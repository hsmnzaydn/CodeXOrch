import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
const run = promisify(execFile);
const efforts = ["low", "medium", "high", "xhigh", "max"];
const pick = (value, allowed) => typeof value === "string" && /^[A-Za-z0-9._\[\]-]+$/.test(value) && (!allowed || allowed.includes(value))
    ? value : undefined;
export function claudeLaunchOptions(command) {
    const model = command.match(/(?:^|\s)--model(?:\s+|=)(["']?)([A-Za-z0-9._\[\]-]+)\1(?:\s|$)/)?.[2];
    const effort = pick(command.match(/(?:^|\s)--effort(?:\s+|=)(["']?)([A-Za-z]+)\1(?:\s|$)/)?.[2], efforts);
    const settings = command.match(/(?:^|\s)--settings(?:\s+|=)([^\s"'{][^\s"']*)(?:\s|$)/)?.[1];
    return { ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(settings ? { settings } : {}) };
}
export function claudeSettingsRoute(file) {
    try {
        const data = JSON.parse(readFileSync(file, "utf8"));
        const model = pick(data.model);
        const effort = pick(data.effortLevel, efforts);
        return { ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
    }
    catch {
        return {};
    }
}
export function claudeEnvRoute(env) {
    const model = pick(env.ANTHROPIC_MODEL);
    const effort = pick(env.CLAUDE_CODE_EFFORT_LEVEL, efforts);
    return { ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
}
function claudeSettingsFiles(env, project) {
    const config = env.CLAUDE_CONFIG_DIR || join(env.HOME || homedir(), ".claude");
    return [join(project, ".claude", "settings.local.json"), join(project, ".claude", "settings.json"),
        join(config, "settings.json")];
}
export function resolveClaudeRoute(launch, env, project) {
    const sources = [launch, claudeEnvRoute(env)];
    const files = [...(launch.settings ? [resolve(project, launch.settings)] : []), ...claudeSettingsFiles(env, project)];
    for (const file of files)
        sources.push(claudeSettingsRoute(file));
    const model = sources.find((source) => source.model)?.model;
    const effort = sources.find((source) => source.effort)?.effort;
    return { ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
}
async function claudeLaunchArgs(parent = process.ppid) {
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
        if (/^(?:\S*\/)?claude(?:\s|$)/.test(match[2]))
            return claudeLaunchOptions(match[2]);
        pid = Number(match[1]);
    }
    return {};
}
export async function claudeLaunchContext(parent = process.ppid, env = process.env, project = env.CLAUDE_PROJECT_DIR || process.cwd()) {
    try {
        return resolveClaudeRoute(await claudeLaunchArgs(parent), env, project);
    }
    catch {
        return {};
    }
}
