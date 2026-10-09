import { spawn, spawnSync } from "node:child_process";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findBinary } from "./auto-update.js";
import { trustInstalledCodeXOrchHooks } from "./codex-trust.js";
const entrypoint = fileURLToPath(import.meta.url);
const repair = "Run codex doctor; if the daemon is broken, explicitly run codex app-server daemon restart.";
// The shared daemon's hourly updater restarts it and drops attached TUI sessions.
// Opt out only when unset; an explicit user value or a malformed file is left alone.
export async function disableDaemonAutoUpdate(dir) {
    const file = join(dir, "app-server-daemon", "settings.json");
    const text = await readFile(file, "utf8").catch((error) => {
        if (error.code === "ENOENT")
            return "{}";
        throw error;
    });
    let settings;
    try {
        settings = JSON.parse(text);
    }
    catch {
        return "malformed";
    }
    const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
    if (!isObject(settings) || (settings.updater !== undefined && !isObject(settings.updater)))
        return "malformed";
    if (Object.hasOwn(settings.updater ?? {}, "autoUpdateEnabled"))
        return "kept";
    settings.updater = { ...settings.updater, autoUpdateEnabled: false };
    await mkdir(dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(settings, null, 2)}\n`);
    await rename(temp, file);
    return "disabled";
}
export async function runCodexHealth(env = process.env, options = {}) {
    const configuredHome = env.HOME ?? env.USERPROFILE;
    const home = configuredHome && isAbsolute(configuredHome) ? configuredHome : homedir() || tmpdir();
    const dir = env.CODEX_HOME || join(home, ".codex");
    const versionState = join(dir, ".codexorch-codex-last-version");
    const logPath = join(dir, "logs", "codexorch-codex-version.log");
    const log = async (message) => {
        await mkdir(dirname(logPath), { recursive: true });
        await appendFile(logPath, `${new Date(options.now ?? Date.now()).toISOString()} ${message}\n`);
    };
    try {
        const binary = options.binary ?? await findBinary("codex", env);
        if (!binary)
            return { version: "no-binary" };
        await disableDaemonAutoUpdate(dir).catch(error => log(`Daemon updater opt-out skipped: ${error.message}`));
        const childEnv = { ...env, PATH: [dirname(binary), env.PATH ?? ""].join(delimiter) };
        const run = options.run ?? ((command, args, env, timeout, cwd) => spawnSync(command, args, { cwd, env, encoding: "utf8", timeout, stdio: "pipe" }));
        const reported = run(binary, ["--version"], childEnv, 30_000, home);
        const current = reported.status === 0 ? reported.stdout?.trim() : undefined;
        if (!current || reported.error)
            throw new Error("codex --version failed");
        const previous = await readFile(versionState, "utf8").then(text => text.trim()).catch((error) => {
            if (error.code !== "ENOENT")
                throw error;
            return "";
        });
        if (previous === current)
            return { version: "unchanged" };
        if (previous) {
            try {
                await (options.trust ?? trustInstalledCodeXOrchHooks)(dir, home, binary, childEnv);
            }
            catch (error) {
                await log(`Hook re-trust failed; retry on next session: ${error.message}. ${repair}`);
                return { version: "retrust-failed" };
            }
        }
        await mkdir(dir, { recursive: true });
        await writeFile(versionState, current);
        return { version: previous ? "retrusted" : "recorded" };
    }
    catch (error) {
        await log(`Version check failed open: ${error.message}. ${repair}`).catch(() => undefined);
        return { version: "error" };
    }
}
export function startCodexHealth(env = process.env, launch = spawn) {
    const child = launch(process.execPath, [entrypoint, "--worker"], {
        detached: true, stdio: "ignore", env,
    });
    child.unref();
    return child;
}
if (process.argv[1] && resolve(process.argv[1]) === entrypoint && process.argv[2] === "--worker") {
    await runCodexHealth();
}
