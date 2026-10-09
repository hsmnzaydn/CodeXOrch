import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { toolkitCodexProviderCliOverrides } from "../core/routes/index.js";
import { codexRequest } from "./codex-app-server.js";
const execute = promisify(execFile);
const words = (value) => value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
function named(text, name) {
    const haystack = ` ${words(text).join(" ")} `;
    return haystack.includes(` ${words(name).join(" ")} `);
}
export function mcpOverrides(servers, selection, capabilityServers = []) {
    const allowed = new Set(capabilityServers);
    for (const server of servers) {
        if (named(selection, server.name))
            allowed.add(server.name);
    }
    // A short service name is accepted only when it identifies one configured server.
    const prefixes = new Set(servers.map((server) => words(server.name)[0]));
    for (const prefix of prefixes) {
        const matches = servers.filter((server) => words(server.name)[0] === prefix);
        if (!named(selection, prefix))
            continue;
        if (matches.length === 1)
            allowed.add(matches[0].name);
        else if (!matches.some((server) => allowed.has(server.name)))
            throw new Error(`Ambiguous MCP service ${prefix}; brief must name one configured server`);
    }
    // Codex splits override paths on dots without unquoting; use an inline TOML table
    // to retain literal server names, including names containing dots.
    return ["-c", `mcp_servers={${servers.map((server) => `${JSON.stringify(server.name)}={enabled=${server.enabled && allowed.has(server.name)}}`).join(",")}}`];
}
async function appServerMcpEntries(home, cwd) {
    let entries = [];
    await codexRequest(home, cwd, async (send) => {
        const response = await send("config/read", { includeLayers: true, cwd });
        if (!response?.config || typeof response.config !== "object" || Array.isArray(response.config))
            throw new Error("codex -c features.plugins=false app-server --stdio config/read: invalid JSON config shape");
        const servers = response.config.mcp_servers === undefined ? {} : response.config.mcp_servers;
        if (!servers || typeof servers !== "object" || Array.isArray(servers) ||
            Object.entries(servers).some(([name, server]) => !name || !server || typeof server !== "object" ||
                Array.isArray(server) || (server.enabled !== undefined && typeof server.enabled !== "boolean")))
            throw new Error("codex -c features.plugins=false app-server --stdio config/read: invalid JSON MCP config shape");
        entries = Object.entries(servers).map(([name, server]) => ({ name, enabled: server.enabled ?? true }));
    }, "codex", process.env, ["-c", "features.plugins=false"]);
    return entries;
}
function userConfigIsolationArgs() {
    // configureCodex owns this provider contract. The fallback skips only a malformed user config,
    // so restore the provider without copying credentials or any user-defined MCP registration.
    return ["--ignore-user-config", ...toolkitCodexProviderCliOverrides()];
}
async function isolatedMcpEntries(cwd) {
    const home = await mkdtemp(join(tmpdir(), "codexorch-codex-mcp-"));
    try {
        return await appServerMcpEntries(home, cwd);
    }
    finally {
        await rm(home, { recursive: true, force: true });
    }
}
function isConfigLoadFailure(text) {
    return /failed to load configuration|invalid configuration|config\.toml|AgentRoleToml/i.test(text);
}
export async function codexMcpArgs(cwd, brief = "", context) {
    const command = "codex mcp list --json -c features.plugins=false";
    let entries;
    let launchArgs = [];
    try {
        // Plugin servers use a different policy namespace, not top-level user config.
        const { stdout } = await execute("codex", ["mcp", "list", "--json", "-c", "features.plugins=false"], { cwd, timeout: 10_000, maxBuffer: 4 * 1024 * 1024 });
        if (!stdout.trim())
            throw new Error("exit 0; empty stdout");
        try {
            entries = JSON.parse(stdout);
        }
        catch {
            throw new Error("exit 0; invalid JSON");
        }
        if (!Array.isArray(entries) || entries.some((entry) => !entry || typeof entry.name !== "string" ||
            !entry.name || typeof entry.enabled !== "boolean"))
            throw new Error("exit 0; invalid JSON inventory shape");
    }
    catch (error) {
        const failure = error;
        const detail = failure.code !== undefined || failure.signal
            ? `${failure.killed ? "timeout after 10000 ms; " : ""}${failure.signal ? `signal ${failure.signal}` : `exit ${failure.code}`}; ` +
                (failure.stderr?.split(/\r?\n/, 1)[0] || failure.code || "empty stdout")
            : failure.message;
        try {
            entries = await appServerMcpEntries(process.env.CODEX_HOME ?? join(homedir(), ".codex"), cwd);
        }
        catch (fallback) {
            const refusal = `Cannot read effective Codex MCP configuration; refusing unfiltered launch: ` +
                `${command}: ${detail}; fallback ${fallback.message}`;
            if (!isConfigLoadFailure(`${detail}\n${fallback.message}`))
                throw new Error(refusal);
            try {
                // Codex native isolation keeps CODEX_HOME auth while omitting the malformed user config.
                // Read project/system MCP state from a clean home first, then disable every discovered server.
                entries = await isolatedMcpEntries(cwd);
                launchArgs = userConfigIsolationArgs();
            }
            catch (isolated) {
                throw new Error(`${refusal}; isolated user-config bypass failed: ${isolated.message}`);
            }
        }
    }
    const selectedIds = context?.selectedCapabilities.map((item) => item.id) ?? [];
    const selectedServers = [];
    if (context) {
        try {
            const registry = JSON.parse(await readFile(join(context.binding.canonicalRoot, ".codexorch", "mcp-servers.json"), "utf8"));
            if (!Array.isArray(registry))
                throw new Error("Invalid project MCP registry");
            for (const raw of registry) {
                const server = raw;
                if (server.approved && typeof server.id === "string" &&
                    Array.isArray(server.capabilityIds) && server.capabilityIds.some((id) => selectedIds.includes(id)))
                    selectedServers.push(server.id);
            }
        }
        catch (error) {
            if (error.code !== "ENOENT")
                throw error;
        }
    }
    return [...launchArgs, ...mcpOverrides(entries, [brief, ...selectedIds].join("\n"), selectedServers)];
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const startedAt = Date.now();
    const timeoutMs = 600_000;
    codexMcpArgs(process.cwd()).then((overrides) => {
        const [command, ...args] = process.argv.slice(2);
        const child = spawn("codex", [command, ...overrides, "-c", "features.plugins=false", ...args], { stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
        let lastProgress = "";
        let timedOut = false;
        let stdoutTail = "";
        let stderrTail = "";
        const progress = (chunk, tail) => {
            const lines = (tail + chunk.toString()).split(/\r?\n/);
            const last = lines.findLast((line) => line.trim());
            if (last)
                lastProgress = last.slice(-1024);
            return (lines.at(-1) ?? "").slice(-1024);
        };
        child.stdout.on("data", (chunk) => { stdoutTail = progress(chunk, stdoutTail); process.stdout.write(chunk); });
        child.stderr.on("data", (chunk) => { stderrTail = progress(chunk, stderrTail); process.stderr.write(chunk); });
        const stop = () => {
            if (child.pid) {
                try {
                    if (process.platform === "win32")
                        child.kill("SIGKILL");
                    else
                        process.kill(-child.pid, "SIGKILL");
                }
                catch (error) {
                    if (error.code !== "ESRCH")
                        throw error;
                }
            }
        };
        const deadline = setTimeout(() => {
            timedOut = true;
            // Kill the owned group so a stalled tool cannot retain the output pipes.
            stop();
        }, Math.max(1, timeoutMs - (Date.now() - startedAt)));
        for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
            process.once(signal, () => {
                stop();
                process.kill(process.pid, signal);
            });
        }
        child.on("error", () => {
            clearTimeout(deadline);
            process.stderr.write("Codex scout launch failed\n");
            process.exitCode = 127;
        });
        child.on("close", (code, signal) => {
            clearTimeout(deadline);
            if (timedOut) {
                process.stderr.write(`scout timed out after ${timeoutMs / 1000} s; last progress: ${lastProgress || "none"}\n`);
                process.exitCode = 124;
            }
            else if (signal)
                process.kill(process.pid, signal);
            else
                process.exitCode = code ?? 1;
        });
    }).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
