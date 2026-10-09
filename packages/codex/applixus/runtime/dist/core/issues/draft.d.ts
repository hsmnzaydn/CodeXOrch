interface BugDraftInput {
    host: string;
    event: string;
    step?: string;
    error?: unknown;
    message?: string;
    report?: {
        title: string;
        body: string;
        fingerprint: string;
    };
}
interface BugDraftOptions {
    now?: number;
    throttleMs?: number;
    version?: string;
}
export declare function draftDirectory(env: NodeJS.ProcessEnv): string;
export declare function toolkitVersion(): string;
export declare function writeBugDraft(input: BugDraftInput, env?: NodeJS.ProcessEnv, options?: BugDraftOptions): Promise<string | undefined>;
export {};
