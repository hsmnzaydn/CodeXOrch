import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { codexUsage } from "./codex-usage.js";
const execute = promisify(execFile);
const text = (value) => typeof value === "string" ? value : "unknown";
const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
function preStartRejection(envelope) {
    if (envelope.ok !== false)
        return false;
    const error = object(envelope.error);
    const data = object(error.data);
    if (data.effectsApplied === false)
        return true;
    const acceptedOrUncertain = (value) => {
        if (!value || typeof value !== "object")
            return false;
        if (Array.isArray(value))
            return value.some(acceptedOrUncertain);
        const item = value;
        if (item.effectsApplied === true ||
            (item.kind === "terminal" && item.role === "agent" && item.action === "created"))
            return true;
        return Object.entries(item).some(([key, child]) => (["dispatchId", "dispatch_id", "agentTerminalHandle", "agent_terminal_handle"].includes(key) &&
            typeof child === "string" && !!child) ||
            (["code", "failedStage"].includes(key) &&
                typeof child === "string" && /agent_readiness|outcome_unknown/.test(child)) ||
            acceptedOrUncertain(child));
    };
    return !acceptedOrUncertain(error);
}
export class OrcaCli {
    async dispatchCapability() {
        const { stdout: help } = await execute("orca", ["orchestration", "worker-start", "--help"], { timeout: 10_000 });
        if (!/--task\b/.test(help) || !/--base-branch\b/.test(help))
            throw new Error("Orca portable dispatch flags unavailable");
        const status = await this.run(["status"]);
        if (status.runtime?.reachable !== true)
            throw new Error("Orca runtime unreachable");
        if (status.runtime.appVersion) {
            const { stdout } = await execute("orca", ["--version"], { timeout: 10_000 });
            if (stdout.match(/\d+\.\d+\.\d+/)?.[0] !== status.runtime.appVersion)
                throw new Error("Orca CLI and running runtime differ; update the runtime after the owner session closes");
        }
    }
    async run(args, timeoutMs = 30_000, options = {}) {
        const env = { ...process.env };
        if (options.unbound)
            delete env.ORCA_TERMINAL_HANDLE;
        let stdout;
        let stderr;
        try {
            const pending = execute("orca", [...args, "--json"], {
                env, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024,
            });
            pending.child.stdin?.end();
            ({ stdout, stderr } = await pending);
        }
        catch (cause) {
            const failure = cause;
            if (args[1] === "worker-start") {
                try {
                    const envelope = JSON.parse(failure.stdout ?? "");
                    if (envelope.ok === true && envelope.result?.dispatchId)
                        return envelope.result;
                }
                catch { /* A non-receipt failure remains a native failure. */ }
            }
            let notSent = args[1] !== "worker-start";
            if (!notSent && failure.killed !== true) {
                try {
                    notSent = preStartRejection(object(JSON.parse(failure.stdout ?? "")));
                }
                catch {
                    notSent = failure.code === "ENOENT";
                }
            }
            throw Object.assign(new Error(`Orca ${args[0]} ${args[1]} failed:\n${failure.stdout ?? ""}\n${failure.stderr ?? ""}`, { cause }), { stdout: failure.stdout, stderr: failure.stderr, code: failure.code,
                timedOut: failure.killed === true, notSent });
        }
        let envelope;
        try {
            envelope = JSON.parse(stdout);
        }
        catch (cause) {
            throw new Error(`Invalid JSON from orca ${[...args, "--json"].join(" ")}: ${cause.message}`, { cause });
        }
        if (envelope.ok !== true)
            throw Object.assign(new Error(`Orca ${args[0]} ${args[1]} failed:\n${stdout}\n${stderr}`), { stdout, stderr, orcaCode: envelope.error?.code,
                notSent: args[1] !== "worker-start" || preStartRejection(envelope) });
        return envelope.result;
    }
    async currentWorkspace(timeoutMs = 30_000) {
        let result;
        try {
            result = await this.run(["worktree", "current"], timeoutMs);
        }
        catch (error) {
            if (!error.stdout?.includes("selector_not_found"))
                throw error;
            const { stdout } = await execute("git", ["rev-parse", "--show-toplevel"]);
            result = await this.run(["worktree", "show", "--worktree", `path:${stdout.trim()}`], timeoutMs);
        }
        const tree = object(result.worktree);
        return { id: text(tree.id), path: text(tree.path), head: tree.head === "local" ? "local" :
                (await execute("git", ["-C", text(tree.path), "rev-parse", "HEAD"])).stdout.trim() };
    }
    async observe(dispatchId) {
        const result = await this.run(["orchestration", "worker-show", "--dispatch", dispatchId]);
        const dispatch = object(result.dispatch);
        const worker = object(result.worker);
        const terminal = object(result.terminal);
        const resource = object(result.terminalResource);
        const projection = object(result.projection);
        const requested = object(worker.startOptions?.launch?.requested);
        const effective = object(worker.startOptions?.launch?.effective);
        const liveness = object(projection.liveness);
        const agent = requested.agent;
        const reporting = agent === "codex"
            ? await codexUsage(worker.cwd ?? worker.childPath ?? terminal.worktreePath)
            : { resolvedBackend: "unknown", usage: "unknown" };
        return {
            runId: text(dispatch.runId ?? dispatch.run_id),
            taskId: text(dispatch.taskId ?? dispatch.task_id),
            dispatchId,
            ...(dispatch.retryOfDispatchId ? { retryOfDispatchId: text(dispatch.retryOfDispatchId) } : {}),
            workspaceId: text(worker.worktreeId ?? worker.worktree_id),
            terminalHandle: text(worker.agentTerminalHandle ?? worker.agent_terminal_handle ?? terminal.handle ??
                resource.terminalHandle ?? dispatch.assigneeHandle),
            host: agent === "claude" || agent === "codex" ? agent : "unknown",
            processIncarnation: text(dispatch.processIncarnation ?? dispatch.process_incarnation),
            state: text(dispatch.status), transcriptSource: "unknown",
            requestedRoute: text(requested.model), effectiveRoute: text(effective.model),
            projectedRoute: text(projection.provider?.model), resolvedBackend: reporting.resolvedBackend,
            requestedEffort: text(requested.effort), effectiveEffort: text(effective.effort),
            gatewayVersion: "unknown", usage: reporting.usage,
            agentLiveness: liveness.verdict === "live" || liveness.verdict === "exited" ? liveness.verdict : "unverifiable",
            livenessSource: text(liveness.source),
        };
    }
}
