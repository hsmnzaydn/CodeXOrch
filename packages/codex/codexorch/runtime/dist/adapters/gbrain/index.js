import { isBackendRecord, isObject, KnowledgeOutcomeUnknownError, } from "../../core/knowledge/backends/index.js";
export class GbrainBackend {
    sources;
    name = "gbrain";
    layer = "pages";
    capabilities = {
        scopedRetrieval: true, verifiedIdentity: false, pagination: true,
        revision: false, deletion: false,
    };
    // Each authorized scope must map to its own registered GBrain source.
    constructor(sources) {
        this.sources = sources;
    }
    source(scope) {
        const source = this.sources[scope];
        if (!source?.sourceId || source.sourceId === "__all__" || !source.call) {
            throw new Error("GBrain source not bound");
        }
        return source;
    }
    async search(scope, text, limit) {
        const { sourceId, call } = this.source(scope);
        const result = await call("search", { query: text, source_id: sourceId, limit });
        if (!isObject(result) || !Array.isArray(result.results))
            throw new Error("Invalid GBrain search response");
        return result.results.flatMap((hit) => {
            // Search snippets without exact source and revision metadata are not authoritative.
            if (!isObject(hit) || hit.source_id !== sourceId || !isBackendRecord(hit.record) ||
                hit.record.scope !== scope)
                return [];
            return [{ ...hit.record, backend: this.name }];
        });
    }
    async deliver(record) {
        const { call } = this.source(record.scope);
        const slug = `knowledge/${encodeURIComponent(record.scope)}/${encodeURIComponent(record.id)}/${encodeURIComponent(record.revision)}`;
        const content = JSON.stringify(record);
        await call("put_page", { slug, content });
        let visible;
        try {
            visible = await this.reconcile(record);
        }
        catch (error) {
            throw new KnowledgeOutcomeUnknownError("GBrain write awaits reconciliation", { cause: error });
        }
        if (!visible)
            throw new Error("GBrain delivery not visible at bound source");
        return "visible";
    }
    async reconcile(record) {
        const { sourceId, call } = this.source(record.scope);
        const slug = `knowledge/${encodeURIComponent(record.scope)}/${encodeURIComponent(record.id)}/${encodeURIComponent(record.revision)}`;
        const read = await call("get_page", { slug, source_id: sourceId, include_content: true });
        return isObject(read) && read.slug === slug && read.source_id === sourceId &&
            typeof read.content === "string" &&
            read.content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").trim() === JSON.stringify(record)
            ? "visible" : undefined;
    }
}
