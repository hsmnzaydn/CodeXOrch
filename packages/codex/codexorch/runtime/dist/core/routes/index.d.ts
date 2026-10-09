declare const aliases: readonly ["codex-lead-model", "codex-sub-model", "codex-sub-high", "utility-model", "long-context-model", "tester-model", "review-model", "security-review-model"];
export type Alias = typeof aliases[number];
declare const efforts: readonly ["low", "medium", "high", "xhigh"];
declare const complexities: readonly ["simple", "standard", "complex"];
declare const risks: readonly ["low", "normal", "high"];
export type EffortLevel = typeof efforts[number];
export type TaskComplexity = typeof complexities[number];
export type TaskRisk = typeof risks[number];
interface AssignmentEffortSignals {
    complexity?: TaskComplexity;
    risk?: TaskRisk;
    effort?: EffortLevel;
}
type ChildEffortSignalAllocation = {
    complexity: TaskComplexity;
    risk?: TaskRisk;
} | {
    complexity?: TaskComplexity;
    risk: TaskRisk;
};
type ChildEffortAllocation = EffortLevel | ChildEffortSignalAllocation;
export type ChildEffortAllocations = Record<string, ChildEffortAllocation>;
interface AssignmentEffortAuthority {
    dispatcherRole?: string;
    rootAuthority?: string;
    assignmentId?: string;
    childAllocations?: ChildEffortAllocations;
}
type Route = {
    route: string;
    effort?: EffortLevel;
    behavesAs?: string;
};
export declare const toolkitCodexProvider: {
    readonly id: "codexorch";
    readonly config: {
        readonly name: "OpenAI-compatible";
        readonly base_url: string;
        readonly env_key: "OPENAI_API_KEY";
        readonly wire_api: "responses";
    };
};
export declare function toolkitCodexProviderCliOverrides(): string[];
export type DispatchRole = "producer" | "integration-owner" | "complex" | "high-risk" | "migration" | "release-blocker" | "reviewer" | "security-reviewer";
export type AssignmentRole = DispatchRole | "sub-lead" | "tester" | "audit";
export declare const assignmentRoleRoutes: Record<AssignmentRole, readonly string[]>;
export declare function assignmentRoute(role: AssignmentRole, route: string): {
    agent: "codex";
    contextRole: "worker" | "reviewer";
};
export declare function loadRoutes(packageRoot: string, host: "codex"): Promise<Record<Alias, Route>>;
export declare function assignmentLaunch(role: AssignmentRole, alias?: string, signals?: AssignmentEffortSignals, authority?: AssignmentEffortAuthority): Promise<Route>;
export {};
