import type { DecisionEnvelope, DecisionPort } from "../../core/contracts.js";
export type JevQuestion = {
    type: "noul";
    instructions: string;
} | {
    type: "choice";
    instructions: string;
    criteria: Record<string, string>;
} | {
    type: "score";
    instructions: string;
    criteria: string[];
};
export declare const noulQuestion: (instructions: string) => JevQuestion;
export declare const choiceQuestion: (instructions: string, criteria: Record<string, string>) => JevQuestion;
export declare const scoreQuestion: (instructions: string, criteria: string[]) => JevQuestion;
export interface JevDecisionEnvelope extends DecisionEnvelope {
    cacheHit?: boolean;
    requestedModel: string;
    effectiveEffort: string | "unknown";
    provider?: string;
    responseId?: string;
    cost?: number;
    degradedReason?: string;
}
export interface JevOptions {
    catalogRevision: string;
    questionVersion: string;
    selectionQuestionIds?: string[];
    questionRelations?: Record<string, {
        dependsOn?: string[];
        conflictsWith?: string[];
    }>;
    model?: string;
    baseUrl?: string;
    apiKey?: string;
    timeoutMs?: number;
    fetch?: typeof fetch;
}
export declare class JevDecisionAdapter implements DecisionPort {
    private readonly options;
    constructor(options: JevOptions);
    decide(state: string, questions: Record<string, unknown>): Promise<JevDecisionEnvelope>;
}
