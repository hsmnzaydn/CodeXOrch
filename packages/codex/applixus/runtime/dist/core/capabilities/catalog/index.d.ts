import { type SelectionOptions } from "./semantic.js";
import type { CapabilityDescriptor, ContextPack, GoalContext, Host, ProjectBinding } from "../../contracts.js";
import type { PackIdentity } from "../../project/binding/index.js";
import type { ProjectProfile } from "../../project/discovery/index.js";
type CatalogCapability = CapabilityDescriptor & PackIdentity & {
    plugin: string;
    group: string;
};
export declare function knowledgePreview(item: {
    source: string;
    content: string;
    id?: string;
    scope?: string;
    revision?: string;
}): string;
export declare function skillRevision(directory: string): Promise<string | undefined>;
export declare function loadCatalog(packagesRoot: string, host: Host): Promise<{
    capabilities: CatalogCapability[];
    revision: string;
}>;
export declare function selectLocalCapabilities(input: {
    request?: string;
    binding: ProjectBinding;
    host: Host;
    catalog: Awaited<ReturnType<typeof loadCatalog>>;
    profile?: ProjectProfile;
    optionalIds?: string[];
    floorIds?: string[];
}): {
    capabilities: CatalogCapability[];
    acceptedIds: string[];
    dependencyIds: string[];
    unresolvedRequirements: string[];
    requiredContracts: string[];
    skillRefs: {
        id: string;
        entrypoint: string;
    }[];
    mode: "native";
};
export declare function selectSkillPaths(input: Parameters<typeof selectLocalCapabilities>[0] & SelectionOptions): Promise<{
    remote: import("../../../adapters/jev/index.js").JevDecisionEnvelope | undefined;
    capabilities: CatalogCapability[];
    acceptedIds: string[];
    dependencyIds: string[];
    unresolvedRequirements: string[];
    requiredContracts: string[];
    skillRefs: {
        id: string;
        entrypoint: string;
    }[];
    mode: "native";
}>;
export declare function selectCapabilities(input: {
    request: string;
    binding: ProjectBinding;
    goal: GoalContext;
    previousGoal?: GoalContext;
    host: Host;
    catalog: Awaited<ReturnType<typeof loadCatalog>>;
    profile?: ProjectProfile;
    intent?: "read-only" | "implementation";
    knowledge?: ContextPack["knowledge"];
} & SelectionOptions & {
    floorIds?: string[];
}): Promise<{
    capabilities: CatalogCapability[];
    context: ContextPack;
    goal: GoalContext;
    intent: "read-only" | "implementation";
    decision: {
        degradedReason: string | null;
        acceptedIds: string[];
        dependencyIds: string[];
        loadedIds: string[];
        cacheHit: boolean;
        requestedModel: string;
        effectiveEffort: string | "unknown";
        provider?: string;
        responseId: string | null;
        cost?: number;
        stateRevision?: string;
        catalogRevision?: string;
        questionVersion?: string;
        model: string;
        answers?: Record<string, unknown>;
        selectedIds?: string[];
        alternatives?: string[];
        mode: "live" | "native-degraded";
        latencyMs: import("../../contracts.js").Observation<number>;
        usage: string | {
            inputTokens: number;
            outputTokens: number;
        };
    };
}>;
export {};
