import { spawn, type SpawnSyncReturns } from "node:child_process";
import { trustInstalledCodeXOrchHooks } from "./codex-trust.js";
type Run = (binary: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number, cwd: string) => SpawnSyncReturns<string>;
interface CodexHealthOptions {
    binary?: string;
    run?: Run;
    now?: number;
    trust?: typeof trustInstalledCodeXOrchHooks;
}
export declare function disableDaemonAutoUpdate(dir: string): Promise<"disabled" | "malformed" | "kept">;
export declare function runCodexHealth(env?: NodeJS.ProcessEnv, options?: CodexHealthOptions): Promise<{
    version: string;
}>;
export declare function startCodexHealth(env?: NodeJS.ProcessEnv, launch?: typeof spawn): import("child_process").ChildProcess;
export {};
