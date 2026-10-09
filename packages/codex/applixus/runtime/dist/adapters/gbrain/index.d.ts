import { type BackendRecord, type KnowledgeBackend } from "../../core/knowledge/backends/index.js";
type GbrainCall = (tool: "search" | "put_page" | "get_page", args: Record<string, unknown>) => Promise<unknown>;
export declare class GbrainBackend implements KnowledgeBackend {
    private readonly sources;
    readonly name = "gbrain";
    readonly layer = "pages";
    readonly capabilities: {
        scopedRetrieval: boolean;
        verifiedIdentity: boolean;
        pagination: boolean;
        revision: boolean;
        deletion: boolean;
    };
    constructor(sources: Readonly<Record<string, {
        sourceId: string;
        call: GbrainCall;
    }>>);
    private source;
    search(scope: string, text: string, limit: number): Promise<BackendRecord[]>;
    deliver(record: BackendRecord): Promise<"visible">;
    reconcile(record: BackendRecord): Promise<"visible" | undefined>;
}
export {};
