import type { KnowledgeRecord, ProjectionStore } from "../../contracts.js";
import { type ScopedKnowledge } from "../policy/index.js";
interface BackendCapabilities {
    scopedRetrieval: boolean;
    verifiedIdentity: boolean;
    pagination: boolean;
    revision: boolean;
    deletion: boolean;
}
export interface BackendRecord extends ScopedKnowledge {
    backend: string;
    delivery?: KnowledgeRecord["delivery"];
}
export interface KnowledgeBackend {
    readonly name: string;
    readonly layer?: "facts" | "pages";
    readonly capabilities: BackendCapabilities;
    search(scope: string, text: string, limit: number): Promise<BackendRecord[]>;
    deliver(record: BackendRecord): Promise<"delivered" | "visible">;
    reconcile?(record: BackendRecord): Promise<"delivered" | "visible" | undefined>;
}
export declare class KnowledgeOutcomeUnknownError extends Error {
}
export declare class KnowledgeService {
    private readonly store;
    private readonly backends;
    private readonly authorizedScopes;
    private readonly acceptedProjectPack;
    constructor(store: ProjectionStore, backends: readonly KnowledgeBackend[], authorizedScopes: ReadonlySet<string>, acceptedProjectPack?: readonly BackendRecord[]);
    recall(scopes: readonly string[], text: string, sourceRevisions?: Readonly<Record<string, string>>): Promise<{
        records: BackendRecord[];
        conflicts: BackendRecord[][];
        unavailableBackends: string[];
    }>;
    save(record: BackendRecord): Promise<BackendRecord>;
    current(scope: string, id: string): Promise<BackendRecord | undefined>;
    deliver(scope: string, id: string, backend: KnowledgeBackend): Promise<BackendRecord>;
}
export declare function isObject(value: unknown): value is Record<string, unknown>;
export declare function isBackendRecord(value: unknown): value is BackendRecord;
export {};
