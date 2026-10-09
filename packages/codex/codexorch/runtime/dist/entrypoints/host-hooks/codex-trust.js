import { codexRequest } from "../../adapters/codex-app-server.js";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { codexorchHookPrefix, reconcileCodexHookDeclarations } from "../../core/install/codex-hooks.js";
const corePrefix = codexorchHookPrefix;
export async function trustCodeXOrchHooks(send, cwd, home) {
    const result = await send("hooks/list", { cwds: [cwd] });
    const hooks = (result.data?.[0]?.hooks ?? []).filter((hook) => hook.key.startsWith(corePrefix) && /^sha256:[0-9a-f]{64}$/.test(hook.currentHash));
    const expected = ["session_start", "user_prompt_submit", "session_end"];
    if (!expected.every((event) => hooks.some((hook) => hook.key === `${corePrefix}${event}:0:0`)))
        throw new Error("CodeXOrch Codex core hooks not discovered");
    if (home) {
        const owned = {};
        for (const hook of hooks) {
            if (!hook.command || !hook.eventName)
                continue;
            const event = hook.eventName[0].toUpperCase() + hook.eventName.slice(1);
            (owned[event] ??= []).push(hook.command);
        }
        const script = join(realpathSync(cwd), ".codexorch/packages/codex/codexorch/runtime/dist/entrypoints/host-hooks/native.js");
        (owned.SessionStart ??= []).push(`node "${script}" codex session`);
        (owned.UserPromptSubmit ??= []).push(`node "${script}" codex`);
        await reconcileCodexHookDeclarations(send, home, owned, hooks);
    }
    const trusted = Object.fromEntries(hooks.map((hook) => [hook.key, { trusted_hash: hook.currentHash }]));
    await send("config/batchWrite", { edits: [
            { keyPath: "hooks.state", value: trusted, mergeStrategy: "upsert" },
        ], filePath: null, expectedVersion: null, reloadUserConfig: true });
}
export async function trustInstalledCodeXOrchHooks(home, cwd, binary, env) {
    await codexRequest(home, cwd, (send) => trustCodeXOrchHooks(send, cwd, home), binary, env);
}
export function isTrustEntrypoint(path, moduleUrl) {
    return realpathSync(path) === fileURLToPath(moduleUrl);
}
if (process.argv[1] && isTrustEntrypoint(process.argv[1], import.meta.url)) {
    trustInstalledCodeXOrchHooks(process.env.CODEX_HOME ?? join(homedir(), ".codex"), process.cwd(), "codex", process.env).catch((error) => {
        if (error.code === "ENOENT") {
            process.stderr.write("CodeXOrch Codex hook trust skipped: codex binary not found on PATH\n");
            return;
        }
        process.stderr.write(`CodeXOrch Codex hook trust failed: ${error.message}\n`);
        process.exitCode = 1;
    });
}
