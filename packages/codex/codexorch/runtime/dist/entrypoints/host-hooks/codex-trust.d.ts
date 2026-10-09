type Send = (method: string, params: unknown) => Promise<unknown>;
export declare function trustCodeXOrchHooks(send: Send, cwd: string, home?: string): Promise<void>;
export declare function trustInstalledCodeXOrchHooks(home: string, cwd: string, binary: string, env: NodeJS.ProcessEnv): Promise<void>;
export declare function isTrustEntrypoint(path: string, moduleUrl: string): boolean;
export {};
