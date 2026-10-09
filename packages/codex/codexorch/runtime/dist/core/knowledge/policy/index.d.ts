export interface ScopedKnowledge {
    id: string;
    scope: string;
    revision: string;
    content: string;
    source: string;
    trust: "candidate" | "approved";
    supersedes?: string;
    validUntil?: string;
    tombstone?: boolean;
    sourceRevision?: string;
}
interface ScopedQuery {
    scope: string;
}
export declare function planScopedQueries(requestedScopes: readonly string[], authorizedScopes: ReadonlySet<string>): ScopedQuery[];
interface KnowledgeResolution<T extends ScopedKnowledge> {
    records: T[];
    conflicts: T[][];
}
export declare function resolveScopedKnowledge<T extends ScopedKnowledge>(records: readonly T[], queries: readonly ScopedQuery[], now: Date, sourceRevisions?: Readonly<Record<string, string>>): KnowledgeResolution<T>;
export {};
