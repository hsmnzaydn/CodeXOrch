import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { promisify } from "node:util";
import { assignmentRoute } from "../../core/routes/index.js";
const run = promisify(execFile);
export async function projectPath(cwd) {
    try {
        const { stdout } = await run("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { timeout: 10_000 });
        const path = await realpath(stdout.replace(/\n$/, ""));
        try {
            const { stdout: head } = await run("git", ["-C", cwd, "rev-parse", "HEAD"], { timeout: 10_000 });
            return { path, head: head.trim() };
        }
        catch (error) {
            if (String(error.stderr ?? "").includes("ambiguous argument 'HEAD'"))
                return { path, head: "local" };
            throw error;
        }
    }
    catch (error) {
        const { stderr } = error;
        if (!String(stderr ?? "").includes("not a git repository"))
            throw error;
        return { path: await realpath(cwd), head: "local" };
    }
}
export async function matchesInstalledProject(event, host, root) {
    if (host !== "codex" || !root.endsWith(`${sep}.codexorch${sep}packages`))
        return true;
    const project = resolve(root, "../..");
    const cwd = await realpath(typeof event.cwd === "string" ? event.cwd : process.cwd());
    return cwd === project || cwd.startsWith(project + sep);
}
export function assignedRoute(host, payload) {
    const assignment = payload.assignment;
    if (!assignment || typeof assignment !== "object" || Array.isArray(assignment))
        return undefined;
    const { role, semanticRoute } = assignment;
    if (role === "lead" && semanticRoute === `${host}-lead-model`)
        return `${host}-lead-model`;
    if (typeof role !== "string" || typeof semanticRoute !== "string")
        return undefined;
    try {
        return assignmentRoute(role, semanticRoute).agent === host
            ? semanticRoute : undefined;
    }
    catch {
        return undefined;
    }
}
