type Send = (method: string, params: unknown) => Promise<unknown>;
export declare function trustGreenfieldHooks(send: Send, cwd: string, home?: string): Promise<void>;
export declare function trustInstalledGreenfieldHooks(home: string, cwd: string, binary: string, env: NodeJS.ProcessEnv): Promise<void>;
export declare function isTrustEntrypoint(path: string, moduleUrl: string): boolean;
export {};
