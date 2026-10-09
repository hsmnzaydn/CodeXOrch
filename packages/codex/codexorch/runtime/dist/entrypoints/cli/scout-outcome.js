import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { failureLine, recordOutcome } from "../../core/issues/outcomes.js";
const [status, startedAt, diagnostics, output, question, earlyError] = process.argv.slice(2);
const read = (path) => path ? readFile(path, "utf8").catch(() => "") : Promise.resolve("");
const [stderr, stdout, brief] = await Promise.all([read(diagnostics), read(output),
    question === "-" ? Promise.resolve(readFileSync(0, "utf8")) : read(question)]);
await recordOutcome({ command: "scout", outcome: status === "0" ? "succeeded" : "failed",
    startedAt: Number(startedAt) || Date.now(), error: status === "0" ? undefined : failureLine(stderr) || earlyError,
    output: [stdout, stderr].filter(Boolean).join("\n"), brief });
