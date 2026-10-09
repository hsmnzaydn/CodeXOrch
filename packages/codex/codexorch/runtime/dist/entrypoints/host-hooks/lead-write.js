import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { workerRouteRecipe } from "./worker-route.js";
export const leadRedirect = `Lead orchestrates only. ${workerRouteRecipe(undefined)}`;
function canonical(path) {
    if (existsSync(path))
        return realpathSync(path);
    const parent = dirname(path);
    return parent === path ? path : join(canonical(parent), basename(path));
}
function inside(path, root) {
    return path === root || path.startsWith(root + sep);
}
function permitted(candidate, cwd, repo) {
    const expanded = candidate.replace(/^~(?=\/|$)|^\$HOME(?=\/|$)|^\$\{HOME\}(?=\/|$)/, homedir());
    const path = canonical(resolve(cwd, expanded));
    const rel = relative(repo, path).split(sep).join("/");
    return rel === "CLAUDE.md" || (!inside(path, repo) && inside(path, canonical("/tmp"))) ||
        /^projects\/[^/]+\/memory(?:\/|$)/.test(relative(canonical(join(homedir(), ".claude")), path).split(sep).join("/"));
}
export function classifyLeadWrite(event) {
    if (event.tool_name === "Bash")
        return "allowed";
    const write = ["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(String(event.tool_name));
    if (!write)
        return "allowed";
    const input = event.tool_input;
    if (!input || typeof input !== "object" || typeof event.cwd !== "string")
        return "unknown";
    const cwd = resolve(event.cwd, typeof input.workdir === "string" ? input.workdir : ".");
    try {
        const repo = canonical(execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
            encoding: "utf8", timeout: 1000, stdio: ["ignore", "pipe", "pipe"],
        }).trim());
        return classify(repo);
    }
    catch (error) {
        if (String(error.stderr ?? "").includes("not a git repository"))
            return classify(canonical(cwd));
        return "unknown";
    }
    function classify(repo) {
        const target = input.file_path ?? input.filePath ?? input.path ?? input.notebook_path;
        if (typeof target !== "string" || !target)
            return "unknown";
        return permitted(target, cwd, repo) ? "allowed" : "product-write";
    }
}
export function leadWriteDecision(event, isLead = true) {
    const classification = !isLead ||
        process.env.CODEXORCH_LEAD_WRITE === "off"
        ? "allowed" : classifyLeadWrite(event);
    return classification === "unknown"
        ? { deny: true, note: leadRedirect }
        : classification === "product-write"
            ? { deny: true, note: `LEAD WORK BLOCKED: product write. ${workerRouteRecipe(event.cwd)}` }
            : { deny: false };
}
export function leadGuardFailure(error, worker) {
    if (worker)
        return { exitCode: 0, stderr: "" };
    const message = error instanceof Error ? error.message : "failed";
    return { exitCode: 2,
        stderr: `CodeXOrch guard error: ${message}\n` };
}
