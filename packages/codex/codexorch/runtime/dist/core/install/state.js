import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, sep } from "node:path";
import { promisify } from "node:util";
import { resolveKnowledgeActor } from "../knowledge/actor.js";
import { bindProject } from "../project/binding/index.js";
const slug = /^codexorch(?:-[a-z0-9]+)*$/;
const skill = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const execute = promisify(execFile);
export async function knowledgeIdentity(target, explicitActor) {
    const { actorId, teamScopes } = await resolveKnowledgeActor(target, explicitActor);
    if (!actorId)
        return undefined;
    const head = await execute("git", ["-C", target, "rev-parse", "HEAD"])
        .then(({ stdout }) => stdout.trim(), () => "local");
    const repository = head === "local" ? `local:${target}` :
        (await bindProject({ id: `local:${target}`, path: target, head })).repository;
    return { repository, actorId, personScope: `person:${actorId}`, teamScopes };
}
export async function stat(path) {
    try {
        return await lstat(path);
    }
    catch (error) {
        if (error.code === "ENOENT")
            return undefined;
        throw error;
    }
}
export function inside(path, root) {
    return path === root || path.startsWith(root + sep);
}
export async function files(root) {
    const result = {};
    async function walk(dir) {
        for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
            const name = join(dir, entry.name);
            if (entry.isDirectory())
                await walk(name);
            else if (entry.isFile())
                result[name] = createHash("sha256").update(await readFile(join(root, name))).digest("hex");
            else
                throw new Error(`Unsupported package entry: ${name}`);
        }
    }
    await walk("");
    return result;
}
function sameFiles(left, right) {
    return JSON.stringify(Object.entries(left).sort()) === JSON.stringify(Object.entries(right).sort());
}
export async function readState(dir) {
    if (!(await stat(join(dir, "state.json"))))
        return undefined;
    const value = JSON.parse(await readFile(join(dir, "state.json"), "utf8"));
    if (!value || typeof value !== "object")
        throw new Error("Invalid install state");
    const state = value;
    if (typeof state.version !== "string" || !Array.isArray(state.links) ||
        !Array.isArray(state.plugins) || !state.files || typeof state.files !== "object" ||
        state.links.some((link) => !skill.test(link)) ||
        state.plugins.some((plugin) => !/^codex\/codexorch(?:-[a-z0-9]+)*$/.test(plugin)) ||
        (state.hosts !== undefined && (!Array.isArray(state.hosts) ||
            state.hosts.some((host) => typeof host.path !== "string" || !Array.isArray(host.changes) ||
                host.changes.some((change) => !Array.isArray(change.key) || change.key.some((key) => typeof key !== "string") ||
                    typeof change.hadBefore !== "boolean")))))
        throw new Error("Invalid install state");
    return state;
}
export function at(value, key) {
    let node = value;
    for (const part of key) {
        if (!node || typeof node !== "object" || Array.isArray(node))
            return { present: false, value: undefined };
        if (!Object.hasOwn(node, part))
            return { present: false, value: undefined };
        node = node[part];
    }
    return { present: true, value: node };
}
export function set(value, key, replacement, present) {
    let node = value;
    for (const part of key.slice(0, -1)) {
        if (!node[part] || typeof node[part] !== "object" || Array.isArray(node[part]))
            node[part] = {};
        node = node[part];
    }
    if (present)
        node[key.at(-1)] = replacement;
    else
        delete node[key.at(-1)];
}
export function record(before, after, keys, previous) {
    return keys.map((key) => {
        const prior = previous?.changes.find((change) => JSON.stringify(change.key) === JSON.stringify(key));
        const original = prior ?? { hadBefore: at(before, key).present, before: at(before, key).value };
        return { key, hadBefore: original.hadBefore, before: original.before, after: at(after, key).value };
    });
}
export async function writeJson(path, value) {
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
        await writeFile(temp, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
        await rename(temp, path);
    }
    finally {
        await rm(temp, { force: true });
    }
}
export function sharedPath(host) {
    return join(dirname(host.path), `.codexorch-shared-${basename(host.path)}.json`);
}
export async function readShared(host) {
    const path = sharedPath(host);
    return await stat(path) ? JSON.parse(await readFile(path, "utf8")) : undefined;
}
export async function addShared(host, target) {
    const current = await readShared(host);
    const owners = [...new Set([...(current?.owners ?? []), target])];
    await writeJson(sharedPath(host), { owners, baseline: current?.baseline ?? host });
}
export async function projectMcpServers(target, inventory, previous) {
    const path = join(target, ".codexorch", "mcp-servers.json");
    const current = await stat(path) ? await readFile(path, "utf8") : undefined;
    if (previous?.mcp && current !== previous.mcp.after)
        throw new Error("MCP server policy changed; refusing to overwrite");
    const retained = current ? JSON.parse(current) : [];
    if (!Array.isArray(retained))
        throw new Error("Invalid MCP server policy");
    const registered = new Map();
    if (inventory.some((item) => item.host === "codex") && process.env.CODEX_HOME) {
        const { stdout } = await execute("codex", ["mcp", "list", "--json"], {
            cwd: target, env: { ...process.env, CODEX_HOME: process.env.CODEX_HOME },
            timeout: 10_000, maxBuffer: 4 * 1024 * 1024,
        });
        for (const item of JSON.parse(stdout)) {
            if (item.enabled)
                registered.set(item.name, item.transport.type === "stdio" ? "stdio" : "http");
        }
    }
    const projected = [...registered].filter(([id]) => id !== "codexorch-broker" &&
        !id.startsWith("codexorch_broker_") && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id))
        .map(([id, transport]) => retained.find((item) => item.id === id && item.transport === transport) ??
        { id, transport, approved: true, capabilityIds: [id], tools: {}, autoDiscover: true });
    const after = JSON.stringify(projected, null, 2) + "\n";
    await writeJson(path, projected);
    const before = previous?.mcp ? previous.mcp.before : current;
    return { ...(before === undefined ? {} : { before }), after };
}
export async function removeShared(host, target) {
    const current = await readShared(host);
    if (!current?.owners.includes(target))
        return;
    const owners = current.owners.filter((owner) => owner !== target);
    if (owners.length)
        await writeJson(sharedPath(host), { ...current, owners });
    else
        await rm(sharedPath(host));
}
export async function restoreJson(host, skipped, shared = false) {
    if (!(await stat(host.path))) {
        skipped.push(`${host.path}: missing`);
        return;
    }
    const document = JSON.parse(await readFile(host.path, "utf8"));
    let changed = false;
    for (const change of host.changes) {
        if (shared)
            continue;
        const current = at(document, change.key);
        if (current.present && JSON.stringify(current.value) === JSON.stringify(change.after)) {
            set(document, change.key, change.before, change.hadBefore);
            changed = true;
        }
        else
            skipped.push(`${host.path}: ${change.key.join(".")} changed`);
    }
    for (const { event, group } of host.hooks ?? []) {
        const groups = document.hooks?.[event];
        const index = groups?.findIndex((entry) => JSON.stringify(entry) === JSON.stringify(group)) ?? -1;
        if (index >= 0) {
            groups.splice(index, 1);
            if (!groups.length)
                delete document.hooks[event];
            changed = true;
        }
        else
            skipped.push(`${host.path}: ${event} hook changed`);
    }
    if (changed)
        await writeJson(host.path, document);
}
export async function verify(target, state) {
    const dir = join(target, ".codexorch");
    const actual = await files(join(dir, "packages"));
    if (!sameFiles(actual, state.files))
        throw new Error("Installed package changed; refusing to overwrite");
    for (const link of state.links) {
        const path = join(target, ".agents", "skills", link);
        const entry = await stat(path);
        if (!entry?.isSymbolicLink() ||
            !inside(await realpath(path), join(dir, "packages", "codex"))) {
            throw new Error(`Installed skill changed: ${link}`);
        }
    }
}
export async function source(packageRoot) {
    const inventory = [];
    let version;
    for (const host of ["codex"]) {
        const hostDir = join(packageRoot, host);
        if (!(await stat(hostDir)))
            continue;
        for (const entry of await readdir(hostDir, { withFileTypes: true })) {
            if (!entry.isDirectory() || !slug.test(entry.name))
                throw new Error(`Unexpected package: ${entry.name}`);
            if (!["codexorch", "codexorch-flutter"].includes(entry.name))
                continue;
            const dir = join(hostDir, entry.name);
            const manifest = JSON.parse(await readFile(join(dir, ".codex-plugin/plugin.json"), "utf8"));
            const catalog = JSON.parse(await readFile(join(dir, "catalog.json"), "utf8"));
            if (manifest.name !== entry.name || !manifest.version || catalog.version !== manifest.version ||
                (version && version !== manifest.version))
                throw new Error(`Invalid package identity/version: ${entry.name}`);
            version = manifest.version;
            const skillsDir = join(dir, "codex-skills");
            const skills = (await readdir(skillsDir, { withFileTypes: true })).map((item) => {
                if (!item.isDirectory() || !skill.test(item.name))
                    throw new Error(`Invalid skill: ${item.name}`);
                return item.name;
            });
            inventory.push({ host, plugin: entry.name, skills });
        }
    }
    if (!version || !inventory.length)
        throw new Error("Empty package");
    await files(packageRoot);
    return { inventory, version };
}
