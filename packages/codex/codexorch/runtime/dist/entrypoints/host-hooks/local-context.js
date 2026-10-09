import { createHash } from "node:crypto";
import { join } from "node:path";
import { FileProjectionStore } from "../../adapters/storage.js";
import { advanceGoal, loadGoalSession, resolveGoalLineage, saveGoalSession } from "../../core/goals/index.js";
import { resolveKnowledgeActor } from "../../core/knowledge/actor.js";
import { saveTaskCheckpoint, taskContext } from "../../core/context/index.js";
import { nativeSubagent } from "./lead-identity.js";
import { selectLocalCapabilities, selectSkillPaths } from "../../core/capabilities/catalog/index.js";
import { validFloor } from "./skill-floor.js";
export const contextLimit = 2048;
export function boundedText(text, bytes) {
    if (bytes <= 0)
        return "";
    if (Buffer.byteLength(text) <= bytes)
        return text;
    const suffix = "...";
    let result = "";
    for (const character of text) {
        if (Buffer.byteLength(result + character + suffix) > bytes)
            break;
        result += character;
    }
    return result + (bytes >= suffix.length ? suffix : "");
}
export function savedGoalSummary(goal, limit) {
    const parts = [
        `Goal: ${boundedText(goal.outcome, 180)}`,
        `Goal ID: ${goal.id}; revision: ${goal.revision}`,
        `Tasks: ${boundedText(goal.orcaTaskIds.join(", ") || "none", 80)}`,
        `Constraints: ${boundedText(goal.acceptance.join("; ") || "none", 100)}`,
        `Decisions: ${boundedText(goal.decisions.join("; ") || "none", 100)}`,
        `Rejected: ${boundedText(goal.rejectedMethods?.join("; ") || "none", 80)}`,
        `Scope: ${boundedText(goal.scope.join("; ") || "none", 80)}`,
    ];
    return boundedText(parts.join("\n"), limit);
}
async function localGoal(event, host, path) {
    const id = typeof event.session_id === "string" ? event.session_id
        : typeof event.thread_id === "string" ? event.thread_id : undefined;
    const actorId = (await resolveKnowledgeActor(path, undefined, typeof event.user_id === "string" ? event.user_id : undefined)).actorId;
    if (!id || !actorId)
        return { id };
    const key = resolveGoalLineage(path, actorId, host, id, process.env.ORCA_TERMINAL_HANDLE || undefined, event.source === "resume" || event.source === "compact", typeof event.source_session_id === "string" ? event.source_session_id : undefined);
    return { key, session: await loadGoalSession(path, key), actorId, id };
}
export async function projectReference(host, path, packagesRoot, head, request = "") {
    const { prepareLocalCore } = await import("./prompt.js");
    const core = await prepareLocalCore({ host, packagesRoot, request, workspace: { id: `local:${path}`, path, head } });
    return coreReference(core, core.localSelection);
}
function coreReference(core, selection) {
    const contract = core.catalog.capabilities.find(item => item.projectPack && item.id === core.binding.productVariant);
    return [
        `Project: ${core.binding.repository} at ${core.binding.commit}`,
        "Project rules: native AGENTS.md.",
        ...(contract ? [`Load project skill ${contract.id} natively.`] : []),
        ...selection.capabilities.filter(item => !item.projectPack).map(item => `Load expertise skill ${item.id} natively.`),
    ].join("\n");
}
export async function localPrompt(event, host, path, packagesRoot, head, options = {}) {
    const request = typeof event.prompt === "string" ? event.prompt.trim() : "";
    if (!request || ["<task-notification>", "<system-reminder>", "<cross-session-message", "[Cross-session idle notice]"]
        .some(prefix => request.startsWith(prefix)))
        return { text: "", acknowledge: async () => { } };
    let current;
    try {
        current = await localGoal(event, host, path);
    }
    catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith("Ambiguous goal lineage:"))
            throw error;
        return { text: boundedText(`${await projectReference(host, path, packagesRoot, head)}\n${error.message}. Select the source session explicitly; no goal or task was selected.`, contextLimit),
            acknowledge: async () => { } };
    }
    const { key, session, actorId, id } = current;
    const goal = session?.goal.outcome === request ? session.goal : advanceGoal(session?.goal, request);
    if (key && actorId && id)
        await saveGoalSession(key, {
            projectRoot: path, actorId, sessionId: session?.sessionId ?? `${host}:${id}`, goal,
        }, session?.goal.revision ?? null);
    const store = new FileProjectionStore(join(path, ".codexorch", "context"));
    const stateKey = id ? `prompt_delta_${createHash("sha256").update(`${host}:${id}`).digest("hex")}` : undefined;
    const summary = key ? savedGoalSummary(goal, 768) : boundedText(`Goal: ${request}`, 768);
    const { prepareLocalCore } = await import("./prompt.js");
    const core = await prepareLocalCore({ host, packagesRoot, request, workspace: { id: `local:${path}`, path, head } });
    const context = key ? taskContext(path, key, contextRole(event)) : undefined;
    const prior = context ? await context.store.load(context.key).catch(() => undefined) : undefined;
    const floorContext = { ...core, host };
    const floor = validFloor(prior?.skillFloor, core.binding, floorContext) ? prior.skillFloor
        : validFloor(event.skillFloor, core.binding, floorContext) ? event.skillFloor : undefined;
    if (context && (floor || prior?.skillFloor))
        await context.store.save(context.key, { ...prior, skillFloor: floor });
    const selectionInput = { ...core, request: goal.outcome, host, ...options,
        timeoutMs: Math.min(2000, options.timeoutMs ?? Number(process.env.CODEXORCH_SESSION_BUDGET_MS || 2000)),
        ...(floor ? { floorIds: floor.skillRefs.map(item => item.id) } : {}) };
    // Empty, unbound workspaces have no project expertise evidence; goal admission stays local.
    const selection = core.binding.productVariant || core.profile.manifests.length ||
        core.localSelection.capabilities.length || floor ? await selectSkillPaths(selectionInput)
        : selectLocalCapabilities(selectionInput);
    const text = boundedText(`${coreReference(core, selection)}\n${summary}`, contextLimit);
    const digest = createHash("sha256").update(text).digest("hex");
    const previous = stateKey ? await store.load(stateKey) : undefined;
    return {
        text: previous?.digest === digest ? "" : text,
        acknowledge: async () => { if (stateKey && previous?.digest !== digest)
            await store.save(stateKey, { digest }); },
    };
}
function contextRole(event) {
    const role = event.assignment?.role;
    return role === "reviewer" || role === "security-reviewer" ? "reviewer" : (role && role !== "lead") || nativeSubagent(event) ? "worker" : "lead";
}
export async function checkpointTask(root, key, checkpoint, role = "lead") {
    const session = await loadGoalSession(root, key);
    if (!session || checkpoint.goal.id !== session.goal.id || checkpoint.goal.revision !== session.goal.revision ||
        checkpoint.acceptedBriefRevision !== session.goal.revision)
        throw new Error("Stale task checkpoint");
    await saveTaskCheckpoint(root, key, { ...checkpoint, goal: session.goal }, role);
}
function initialCheckpoint(goal) {
    return {
        goal, acceptedBriefRevision: goal.revision,
        acceptanceProgress: goal.acceptance.map(criterion => ({
            criterion, status: "pending", evidenceRefs: [],
        })),
        candidateSha: null, consumedEvidenceRefs: [], nativeDispatchIds: [], checks: [],
        nextAction: goal.outcome,
    };
}
export async function compactTask(event, host, path) {
    const { session, key } = await localGoal(event, host, path);
    if (!session || !key)
        return;
    const state = taskContext(path, key, contextRole(event));
    const previous = await state.store.load(state.key).catch(() => undefined);
    const checkpoint = previous?.checkpoint?.goal.id === session.goal.id &&
        previous.checkpoint.goal.revision === session.goal.revision ? previous.checkpoint : initialCheckpoint(session.goal);
    await state.store.save(state.key, { ...previous, checkpoint, seen: [],
        generation: (previous?.generation ?? 0) + 1 });
}
export async function resumeGoal(event, host, path, availableBytes, core) {
    const empty = { text: "", acknowledge: async () => { } };
    try {
        const { session, key } = await localGoal(event, host, path);
        if (!session || !key || availableBytes <= 0)
            return empty;
        const state = taskContext(path, key, contextRole(event));
        let previous = await state.store.load(state.key).catch(() => undefined);
        const floor = core && validFloor(previous?.skillFloor, core.binding, { ...core, host })
            ? previous.skillFloor : undefined;
        if (core && previous?.skillFloor && !floor) {
            previous = { ...previous };
            delete previous.skillFloor;
            await state.store.save(state.key, previous);
        }
        const generation = previous?.generation ?? 0;
        const epoch = (value) => JSON.stringify([event.session_id ?? event.thread_id, event.source,
            value, session.goal.id, session.goal.revision]);
        if (previous?.restoredEpoch === epoch(generation))
            return empty;
        const checkpoint = previous?.checkpoint?.goal.id === session.goal.id &&
            previous.checkpoint.goal.revision === session.goal.revision ? previous.checkpoint : initialCheckpoint(session.goal);
        const reference = `Checkpoint: .codexorch/context/${state.key}.json`;
        if (Buffer.byteLength(reference) > availableBytes)
            return empty;
        const facts = [
            ...(floor ? [`Selected skills: ${floor.skillRefs.map(item => `${item.id} (${item.entrypoint})`).join(", ")}`] : []),
            `Brief: ${checkpoint.acceptedBriefRevision}; candidate: ${checkpoint.candidateSha ?? "unknown"}`,
            `AC: ${checkpoint.acceptanceProgress.map(item => `${item.criterion}=${item.status}`).join("; ")}`,
            `Consumed: ${checkpoint.consumedEvidenceRefs.join(", ") || "none"}`,
            `Dispatches: ${checkpoint.nativeDispatchIds.join(", ") || "none"}`,
            `Checks: ${checkpoint.checks.map(item => `${item.command}=${item.exit}`).join("; ") || "none"}`,
            `Next: ${checkpoint.nextAction}`,
        ].join("\n");
        const summary = savedGoalSummary(session.goal, 480);
        return { text: [reference, boundedText(`${summary}\n${facts}`, availableBytes - Buffer.byteLength(reference) - 1)].filter(Boolean).join("\n"),
            acknowledge: async () => {
                await state.store.save(state.key, { ...previous, checkpoint, restoredEpoch: epoch(generation), seen: [], generation });
            } };
    }
    catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith("Ambiguous goal lineage:"))
            throw error;
        return { ...empty, text: boundedText(`${error.message}. Select the source session explicitly; no goal or task was selected.`, availableBytes) };
    }
}
