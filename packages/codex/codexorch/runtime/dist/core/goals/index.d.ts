import type { GoalContext } from "../contracts.js";
export interface GoalRevision {
    expectedRevision: string;
    revision: string;
    outcome?: string;
    acceptance?: string[];
    scope?: string[];
    decisions?: string[];
    openQuestions?: string[];
    rejectedMethods?: string[];
}
export interface GoalState extends GoalContext {
    rejectedMethods?: string[];
}
export declare function reviseGoal(goal: GoalState, change: GoalRevision): GoalState;
export declare function attachTask(goal: GoalState, taskId: string): GoalState;
export interface GoalSession {
    projectRoot: string;
    actorId: string;
    sessionId: string;
    goal: GoalState;
}
export declare function goalKey(projectRoot: string, actorId: string, sessionId: string): string;
export declare function loadGoalSession(projectRoot: string, key: string): Promise<GoalSession | undefined>;
export declare function resolveGoalLineage(projectRoot: string, actorId: string, host: string, sessionId: string, terminalHandle?: string, resume?: boolean, sourceSessionId?: string): string;
export declare function saveGoalSession(key: string, session: GoalSession, expectedRevision?: string | null): Promise<void>;
export declare function changeGoalSession(projectRoot: string, key: string, change: {
    revision?: GoalRevision;
    taskId?: string;
}): Promise<GoalState>;
export declare function advanceGoal(previous: GoalState | undefined, message: string): GoalState;
