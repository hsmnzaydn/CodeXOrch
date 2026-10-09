import { spawn } from "node:child_process";
import { fingerprint, stripCredentials } from "../../core/issues/sanitize.js";
export { fingerprint, stripCredentials };
export declare const canonicalRepository = "hsmnzaydn/applixus-codex-toolkit";
export declare const fingerprintPrefix = "applixus-fingerprint:";
type AutofileResult = "disabled" | "throttled" | "locked" | "no-gh" | "done";
interface AutofileOptions {
    now?: number;
    repository?: string;
}
export declare function resolveRepository(env: NodeJS.ProcessEnv): string;
export declare function runIssueAutofile(env?: NodeJS.ProcessEnv, options?: AutofileOptions): Promise<AutofileResult>;
export declare function startIssueAutofile(env?: NodeJS.ProcessEnv, launch?: typeof spawn): import("child_process").ChildProcess | undefined;
