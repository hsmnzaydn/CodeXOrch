import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { fingerprint } from "./sanitize.js";
import { toolkitVersion, writeBugDraft } from "./draft.js";
import { collectSessionDigests } from "./session-digest.js";
import { dailySessionBody } from "./session-report.js";
const day = 86_400_000;
const maxLedger = 5 * 1024 * 1024;
export function outputTail(text, bytes = 4096) {
    const buffer = Buffer.from(text);
    let start = Math.max(0, buffer.length - bytes);
    while (start < buffer.length && (buffer[start] & 0xc0) === 0x80)
        start += 1;
    return buffer.subarray(start).toString("utf8");
}
export function telemetryDirectory(env) {
    const configured = env.CODEXORCH_ISSUE_LEDGER_DIR;
    if (configured && isAbsolute(configured))
        return configured;
    return join(env.HOME ?? env.USERPROFILE ?? homedir(), ".codexorch", "telemetry");
}
function local(command, args, cwd, env) {
    const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout: 2000, stdio: "pipe" });
    return result.status === 0 ? result.stdout.trim() : "";
}
function login(env, cwd) {
    return local("gh", ["config", "get", "user", "--host", env.GH_HOST ?? "github.com"], cwd, env) ||
        env.USER || env.USERNAME || "unknown";
}
export function failureLine(text) {
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    return lines.find(line => /\berror\b|\bfailed\b|\bBLOCKED\b|\b[45]\d\d\b/i.test(line)) ?? lines[0] ?? "";
}
export function errorClass(text) {
    return (failureLine(text) || "unknown failure")
        .replace(/\b(?:term|task|ctx|run|dispatch|worker)_[A-Za-z0-9_-]+/g, "<id>")
        .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "<id>")
        .replace(/(?:[A-Za-z]:[\\/]|\/|~\/)[^\s"'`]+/g, "<path>")
        .replace(/\b[0-9a-f]{8,}\b/gi, "<id>")
        .replace(/\d+/g, "<n>").replace(/\s+/g, " ").slice(0, 500);
}
function errorText(error) {
    if (typeof error === "string")
        return error;
    if (error instanceof Error) {
        const captured = error;
        return [error.stack ?? error.message, captured.stderr, captured.stdout].filter(Boolean).join("\n");
    }
    return error === undefined ? "" : String(error);
}
export async function appendOutcome(record, env = process.env) {
    const directory = telemetryDirectory(env);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = join(directory, "outcomes.jsonl");
    const testRun = env.CODEXORCH_TEST_RUN_ID ?? process.env.CODEXORCH_TEST_RUN_ID;
    const line = `${JSON.stringify({ ...record,
        ...(testRun ? { test_run_id: testRun } : {}) })}\n`;
    const size = await stat(file).then(info => info.size, () => 0);
    if (size + Buffer.byteLength(line) > maxLedger) {
        await rm(`${file}.1`, { force: true });
        await rename(file, `${file}.1`);
    }
    await appendFile(file, line, { mode: 0o600 });
}
export async function recordOutcome(input, env = process.env) {
    try {
        if (input.outcome === "pending")
            return;
        const cwd = input.cwd ?? process.cwd();
        const now = Date.now();
        const rawError = errorText(input.error);
        const tail = outputTail(input.output ?? "");
        const raw = [rawError, tail].filter(Boolean).join("\n");
        const record = {
            ts: new Date(now).toISOString(), user: login(env, cwd), host: hostname(),
            toolkitVersion: toolkitVersion(), repo: basename(cwd),
            branch: local("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd, env),
            command: input.command, outcome: input.outcome, durationMs: Math.max(0, now - input.startedAt),
            ...(input.outcome !== "succeeded" ? { errorClass: errorClass(rawError || tail), errorText: outputTail(raw) } : {}),
            ...(input.route ? { route: input.route } : {}),
            ...(input.dispatchId ? { dispatchId: input.dispatchId } : {}),
            ...(input.brief ? { briefHead: input.brief.slice(0, 500) } : {}),
        };
        await appendOutcome(record, env).catch(() => undefined);
        if (record.outcome === "succeeded" || input.reportBug === false ||
            (env.CODEXORCH_TEST_RUN_ID ?? process.env.CODEXORCH_TEST_RUN_ID))
            return;
        const head = local("git", ["rev-parse", "HEAD"], cwd, env);
        await writeBugDraft({ host: record.host, event: input.command, error: raw, report: {
                title: `${input.command} failed: ${record.errorClass}`,
                fingerprint: fingerprint(record.errorClass, ""),
                body: [`Command: ${input.command}`, `Repo: ${record.repo}`, `Branch: ${record.branch}`, `HEAD: ${head}`,
                    `Toolkit version: ${record.toolkitVersion}`, `gh user: ${record.user}`, `Host: ${record.host}`,
                    `Outcome: ${record.outcome}`, `Error class: ${record.errorClass}`, "", "Raw error:", rawError,
                    "", "Output tail:", tail, "", "Brief/question:",
                    Buffer.from(input.brief ?? "").subarray(0, 2048).toString("utf8").replace(/\ufffd$/, "")].join("\n"),
            } }, env);
    }
    catch { /* Reporting must not change the command's result. */ }
}
export async function draftDailyOutcomes(env = process.env, now = Date.now()) {
    if (env.CODEXORCH_ISSUE_AUTOFILE === "0")
        return;
    const directory = telemetryDirectory(env);
    const stamp = join(directory, ".last-daily-log");
    try {
        const last = Number(await readFile(stamp, "utf8"));
        if (Number.isFinite(last) && now - last < day)
            return;
    }
    catch { }
    const home = env.HOME ?? env.USERPROFILE ?? homedir();
    const currentUser = login(env, home);
    const lines = [];
    for (const name of ["outcomes.jsonl.1", "outcomes.jsonl"]) {
        const content = await readFile(join(directory, name), "utf8").catch(() => "");
        for (const raw of content.split("\n").filter(Boolean)) {
            try {
                const record = JSON.parse(raw);
                record.user = record.user ?? currentUser;
                const ts = Date.parse(record.ts);
                if (ts > now - day && ts <= now)
                    lines.push({ record, raw });
            }
            catch { }
        }
    }
    const failures = lines.filter(({ record }) => record.outcome !== "succeeded");
    const sessions = await collectSessionDigests(env, now, currentUser);
    const utcDate = new Date(now).toISOString().slice(0, 10);
    for (const user of new Set([...failures.map(({ record }) => record.user), ...sessions.map(record => record.user)])) {
        const userLines = lines.filter(({ record }) => record.user === user);
        const bad = userLines.filter(({ record }) => record.outcome !== "succeeded");
        const counts = new Map();
        for (const { record } of userLines) {
            const key = `${record.command}/${record.outcome}/${record.errorClass ?? "(none)"}`;
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        await writeBugDraft({ host: hostname(), event: "daily toolkit log", report: {
                title: `daily toolkit log \u2014 ${user} \u2014 ${utcDate}`,
                fingerprint: createHash("sha256").update(`daily toolkit log\0${user}\0${utcDate}`).digest("hex"),
                body: dailySessionBody([`User: ${user}`, `Window ending: ${new Date(now).toISOString()}`, "",
                    ...[...counts].map(([key, count]) => `${key}: ${count}`), "", "Raw non-success outcomes:",
                    ...bad.map(({ raw }) => raw)].join("\n"), sessions.filter(record => record.user === user)),
            } }, env, { now });
    }
    const classes = new Map();
    for (const { record, raw } of failures) {
        if (!record.errorClass)
            continue;
        const values = classes.get(record.errorClass) ?? [];
        values.push(raw);
        classes.set(record.errorClass, values);
    }
    for (const [classification, raw] of classes) {
        if (raw.length < 3)
            continue;
        await writeBugDraft({ host: hostname(), event: "recurring failure", report: {
                title: `Recurring toolkit failure: ${classification}`, fingerprint: fingerprint(classification, ""),
                body: `Error class: ${classification}\nCount: ${raw.length}\n\n${raw.join("\n")}`,
            } }, env, { now });
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(stamp, String(now), { mode: 0o600 });
}
