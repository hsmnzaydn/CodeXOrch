export function planScopedQueries(requestedScopes, authorizedScopes) {
    if (requestedScopes.some((scope) => !scope || scope === "*" || !authorizedScopes.has(scope))) {
        throw new Error("Knowledge scope not authorized");
    }
    return [...new Set(requestedScopes)].map((scope) => ({ scope }));
}
export function resolveScopedKnowledge(records, queries, now, sourceRevisions = {}) {
    const scopes = new Set(queries.map(({ scope }) => scope));
    const groups = new Map();
    for (const record of records) {
        if (!scopes.has(record.scope) || !record.id || !record.revision)
            continue;
        const key = JSON.stringify([record.scope, record.id]);
        const group = groups.get(key) ?? [];
        group.push(record);
        groups.set(key, group);
    }
    const visible = [];
    const conflicts = [];
    for (const group of groups.values()) {
        const superseded = new Set(group.map((record) => record.supersedes).filter((revision) => !!revision));
        const byRevision = new Map();
        for (const record of group) {
            if (record.validUntil && (!Number.isFinite(Date.parse(record.validUntil)) || Date.parse(record.validUntil) <= now.getTime()))
                continue;
            if (record.sourceRevision && sourceRevisions[record.source] !== record.sourceRevision)
                continue;
            const duplicates = byRevision.get(record.revision) ?? [];
            if (!duplicates.some((item) => item.content === record.content &&
                item.source === record.source &&
                item.trust === record.trust &&
                item.supersedes === record.supersedes &&
                item.validUntil === record.validUntil &&
                item.tombstone === record.tombstone &&
                item.sourceRevision === record.sourceRevision))
                duplicates.push(record);
            byRevision.set(record.revision, duplicates);
        }
        const latest = [...byRevision].filter(([revision]) => !superseded.has(revision)).flatMap(([, revisions]) => revisions);
        if (latest.some((record) => record.tombstone))
            continue;
        if (latest.length > 1) {
            conflicts.push(latest);
        }
        else if (latest[0]) {
            visible.push(latest[0]);
        }
    }
    return { records: visible, conflicts };
}
