export type Host = "claude" | "codex";
export type Observation<T> = T | "unknown";
import type { ProjectProfile } from "./project/discovery/index.js";
import type { AssignmentRole, ChildEffortAllocations, EffortLevel, TaskComplexity, TaskRisk } from "./routes/index.js";
export interface ProjectBinding {
    provider: string;
    repository: string;
    workspaceId: string;
    canonicalRoot: string;
    ref: string;
    commit: string;
    dirty: boolean;
    productVariant?: string;
}
export interface GoalContext {
    id: string;
    revision: string;
    outcome: string;
    acceptance: string[];
    scope: string[];
    decisions: string[];
    openQuestions: string[];
    orcaTaskIds: string[];
}
export interface CapabilityDescriptor {
    id: string;
    version: string;
    description: string;
    entrypoint: string;
    requires: string[];
    provides: string[];
    conflicts: string[];
    hosts: Host[];
    source: string;
    license: string;
}
export interface DecisionEnvelope {
    stateRevision: string;
    catalogRevision: string;
    questionVersion: string;
    model: string;
    answers: Record<string, unknown>;
    selectedIds: string[];
    acceptedIds?: string[];
    dependencyIds?: string[];
    loadedIds?: string[];
    alternatives: string[];
    mode: "live" | "native-degraded";
    latencyMs: Observation<number>;
    usage: Observation<{
        inputTokens: number;
        outputTokens: number;
    }>;
}
export interface DecisionPort {
    decide(state: string, questions: Record<string, unknown>): Promise<DecisionEnvelope>;
}
export interface ContextPack {
    binding: ProjectBinding;
    projectProfile?: ProjectProfile;
    goalRevision: string;
    projectCapability?: string;
    requiredContracts: string[];
    selectedCapabilities: {
        id: string;
        version: string;
    }[];
    sourceRevisions: Record<string, string>;
    artifactRefs: string[];
    knowledge?: {
        id: string;
        scope: string;
        revision: string;
        source: string;
        content: string;
        trust: "candidate" | "approved";
    }[];
    tokenCount: Observation<number>;
    epoch: string;
    role?: "lead" | "worker" | "reviewer";
    ownedPaths?: string[];
    effortAuthority?: {
        assignmentId: string;
        assignedRole: AssignmentRole;
        targetRoute: string;
        decision: "explicit" | "fallback";
        resolvedEffort?: EffortLevel;
        requestedEffort?: EffortLevel;
        dispatcherRole?: string;
        rootAuthority?: string;
        signals: {
            complexity?: TaskComplexity;
            risk?: TaskRisk;
        };
    };
    childAllocations?: ChildEffortAllocations;
}
export interface KnowledgeRecord {
    id: string;
    scope: string;
    kind: string;
    content: string;
    source: string;
    revision: string;
    trust: "candidate" | "approved";
    supersedes?: string;
    validUntil?: string;
    delivery: "local" | "saved" | "delivered" | "visible";
}
export interface NativeWorkerObservation {
    runId: string;
    taskId: string;
    dispatchId: string;
    retryOfDispatchId?: string;
    workspaceId: string;
    terminalHandle: string;
    host: Host | "unknown";
    processIncarnation: string;
    state: string;
    transcriptSource: Observation<string>;
    requestedRoute: Observation<string>;
    effectiveRoute: Observation<string>;
    projectedRoute: Observation<string>;
    resolvedBackend: Observation<string>;
    requestedEffort: Observation<string>;
    effectiveEffort: Observation<string>;
    gatewayVersion: Observation<string>;
    usage: Observation<{
        inputTokens: number;
        outputTokens: number;
    }>;
}
export interface ProjectionStore {
    load(key: string): Promise<unknown>;
    save(key: string, value: unknown): Promise<void>;
    scan(prefix: string): Promise<unknown[]>;
    knowledge?: {
        save(record: {
            scope: string;
            id: string;
            revision: string;
            backend: string;
        }): Promise<void>;
        current(scope: string, id: string): Promise<unknown>;
        scan(scope: string): Promise<unknown[]>;
        deliver(scope: string, id: string, revision: string, backend: string, status: "delivered" | "visible"): Promise<void>;
        delivery(scope: string, id: string, revision: string, backend: string): Promise<string | undefined>;
        claim(scope: string, id: string, revision: string, backend: string): Promise<boolean>;
        release(scope: string, id: string, revision: string, backend: string): Promise<void>;
    };
}
