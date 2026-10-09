import { createHash } from "node:crypto";
import { join } from "node:path";
import { FileProjectionStore } from "../../adapters/storage.js";
export function taskContext(root, key, role = "lead") {
    const contextRole = role === "reviewer" || role === "lead" ? role : "worker";
    return {
        store: new FileProjectionStore(join(root, ".codexorch", "context")),
        key: `context_${createHash("sha256").update(`${key}:${contextRole}`).digest("hex")}`,
    };
}
export async function saveTaskCheckpoint(root, key, checkpoint, role = "lead") {
    const state = taskContext(root, key, role);
    const previous = await state.store.load(state.key);
    await state.store.save(state.key, { ...previous, checkpoint });
}
export function contextDelta(epoch, items, seen) {
    const current = new Map();
    const delivered = new Set(seen.filter((item) => item.epoch === epoch)
        .map((item) => JSON.stringify([item.key, item.revision, item.contentHash])));
    const load = [];
    const next = seen.filter((item) => item.epoch === epoch);
    for (const item of items) {
        if (!item.key || !item.revision || !item.contentHash)
            throw new Error("Incomplete context source");
        const prior = current.get(item.key);
        if (prior) {
            if (prior.revision !== item.revision || prior.contentHash !== item.contentHash) {
                throw new Error(`Conflicting context source: ${item.key}`);
            }
            continue;
        }
        current.set(item.key, item);
        const identity = JSON.stringify([item.key, item.revision, item.contentHash]);
        if (delivered.has(identity))
            continue;
        load.push(item);
        next.push({ epoch, key: item.key, revision: item.revision, contentHash: item.contentHash });
    }
    return { load, seen: next };
}
