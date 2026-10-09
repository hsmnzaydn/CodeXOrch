import { execFileSync } from "node:child_process";
export function leadSessionState(event, host, env = process.env) {
    if (host !== "claude")
        return { lead: false, worker: true };
    if (env.CODEXORCH_LEAD_WRITE === "off")
        return { lead: false, worker: false };
    if (event.agent_id || event.agent_type || event.is_subagent === true || event.agent_role ||
        event.thread_source === "subagent")
        return { lead: false, worker: true };
    const handle = env.ORCA_TERMINAL_HANDLE;
    if (!handle)
        return { lead: true, worker: false };
    try {
        const output = execFileSync("orca", ["orchestration", "worker-list", "--terminal-state", "active", "--json"], {
            encoding: "utf8", timeout: 1500, maxBuffer: 2 * 1024 * 1024, stdio: "pipe",
        });
        const result = JSON.parse(output);
        const worker = result.ok === true && Array.isArray(result.result?.workers) && result.result.workers.some((value) => {
            if (!value || typeof value !== "object" || Array.isArray(value))
                return false;
            const row = value;
            const projection = row.projection;
            const provider = projection?.provider;
            return row.agentTerminalHandle === handle && provider?.id === host && row.terminalState === "active";
        });
        return worker ? { lead: false, worker: true } : { lead: true, worker: false };
    }
    catch {
        return { lead: true, worker: false };
    }
}
export function nativeSubagent(event) {
    return Boolean(event.agent_id || event.agent_type || event.is_subagent === true ||
        event.agent_role || event.thread_source === "subagent");
}
