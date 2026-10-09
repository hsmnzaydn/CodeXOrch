import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const aliases = ["codex-lead-model", "codex-sub-model",
    "codex-sub-high", "utility-model", "long-context-model", "tester-model", "review-model", "security-review-model"];
const efforts = ["low", "medium", "high", "xhigh"];
const complexities = ["simple", "standard", "complex"];
const risks = ["low", "normal", "high"];
export const toolkitCodexProvider = {
    id: "codexorch",
    config: {
        name: "OpenAI-compatible",
        base_url: process.env.CODEXORCH_ROUTER_URL ?? "",
        env_key: "OPENAI_API_KEY",
        wire_api: "responses",
    },
};
export function toolkitCodexProviderCliOverrides() {
    const table = Object.entries(toolkitCodexProvider.config)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(",");
    return [
        "-c", `model_provider=${JSON.stringify(toolkitCodexProvider.id)}`,
        "-c", `model_providers.${toolkitCodexProvider.id}={${table}}`,
    ];
}
export const assignmentRoleRoutes = {
    "sub-lead": ["codex-lead-model"],
    producer: ["codex-sub-model", "codex-sub-high"],
    "integration-owner": ["codex-sub-high", "codex-sub-model"],
    complex: ["codex-sub-high"],
    "high-risk": ["codex-sub-high"],
    migration: ["codex-sub-high"],
    "release-blocker": ["codex-sub-high"],
    tester: ["tester-model"],
    reviewer: ["review-model"],
    "security-reviewer": ["security-review-model"],
    audit: ["long-context-model"],
};
export function assignmentRoute(role, route) {
    if (!assignmentRoleRoutes[role]?.includes(route))
        throw new Error("Invalid assignment role/route");
    return { agent: "codex",
        contextRole: ["reviewer", "security-reviewer", "tester", "audit"].includes(role) ? "reviewer" : "worker" };
}
function validateRoutes(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        Object.keys(value).length !== aliases.length ||
        aliases.some((alias) => {
            const route = value[alias];
            return !route || typeof route.route !== "string" || !route.route ||
                (route.effort !== undefined && !efforts.includes(route.effort)) ||
                (route.behavesAs !== undefined && (typeof route.behavesAs !== "string" || !route.behavesAs));
        }))
        throw new Error("Invalid model routes");
    return value;
}
const assignmentIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
function normalizeChildAllocations(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Invalid child effort allocations");
    }
    const entries = Object.entries(value);
    if (entries.some(([id, allocation]) => !assignmentIdPattern.test(id) ||
        (typeof allocation === "string" && !efforts.includes(allocation)) ||
        (typeof allocation !== "string" && (!allocation || typeof allocation !== "object" ||
            Array.isArray(allocation) || Object.keys(allocation).length === 0 ||
            Object.keys(allocation).some((key) => key !== "complexity" && key !== "risk") ||
            (allocation.complexity !== undefined && !complexities.includes(allocation.complexity)) ||
            (allocation.risk !== undefined && !risks.includes(allocation.risk)))))) {
        throw new Error("Invalid child effort allocations");
    }
    return Object.fromEntries(entries.map(([id, allocation]) => [
        id, typeof allocation === "object" ? { ...allocation } : allocation,
    ]));
}
function fallbackEffort(defaultEffort, signals) {
    return signals.complexity === "simple" && signals.risk === "low" ? "medium"
        : signals.complexity === "complex" || signals.risk === "high" ? "high" : defaultEffort;
}
function authorizedEffort(role, alias, signals, authority, defaultEffort) {
    const target = assignmentRoute(role, alias);
    if (!["producer", "integration-owner", "sub-lead"].includes(role))
        throw new Error("Explicit effort is only valid for work assignments");
    if (!["lead", "sub-lead"].includes(authority.dispatcherRole ?? ""))
        throw new Error("Explicit effort requires a valid dispatcher role");
    if (authority.rootAuthority !== "codex-lead")
        throw new Error("Explicit effort requires Codex Lead root authority");
    if (typeof authority.assignmentId !== "string" || !assignmentIdPattern.test(authority.assignmentId))
        throw new Error("Explicit effort requires a valid assignment ID");
    if (authority.dispatcherRole === "lead") {
        return signals.effort;
    }
    if (target.agent !== "codex" || alias !== "codex-sub-model" ||
        (role !== "producer" && role !== "integration-owner")) {
        throw new Error("Sub-lead may only dispatch allocated Codex sub-model work");
    }
    const allocations = normalizeChildAllocations(authority.childAllocations);
    const allocated = allocations[authority.assignmentId];
    if (!allocated)
        throw new Error("Sub-lead child allocation is missing");
    if (typeof allocated === "string") {
        if (signals.effort !== undefined && signals.effort !== allocated)
            throw new Error("Sub-lead effort does not match its child allocation");
        return allocated;
    }
    const allocatedEffort = fallbackEffort(defaultEffort, allocated);
    if ((signals.complexity !== undefined && signals.complexity !== allocated.complexity) ||
        (signals.risk !== undefined && signals.risk !== allocated.risk))
        throw new Error("Sub-lead signals do not match its child allocation");
    if (signals.effort !== undefined && signals.effort !== allocatedEffort)
        throw new Error("Sub-lead effort does not match its child allocation");
    return allocatedEffort;
}
export async function loadRoutes(packageRoot, host) {
    const installed = await access(join(packageRoot, "catalog.json")).then(() => true, () => false);
    const path = installed
        ? join(packageRoot, "runtime", "model-routes.json")
        : join(packageRoot, host, "codexorch", "runtime", "model-routes.json");
    const text = await readFile(path, "utf8");
    let routes;
    try {
        routes = JSON.parse(text);
    }
    catch (cause) {
        throw new Error(`Invalid JSON in ${path}: ${cause.message}`, { cause });
    }
    return validateRoutes(routes);
}
export async function assignmentLaunch(role, alias, signals = {}, authority = {}) {
    if (!Object.hasOwn(assignmentRoleRoutes, role))
        role = "producer";
    alias ??= assignmentRoleRoutes[role][0];
    assignmentRoute(role, alias);
    if ((signals.complexity !== undefined && !complexities.includes(signals.complexity)) ||
        (signals.risk !== undefined && !risks.includes(signals.risk)) ||
        (signals.effort !== undefined && !efforts.includes(signals.effort)))
        throw new Error("Invalid assignment effort signals");
    if (authority.dispatcherRole !== undefined &&
        !["lead", "sub-lead"].includes(authority.dispatcherRole))
        throw new Error("Invalid dispatcher role");
    const path = fileURLToPath(new URL("../../../model-routes.json", import.meta.url));
    const text = await readFile(path, "utf8");
    let value;
    try {
        value = JSON.parse(text);
    }
    catch (cause) {
        throw new Error(`Invalid JSON in ${path}: ${cause.message}`, { cause });
    }
    const routes = validateRoutes(value);
    const route = routes[alias];
    const resolve = (effort) => {
        if (alias === "codex-sub-model" || alias === "codex-sub-high") {
            const high = alias === "codex-sub-high" || role === "integration-owner" ||
                signals.complexity === "complex" || signals.risk === "high" || effort === "high" || effort === "xhigh";
            return routes[high ? "codex-sub-high" : "codex-sub-model"];
        }
        return { ...route, ...(effort !== undefined ? { effort } : {}) };
    };
    if (authority.dispatcherRole === "sub-lead") {
        if ((role === "producer" || role === "integration-owner") && alias === "codex-sub-model") {
            const effort = authorizedEffort(role, alias, signals, authority, route.effort);
            return resolve(effort);
        }
        if (role === "sub-lead" || signals.effort !== undefined)
            throw new Error("Sub-lead may only dispatch allocated Codex sub-model work");
        return route;
    }
    if (signals.effort !== undefined) {
        const effort = authorizedEffort(role, alias, signals, authority, route.effort);
        return resolve(effort);
    }
    if ((role !== "sub-lead" && role !== "producer" && role !== "integration-owner") ||
        assignmentRoute(role, alias).agent !== "codex")
        return route;
    const effort = fallbackEffort(route.effort, signals);
    return resolve(effort);
}
