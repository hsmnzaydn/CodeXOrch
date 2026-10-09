import { spawn, spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { access, appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertAutofileGh } from "../../core/issues/authority.js";
import { draftDirectory } from "../../core/issues/draft.js";
import { draftDailyOutcomes } from "../../core/issues/outcomes.js";
import { fingerprint, stripCredentials } from "../../core/issues/sanitize.js";
export { fingerprint, stripCredentials };
export const canonicalRepository = "hsmnzaydn/codexorch";
export const fingerprintPrefix = "codexorch-fingerprint:";
const interval = 300_000;
const lockStale = 600_000;
const maxPerRun = 5;
const maxBody = 30_000;
const maxTitle = 200;
const ghTimeout = 30_000;
const labels = ["auto-reported", "bug"];
const entrypoint = fileURLToPath(import.meta.url);
const baseDir = draftDirectory;
function neutralCwd(env) {
    const home = env.HOME ?? env.USERPROFILE;
    return home && isAbsolute(home) ? home : homedir() || tmpdir();
}
const repositoryPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;
export function resolveRepository(env) {
    const override = env.CODEXORCH_ISSUE_REPO;
    if (override === undefined || override === "")
        return canonicalRepository;
    if (!repositoryPattern.test(override))
        throw new Error("Invalid CODEXORCH_ISSUE_REPO");
    return override;
}
function text(value) {
    return typeof value === "string" ? value : "";
}
async function loadDrafts(directory, log) {
    const drafts = [];
    let names;
    try {
        names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
    }
    catch (error) {
        if (error.code === "ENOENT")
            return drafts;
        throw error;
    }
    for (const name of names) {
        const file = join(directory, name);
        try {
            const value = JSON.parse(await readFile(file, "utf8"));
            if (!value || typeof value !== "object" || Array.isArray(value))
                throw new Error("not an object");
            const status = text(value.status);
            if (status && !["queued", "pending", "draft"].includes(status))
                continue;
            const title = text(value.title).replace(/\s+/g, " ").trim();
            const body = text(value.body) || text(value.details);
            if (!title)
                throw new Error("missing title");
            drafts.push({ file, id: name.replace(/\.json$/, ""), title, body,
                stack: text(value.stack) || body, report: value.report === true,
                fingerprint: text(value.fingerprint) });
        }
        catch (error) {
            await log(`SKIP: unreadable draft ${name}: ${error.message}`);
        }
    }
    return drafts;
}
function gh(env, args) {
    assertAutofileGh(args);
    const home = env.HOME ?? env.USERPROFILE ?? "";
    const fallback = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", join(home, ".local", "bin")];
    const path = [...new Set([...(env.PATH ?? "").split(delimiter).filter((dir) => dir && isAbsolute(dir)),
            ...fallback])].join(delimiter);
    const result = spawnSync("gh", args, { cwd: neutralCwd(env), env: { ...env, PATH: path, GH_PROMPT_DISABLED: "1" },
        encoding: "utf8", timeout: ghTimeout, maxBuffer: 4 * 1024 * 1024, stdio: "pipe" });
    return { ok: result.status === 0 && !result.error, stdout: result.stdout ?? "",
        stderr: (result.stderr?.trim() || result.error?.message || "(empty)"), status: result.status };
}
async function ghReport(env, args, body, draft) {
    const file = `${draft.file}.body`;
    await writeFile(file, body, { mode: 0o600 });
    try {
        return gh(env, [...args, "--body-file", file]);
    }
    finally {
        await rm(file, { force: true });
    }
}
async function hasGh(env) {
    const home = env.HOME ?? env.USERPROFILE ?? "";
    const dirs = [...(env.PATH ?? "").split(delimiter).filter((dir) => dir && isAbsolute(dir)),
        "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", join(home, ".local", "bin")];
    for (const dir of dirs) {
        try {
            await access(join(dir, process.platform === "win32" ? "gh.exe" : "gh"), constants.X_OK);
            return true;
        }
        catch { }
    }
    return false;
}
function issueNumber(url) {
    return url.match(/\/issues\/(\d+)/)?.[1];
}
async function ensureLabels(env, repository, log) {
    const listing = gh(env, ["label", "list", "--repo", repository, "--json", "name", "--limit", "200"]);
    let existing = new Set();
    if (listing.ok) {
        try {
            existing = new Set(JSON.parse(listing.stdout).map((item) => item.name ?? ""));
        }
        catch { }
    }
    else
        await log(`WARN: label list failed: ${listing.stderr}`);
    for (const label of labels) {
        if (existing.has(label))
            continue;
        const created = gh(env, ["label", "create", label, "--repo", repository,
            "--description", "Filed automatically by the CodeXOrch toolkit"]);
        if (!created.ok)
            await log(`WARN: label create ${label} failed: ${created.stderr}`);
    }
}
async function move(draft, directory, extra) {
    const filed = join(directory, "filed");
    await mkdir(filed, { recursive: true });
    const original = JSON.parse(await readFile(draft.file, "utf8"));
    const target = join(filed, `${draft.id}.json`);
    await writeFile(`${target}.tmp`, `${JSON.stringify({ ...original, status: "filed", ...extra }, null, 2)}\n`);
    await rename(`${target}.tmp`, target);
    await rm(draft.file, { force: true });
}
export async function runIssueAutofile(env = process.env, options = {}) {
    if (env.CODEXORCH_ISSUE_AUTOFILE !== "1")
        return "disabled";
    const directory = baseDir(env);
    const logPath = join(directory, "autofile.log");
    const statePath = join(directory, ".last-autofile");
    const lockPath = join(directory, ".autofile.lock");
    const log = async (message) => {
        await mkdir(directory, { recursive: true });
        await appendFile(logPath, `${new Date().toISOString()} ${message}\n`);
    };
    const now = options.now ?? Date.now();
    try {
        if (now - Number(await readFile(statePath, "utf8")) < interval)
            return "throttled";
    }
    catch (error) {
        if (error.code !== "ENOENT")
            return "throttled";
    }
    await mkdir(directory, { recursive: true });
    try {
        await mkdir(lockPath);
    }
    catch (error) {
        if (error.code !== "EEXIST")
            return "locked";
        try {
            if (now - (await stat(lockPath)).mtimeMs < lockStale)
                return "locked";
            await rm(lockPath, { recursive: true, force: true });
            await mkdir(lockPath);
        }
        catch {
            return "locked";
        }
    }
    try {
        await draftDailyOutcomes(env, now).catch(async (error) => {
            await log(`FAIL: daily outcomes: ${error.message}`);
        });
        const drafts = await loadDrafts(directory, log).catch(async (error) => {
            await log(`FAIL: draft scan: ${error.message}`);
            return [];
        });
        if (!drafts.length)
            return "done";
        if (!await hasGh(env)) {
            await log("FAIL: gh binary not found; drafts kept");
            return "no-gh";
        }
        let repository;
        try {
            repository = options.repository ?? resolveRepository(env);
        }
        catch (error) {
            await log(`FAIL: ${error.message}`);
            return "done";
        }
        await writeFile(statePath, String(now));
        const ledger = await filedFingerprints(directory);
        let labelsReady = false;
        for (const draft of drafts.slice(0, maxPerRun)) {
            try {
                const clean = (value) => draft.report ? value : stripCredentials(value, env);
                const title = clean(draft.title).slice(0, maxTitle);
                const stack = clean(draft.stack);
                const print = draft.report && draft.fingerprint ? draft.fingerprint : fingerprint(title, stack);
                const known = ledger.get(print);
                if (known && !draft.report) {
                    await move(draft, directory, { issue_url: known, fingerprint: print, duplicate_of: known,
                        filed_at: new Date(now).toISOString() });
                    await log(`DEDUPE: ${draft.id} matches already filed ${known}`);
                    continue;
                }
                const search = gh(env, ["issue", "list", "--repo", repository, "--state", "all",
                    "--search", `${print} in:body`, "--json", "number,state,url,body", "--limit", "20"]);
                if (!search.ok) {
                    await log(`FAIL: ${draft.id}: issue search: ${search.stderr}`);
                    continue;
                }
                const matches = JSON.parse(search.stdout || "[]")
                    .filter((item) => (item.body ?? "").includes(`${fingerprintPrefix} ${print}`));
                const existing = matches.find((item) => item.state.toUpperCase() === "OPEN") ?? matches[0];
                if (existing) {
                    if (existing.state.toUpperCase() === "OPEN") {
                        const body = `Reported again at ${new Date(now).toISOString()} (draft ${draft.id}).` +
                            (draft.report ? `\n\n${draft.body}` : "");
                        const args = ["issue", "comment", String(existing.number), "--repo", repository];
                        const comment = draft.report ? await ghReport(env, args, body, draft) :
                            gh(env, [...args, "--body", body]);
                        if (!comment.ok) {
                            await log(`FAIL: ${draft.id}: comment on #${existing.number}: ${comment.stderr}`);
                            continue;
                        }
                    }
                    await move(draft, directory, { issue_url: existing.url, fingerprint: print,
                        duplicate_of: existing.url, filed_at: new Date(now).toISOString() });
                    ledger.set(print, existing.url);
                    await log(`DEDUPE: ${draft.id} matches ${existing.url}`);
                    continue;
                }
                if (!labelsReady) {
                    await ensureLabels(env, repository, log);
                    labelsReady = true;
                }
                const body = `${draft.report ? draft.body : clean(draft.body).slice(0, maxBody)}\n\n` +
                    `_Auto-reported by the CodeXOrch toolkit from draft ${draft.id}._\n\n` +
                    `<!-- ${fingerprintPrefix} ${print} -->\n`;
                const args = ["issue", "create", "--repo", repository, "--title", title,
                    ...labels.flatMap((label) => ["--label", label])];
                const created = draft.report ? await ghReport(env, args, body, draft) :
                    gh(env, [...args, "--body", body]);
                const url = created.stdout.trim().split(/\s+/).find((part) => issueNumber(part));
                if (!created.ok || !url) {
                    await log(`FAIL: ${draft.id}: issue create: ${created.stderr}`);
                    continue;
                }
                await move(draft, directory, { issue_url: url, fingerprint: print,
                    filed_at: new Date(now).toISOString() });
                ledger.set(print, url);
                await log(`FILED: ${draft.id} -> ${url}`);
            }
            catch (error) {
                await log(`FAIL: ${draft.id}: ${error.message}`);
            }
        }
        return "done";
    }
    catch (error) {
        await log(`FAIL: ${error.message}`).catch(() => undefined);
        return "done";
    }
    finally {
        await rm(lockPath, { recursive: true, force: true });
    }
}
async function filedFingerprints(directory) {
    const ledger = new Map();
    let names = [];
    try {
        names = await readdir(join(directory, "filed"));
    }
    catch {
        return ledger;
    }
    for (const name of names.filter((item) => item.endsWith(".json"))) {
        try {
            const value = JSON.parse(await readFile(join(directory, "filed", name), "utf8"));
            if (typeof value.fingerprint === "string" && typeof value.issue_url === "string")
                ledger.set(value.fingerprint, value.issue_url);
        }
        catch { }
    }
    return ledger;
}
export function startIssueAutofile(env = process.env, launch = spawn) {
    if (env.CODEXORCH_ISSUE_AUTOFILE !== "1")
        return undefined;
    const child = launch(process.execPath, [entrypoint, "--worker"], {
        detached: true, stdio: "ignore", env, cwd: neutralCwd(env),
    });
    child.unref();
    return child;
}
if (process.argv[1] && resolve(process.argv[1]) === entrypoint && process.argv[2] === "--worker") {
    runIssueAutofile().catch((error) => {
        process.stderr.write(`CodeXOrch issue autofile FAIL: ${error.message}\n`);
        process.exitCode = 1;
    });
}
