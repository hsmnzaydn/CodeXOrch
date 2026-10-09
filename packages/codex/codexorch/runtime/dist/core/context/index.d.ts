import { FileProjectionStore } from "../../adapters/storage.js";
import type { GoalContext, ProjectBinding } from "../contracts.js";
export interface SkillFloor {
    binding: ProjectBinding;
    skillRefs: {
        id: string;
        entrypoint: string;
    }[];
}
export interface TaskCheckpoint {
    goal: GoalContext;
    acceptedBriefRevision: string;
    acceptanceProgress: {
        criterion: string;
        status: "pending" | "passed" | "failed";
        evidenceRefs: string[];
    }[];
    candidateSha: string | null;
    consumedEvidenceRefs: string[];
    nativeDispatchIds: string[];
    checks: {
        command: string;
        exit: number;
    }[];
    nextAction: string;
}
export declare function taskContext(root: string, key: string, role?: string): {
    store: FileProjectionStore;
    key: string;
};
export interface TaskContextState {
    generation?: number;
    seen?: SeenItem[];
    checkpoint?: TaskCheckpoint;
    restoredEpoch?: string;
    skillFloor?: SkillFloor;
}
export declare function saveTaskCheckpoint(root: string, key: string, checkpoint: TaskCheckpoint, role?: string): Promise<void>;
export interface ContextItem {
    key: string;
    revision: string;
    contentHash: string;
    content: string;
}
export interface SeenItem {
    epoch: string;
    key: string;
    revision: string;
    contentHash: string;
}
export declare function contextDelta(epoch: string, items: readonly ContextItem[], seen: readonly SeenItem[]): {
    load: ContextItem[];
    seen: SeenItem[];
};
