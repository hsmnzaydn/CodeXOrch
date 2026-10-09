import { spawnSync } from "node:child_process";
import { accessSync, appendFileSync, closeSync, constants, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
export function findGraphify(env = process.env) {
    const name = process.platform === "win32" ? "graphify.exe" : "graphify";
    const home = env.HOME ?? env.USERPROFILE ?? homedir();
    const dirs = [...(env.PATH ?? "").split(delimiter).filter(isAbsolute),
        join(home, ".local", "bin"), join(home, ".cargo", "bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
    for (const dir of new Set(dirs)) {
        const candidate = join(dir, name);
        try {
            accessSync(candidate, constants.X_OK);
            return candidate;
        }
        catch { /* Next known path. */ }
    }
    return undefined;
}
const localExcludes = ["graphify-out/", ".codexorch/"];
function gitOut(root, args) {
    const out = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", timeout: 3_000, stdio: "pipe" });
    return out.status === 0 && !out.error ? out.stdout.trim() : undefined;
}
export function ensureLocalExcludes(root) {
    try {
        if (!existsSync(join(root, ".git")))
            return [];
        const rel = gitOut(root, ["rev-parse", "--git-path", "info/exclude"]);
        if (!rel)
            return [];
        const file = resolve(root, rel);
        let current = "";
        try {
            current = readFileSync(file, "utf8");
        }
        catch { /* No local excludes yet. */ }
        const lines = new Set(current.split(/\r?\n/).map(line => line.trim()));
        const missing = localExcludes.filter(entry => !lines.has(entry));
        if (!missing.length)
            return [];
        const ignored = spawnSync("git", ["-C", root, "check-ignore", "--stdin"], {
            input: `${missing.join("\n")}\n`, encoding: "utf8", timeout: 3_000, stdio: "pipe",
        });
        const present = new Set(ignored.status === 0 ? ignored.stdout.trim().split(/\r?\n/) : []);
        const fresh = missing.filter(entry => !present.has(entry));
        if (!fresh.length)
            return [];
        mkdirSync(dirname(file), { recursive: true });
        appendFileSync(file, `${current === "" || current.endsWith("\n") ? "" : "\n"}${fresh.join("\n")}\n`);
        return fresh;
    }
    catch {
        return [];
    }
}
export function graphStatus(root) {
    let mtime;
    try {
        mtime = statSync(join(root, "graphify-out", "graph.json")).mtimeMs;
    }
    catch {
        return { present: false, stale: false, git: existsSync(join(root, ".git")) };
    }
    const git = existsSync(join(root, ".git"));
    let stale = false;
    if (git) {
        const head = spawnSync("git", ["-C", root, "log", "-1", "--format=%ct"], { encoding: "utf8", timeout: 1_500 });
        const committed = Number(head.stdout?.trim());
        stale = head.status === 0 && Number.isFinite(committed) && committed * 1000 > mtime;
    }
    let nodes;
    try {
        const descriptor = openSync(join(root, "graphify-out", "GRAPH_REPORT.md"), "r");
        try {
            const buffer = Buffer.alloc(4096);
            const match = buffer.subarray(0, readSync(descriptor, buffer, 0, buffer.length, 0))
                .toString("utf8").match(/(\d[\d,]*) nodes/);
            if (match?.[1])
                nodes = Number(match[1].replaceAll(",", ""));
        }
        finally {
            closeSync(descriptor);
        }
    }
    catch { /* A report is optional. */ }
    return { present: true, stale, git, ...(nodes === undefined ? {} : { nodes }) };
}
export function graphifyContext(root, env = process.env, options = {}) {
    try {
        const status = graphStatus(root);
        const cli = options.cli ?? Boolean(findGraphify(env));
        if (!status.present)
            return `graphify: no graph for this project${cli ? "" : "; CLI not installed"}. Use Grep/Glob/Read; run graphify update . to create one.`;
        const state = `${status.stale ? "stale" : "fresh"}${status.nodes ? `, ${status.nodes} nodes` : ""}`;
        if (status.stale)
            return `graphify: graph ${state}${cli ? "" : "; CLI not installed"}. Use Grep/Glob/Read for current source; graphify query/path/explain only for cross-module relationships, or run graphify update . first.`;
        return `graphify: graph ${state}${cli ? "" : "; CLI not installed"}. For file/code discovery run graphify query "<q>" | explain "<x>" | path "<a>" "<b>" first, then Grep/Glob/Read.`;
    }
    catch {
        return "";
    }
}
