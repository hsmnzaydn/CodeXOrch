import { constants } from "node:fs";
import { access, readdir, readFile, readlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { delimiter, isAbsolute, join } from "node:path";
import { homedir, tmpdir } from "node:os";
export function marketplaceRevision(root, env, cwd, timeout, retainedLocal = false) {
    const git = (...args) => {
        const result = spawnSync("git", ["-C", root, ...args], { env, cwd, timeout, encoding: "utf8", stdio: "pipe" });
        if (result.status !== 0 || result.error)
            throw new Error(result.stderr?.trim() || result.error?.message || `git ${args.join(" ")} failed`);
        return result.stdout.trim();
    };
    git("fetch", "--quiet", "origin", "main");
    const revision = git("rev-parse", "FETCH_HEAD");
    if (retainedLocal) {
        if (git("status", "--porcelain"))
            throw new Error("retained local marketplace working tree is dirty");
        git("merge", "--ff-only", "FETCH_HEAD");
        if (git("rev-parse", "HEAD") !== revision)
            throw new Error("retained local marketplace HEAD differs from fetched revision");
    }
    return { revision, version: packageVersion(git("show", `${revision}:package.json`)),
        files(plugin) {
            const prefix = `packages/codex/${plugin}/`;
            return new Map(git("ls-tree", "-rz", revision, "--", prefix).split("\0").filter(Boolean)
                .map(entry => {
                const [header, path] = entry.split("\t");
                const [mode, , oid] = header.split(" ");
                return [path.slice(prefix.length), `${mode} ${oid}`];
            }));
        } };
}
export async function installedContent(root, oidLength = 40) {
    const files = new Map();
    async function walk(directory, prefix = "") {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            const path = join(directory, entry.name);
            const relative = `${prefix}${entry.name}`;
            if (entry.isDirectory())
                await walk(path, `${relative}/`);
            else {
                const content = entry.isSymbolicLink() ? Buffer.from(await readlink(path)) : await readFile(path);
                const oid = createHash(oidLength === 64 ? "sha256" : "sha1")
                    .update(`blob ${content.length}\0`).update(content).digest("hex");
                // Executability is host-dependent; symlink identity is not.
                files.set(relative, `${entry.isSymbolicLink() ? "120000" : "100644"} ${oid}`);
            }
        }
    }
    await walk(root);
    return files;
}
export function contentMatches(expected, actual) {
    return expected.size > 0 && expected.size === actual.size && [...expected].every(([path, object]) => actual.get(path) === object.replace(/^100755 /, "100644 "));
}
export function packageVersion(text) {
    try {
        const version = JSON.parse(text).version;
        return typeof version === "string" && /^\d+\.\d+\.\d+/.test(version) ? version : undefined;
    }
    catch {
        return undefined;
    }
}
export function neutralCwd(env) {
    const home = env.HOME ?? env.USERPROFILE;
    return home && isAbsolute(home) ? home : homedir() || tmpdir();
}
export function configDir(host, env) {
    const home = env.HOME ?? env.USERPROFILE ?? "";
    return host === "claude" ? env.CLAUDE_CONFIG_DIR || join(home, ".claude")
        : env.CODEX_HOME || join(home, ".codex");
}
export function binaryCandidates(host, env) {
    const home = env.HOME ?? env.USERPROFILE ?? "";
    const name = process.platform === "win32" ? `${host}.exe` : host;
    const paths = (env.PATH ?? "").split(delimiter).filter(dir => dir !== "" && isAbsolute(dir));
    return [...paths.map(dir => join(dir, name)),
        ...["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin",
            join(home, ".local", "bin"), join(home, ".npm-global", "bin")].map(dir => join(dir, name)),
        ...(host === "claude" ? [
            join(home, "Applications", "Claude.app", "Contents", "MacOS", "claude"),
            "/Applications/Claude.app/Contents/MacOS/claude",
            ...(env.LOCALAPPDATA ? [join(env.LOCALAPPDATA, "Claude", "claude.exe")] : []),
        ] : [])];
}
export async function findBinary(host, env, candidates = binaryCandidates(host, env)) {
    for (const candidate of candidates) {
        try {
            await access(candidate, constants.X_OK);
            return candidate;
        }
        catch { /* Try the next known binary location. */ }
    }
    return undefined;
}
