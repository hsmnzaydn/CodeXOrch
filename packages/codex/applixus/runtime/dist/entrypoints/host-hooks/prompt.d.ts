import { OrcaCli } from "../../adapters/orca.js";
import { type KnowledgeBackend } from "../../core/knowledge/backends/index.js";
import type { GoalContext, Host } from "../../core/contracts.js";
import { type WorkspaceIdentity } from "../../core/project/binding/index.js";
import type { SelectionOptions } from "../../core/capabilities/catalog/semantic.js";
import type { SkillFloor } from "../../core/context/index.js";
export interface PromptInput extends SelectionOptions {
    request: string;
    host: Host;
    goal: GoalContext;
    previousGoal?: GoalContext;
    packagesRoot: string;
    intent?: "read-only" | "implementation";
    sourceRevisions?: Record<string, string>;
    workspace?: WorkspaceIdentity;
    goalKey?: string;
    role?: "lead" | "worker" | "reviewer";
    actorId?: string;
    signal?: AbortSignal;
    deadline?: number;
    localCore?: Awaited<ReturnType<typeof prepareLocalCore>>;
    skillFloor?: SkillFloor;
}
export declare function prepareLocalCore(input: Pick<PromptInput, "host" | "packagesRoot" | "workspace"> & {
    request?: string;
}, orca?: OrcaCli): Promise<{
    catalog: {
        capabilities: (import("../../core/contracts.js").CapabilityDescriptor & import("../../core/project/binding/index.js").PackIdentity & {
            plugin: string;
            group: string;
        })[];
        revision: string;
    };
    binding: import("../../core/contracts.js").ProjectBinding;
    profile: import("../../core/project/discovery/index.js").ProjectProfile;
    localSelection: {
        capabilities: (import("../../core/contracts.js").CapabilityDescriptor & import("../../core/project/binding/index.js").PackIdentity & {
            plugin: string;
            group: string;
        })[];
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
    hostContext: string;
}>;
export declare function readKnowledgeExcerpt(root: string, packRef: string, scope: string, id: string, revision: string, offset: number, length: number): Promise<string>;
export declare function configuredKnowledge(repository: string, root?: string, activeActor?: string, signal?: AbortSignal): {
    scopes: string[];
    backends: KnowledgeBackend[];
    actorId?: string;
    degradedReason?: string;
};
export declare function preparePrompt(input: PromptInput, orca?: OrcaCli): Promise<{
    contextPack: import("../../core/contracts.js").ContextPack;
    contextPackRef: string | undefined;
    goal: GoalContext;
    selected: {
        id: string;
        entrypoint: string;
    }[];
    intent: "read-only" | "implementation";
    decision: {
        mode: "live" | "native-degraded";
        model: string;
        requestedModel: string;
        effectiveEffort: string;
        latencyMs: import("../../core/contracts.js").Observation<number>;
        usage: string | {
            inputTokens: number;
            outputTokens: number;
        };
        responseId: string | null;
        degradedReason: string | null;
        cacheHit: boolean;
    };
    hostContext: string;
    delivery: {
        epoch: string;
        seen: import("../../core/context/index.js").SeenItem[];
    };
}>;
