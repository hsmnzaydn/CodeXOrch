import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { codexRequest } from "../../adapters/codex-app-server.js";
import { toolkitCodexProvider } from "../routes/index.js";
import { at, inside, record, set, stat, writeJson } from "./state.js";
import { codexorchHookPrefix, reconcileCodexHookDeclarations } from "./codex-hooks.js";
export async function configureCodex(homePath, target, route, previous = [], smoke = false) {
    if (!isAbsolute(homePath))
        throw new Error("CODEX_HOME must be absolute");
    await mkdir(homePath, { recursive: true });
    const home = await realpath(homePath);
    const tempRoots = await Promise.all([tmpdir(), "/tmp"].map((path) => realpath(path)));
    if ((smoke && !tempRoots.some((root) => inside(home, root))) || inside(home, join(homedir(), ".codex"))) {
        throw new Error("CODEX_HOME must be isolated under a temporary directory");
    }
    const path = join(home, "hooks.json");
    const existing = await stat(path);
    const document = existing ? JSON.parse(await readFile(path, "utf8")) : { hooks: {} };
    if (!document.hooks || typeof document.hooks !== "object" || Array.isArray(document.hooks))
        throw new Error(`Invalid Codex hooks: ${path}`);
    const added = [];
    const script = join(target, ".codexorch", "packages", "codex", "codexorch", "runtime", "dist", "entrypoints", "host-hooks", "native.js");
    for (const [event, suffix, timeout] of [["SessionStart", " session", 5], ["UserPromptSubmit", "", 30]]) {
        const command = `node "${script}" codex${suffix}`;
        const groups = document.hooks[event] ?? [];
        if (!Array.isArray(groups))
            throw new Error(`Invalid Codex hook group: ${event}`);
        if (!groups.some((group) => Array.isArray(group.hooks) && group.hooks.some((hook) => hook.command === command))) {
            const group = { hooks: [{ type: "command", command, timeout }] };
            groups.push(group);
            added.push({ event, group });
        }
        document.hooks[event] = groups;
    }
    const serialized = JSON.stringify(document, null, 2) + "\n";
    if (!existing || await readFile(path, "utf8") !== serialized) {
        await writeJson(path, document);
    }
    let configState;
    await codexRequest(home, target, async (send) => {
        const configPath = join(home, "config.toml");
        let expectedVersion = null;
        const user = async () => {
            const response = await send("config/read", { includeLayers: true, cwd: target });
            const layer = response.layers?.find((layer) => layer.name.type === "user" &&
                layer.name.file === configPath && !layer.name.profile);
            expectedVersion = layer?.version ?? null;
            return layer?.config ?? {};
        };
        const before = await user();
        const previousConfig = previous.find((host) => host.path === configPath);
        const retiredBrokerEdits = (previousConfig?.changes ?? []).flatMap((change) => {
            if (change.key.length !== 2 || change.key[0] !== "mcp_servers" ||
                !change.key[1]?.startsWith("codexorch_broker_"))
                return [];
            const current = at(before, change.key);
            if (!current.present || JSON.stringify(current.value) !== JSON.stringify(change.after))
                return [];
            return [{ keyPath: change.key.join("."), value: change.hadBefore ? change.before : null,
                    mergeStrategy: "replace" }];
        });
        let result = await send("hooks/list", { cwds: [target] });
        const pluginHooks = (result.data[0]?.hooks ?? []).filter(hook => hook.key.startsWith(codexorchHookPrefix));
        await reconcileCodexHookDeclarations(send, home, Object.fromEntries([["SessionStart", " session"], ["UserPromptSubmit", ""]].map(([event, suffix]) => [event, [`node "${script}" codex${suffix}`]])), pluginHooks);
        result = await send("hooks/list", { cwds: [target] });
        await user();
        const trusted = Object.fromEntries((result.data[0]?.hooks ?? [])
            .filter((hook) => hook.sourcePath === path || hook.key.startsWith(codexorchHookPrefix))
            .map((hook) => [hook.key, { trusted_hash: hook.currentHash }]));
        if (![["sessionStart", " session"], ["userPromptSubmit", ""]].every(([event, suffix]) => (result.data[0]?.hooks ?? []).filter(item => trusted[item.key] &&
            (item.command === `node "${script}" codex${suffix}` ||
                item.enabled !== false && item.eventName === event && item.key.startsWith(codexorchHookPrefix))).length === 1))
            throw new Error("Codex did not discover both installed hooks");
        const edits = [
            ...retiredBrokerEdits,
            { keyPath: "model", value: route.route, mergeStrategy: "replace" },
            ...(route.effort ? [{ keyPath: "model_reasoning_effort", value: route.effort, mergeStrategy: "replace" }] : []),
            { keyPath: "model_provider", value: toolkitCodexProvider.id, mergeStrategy: "replace" },
            { keyPath: `model_providers.${toolkitCodexProvider.id}`, value: toolkitCodexProvider.config,
                mergeStrategy: "upsert" },
            { keyPath: "hooks.state", value: trusted, mergeStrategy: "upsert" },
        ];
        await send("config/batchWrite", {
            edits,
            filePath: null, expectedVersion, reloadUserConfig: true,
        });
        const after = await user();
        const keys = [["model"], ...(route.effort ? [["model_reasoning_effort"]] : []), ["model_provider"],
            ["model_providers", "nine_router"],
            ...Object.keys(trusted).map((key) => ["hooks", "state", key])];
        configState = { path: configPath, changes: record(before, after, keys, previousConfig) };
    });
    return [
        { path, changes: [], hooks: [...(previous.find((host) => host.path === path)?.hooks ?? []), ...added] },
        configState,
    ];
}
export async function restoreCodex(host, home, target, skipped, shared) {
    await codexRequest(home, target, async (send) => {
        const response = await send("config/read", { includeLayers: true, cwd: target });
        const layer = response.layers?.find((layer) => layer.name.type === "user" &&
            layer.name.file === host.path && !layer.name.profile);
        const current = layer?.config ?? {};
        const trust = structuredClone(at(current, ["hooks", "state"]).value ?? {});
        let trustChanged = false;
        const edits = host.changes.flatMap((change) => {
            if (shared && change.key[0] !== "hooks" && change.key[0] !== "mcp_servers") {
                skipped.push(`${host.path}: ${change.key.join(".")} retained for another project`);
                return [];
            }
            const value = at(current, change.key);
            if (value.present && JSON.stringify(value.value) === JSON.stringify(change.after)) {
                if (change.key[0] === "hooks" && change.key[1] === "state") {
                    if (change.hadBefore)
                        trust[change.key[2]] = change.before;
                    else
                        delete trust[change.key[2]];
                    trustChanged = true;
                    return [];
                }
                return [{ keyPath: change.key.join("."), value: change.hadBefore ? change.before : null, mergeStrategy: "replace" }];
            }
            skipped.push(`${host.path}: ${change.key.join(".")} changed`);
            return [];
        });
        if (trustChanged)
            edits.push({ keyPath: "hooks.state",
                value: Object.keys(trust).length ? trust : null, mergeStrategy: "replace" });
        if (edits.length)
            await send("config/batchWrite", {
                edits, filePath: null, expectedVersion: layer?.version ?? null, reloadUserConfig: true,
            });
    });
}
