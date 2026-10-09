import { createHash } from "node:crypto";
import { access, readdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { optionalSelection } from "./semantic.js";
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const strings = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");
function knowledgeKind(item) {
    try {
        const value = JSON.parse(item.content);
        if (!isObject(value))
            return undefined;
        if (Array.isArray(value.sourceRecordIds) && typeof value.description === "string")
            return "relationship";
        if (item.source.startsWith("orca:") && typeof value.taskId === "string" &&
            typeof value.status === "string" && Object.hasOwn(value, "result"))
            return "outcome";
    }
    catch { /* Plain knowledge is not a structured outcome. */ }
    return undefined;
}
export function knowledgePreview(item) {
    const kind = knowledgeKind(item);
    if (!kind)
        return item.content.slice(0, 512);
    const record = JSON.parse(item.content);
    const excerpt = (value, limit) => {
        const text = (typeof value === "string" ? value : JSON.stringify(value)) ?? "";
        return text.length <= limit ? text : `${text.slice(0, limit - 72)}\n[excerpt]\n${text.slice(-60)}`;
    };
    const preview = kind === "outcome"
        ? { result: excerpt(record.result, 240), outcome: excerpt(record.outcome, 100) }
        : { description: excerpt(record.description, 300) };
    // Excerpts carry beginning and end; targeted retrieval uses recordRef when middle is needed.
    for (const key of kind === "outcome"
        ? ["status", "taskId", "evidenceRefs", "goalId", "goalRevision"]
        : ["sourceRecordIds", "taskId"]) {
        const candidate = { ...preview, [key]: record[key] };
        if (JSON.stringify(candidate).length <= 512)
            preview[key] = record[key];
    }
    if (item.id && item.scope && item.revision) {
        const candidate = { ...preview, recordRef: { scope: item.scope, id: item.id, revision: item.revision } };
        if (JSON.stringify(candidate).length <= 512)
            preview.recordRef = candidate.recordRef;
    }
    return JSON.stringify(preview);
}
export async function skillRevision(directory) {
    const files = [];
    const walk = async (path, relative) => {
        for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
            const name = relative ? `${relative}/${entry.name}` : entry.name;
            if (entry.isDirectory())
                await walk(join(path, entry.name), name);
            else if (entry.isFile())
                files.push(name);
        }
    };
    try {
        await walk(directory, "");
        const hash = createHash("sha256");
        for (const file of files)
            hash.update(file).update(await readFile(join(directory, file)));
        return hash.digest("hex");
    }
    catch (error) {
        if (error.code !== "ENOENT")
            throw error;
        return undefined;
    }
}
export async function loadCatalog(packagesRoot, host) {
    if (host !== "codex")
        throw new Error("Only Codex is supported");
    const installed = await access(join(packagesRoot, "catalog.json")).then(() => true, () => false);
    const packagePaths = installed
        ? await Promise.all((await readdir(dirname(dirname(packagesRoot)), { withFileTypes: true }))
            .filter((entry) => entry.isDirectory() && ["codexorch", "codexorch-flutter"].includes(entry.name))
            .map(async (entry) => join(dirname(dirname(packagesRoot)), entry.name, basename(packagesRoot))))
        : (await readdir(join(packagesRoot, host), { withFileTypes: true }))
            .filter((entry) => entry.isDirectory() && ["codexorch", "codexorch-flutter"].includes(entry.name)).map((entry) => join(packagesRoot, host, entry.name));
    const paths = [];
    for (const path of packagePaths.sort()) {
        if (await access(join(path, "catalog.json")).then(() => true, () => false))
            paths.push(path);
    }
    const descriptors = [];
    const digests = [];
    for (const packagePath of paths) {
        const path = join(packagePath, "catalog.json");
        const raw = await readFile(path, "utf8");
        const catalog = JSON.parse(raw);
        if (!isObject(catalog) || !Array.isArray(catalog.capabilities))
            throw new Error(`Invalid catalog: ${path}`);
        digests.push(raw);
        for (const item of catalog.capabilities) {
            if (!isObject(item) || typeof item.id !== "string" || !item.id ||
                typeof item.plugin !== "string" || !item.plugin ||
                typeof item.version !== "string" || typeof item.description !== "string" ||
                typeof item.group !== "string" || !["capabilities", "project-packs"].includes(item.group) ||
                !strings(item.hosts) || !strings(item.requires) || !strings(item.provides) ||
                !strings(item.conflicts) || typeof item.source !== "string" ||
                typeof item.license !== "string" ||
                (item.projectPack !== undefined && typeof item.projectPack !== "boolean") ||
                (item.repository_ids !== undefined && !strings(item.repository_ids)) ||
                (item.folders !== undefined && !strings(item.folders)) ||
                (item.project_marker !== undefined && typeof item.project_marker !== "string"))
                throw new Error(`Invalid capability: ${path}`);
            if (!item.hosts.includes(host))
                continue;
            const id = item.id;
            if (descriptors.some((candidate) => candidate.id === id))
                throw new Error(`Duplicate capability: ${id}`);
            const entrypoint = join(packagePath, "codex-skills", id, "SKILL.md");
            const revision = await skillRevision(dirname(entrypoint));
            if (!revision)
                continue;
            digests.push(`${id}:${revision}`);
            // Keep product-policy dependencies even when that policy's skill source disappears.
            const policies = item.projectPack ? [] : catalog.capabilities.filter(candidate => isObject(candidate) && candidate.projectPack === true && candidate.group === "capabilities" &&
                candidate.plugin === item.plugin && typeof candidate.id === "string")
                .map(candidate => candidate.id);
            descriptors.push({
                id, plugin: item.plugin, group: item.group, version: item.version,
                description: item.description, entrypoint,
                requires: [...new Set([...item.requires, ...policies])], provides: item.provides, conflicts: item.conflicts,
                hosts: [host], source: item.source, license: item.license,
                projectPack: item.projectPack === true, repositoryIds: item.repository_ids ?? [],
                folders: item.folders ?? [], ...(item.project_marker ? { projectMarker: item.project_marker } : {}),
            });
        }
    }
    return { capabilities: descriptors, revision: createHash("sha256").update(digests.join("\n")).digest("hex") };
}
function explicitReadOnly(request) {
    const action = /\b(?:run|test|build|probe|implement|create|write|execute|install|deploy|publish|verify|fix)\b|(?:düzelt|oluştur|çalıştır|uygula|yükle|kur)(?:\w*)/iu;
    if (action.test(request))
        return false;
    return /(?:sadece|yalnızca|yalnız|only)\s+(?:incele|analiz et|inspect|review|analy[sz]e)|(?:hiçbir\s+)?dosya(?:yı|ları)?\s+değiştirme|\bdokunma\b|\bread-only\b|\bplan[- ]only\b|\bincele\b|\binspect\b|\breview\b/iu.test(request) ||
        /\?\s*$/u.test(request);
}
export function selectLocalCapabilities(input) {
    const eligible = input.catalog.capabilities.filter(item => item.hosts.includes(input.host));
    const contract = eligible.find(item => item.projectPack && item.id === input.binding.productVariant);
    if (input.binding.productVariant && !contract)
        throw new Error(`Unavailable project contract: ${input.binding.productVariant}`);
    const words = (text) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
    const request = words((input.request ?? "").slice(0, 8192));
    const generic = words("a an and api app build capability code consumer contracts create data development existing feature fix for implementation implement in inspect of or project read review service state task the to typed use web with work");
    const evidence = words((input.request ?? "").slice(0, 8192) + " " +
        (input.profile?.manifests.join(" ") ?? "") + " " + (input.profile?.languages.join(" ") ?? ""));
    const capabilities = contract ? [contract] : [];
    const dependencyIds = [];
    const acceptedIds = [];
    const unresolvedRequirements = [];
    const conflicts = (a, b) => a.conflicts.some(id => id === b.id || b.provides.includes(id)) ||
        b.conflicts.some(id => id === a.id || a.provides.includes(id));
    const add = (item, visiting = new Set()) => {
        if (capabilities.some(candidate => candidate.id === item.id))
            return true;
        if (visiting.has(item.id) || capabilities.length >= 8 ||
            capabilities.some(candidate => conflicts(item, candidate)))
            return false;
        visiting.add(item.id);
        for (const requirement of item.requires) {
            if (capabilities.some(candidate => candidate.id === requirement || candidate.provides.includes(requirement)))
                continue;
            const providers = eligible.filter(candidate => !candidate.projectPack &&
                (candidate.id === requirement || candidate.provides.includes(requirement)));
            if (providers.length !== 1 || !add(providers[0], visiting))
                return false;
            dependencyIds.push(providers[0].id);
        }
        if (capabilities.length >= 8 || capabilities.some(candidate => conflicts(item, candidate)))
            return false;
        capabilities.push(item);
        return true;
    };
    // The bound contract's requirements are expertise, not another product identity.
    if (contract)
        for (const requirement of contract.requires) {
            const providers = eligible.filter(item => !item.projectPack &&
                (item.id === requirement || item.provides.includes(requirement)));
            if (providers.length === 1 && add(providers[0]))
                dependencyIds.push(providers[0].id);
            else
                unresolvedRequirements.push(requirement);
        }
    if (unresolvedRequirements.length) {
        capabilities.splice(1);
        dependencyIds.length = 0;
    }
    const candidates = eligible.filter(item => !item.projectPack &&
        (!contract || item.plugin === contract.plugin)).map(item => {
        const terms = words(`${item.id} ${item.description} ${item.provides.join(" ")}`);
        const score = [...terms].filter(word => !generic.has(word) && evidence.has(word)).length;
        const names = [...words(item.id)].filter(word => !generic.has(word));
        const named = names.length > 0 && names.every(word => request.has(word));
        return { item, score: named ? score + 2 : score };
    }).filter(({ score }) => score >= 2).sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id));
    const optional = eligible.filter(item => !item.projectPack && (!contract || item.plugin === contract.plugin));
    const requested = input.optionalIds === undefined ? candidates.slice(0, 3).map(({ item }) => item.id)
        : input.optionalIds.slice(0, 3);
    for (const id of unresolvedRequirements.length ? [] : [...new Set([...(input.floorIds ?? []), ...requested])]) {
        const item = optional.find(candidate => candidate.id === id);
        if (!item)
            continue;
        if (capabilities.some(candidate => candidate.id === item.id))
            continue;
        const saved = capabilities.length, dependencies = dependencyIds.length;
        if (add(item))
            acceptedIds.push(item.id);
        else {
            capabilities.splice(saved);
            dependencyIds.splice(dependencies);
        }
    }
    return { capabilities, acceptedIds, dependencyIds: [...new Set(dependencyIds)], unresolvedRequirements,
        requiredContracts: contract ? [contract.entrypoint] : [],
        skillRefs: capabilities.map(({ id, entrypoint }) => ({ id, entrypoint })),
        mode: "native" };
}
export async function selectSkillPaths(input) {
    const mandatory = selectLocalCapabilities({ ...input, optionalIds: [] });
    const optional = input.catalog.capabilities.filter(item => !item.projectPack &&
        item.hosts.includes(input.host) && (!input.binding.productVariant ||
        item.plugin === mandatory.capabilities[0]?.plugin) &&
        !mandatory.capabilities.some(required => required.id === item.id) &&
        selectLocalCapabilities({ ...input, optionalIds: [item.id] }).capabilities.some(selected => selected.id === item.id));
    const remote = mandatory.unresolvedRequirements.length ? undefined : await optionalSelection(input, optional);
    const selection = selectLocalCapabilities({ ...input,
        ...(remote?.mode === "live" ? { optionalIds: remote.selectedIds } : {}) });
    return { ...selection, remote };
}
export async function selectCapabilities(input) {
    if (!input.request.trim())
        throw new Error("Empty user request");
    const local = await selectSkillPaths(input);
    const { capabilities } = local;
    const contract = capabilities.find(item => item.projectPack);
    const transition = /^(?:devam(?:\s+et)?|continue|resume|önceki yöntemi reddet|reject (?:the )?previous method|yeniden başla|baştan başla|restart)[.!]?\s*$/iu.test(input.request.trim());
    const goal = input.previousGoal && !transition ? input.previousGoal : input.goal;
    const sourceRevisions = await Promise.all(capabilities.map(async (item) => [item.entrypoint, await skillRevision(dirname(item.entrypoint))]));
    const context = {
        binding: input.binding, goalRevision: goal.revision,
        ...(input.profile ? { projectProfile: input.profile } : {}),
        ...(contract ? { projectCapability: contract.id } : {}),
        requiredContracts: capabilities.map(item => item.entrypoint),
        selectedCapabilities: capabilities.map(item => ({ id: item.id, version: item.version })),
        sourceRevisions: Object.fromEntries(sourceRevisions.filter((entry) => entry[1] !== undefined)),
        artifactRefs: [], tokenCount: "unknown",
        epoch: `${input.binding.workspaceId}:${goal.revision}:${input.catalog.revision}`, role: "lead",
        knowledge: (input.knowledge ?? []).slice(0, 10),
    };
    return {
        capabilities, context, goal,
        intent: input.intent ?? (explicitReadOnly(input.request) ? "read-only" : "implementation"),
        decision: { mode: "native-degraded", model: "native", requestedModel: "unknown",
            effectiveEffort: "unknown", latencyMs: 0, usage: "unknown", responseId: null,
            cacheHit: false, ...local.remote,
            degradedReason: local.unresolvedRequirements.length
                ? `unresolved_contract_requirements:${local.unresolvedRequirements.join(",")}` : local.remote?.degradedReason ?? null,
            acceptedIds: local.acceptedIds,
            dependencyIds: local.dependencyIds, loadedIds: capabilities.map(item => item.id) },
    };
}
