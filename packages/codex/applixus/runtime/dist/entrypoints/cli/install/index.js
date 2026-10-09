import { projectInstall } from "../../../core/install/index.js";
import { pruneInstalledPluginCaches } from "../../../core/install/cache-prune.js";
import { recordOutcome } from "../../../core/issues/outcomes.js";
const startedAt = Date.now();
const [action, packageRoot, target, ...flags] = process.argv.slice(2);
const mode = flags.includes("--smoke") ? "smoke" : "project";
const actorIndex = flags.indexOf("--actor-id");
const actorId = actorIndex >= 0 ? flags[actorIndex + 1] : undefined;
if (!["install", "upgrade", "uninstall", "purge"].includes(action ?? "") || !packageRoot || !target ||
    flags.some((flag, index) => flag !== "--smoke" && flag !== "--actor-id" && index !== actorIndex + 1) ||
    (actorIndex >= 0 && !actorId)) {
    console.error("Usage: node dist/entrypoints/cli/install/index.js <install|upgrade|uninstall|purge> <absolute-packages-dir> <absolute-project-dir> [--smoke] [--actor-id ID]");
    process.exitCode = 2;
    await recordOutcome({ command: "install", outcome: "failed", startedAt,
        error: "Invalid install CLI arguments", brief: process.argv.slice(2).join(" ") });
}
else {
    projectInstall(action, packageRoot, target, undefined, mode, actorId)
        .then(async (result) => {
        if (action === "install" || action === "upgrade")
            await pruneInstalledPluginCaches().catch(error => console.error(`Plugin cache prune skipped: ${error.message}`));
        console.log(JSON.stringify(result));
        await recordOutcome({ command: "install", outcome: "succeeded", startedAt, cwd: target,
            brief: process.argv.slice(2).join(" ") });
    })
        .catch(async (error) => {
        console.error(error.message);
        process.exitCode = 1;
        await recordOutcome({ command: "install", outcome: "failed", startedAt, cwd: target,
            error, brief: process.argv.slice(2).join(" ") });
    });
}
