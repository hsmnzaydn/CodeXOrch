export declare function outputTail(text: string, bytes?: number): string;
export interface Outcome {
    ts: string;
    user: string;
    host: string;
    toolkitVersion: string;
    repo: string;
    branch: string;
    command: "dispatch" | "scout" | "install";
    outcome: string;
    durationMs: number;
    errorClass?: string;
    errorText?: string;
    route?: string;
    dispatchId?: string;
    briefHead?: string;
}
interface OutcomeInput {
    command: Outcome["command"];
    outcome: string;
    startedAt: number;
    cwd?: string;
    error?: unknown;
    output?: string;
    brief?: string;
    route?: string;
    dispatchId?: string;
    reportBug?: boolean;
}
export declare function telemetryDirectory(env: NodeJS.ProcessEnv): string;
export declare function failureLine(text: string): string;
export declare function errorClass(text: string): string;
export declare function appendOutcome(record: Outcome, env?: NodeJS.ProcessEnv): Promise<void>;
export declare function recordOutcome(input: OutcomeInput, env?: NodeJS.ProcessEnv): Promise<void>;
export declare function draftDailyOutcomes(env?: NodeJS.ProcessEnv, now?: number): Promise<void>;
export {};
