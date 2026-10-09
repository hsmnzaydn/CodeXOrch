import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
export function codexLaunchOptions(command) {
    const model = command.match(/(?:^|\s)(?:-m|--model)(?:\s+|=)(["']?)([A-Za-z0-9._-]+)\1(?:\s|$)/)?.[2];
    const effort = command.match(/(?:^|\s)(?:-c|--config)\s+(?:(["'])?)model_reasoning_effort=(["']?)(low|medium|high|xhigh)\2\1(?:\s|$)/)?.[3];
    return { ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
}
export async function codexLaunchContext(parent = process.ppid) {
    let pid = parent;
    for (let depth = 0; depth < 8 && pid > 1; depth++) {
        let output;
        try {
            output = (await run("ps", ["-p", String(pid), "-o", "ppid=", "-o", "command="], { timeout: 500 })).stdout.trim();
        }
        catch {
            break;
        }
        const match = output.match(/^(\d+)\s+(.+)$/s);
        if (!match?.[1] || !match[2])
            break;
        if (/^(?:\S*\/)?codex(?:\s|$)/.test(match[2]))
            return codexLaunchOptions(match[2]);
        pid = Number(match[1]);
    }
    return {};
}
