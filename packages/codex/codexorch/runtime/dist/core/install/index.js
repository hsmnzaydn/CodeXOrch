import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, realpath, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { receiptDirectory } from "../evidence/index.js";
import { bindProject } from "../project/binding/index.js";
import { discoverProject } from "../project/discovery/index.js";
import { loadRoutes } from "../routes/index.js";
import { configureCodex, restoreCodex } from "./hosts.js";
import { addShared, execute, files, inside, knowledgeIdentity, projectMcpServers, readShared, readState, removeShared, restoreJson, sharedPath, source, stat, verify, writeJson } from "./state.js";
async function hostSnapshots(target, additional = []) {
    const paths = [];
    if (process.env.CODEX_HOME) {
        if (!isAbsolute(process.env.CODEX_HOME))
            throw new Error("CODEX_HOME must be absolute");
        paths.push(join(process.env.CODEX_HOME, "hooks.json"), join(process.env.CODEX_HOME, "config.toml"));
        paths.push(join(process.env.CODEX_HOME, ".codexorch-shared-config.toml.json"));
    }
    return Promise.all([...new Set([...paths, ...additional])].map(async (path) => {
        const entry = await stat(path);
        if (entry && !entry.isFile())
            throw new Error(`Expected regular host settings file: ${path}`);
        return { path, content: entry ? await readFile(path) : undefined };
    }));
}
async function restoreSnapshots(snapshots) {
    for (const { path, content } of snapshots) {
        if (content === undefined)
            await rm(path, { force: true });
        else {
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, content);
        }
    }
}
export async function projectInstall(action, packageRoot, targetPath, checkpoint, mode = "project", explicitActor) {
    if (!isAbsolute(targetPath) || !isAbsolute(packageRoot))
        throw new Error("Absolute paths required");
    const target = await realpath(targetPath);
    const tempRoots = await Promise.all([tmpdir(), "/tmp"].map((path) => realpath(path)));
    if ((mode === "smoke" && !tempRoots.some((root) => inside(target, root))) ||
        target === await realpath(homedir()) || target === "/" ||
        inside(target, join(homedir(), ".claude")) || inside(target, join(homedir(), ".codex")))
        throw new Error("Unsafe project target");
    if (mode === "project" && !(await stat(join(target, ".git"))))
        throw new Error("Project mode requires a Git checkout; use smoke mode for fixtures");
    const own = join(target, ".codexorch");
    const agent = join(target, ".agents");
    const skillsDir = join(agent, "skills");
    for (const path of [target, agent, skillsDir, own]) {
        const entry = await stat(path);
        if (entry && !entry.isDirectory())
            throw new Error(`Expected directory: ${path}`);
    }
    const old = await readState(own);
    if (action === "purge") {
        if (old)
            throw new Error("Uninstall before purging runtime data");
        await rm(own, { recursive: true, force: true });
        return { action, version: "", plugins: [] };
    }
    if (action === "install" && old)
        throw new Error("Already installed; use upgrade");
    if (action !== "install" && !old)
        throw new Error("Not installed");
    if (old)
        await verify(target, old);
    if (action === "uninstall") {
        const skipped = [];
        const backup = join(target, `.codexorch-backup-${randomUUID()}`);
        for (const host of old.hosts ?? []) {
            const parent = isAbsolute(host.path) ? await realpath(dirname(host.path)) : "";
            if (!isAbsolute(host.path) || !["settings.json", "hooks.json", "config.toml"].includes(basename(host.path)) ||
                host.path !== join(parent, basename(host.path)) ||
                inside(host.path, join(homedir(), ".claude")) || inside(host.path, join(homedir(), ".codex")) ||
                (await stat(host.path))?.isSymbolicLink())
                throw new Error(`Unsafe install state host path: ${host.path}`);
        }
        const snapshots = await hostSnapshots(target, [
            join(own, "mcp-servers.json"), ...(old.hosts?.flatMap((host) => [host.path, sharedPath(host)]) ?? [])
        ]);
        try {
            for (const host of old.hosts ?? []) {
                const shared = await readShared(host);
                const active = shared?.owners.filter((owner) => owner !== target) ?? [];
                const restoring = shared && !active.length
                    ? { ...host, changes: host.path.endsWith("/config.toml")
                            ? [...host.changes.filter((change) => ["hooks", "mcp_servers"].includes(change.key[0])),
                                ...shared.baseline.changes.filter((change) => !["hooks", "mcp_servers"].includes(change.key[0]))]
                            : shared.baseline.changes } : host;
                if (host.path.endsWith("/config.toml")) {
                    const hookFile = join(dirname(host.path), "hooks.json");
                    const hooks = await stat(hookFile) ? JSON.parse(await readFile(hookFile, "utf8")) : {};
                    const otherHooks = Object.values(hooks.hooks ?? {}).flat().some((group) => group.hooks?.some((hook) => hook.command?.includes("/.codexorch/packages/") &&
                        !hook.command.includes(`${target}/.codexorch/packages/`)));
                    if (await stat(host.path))
                        await restoreCodex(restoring, dirname(host.path), target, skipped, !!active.length || (!shared && otherHooks));
                    else
                        skipped.push(`${host.path}: missing`);
                }
                else
                    await restoreJson(restoring, skipped, !!active.length && host.path.endsWith("/settings.json") &&
                        host.path !== join(target, ".claude", "settings.json"));
                if (shared)
                    await removeShared(host, target);
            }
            if (old.mcp) {
                const path = join(own, "mcp-servers.json");
                if (await readFile(path, "utf8") === old.mcp.after) {
                    if (old.mcp.before === undefined)
                        await rm(path);
                    else
                        await writeFile(path, old.mcp.before);
                }
                else
                    skipped.push(`${path}: changed`);
            }
            await rename(join(own, "packages"), backup);
            for (const link of old.links)
                await unlink(join(skillsDir, link));
            await rm(join(own, "state.json"));
        }
        catch (error) {
            if (await stat(backup))
                await rename(backup, join(own, "packages"));
            for (const link of old.links) {
                if (await stat(join(skillsDir, link)))
                    continue;
                const identity = old.plugins.filter((item) => item.startsWith("codex/"))
                    .map((item) => item.slice("codex/".length))
                    .sort((a, b) => b.length - a.length)
                    .find((item) => link.startsWith(`${item}-`));
                if (identity)
                    await symlink(relative(skillsDir, join(own, "packages", "codex", identity, "codex-skills", link.slice(identity.length + 1))), join(skillsDir, link));
            }
            await restoreSnapshots(snapshots);
            throw error;
        }
        await rm(backup, { recursive: true });
        return { action, version: old.version, plugins: old.plugins, skipped,
            marketplace: "Marketplace registration is separate; if manually added, run: codex plugin marketplace remove codexorch" };
    }
    const root = await realpath(packageRoot);
    const { inventory, version } = await source(root);
    const routes = await loadRoutes(root, inventory[0].host);
    const links = inventory.filter((item) => item.host === "codex")
        .flatMap((item) => item.skills.map((name) => `${item.plugin}-${name}`));
    if (new Set(links).size !== links.length)
        throw new Error("Duplicate Codex skill identity");
    for (const link of links) {
        if (!old?.links.includes(link) && await stat(join(skillsDir, link)))
            throw new Error(`Skill already exists: ${link}`);
    }
    if (!old && ((await stat(join(own, "packages"))) || (await stat(join(own, "state.json"))))) {
        throw new Error("Unmanaged install content in runtime data directory");
    }
    const profilePath = join(own, "verification-profile.json");
    const snapshots = await hostSnapshots(target, [join(own, "mcp-servers.json"), profilePath]);
    const bindingPath = join(own, "knowledge-binding.json");
    const previousBinding = await stat(bindingPath) ? await readFile(bindingPath) : undefined;
    const identity = previousBinding ? undefined : await knowledgeIdentity(target, explicitActor);
    const stage = join(target, `.codexorch-stage-${randomUUID()}`);
    const backup = join(target, `.codexorch-backup-${randomUUID()}`);
    const packageDir = join(stage, "packages");
    try {
        await cp(root, packageDir, { recursive: true, force: false });
        const state = {
            version, files: await files(packageDir), links,
            plugins: inventory.map((item) => `${item.host}/${item.plugin}`),
        };
        let swapped = false;
        if (old)
            await rename(join(own, "packages"), backup);
        try {
            await mkdir(own, { recursive: true });
            await rename(packageDir, join(own, "packages"));
            swapped = true;
            checkpoint?.("after-swap");
            await mkdir(skillsDir, { recursive: true });
            for (const item of inventory.filter((entry) => entry.host === "codex")) {
                for (const name of item.skills) {
                    const link = `${item.plugin}-${name}`;
                    if (old?.links.includes(link))
                        continue;
                    const destination = join(skillsDir, link);
                    await symlink(relative(skillsDir, join(own, "packages", "codex", item.plugin, "codex-skills", name)), destination);
                }
            }
            for (const link of old?.links ?? [])
                if (!links.includes(link))
                    await unlink(join(skillsDir, link));
            const hosts = [];
            checkpoint?.("host-settings-write");
            if (inventory.some((item) => item.host === "codex") && process.env.CODEX_HOME) {
                const configured = await configureCodex(process.env.CODEX_HOME, target, routes["codex-lead-model"], old?.hosts, mode === "smoke");
                hosts.push(...configured);
                await addShared(configured[1], target);
            }
            state.mcp = await projectMcpServers(target, inventory, old);
            state.hosts = hosts;
            if (!(await stat(profilePath))) {
                const head = await execute("git", ["-C", target, "rev-parse", "HEAD"])
                    .then(({ stdout }) => stdout.trim(), () => "local");
                const binding = head === "local" ? {
                    provider: "local", repository: `local:${target}`, workspaceId: `local:${target}`,
                    canonicalRoot: target, ref: "local", commit: "local", dirty: false,
                } : await bindProject({ id: `local:${target}`, path: target, head });
                const profile = (await discoverProject(binding))
                    .verificationProfile;
                if (profile)
                    await writeJson(profilePath, profile);
            }
            await mkdir(receiptDirectory(target), { recursive: true, mode: 0o700 });
            if (identity)
                await writeJson(bindingPath, identity);
            await writeJson(join(own, "state.json"), state);
        }
        catch (error) {
            for (const link of links)
                if (!old?.links.includes(link) && (await stat(join(skillsDir, link)))?.isSymbolicLink())
                    await unlink(join(skillsDir, link));
            if (swapped)
                await rm(join(own, "packages"), { recursive: true });
            if (old)
                await rename(backup, join(own, "packages"));
            for (const link of old?.links ?? []) {
                if (await stat(join(skillsDir, link)))
                    continue;
                const identity = old.plugins.filter((item) => item.startsWith("codex/"))
                    .map((item) => item.slice("codex/".length))
                    .sort((a, b) => b.length - a.length)
                    .find((item) => link.startsWith(`${item}-`));
                if (identity)
                    await symlink(relative(skillsDir, join(own, "packages", "codex", identity, "codex-skills", link.slice(identity.length + 1))), join(skillsDir, link));
            }
            await restoreSnapshots(snapshots);
            if (identity)
                await rm(bindingPath, { force: true });
            throw error;
        }
        if (old)
            await rm(backup, { recursive: true });
        return { action, version, plugins: state.plugins };
    }
    finally {
        await rm(stage, { recursive: true, force: true });
    }
}
