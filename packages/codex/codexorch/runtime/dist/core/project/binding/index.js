import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
const execute = promisify(execFile);
async function git(root, ...args) {
    const { stdout } = await execute("git", ["-C", root, ...args], {
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
}
export async function bindProject(workspace, packs = []) {
    if (!workspace.id || !workspace.path || !workspace.head)
        throw new Error("Incomplete Orca workspace");
    const workspaceRoot = await realpath(workspace.path);
    const [top, snapshot, origin] = await Promise.allSettled([
        git(workspaceRoot, "rev-parse", "--show-toplevel"),
        git(workspaceRoot, "status", "--porcelain=v2", "--branch", "--untracked-files=normal"),
        git(workspaceRoot, "config", "--get", "remote.origin.url"),
    ]);
    let gitRoot;
    if (top.status === "fulfilled")
        gitRoot = top.value;
    else {
        if (!String(top.reason.stderr ?? "").includes("not a git repository"))
            throw top.reason;
    }
    const root = gitRoot ? await realpath(gitRoot) : workspaceRoot;
    if (root !== workspaceRoot)
        throw new Error("Workspace is not Git root");
    if (gitRoot && snapshot.status === "rejected")
        throw snapshot.reason;
    const status = gitRoot && snapshot.status === "fulfilled" ? snapshot.value.split("\n") : [];
    const oid = status.find(line => line.startsWith("# branch.oid "))?.slice(13);
    const branch = status.find(line => line.startsWith("# branch.head "))?.slice(14);
    const commit = oid && oid !== "(initial)" ? oid : "local";
    if (gitRoot && commit !== "local" && commit !== workspace.head)
        throw new Error("Orca workspace head differs from Git HEAD");
    let remote = gitRoot && origin.status === "fulfilled" ? origin.value : "";
    if (remote.startsWith("file://")) {
        try {
            const source = fileURLToPath(remote);
            remote = await git(source, "config", "--get", "remote.origin.url");
            if (remote.startsWith("file://"))
                remote = "";
        }
        catch {
            remote = "";
        }
    }
    const match = remote.match(/(?:^|[/:])([^/:]+)\/([^/]+?)(?:\.git)?$/);
    const host = remote.match(/^(?:https?:\/\/|ssh:\/\/git@)([^/:]+)|^[^@]+@([^:]+):/);
    const provider = host?.[1] ?? host?.[2] ?? "local";
    const repository = match && provider !== "local" ? `${provider}:${match[1]}/${match[2]}` : `local:${root}`;
    const projectPacks = packs.filter((pack) => pack.projectPack);
    const registered = projectPacks.filter((pack) => pack.repositoryIds.some((id) => id.toLowerCase() === repository.toLowerCase()));
    if (registered.length > 1)
        throw new Error("Ambiguous project registry binding");
    const folderNames = new Set([basename(root).toLowerCase()]);
    if (gitRoot && !registered.length) {
        try {
            const common = await realpath(resolve(root, await git(root, "rev-parse", "--git-common-dir")));
            const admin = await realpath(await git(root, "rev-parse", "--absolute-git-dir"));
            const main = dirname(common);
            if (basename(common) === ".git" && dirname(admin) === resolve(common, "worktrees") &&
                await realpath((await readFile(resolve(admin, "gitdir"), "utf8")).trim()) ===
                    await realpath(resolve(root, ".git")) &&
                await realpath(await git(main, "rev-parse", "--show-toplevel")) === main &&
                await realpath(await git(main, "rev-parse", "--absolute-git-dir")) === common)
                folderNames.add(basename(main).toLowerCase());
        }
        catch { /* Missing checkout metadata cannot supply another folder identity. */ }
    }
    const discovered = registered.length ? [] : (await Promise.all(projectPacks.map(async (pack) => {
        const folder = pack.folders.some(name => folderNames.has(name.toLowerCase()));
        const markerPath = pack.projectMarker && !isAbsolute(pack.projectMarker)
            ? await realpath(resolve(root, pack.projectMarker)).catch(() => undefined) : undefined;
        const markerRelative = markerPath ? relative(root, markerPath) : undefined;
        const marker = markerRelative !== undefined && markerRelative !== "" &&
            markerRelative !== ".." && !markerRelative.startsWith(`..${sep}`) && !isAbsolute(markerRelative);
        return folder || marker ? pack : undefined;
    }))).filter((pack) => Boolean(pack));
    if (discovered.length > 1)
        throw new Error("Ambiguous project discovery binding");
    const productVariant = (registered[0] ?? discovered[0])?.id;
    return {
        provider,
        repository,
        workspaceId: workspace.id,
        canonicalRoot: root,
        ref: branch && branch !== "(detached)" ? branch : commit,
        commit,
        dirty: status.some(line => line && !line.startsWith("# ")),
        ...(productVariant ? { productVariant } : {}),
    };
}
