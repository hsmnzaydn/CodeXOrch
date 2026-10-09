import { open, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
const unknown = { resolvedBackend: "unknown", usage: "unknown" };
// Optional reporting has a fixed time, candidate, and byte budget.
export async function codexUsage(cwd, sessions = join(homedir(), ".codex", "sessions"), now = new Date()) {
    if (typeof cwd !== "string" || !cwd)
        return unknown;
    const controller = new AbortController();
    let timer;
    const scan = async () => {
        let candidates = 0;
        let bytes = 0;
        for (let day = 0; day < 3; day++) {
            const date = new Date(now);
            date.setDate(date.getDate() - day);
            const directory = join(sessions, String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0"));
            let names;
            try {
                names = await readdir(directory);
            }
            catch {
                continue;
            }
            for (const name of names.filter(name => /^rollout-.*\.jsonl$/.test(name)).sort().reverse()) {
                if (controller.signal.aborted || ++candidates > 128 || bytes >= 8 * 1024 * 1024)
                    return unknown;
                let file;
                try {
                    const path = join(directory, name);
                    file = await open(path, "r");
                    const header = Buffer.alloc(Math.min(64 * 1024, 8 * 1024 * 1024 - bytes));
                    const read = await file.read(header, 0, header.length, 0);
                    bytes += read.bytesRead;
                    const firstLine = header.subarray(0, read.bytesRead).toString("utf8").split("\n")[0];
                    const meta = JSON.parse(firstLine ?? "");
                    if (meta.type !== "session_meta" || meta.payload?.cwd !== cwd)
                        continue;
                    const size = (await file.stat()).size;
                    if (size > 8 * 1024 * 1024 - bytes)
                        return unknown;
                    const contents = await readFile(file, { encoding: "utf8", signal: controller.signal });
                    bytes += Buffer.byteLength(contents);
                    const report = { ...unknown };
                    for (const line of contents.split("\n")) {
                        if (controller.signal.aborted)
                            return unknown;
                        let record;
                        try {
                            record = JSON.parse(line);
                        }
                        catch {
                            continue;
                        }
                        if (record?.type === "turn_context" && typeof record.payload?.model === "string")
                            report.resolvedBackend = record.payload.model;
                        const totals = record?.type === "event_msg" && record.payload?.type === "token_count"
                            ? record.payload.info?.total_token_usage : undefined;
                        if (totals && typeof totals === "object" && !Array.isArray(totals) &&
                            ["input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens"]
                                .every(key => typeof totals[key] === "number" && Number.isFinite(totals[key]) && totals[key] >= 0))
                            report.usage = totals;
                    }
                    return report;
                }
                catch { /* Missing, incomplete, or unreadable sessions are optional evidence. */ }
                finally {
                    await file?.close().catch(() => { });
                }
            }
        }
        return unknown;
    };
    try {
        return await Promise.race([scan(), new Promise(resolve => {
                timer = setTimeout(() => { controller.abort(); resolve(unknown); }, 100);
            })]);
    }
    catch {
        return unknown;
    }
    finally {
        clearTimeout(timer);
        controller.abort();
    }
}
