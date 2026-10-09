import { type BackendRecord, type KnowledgeBackend } from "../../core/knowledge/backends/index.js";
export interface MemosBinding {
    user_id: string;
    mem_cube_id: string;
    scope_token: string;
    actor_id: string;
}
type MemosCall = (tool: "search_memory" | "append_memory_fact", args: Record<string, unknown>) => Promise<unknown>;
export declare class MemosBackend implements KnowledgeBackend {
    private readonly call;
    private readonly bindings;
    readonly name = "memos";
    readonly layer = "facts";
    readonly capabilities: {
        scopedRetrieval: boolean;
        verifiedIdentity: boolean;
        pagination: boolean;
        revision: boolean;
        deletion: boolean;
    };
    constructor(call: MemosCall, bindings: Readonly<Record<string, MemosBinding>>);
    private binding;
    search(scope: string, text: string, limit: number): Promise<BackendRecord[]>;
    deliver(record: BackendRecord): Promise<"delivered">;
    reconcile(record: BackendRecord): Promise<"visible" | undefined>;
}
export {};
