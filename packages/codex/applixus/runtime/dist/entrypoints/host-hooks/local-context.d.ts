import { type GoalState } from "../../core/goals/index.js";
import { type TaskCheckpoint } from "../../core/context/index.js";
import type { SelectionOptions } from "../../core/capabilities/catalog/semantic.js";
import type { prepareLocalCore } from "./prompt.js";
export declare const contextLimit = 2048;
export declare function boundedText(text: string, bytes: number): string;
export declare function savedGoalSummary(goal: GoalState, limit: number): string;
export declare function projectReference(host: "claude" | "codex", path: string, packagesRoot: string, head: string, request?: string): Promise<string>;
export declare function localPrompt(event: Record<string, unknown>, host: "claude" | "codex", path: string, packagesRoot: string, head: string, options?: SelectionOptions): Promise<{
    text: string;
    acknowledge: () => Promise<void>;
}>;
export declare function checkpointTask(root: string, key: string, checkpoint: TaskCheckpoint, role?: string): Promise<void>;
export declare function compactTask(event: Record<string, unknown>, host: "claude" | "codex", path: string): Promise<void>;
export declare function resumeGoal(event: Record<string, unknown>, host: "claude" | "codex", path: string, availableBytes: number, core?: Awaited<ReturnType<typeof prepareLocalCore>>): Promise<{
    text: string;
    acknowledge: () => Promise<void>;
}>;
