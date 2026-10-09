export declare function findGraphify(env?: NodeJS.ProcessEnv): string | undefined;
export declare function ensureLocalExcludes(root: string): string[];
interface GraphStatus {
    present: boolean;
    stale: boolean;
    git: boolean;
    nodes?: number;
}
export declare function graphStatus(root: string): GraphStatus;
export declare function graphifyContext(root: string, env?: NodeJS.ProcessEnv, options?: {
    cli?: boolean;
}): string;
export {};
