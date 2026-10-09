import { execFile } from "node:child_process";
export type Host = "claude" | "codex";
type Change = {
    key: string[];
    before?: unknown;
    after: unknown;
    hadBefore: boolean;
};
export type HostState = {
    path: string;
    changes: Change[];
    hooks?: {
        event: string;
        group: unknown;
    }[];
};
type SharedState = {
    owners: string[];
    baseline: HostState;
};
export type State = {
    version: string;
    files: Record<string, string>;
    links: string[];
    plugins: string[];
    hosts?: HostState[];
    mcp?: {
        before?: string;
        after: string;
    };
};
export declare const execute: typeof execFile.__promisify__;
export declare function knowledgeIdentity(target: string, explicitActor?: string): Promise<{
    repository: string;
    actorId: string;
    personScope: string;
    teamScopes: string[];
} | undefined>;
export declare function stat(path: string): Promise<import("fs").Stats | undefined>;
export declare function inside(path: string, root: string): boolean;
export declare function files(root: string): Promise<Record<string, string>>;
export declare function readState(dir: string): Promise<State | undefined>;
export declare function at(value: Record<string, unknown>, key: string[]): {
    present: boolean;
    value: unknown;
};
export declare function set(value: Record<string, unknown>, key: string[], replacement: unknown, present: boolean): void;
export declare function record(before: Record<string, unknown>, after: Record<string, unknown>, keys: string[][], previous?: HostState): Change[];
export declare function writeJson(path: string, value: unknown): Promise<void>;
export declare function sharedPath(host: HostState): string;
export declare function readShared(host: HostState): Promise<SharedState | undefined>;
export declare function addShared(host: HostState, target: string): Promise<void>;
export declare function projectMcpServers(target: string, inventory: {
    host: Host;
}[], previous?: State): Promise<{
    after: string;
    before?: string;
}>;
export declare function removeShared(host: HostState, target: string): Promise<void>;
export declare function restoreJson(host: HostState, skipped: string[], shared?: boolean): Promise<void>;
export declare function verify(target: string, state: State): Promise<void>;
export declare function source(packageRoot: string): Promise<{
    inventory: {
        host: Host;
        plugin: string;
        skills: string[];
    }[];
    version: string;
}>;
export {};
