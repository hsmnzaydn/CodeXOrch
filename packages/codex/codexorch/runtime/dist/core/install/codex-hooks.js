import { randomUUID } from "node:crypto";
import { readFile, realpath, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
export const codexorchHookPrefix = "codexorch@codexorch:codex-hooks/hooks.json:";
export async function reconcileCodexHookDeclarations(send, home, owned, pluginHooks = []) {
    const canonicalHome = await realpath(home);
    const path = join(canonicalHome, "hooks.json");
    const original = await readFile(path, "utf8").catch((error) => {
        if (error.code === "ENOENT")
            return undefined;
        throw error;
    });
    const document = original === undefined ? { hooks: {} } : JSON.parse(original);
    if (!document.hooks || typeof document.hooks !== "object" || Array.isArray(document.hooks))
        throw new Error(`Invalid Codex hooks: ${path}`);
    const response = await send("config/read", { includeLayers: true });
    const layer = response.layers?.find(item => item.name.type === "user" &&
        [join(home, "config.toml"), join(canonicalHome, "config.toml")].includes(item.name.file ?? "") && !item.name.profile);
    const edits = [];
    for (const [event, commands] of Object.entries(owned)) {
        const isOwned = (hook) => commands.includes(hook.command ?? "");
        const native = pluginHooks.some(hook => hook.enabled !== false && hook.eventName ===
            event[0].toLowerCase() + event.slice(1) && hook.key.startsWith(codexorchHookPrefix));
        let retained = false;
        const filterGroups = (groups) => groups.flatMap(group => {
            if (!Array.isArray(group.hooks))
                return [group];
            const hooks = group.hooks.filter(hook => {
                if (!isOwned(hook))
                    return true;
                if (native || retained)
                    return false;
                retained = true;
                return true;
            });
            return hooks.length ? [{ ...group, hooks }] : group.hooks.length ? [] : [group];
        });
        const groups = document.hooks[event];
        if (Array.isArray(groups)) {
            const filtered = filterGroups(groups);
            if (filtered.length)
                document.hooks[event] = filtered;
            else
                delete document.hooks[event];
        }
        const tomlGroups = layer?.config.hooks?.[event];
        if (Array.isArray(tomlGroups)) {
            const filtered = filterGroups(tomlGroups);
            if (JSON.stringify(filtered) !== JSON.stringify(tomlGroups))
                edits.push({ keyPath: `hooks.${event}`, value: filtered.length ? filtered : null,
                    mergeStrategy: "replace" });
        }
    }
    if (original !== undefined && JSON.stringify(JSON.parse(original)) !== JSON.stringify(document)) {
        if (await readFile(path, "utf8") !== original)
            throw new Error(`Codex hooks changed during reconcile: ${path}`);
        const temp = `${path}.${randomUUID()}.tmp`;
        await writeFile(temp, JSON.stringify(document, null, 2) + "\n", { flag: "wx" });
        await rename(temp, path);
    }
    if (edits.length)
        await send("config/batchWrite", {
            edits, filePath: null, expectedVersion: layer?.version ?? null, reloadUserConfig: true,
        });
}
