import { cp, lstat, mkdir, mkdtemp, readdir, readFile, rename, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
const versionPattern = /^\d+\.\d+\.\d+$/;
const pluginPattern = /^codexorch(?:-[a-z0-9]+)*$/;
export function versionBehind(installed, advertised) {
    const parts = (value) => value.split(/[.+-]/).slice(0, 3).map(part => Number.parseInt(part, 10) || 0);
    const left = parts(installed);
    const right = parts(advertised);
    for (let index = 0; index < 3; index++)
        if ((left[index] ?? 0) !== (right[index] ?? 0))
            return (left[index] ?? 0) < (right[index] ?? 0);
    return false;
}
export function claudeCacheVersions(installed) {
    const result = new Map();
    for (const [id, value] of Object.entries(installed)) {
        if (!id.endsWith("@codexorch") || !Array.isArray(value) || !value.length)
            continue;
        const versions = value.map(entry => entry?.version);
        if (versions.every((version) => typeof version === "string"))
            result.set(id.slice(0, -"@codexorch".length), versions);
    }
    return result;
}
function compareVersions(left, right) {
    const leftParts = left.split(".").map(Number);
    const rightParts = right.split(".").map(Number);
    for (let index = 0; index < 3; index++) {
        const difference = leftParts[index] - rightParts[index];
        if (difference)
            return difference;
    }
    return 0;
}
export async function prunePluginCache(configDir, marketplace, installed) {
    const removed = [];
    for (const [plugin, active] of installed) {
        if (!pluginPattern.test(plugin) || !active.length || active.some(version => !versionPattern.test(version)))
            continue;
        const directory = join(configDir, "plugins", "cache", marketplace, plugin);
        const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
            if (error.code !== "ENOENT")
                throw error;
            return [];
        });
        const versions = entries.filter(entry => entry.isDirectory() && versionPattern.test(entry.name))
            .map(entry => entry.name).sort(compareVersions);
        // A raced registry/cache update must not remove the last usable install.
        if (active.some(version => !versions.includes(version)))
            continue;
        const current = [...active].sort(compareVersions).at(-1);
        const previous = versions.filter(version => compareVersions(version, current) < 0).at(-1);
        const keep = new Set([...active, ...(previous ? [previous] : [])]);
        for (const version of versions) {
            // A future version may belong to an in-flight native installation.
            if (keep.has(version) || compareVersions(version, current) > 0)
                continue;
            await rm(join(directory, version), { recursive: true, force: true });
            removed.push(`${plugin}/${version}`);
        }
    }
    return removed;
}
export async function keepPreviousPluginCaches(configDir, plugins, advertised, update, warn = console.warn) {
    const backups = [];
    try {
        for (const plugin of plugins) {
            if (!pluginPattern.test(plugin) || !versionPattern.test(advertised))
                continue;
            const directory = join(configDir, "plugins/cache/codexorch", plugin);
            const previous = (await readdir(directory, { withFileTypes: true }).catch((error) => { if (error.code !== "ENOENT")
                throw error; return []; }))
                .filter(entry => entry.isDirectory() && versionPattern.test(entry.name) &&
                versionBehind(entry.name, advertised)).map(entry => entry.name).sort(compareVersions).at(-1);
            if (!previous)
                continue;
            const stage = await mkdtemp(join(configDir, "plugins", ".codexorch-cache-previous-"));
            try {
                await cp(join(directory, previous), join(stage, "package"), { recursive: true });
            }
            catch (error) {
                await rm(stage, { recursive: true, force: true });
                await warn(`WARN: rollback cache backup skipped for ${plugin}/${previous}: ${error.message}`);
                continue;
            }
            backups.push({ stage, previous: join(directory, previous) });
        }
        return await update();
    }
    finally {
        for (const { stage, previous } of backups) {
            try {
                // Native Codex updates remove prior cache directories; retain one rollback revision.
                if (!await lstat(previous).then(() => true, (error) => {
                    if (error.code !== "ENOENT")
                        throw error;
                    return false;
                })) {
                    await mkdir(dirname(previous), { recursive: true });
                    await rename(join(stage, "package"), previous);
                }
            }
            finally {
                await rm(stage, { recursive: true, force: true });
            }
        }
    }
}
export async function pruneInstalledPluginCaches(env = process.env, run = spawnSync) {
    const home = env.HOME ?? env.USERPROFILE ?? homedir();
    const claude = env.CLAUDE_CONFIG_DIR || join(home, ".claude");
    const codex = env.CODEX_HOME || join(home, ".codex");
    const registry = await readFile(join(claude, "plugins/installed_plugins.json"), "utf8")
        .then(text => JSON.parse(text))
        .catch((error) => {
        if (error.code !== "ENOENT")
            throw error;
        return { plugins: {} };
    });
    const removed = await prunePluginCache(claude, "codexorch", claudeCacheVersions(registry.plugins ?? {}));
    const listing = run("codex", ["plugin", "list", "--json"], {
        env, cwd: home, timeout: 5000, encoding: "utf8", stdio: "pipe",
    });
    if (listing.status === 0 && !listing.error) {
        const installed = JSON.parse(String(listing.stdout)).installed ?? [];
        const versions = new Map(installed.filter(item => typeof item.pluginId === "string" &&
            item.pluginId.endsWith("@codexorch") && typeof item.version === "string")
            .map(item => [item.pluginId.split("@")[0], [item.version]]));
        removed.push(...await prunePluginCache(codex, "codexorch", versions));
    }
    return removed;
}
