import { appendFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRoutes } from "../../core/routes/index.js";
import { claudeLaunchContext } from "../../core/routes/claude-host.js";
import { codexLaunchContext } from "../../core/routes/codex-host.js";
import { ensureLocalExcludes, graphifyContext } from "./graphify.js";
import { writeBugDraft } from "../../core/issues/draft.js";
import { leadSessionState, nativeSubagent } from "./lead-identity.js";
import { assignedRoute, matchesInstalledProject, projectPath } from "./native-context.js";
import { boundedText, compactTask, contextLimit, localPrompt, projectReference, resumeGoal } from "./local-context.js";
import { workerRouteRecipe } from "./worker-route.js";
import { prepareLocalCore } from "./prompt.js";
process.env.NODE_NO_WARNINGS = "1";
const host = process.argv[2];
const mode = process.argv[3];
const runtime = fileURLToPath(new URL("../../../", import.meta.url));
const sourceRoot = join(runtime, "packages");
const compiledRoot = resolve(runtime, "../../..");
const root = existsSync(join(sourceRoot, host ?? "", "codexorch", "catalog.json"))
    ? sourceRoot : existsSync(join(compiledRoot, host ?? "", "codexorch", "catalog.json"))
    ? compiledRoot : resolve(runtime, "..");
const pluginRoot = host === "claude" && process.env.CLAUDE_PLUGIN_ROOT
    ? resolve(process.env.CLAUDE_PLUGIN_ROOT)
    : existsSync(join(resolve(runtime, ".."), "catalog.json"))
        ? resolve(runtime, "..") : join(root, host ?? "", "codexorch");
const fallbackContract = `Lead orchestrates only: Read/Grep/Glob allowed; no product writes/commands; Agent denied. Workers are exempt.
${workerRouteRecipe(undefined, join(pluginRoot, host === "claude" ? "skills" : "codex-skills", "codexorch/references/render-report.mjs")).replace("<user-checkout>", "the checkout named in the Project line")}
Keep tenant scope; redact secrets. Credentials: recorded owner approval. No mutation replay.`;
let activeEvent = {};
let activeIdentity;
async function emit(event, text) {
    await new Promise((done, reject) => process.stdout.write(`${JSON.stringify({
        hookSpecificOutput: { hookEventName: event, additionalContext: text },
    })}\n`, error => error ? reject(error) : done()));
}
try {
    if (host !== "codex")
        throw new Error("Unknown host");
    const chunks = [];
    for await (const chunk of process.stdin)
        chunks.push(Buffer.from(chunk));
    const event = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    activeEvent = event;
    const identity = mode === "pretool" || mode === "session"
        ? leadSessionState(event, host) : { lead: false, worker: false };
    activeIdentity = identity;
    if (mode === "pretool") {
        if (identity.worker)
            process.exit(0);
        const { leadAgentDecision } = await import("./agent-guard.js");
        const { leadWriteDecision } = await import("./lead-write.js");
        const decision = leadAgentDecision(event, host, identity.lead);
        if (decision.issue) {
            if (host === "claude") {
                process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse",
                        permissionDecision: "deny", permissionDecisionReason: `LEAD WORK BLOCKED: ${decision.issue}` } }) + "\n");
                process.exit(0);
            }
            process.stderr.write(`LEAD WORK BLOCKED: ${decision.issue}\n`);
            process.exit(2);
        }
        const write = host === "claude" ? leadWriteDecision(event, identity.lead) : { deny: false };
        if (write.deny)
            process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse",
                    permissionDecision: "deny", permissionDecisionReason: write.note } }) + "\n");
        process.exit(0);
    }
    if (!(await matchesInstalledProject(event, host, root)))
        process.exit(0);
    const { path, head } = await projectPath(typeof event.cwd === "string" ? event.cwd : process.cwd());
    if (path === dirname(path))
        process.exit(0);
    if (["tool", "compact", "end", "stop"].includes(mode ?? "")) {
        if (mode === "compact" || mode === "end")
            await compactTask(event, host, path);
        if (process.env.CODEXORCH_HOOK_LOG)
            await appendFile(process.env.CODEXORCH_HOOK_LOG, `${JSON.stringify({ event: "native-transcript", host, mode, tool: event.tool_name })}\n`);
        process.exit(0);
    }
    if (mode === "session") {
        const modulePath = fileURLToPath(import.meta.url).split(sep).join("/");
        const pluginCache = modulePath.includes("/plugins/cache/");
        if (!pluginCache)
            ensureLocalExcludes(path);
        if (pluginCache) {
            const { startAutoUpdate } = await import("./auto-update.js");
            startAutoUpdate(host, process.env, undefined, path);
            try {
                const { startIssueAutofile } = await import("./issue-autofile.js");
                startIssueAutofile();
            }
            catch { /* Optional maintenance. */ }
        }
        if (host === "codex") {
            try {
                const { startCodexHealth } = await import("./codex-health.js");
                startCodexHealth();
            }
            catch { /* Nonblocking version trust. */ }
        }
        const lead = identity.lead || (host === "codex" && !nativeSubagent(event) &&
            !assignedRoute(host, event) && !process.env.ORCA_TERMINAL_HANDLE);
        let contract = "";
        let installedSkillPresent = false;
        if (lead) {
            const skill = join(pluginRoot, host === "claude" ? "skills" : "codex-skills", "codexorch/SKILL.md");
            installedSkillPresent = await readFile(skill, "utf8").then(() => true, () => false);
            contract = fallbackContract;
        }
        else if (["reviewer", "security-reviewer"].includes(event.assignment?.role ?? "")) {
            contract = "Read-only source review. Requested tests and build/cache outputs are allowed. Do not edit source, commit, integrate, publish, deploy or dispatch mutating work.";
        }
        const resumed = event.source === "resume" || event.source === "compact";
        if (host === "codex" && event.source === "compact")
            await compactTask(event, host, path);
        const project = await projectReference(host, path, root, head).catch(error => {
            if (lead && !installedSkillPresent && error.code === "ENOENT")
                return `Project: ${path} at ${head}`;
            throw error;
        });
        let projectText = boundedText(project, lead
            ? Math.min(512, contextLimit - Buffer.byteLength(contract) - 2) : 512);
        const restoreCore = resumed ? await prepareLocalCore({ host, packagesRoot: root,
            workspace: { id: `local:${path}`, path, head } }).catch(() => undefined) : undefined;
        const projectLines = project.split("\n");
        const projectTail = [` at ${head}`, ...projectLines.slice(1)].join("\n");
        const projectFloor = Math.max(96, Buffer.byteLength(`Project: ...${projectTail}`));
        const restoreBudget = contextLimit - (lead ? projectFloor : Buffer.byteLength(projectText)) - Buffer.byteLength(contract) - 3;
        const restored = resumed ? await resumeGoal(event, host, path, restoreBudget, restoreCore) : undefined;
        const restoredText = restored?.text ?? "";
        if (lead && restoredText) {
            const projectBudget = Math.min(512, contextLimit - Buffer.byteLength(contract) - Buffer.byteLength(restoredText) - 3);
            projectText = Buffer.byteLength(project) <= projectBudget ? project :
                boundedText((projectLines[0] ?? project).slice(0, -` at ${head}`.length), projectBudget - Buffer.byteLength(projectTail)) + projectTail;
        }
        const required = (lead ? [projectText, contract, restoredText] : [projectText, restoredText, boundedText(contract, contextLimit - Buffer.byteLength(projectText) - Buffer.byteLength(restoredText) - 3)])
            .filter(Boolean).join("\n");
        const extra = resumed ? "" : graphifyContext(path);
        const context = lead ? [required, boundedText(extra, contextLimit - Buffer.byteLength(required) - 1)]
            .filter(Boolean).join("\n") : boundedText([required, extra].filter(Boolean).join("\n"), contextLimit);
        if (process.env.CODEXORCH_HOOK_LOG) {
            const routes = await loadRoutes(root, host);
            const launch = host === "codex" ? await codexLaunchContext() : await claudeLaunchContext();
            const assignment = assignedRoute(host, event);
            const route = assignment ? routes[assignment] : undefined;
            await appendFile(process.env.CODEXORCH_HOOK_LOG, `${JSON.stringify({
                event: "host-init", host, requestedRoute: event.model ?? launch.model ?? "unknown",
                effectiveModel: "unknown", projectedRoute: launch.model ?? route?.route ?? "unknown",
                requestedEffort: event.effort ?? launch.effort ?? route?.effort ?? "unknown",
                effectiveEffort: "unknown", latencyMs: "unknown",
            })}\n`);
        }
        await emit("SessionStart", context);
        if (restored?.text)
            await restored.acknowledge();
    }
    else {
        const result = await localPrompt(event, host, path, root, head);
        await emit("UserPromptSubmit", result.text);
        await result.acknowledge();
    }
    process.exit(0);
}
catch (error) {
    if (mode === "pretool") {
        const { leadGuardFailure } = await import("./lead-write.js");
        const failure = leadGuardFailure(error, Boolean(activeIdentity?.worker || nativeSubagent(activeEvent)));
        process.stderr.write(failure.stderr);
        process.exitCode = failure.exitCode;
    }
    else {
        const message = error instanceof Error ? error.message : "failed";
        process.stderr.write(`CodeXOrch prompt hook: ${message}\n`);
        process.exitCode = 1;
    }
    if (process.exitCode !== 0)
        await writeBugDraft({ host: host ?? "unknown", event: "hook", step: mode ?? "prompt", error });
}
