import { existsSync, readFileSync } from "node:fs";
import { mkdir, open, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fingerprint, redactUserPaths, stackSignature, stripCredentials } from "./sanitize.js";
const throttleWindow = 86_400_000;
const maxPending = 50;
const maxSummary = 500;
const maxTitle = 200;
export function draftDirectory(env) {
    const configured = env.CODEXORCH_ISSUE_DRAFT_DIR;
    if (configured && isAbsolute(configured))
        return configured;
    const home = env.HOME ?? env.USERPROFILE;
    return join(home && isAbsolute(home) ? home : homedir() || tmpdir(), ".codexorch", "bug-drafts");
}
let cachedVersion;
export function toolkitVersion() {
    if (cachedVersion)
        return cachedVersion;
    let directory = dirname(fileURLToPath(import.meta.url));
    for (let depth = 0; depth < 10; depth += 1) {
        for (const name of ["catalog.json", "package.json"]) {
            const file = join(directory, name);
            if (!existsSync(file))
                continue;
            try {
                const version = JSON.parse(readFileSync(file, "utf8")).version;
                if (typeof version === "string" && /^\d+\.\d+\.\d+/.test(version))
                    return cachedVersion = version;
            }
            catch { }
        }
        const parent = dirname(directory);
        if (parent === directory)
            break;
        directory = parent;
    }
    return "unknown";
}
function slug(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "x";
}
function errorParts(error) {
    if (error instanceof Error)
        return { message: error.message, stack: error.stack ?? "" };
    if (typeof error === "string")
        return { message: error, stack: "" };
    return { message: error === undefined ? "" : "non-error value thrown", stack: "" };
}
export async function writeBugDraft(input, env = process.env, options = {}) {
    try {
        if (env.CODEXORCH_ISSUE_AUTOFILE === "0")
            return undefined;
        const directory = draftDirectory(env);
        const now = options.now ?? Date.now();
        const clean = (value) => input.report ? value : redactUserPaths(stripCredentials(value, env));
        const parts = errorParts(input.error);
        const summary = clean((input.message ?? parts.message).replace(/\s+/g, " ").trim()).slice(0, maxSummary);
        const step = slug(input.step ?? "");
        const host = slug(input.host);
        const signature = clean(stackSignature(parts.stack));
        const title = (input.report?.title ??
            `${input.event} failed: ${input.host}${input.step ? ` ${clean(input.step)}` : ""}`).slice(0, maxTitle);
        const print = input.report?.fingerprint ?? fingerprint(title, `${signature}\nstep ${step}`);
        const version = options.version ?? toolkitVersion();
        const throttleDirectory = join(directory, ".throttle");
        await mkdir(throttleDirectory, { recursive: true, mode: 0o700 });
        const stamp = join(throttleDirectory, print);
        const window = options.throttleMs ?? throttleWindow;
        try {
            const handle = await open(stamp, "wx");
            await handle.writeFile(String(now));
            await handle.close();
        }
        catch (error) {
            if (error.code !== "EEXIST")
                return undefined;
            const last = Number(await readFile(stamp, "utf8"));
            if (Number.isFinite(last) && now - last >= 0 && now - last < window)
                return undefined;
            await writeFile(stamp, String(now));
        }
        const pending = (await readdir(directory)).filter((name) => name.endsWith(".json")).length;
        if (pending >= maxPending)
            return undefined;
        const id = `${now}-${slug(input.event)}-${host}-${print.slice(0, 12)}`;
        const body = input.report?.body ?? [`Toolkit version: ${version}`, `Host: ${input.host}`, `Event: ${input.event}`,
            ...(input.step ? [`Step: ${clean(input.step)}`] : []),
            `Error: ${summary || "(no message)"}`,
            ...(signature ? ["", "Stack signature:", "```", signature, "```"] : [])].join("\n");
        const testRun = env.CODEXORCH_TEST_RUN_ID ?? process.env.CODEXORCH_TEST_RUN_ID;
        const draft = { draft_id: id, created_at: new Date(now).toISOString(), status: "queued",
            toolkit_version: version, host: input.host, event: input.event, fingerprint: print,
            title, body, stack: signature || `step ${step}`, error_summary: summary,
            ...(input.report ? { report: true } : {}),
            ...(testRun ? { test_run_id: testRun } : {}) };
        const file = join(directory, `${id}.json`);
        await writeFile(`${file}.tmp`, `${JSON.stringify(draft, null, 2)}\n`, { mode: 0o600 });
        await rename(`${file}.tmp`, file);
        return file;
    }
    catch {
        return undefined;
    }
}
