import { createHash } from "node:crypto";
import { isBackendRecord, isObject, } from "../../core/knowledge/backends/index.js";
export class MemosBackend {
    call;
    bindings;
    name = "memos";
    layer = "facts";
    capabilities = {
        scopedRetrieval: true, verifiedIdentity: false, pagination: false,
        revision: false, deletion: false,
    };
    constructor(call, bindings) {
        this.call = call;
        this.bindings = bindings;
    }
    binding(scope) {
        const binding = this.bindings[scope];
        if (!binding?.user_id || !binding.mem_cube_id ||
            !binding.scope_token || !binding.actor_id ||
            !binding.mem_cube_id.startsWith(`${binding.user_id}::`)) {
            throw new Error("MemOS scope not bound");
        }
        return binding;
    }
    async search(scope, text, limit) {
        const binding = this.binding(scope);
        const result = await this.call("search_memory", {
            ...binding, query: text, top_k: limit,
        });
        if (!isObject(result))
            throw new Error("Invalid MemOS search response");
        const nested = isObject(result.data) ? result.data.text_mem : undefined;
        if (Array.isArray(nested))
            return nested.flatMap((cube) => {
                if (!isObject(cube) || cube.cube_id !== binding.mem_cube_id || !Array.isArray(cube.memories))
                    return [];
                return cube.memories.flatMap((hit) => {
                    if (!isObject(hit) || !isObject(hit.metadata) || hit.metadata.user_id !== binding.user_id)
                        return [];
                    let record = hit.record;
                    if (!record && typeof hit.memory === "string") {
                        try {
                            record = JSON.parse(hit.memory);
                        }
                        catch {
                            if (typeof hit.id !== "string" || !hit.memory.trim())
                                return [];
                            // Content identity is not a provider revision or proof of acceptance.
                            record = { id: hit.id, scope, content: hit.memory,
                                revision: `sha256:${createHash("sha256").update(hit.memory).digest("hex")}`,
                                source: `memos:${binding.mem_cube_id}`, trust: "candidate", backend: this.name };
                        }
                    }
                    return isBackendRecord(record) && record.scope === scope ? [{ ...record, backend: this.name }] : [];
                });
            });
        if (!Array.isArray(result.memories))
            throw new Error("Invalid MemOS search response");
        return result.memories.flatMap((hit) => {
            if (!isObject(hit) || hit.mem_cube_id !== binding.mem_cube_id ||
                !isBackendRecord(hit.record) || hit.record.scope !== scope)
                return [];
            return [{ ...hit.record, backend: this.name }];
        });
    }
    async deliver(record) {
        const binding = this.binding(record.scope);
        const result = await this.call("append_memory_fact", {
            ...binding,
            conversation_first_message: `knowledge:${record.scope}:${record.id}:${record.revision}`,
            messages: [{ role: "user", content: JSON.stringify(record) }],
        });
        if (!isObject(result) || result.error || result.success !== true) {
            throw new Error("MemOS delivery not acknowledged");
        }
        // Append/extraction does not prove stable ID, dedup or search visibility.
        return "delivered";
    }
    async reconcile(record) {
        const matches = await this.search(record.scope, `knowledge:${record.scope}:${record.id}:${record.revision}`, 25);
        return matches.some((match) => match.id === record.id &&
            match.revision === record.revision && match.content === record.content) ? "visible" : undefined;
    }
}
