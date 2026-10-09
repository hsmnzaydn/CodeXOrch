type Host = "claude" | "codex";
export declare function marketplaceRevision(root: string, env: NodeJS.ProcessEnv, cwd: string, timeout: number, retainedLocal?: boolean): {
    revision: string;
    version: string | undefined;
    files(plugin: string): Map<string, string>;
};
export declare function installedContent(root: string, oidLength?: number): Promise<Map<string, string>>;
export declare function contentMatches(expected: Map<string, string>, actual: Map<string, string>): boolean;
export declare function packageVersion(text: string): string | undefined;
export declare function neutralCwd(env: NodeJS.ProcessEnv): string;
export declare function configDir(host: Host, env: NodeJS.ProcessEnv): string;
export declare function binaryCandidates(host: Host, env: NodeJS.ProcessEnv): string[];
export declare function findBinary(host: Host, env: NodeJS.ProcessEnv, candidates?: string[]): Promise<string | undefined>;
export {};
