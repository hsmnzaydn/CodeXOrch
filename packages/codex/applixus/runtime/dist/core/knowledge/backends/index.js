import { createHash } from "node:crypto";
import { planScopedQueries, resolveScopedKnowledge, } from "../policy/index.js";
export class KnowledgeOutcomeUnknownError extends Error {
}
const definitelyNotSent = (error) => {
    if (error instanceof KnowledgeOutcomeUnknownError)
        return false;
    if (!isObject(error))
        return false;
    if (["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH"].includes(String(error.code)))
        return true;
    return error.cause !== error && definitelyNotSent(error.cause);
};
const digest = (value) => createHash("sha256").update(value).digest("hex");
const prefixFor = (scope) => `knowledge-${digest(scope).slice(0, 24)}-`;
const keyFor = (scope, id) => `${prefixFor(scope)}${digest(id)}`;
const revisionKey = (scope, id, revision) => `${keyFor(scope, id)}-${digest(revision).slice(0, 24)}`;
const deliveryKey = (scope, id, revision, backend) => `${prefixFor(scope)}${digest(JSON.stringify([id, revision, backend]))}`;
export class KnowledgeService {
    store;
    backends;
    authorizedScopes;
    acceptedProjectPack;
    constructor(store, backends, authorizedScopes, acceptedProjectPack = []) {
        this.store = store;
        this.backends = backends;
        this.authorizedScopes = authorizedScopes;
        this.acceptedProjectPack = acceptedProjectPack;
    }
    async recall(scopes, text, sourceRevisions = {}) {
        const queries = planScopedQueries(scopes, this.authorizedScopes);
        if (!text.trim())
            throw new Error("Knowledge query required");
        const requests = queries.flatMap(({ scope }) => this.backends.filter((backend) => backend.capabilities.scopedRetrieval)
            .map((backend) => ({ backend: backend.name, request: backend.search(scope, text, 25) })));
        const results = await Promise.allSettled(requests.map(({ request }) => request));
        // Backend filtering is mandatory; this guard also rejects malformed responses.
        const records = results.flatMap((result) => result.status === "fulfilled" ? result.value : [])
            .filter((record) => queries.some(({ scope }) => scope === record.scope) &&
            !!record.id && !!record.revision && !!record.source)
            .map((record) => ({ ...record, trust: "candidate" }));
        // Local matching is lexical only; semantic ranking belongs to scoped backends.
        const terms = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((term) => term.length >= 4);
        const saved = (await Promise.all(queries.map(async ({ scope }) => (await (this.store.knowledge?.scan(scope) ?? this.store.scan(prefixFor(scope))))
            .filter((value) => isBackendRecord(value) && value.scope === scope && value.delivery !== undefined)))).flat();
        const local = this.acceptedProjectPack.filter((record) => record.trust === "approved" && queries.some(({ scope }) => scope === record.scope));
        const resolved = resolveScopedKnowledge([...local, ...saved, ...records], queries, new Date(), sourceRevisions);
        const remote = new Set(records);
        return {
            records: resolved.records.filter((record) => record.trust === "approved" || remote.has(record) ||
                terms.some((term) => record.content.toLowerCase().includes(term))),
            conflicts: resolved.conflicts.filter((group) => group.some((record) => record.trust === "approved" || remote.has(record) ||
                terms.some((term) => record.content.toLowerCase().includes(term)))),
            unavailableBackends: requests.flatMap(({ backend }, index) => results[index]?.status === "rejected" ? [backend] : []),
        };
    }
    async save(record) {
        planScopedQueries([record.scope], this.authorizedScopes);
        if (!record.id || !record.revision || !record.source || !record.content) {
            throw new Error("Incomplete knowledge record");
        }
        if (record.trust !== "candidate") {
            throw new Error("Approved knowledge requires source-controlled project pack");
        }
        const saved = { ...record, delivery: "saved" };
        if (this.store.knowledge)
            await this.store.knowledge.save(saved);
        else {
            // Fixture stores lack cross-process CAS; production uses SQLite metadata.
            await this.store.save(revisionKey(record.scope, record.id, record.revision), saved);
            await this.store.save(keyFor(record.scope, record.id), { currentRevision: record.revision });
        }
        return saved;
    }
    async current(scope, id) {
        planScopedQueries([scope], this.authorizedScopes);
        const pointer = this.store.knowledge ? undefined : await this.store.load(keyFor(scope, id));
        const record = this.store.knowledge
            ? await this.store.knowledge.current(scope, id)
            : isObject(pointer) && typeof pointer.currentRevision === "string"
                ? await this.store.load(revisionKey(scope, id, pointer.currentRevision)) : undefined;
        return isBackendRecord(record) && record.scope === scope && record.id === id ? record : undefined;
    }
    async deliver(scope, id, backend) {
        planScopedQueries([scope], this.authorizedScopes);
        const record = await this.current(scope, id);
        if (!isBackendRecord(record) || record.scope !== scope || record.id !== id ||
            record.delivery !== "saved")
            throw new Error("No saved knowledge delivery");
        const previous = this.store.knowledge
            ? await this.store.knowledge.delivery(scope, id, record.revision, backend.name)
            : await this.store.load(deliveryKey(scope, id, record.revision, backend.name));
        const status = typeof previous === "string" ? previous
            : isObject(previous) ? previous.status : undefined;
        if (status === "delivered" || status === "visible") {
            return { ...record, backend: backend.name, delivery: status };
        }
        const claimed = this.store.knowledge
            ? await this.store.knowledge.claim(scope, id, record.revision, backend.name)
            : status === undefined || status === "saved";
        if (!claimed) {
            const reconciled = await backend.reconcile?.(record);
            if (reconciled) {
                if (this.store.knowledge)
                    await this.store.knowledge.deliver(scope, id, record.revision, backend.name, reconciled);
                else
                    await this.store.save(deliveryKey(scope, id, record.revision, backend.name), { status: reconciled });
                return { ...record, backend: backend.name, delivery: reconciled };
            }
            // An ambiguous append ACK cannot be retried without a proven remote identity; manual reconciliation clears pending.
            throw new Error("Knowledge delivery pending reconciliation");
        }
        if (!this.store.knowledge) {
            await this.store.save(deliveryKey(scope, id, record.revision, backend.name), { status: "pending" });
        }
        let delivery;
        try {
            delivery = await backend.deliver(record);
        }
        catch (error) {
            if (definitelyNotSent(error)) {
                if (this.store.knowledge)
                    await this.store.knowledge.release(scope, id, record.revision, backend.name);
                else
                    await this.store.save(deliveryKey(scope, id, record.revision, backend.name), { status: "saved" });
            }
            throw error;
        }
        const updated = { ...record, backend: backend.name, delivery };
        if (this.store.knowledge) {
            await this.store.knowledge.deliver(scope, id, record.revision, backend.name, delivery);
        }
        else {
            await this.store.save(deliveryKey(scope, id, record.revision, backend.name), { status: delivery });
        }
        return updated;
    }
}
export function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function isBackendRecord(value) {
    return isObject(value) && typeof value.id === "string" &&
        typeof value.scope === "string" && typeof value.revision === "string" &&
        typeof value.content === "string" && typeof value.source === "string" &&
        typeof value.backend === "string" &&
        (value.trust === "candidate" || value.trust === "approved");
}
