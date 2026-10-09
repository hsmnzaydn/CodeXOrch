import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
const text = (value) => typeof value === "string" ? value : "";
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
const number = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
const contentText = (content) => Array.isArray(content)
    ? content.map(item => text(item?.text) || text(item?.input_text)).filter(Boolean).join("\n")
    : text(content);
const correction = /(?:\bno\b|\bwrong\b|didn't understand|hay\u0131r|yanl\u0131\u015f|anlamad\u0131m|olmad\u0131|tekrar)/iu;
function ownerText(value) {
    const trimmed = value.trimStart();
    if (trimmed.startsWith("Coordinator:") ||
        (trimmed.startsWith("You are working inside Orca, a multi-agent IDE. You are a dispatched worker.") &&
            value.includes("=== TASK ===")))
        return "";
    return value.replace(/<note>No completion record was found for (?:it|them) in the previous session\.[\s\S]*?<\/note>/g, "");
}
export function digestSession(rows, route, user, now = Date.now()) {
    const digest = {
        user, host: hostname(), project: "unknown", startedAt: "", durationMin: 0, model: "unknown", route,
        skillsLoaded: [], projectSkills: [], toolCounts: {}, toolErrors: { count: 0, texts: [] },
        retriesOfSameCommand: 0, userCorrections: { count: 0, lines: [] }, compactions: 0,
        tokensIn: 0, tokensOut: 0, unfinished: false, firstUserPrompt: "",
    };
    const times = [];
    const calls = new Map();
    const commands = new Set();
    const usageIds = new Set();
    let totalIn = 0, totalOut = 0;
    const responseUsers = rows.some(row => row.type === "response_item" && row.payload?.role === "user");
    const loaded = new Set(), expected = new Set();
    const skillsIn = (value) => [...value.matchAll(/(?:skills|codex-skills|project-packs\/[^/\s]+)\/([^/\s"'`]+)\/SKILL\.md/g)]
        .map(match => match[1]);
    function context(value) {
        const cwd = text(value.cwd);
        if (cwd)
            digest.project = basename(cwd);
        if (text(value.model))
            digest.model = value.model;
        const provider = text(value.route) || text(value.model_provider);
        if (provider)
            digest.route = provider;
        for (const skill of Array.isArray(value.skillsLoaded) ? value.skillsLoaded : []) {
            if (typeof skill === "string")
                loaded.add(skill);
        }
        if (text(value.projectCapability))
            expected.add(value.projectCapability);
        const instructions = [value.base_instructions?.text, value.developer_instructions]
            .map(contentText).join("\n");
        for (const match of instructions.matchAll(/Load project skill ([\w:-]+) natively/g))
            expected.add(match[1]);
    }
    function userTurn(value) {
        if (!value)
            return;
        if (!digest.firstUserPrompt)
            digest.firstUserPrompt = value.slice(0, 300);
        for (const match of value.matchAll(/Load project skill ([\w:-]+) natively/g))
            expected.add(match[1]);
        for (const line of ownerText(value).split(/\r?\n/)) {
            if (!correction.test(line))
                continue;
            digest.userCorrections.count++;
            if (digest.userCorrections.lines.length < 5)
                digest.userCorrections.lines.push(line);
        }
        digest.unfinished = true;
    }
    function call(id, name, args) {
        if (id && calls.has(id))
            return;
        calls.set(id, { name, args });
        digest.toolCounts[name] = (digest.toolCounts[name] ?? 0) + 1;
        const command = text(args.command) || text(args.cmd);
        if (command) {
            if (commands.has(command))
                digest.retriesOfSameCommand++;
            commands.add(command);
        }
        digest.unfinished = true;
    }
    function result(id, output, failed) {
        const raw = contentText(output) || (typeof output === "object" ? JSON.stringify(output) : "");
        const code = object(output).exit_code;
        const error = failed || (typeof code === "number" && code !== 0) ||
            /^(?:Error:|ToolError:|Error executing tool\b)/im.test(raw) ||
            /(?:Process exited with code|Exit code:)\s*[1-9]\d*|"exit_code"\s*:\s*[1-9]\d*/i.test(raw);
        if (error) {
            digest.toolErrors.count++;
            if (digest.toolErrors.texts.length < 3)
                digest.toolErrors.texts.push(raw);
        }
        else {
            const invocation = calls.get(id);
            if (invocation) {
                if (/^(?:skill|load_skill)$/i.test(invocation.name)) {
                    const skill = text(invocation.args.skill) || text(invocation.args.name);
                    if (skill)
                        loaded.add(skill);
                }
                const args = JSON.stringify(invocation.args);
                if (/\b(?:cat|sed|head|readFile)\b|read/i.test(invocation.name + " " + args)) {
                    for (const skill of skillsIn(args))
                        loaded.add(skill);
                }
            }
        }
        digest.unfinished = true;
    }
    for (const row of rows) {
        const timestamp = Date.parse(text(row.timestamp));
        if (Number.isFinite(timestamp) && timestamp <= now)
            times.push(timestamp);
        context(row);
        const payload = object(row.payload);
        if (row.type === "session_meta" || row.type === "turn_context")
            context(payload);
        if (row.subtype === "compact_boundary" || row.type === "compacted" ||
            (row.type === "event_msg" && ["context_compacted", "compaction"].includes(payload.type))) {
            digest.compactions++;
        }
        if (row.type === "event_msg") {
            if (payload.type === "user_message" && !responseUsers)
                userTurn(text(payload.message));
            if (payload.type === "agent_message" || payload.type === "task_complete")
                digest.unfinished = false;
            if (payload.type === "turn_aborted")
                digest.unfinished = true;
            if (payload.type === "token_count") {
                const info = object(payload.info);
                if (info.total_token_usage) {
                    const usage = object(info.total_token_usage);
                    const input = number(usage.input_tokens), output = number(usage.output_tokens);
                    digest.tokensIn += input >= totalIn ? input - totalIn : input;
                    digest.tokensOut += output >= totalOut ? output - totalOut : output;
                    totalIn = input;
                    totalOut = output;
                }
                else {
                    digest.tokensIn += number(info.last_token_usage?.input_tokens);
                    digest.tokensOut += number(info.last_token_usage?.output_tokens);
                }
            }
        }
        const message = row.type === "response_item" ? payload : object(row.message);
        if (text(message.model))
            digest.model = message.model;
        if (row.isMeta || row.type === "system") {
            for (const match of contentText(message.content ?? row.content)
                .matchAll(/Load project skill ([\w:-]+) natively/g))
                expected.add(match[1]);
        }
        if (message.role === "user" || row.type === "user") {
            if (!row.isMeta)
                userTurn(contentText(message.content));
        }
        if (message.role === "assistant" || row.type === "assistant") {
            digest.unfinished = false;
            const id = text(message.id) || text(row.uuid);
            if (message.usage && (!id || !usageIds.has(id))) {
                if (id)
                    usageIds.add(id);
                digest.tokensIn += number(message.usage.input_tokens);
                digest.tokensOut += number(message.usage.output_tokens);
            }
        }
        for (const block of Array.isArray(message.content) ? message.content : []) {
            if (block?.type === "tool_use")
                call(text(block.id), text(block.name), object(block.input));
            if (block?.type === "tool_result")
                result(text(block.tool_use_id), block.content, block.is_error === true);
        }
        if (message.type === "function_call" || message.type === "custom_tool_call") {
            let args;
            try {
                args = object(JSON.parse(text(message.arguments)));
            }
            catch {
                args = { command: text(message.input) };
            }
            call(text(message.call_id), text(message.name), args);
        }
        if (message.type === "function_call_output" || message.type === "custom_tool_call_output")
            result(text(message.call_id), message.output, message.is_error === true);
    }
    const start = times.reduce((a, b) => Math.min(a, b), Infinity);
    const end = times.reduce((a, b) => Math.max(a, b), -Infinity);
    if (!times.length || end <= now - 86_400_000)
        return undefined;
    digest.startedAt = new Date(start).toISOString();
    digest.durationMin = Math.round((end - start) / 600) / 100;
    digest.skillsLoaded = [...loaded].sort();
    digest.projectSkills = [...expected].sort();
    return digest;
}
export async function collectSessionDigests(env = process.env, now = Date.now(), user = env.USER ?? env.USERNAME ?? "unknown") {
    const home = env.HOME ?? env.USERPROFILE ?? homedir();
    const roots = [
        { path: join(home, ".claude", "projects"), route: "claude" },
        { path: join(env.CODEX_HOME || join(home, ".codex"), "sessions"), route: "codex" },
    ];
    const digests = [];
    async function walk(path, route) {
        const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            const file = join(path, entry.name);
            if (entry.isDirectory())
                await walk(file, route);
            else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
                const info = await stat(file).catch(() => undefined);
                if (!info || info.mtimeMs <= now - 86_400_000)
                    continue;
                const rows = [];
                try {
                    const input = createReadStream(file, { encoding: "utf8" });
                    const lines = createInterface({ input, crlfDelay: Infinity });
                    try {
                        for await (const line of lines) {
                            try {
                                const value = JSON.parse(line);
                                if (value && typeof value === "object" && !Array.isArray(value))
                                    rows.push(value);
                            }
                            catch { /* Interrupted JSONL writes are normal. */ }
                        }
                    }
                    finally {
                        lines.close();
                        input.destroy();
                    }
                    const digest = digestSession(rows, route, user, now);
                    if (digest)
                        digests.push(digest);
                }
                catch { /* Unreadable transcripts must not stop the daily report. */ }
            }
        }
    }
    for (const root of roots)
        await walk(root.path, root.route);
    return digests;
}
