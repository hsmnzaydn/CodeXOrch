#!/usr/bin/env node
import { preparePrompt } from "./host-hooks/prompt.js";
import { checkpointTask } from "./host-hooks/local-context.js";
export { preparePrompt } from "./host-hooks/prompt.js";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [command] = process.argv.slice(2);
    if (command === "prepare-prompt" || command === "checkpoint-task") {
        const chunks = [];
        try {
            for await (const chunk of process.stdin)
                chunks.push(Buffer.from(chunk));
            const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (!input || typeof input !== "object" || Array.isArray(input))
                throw new Error("Invalid event input");
            if (command === "checkpoint-task") {
                const task = input;
                await checkpointTask(task.projectRoot, task.goalKey, task.checkpoint, task.role);
                process.stdout.write(`${JSON.stringify({ saved: true })}\n`);
            }
            else {
                const prompt = input;
                process.stdout.write(`${JSON.stringify(await preparePrompt({
                    ...prompt, packagesRoot: prompt.packagesRoot ?? join(process.cwd(), "packages"),
                }))}\n`);
            }
        }
        catch (error) {
            process.stderr.write(`${error instanceof Error ? error.message : "Prompt failed"}\n`);
            process.exitCode = 1;
        }
    }
    else {
        process.stderr.write("Usage: node dist/entrypoints/index.js <prepare-prompt|checkpoint-task>\n");
        process.exitCode = 2;
    }
}
