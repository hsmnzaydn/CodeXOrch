import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { FileProjectionStore } from "../../adapters/storage.js";
export function reviseGoal(goal, change) {
    if (change.expectedRevision !== goal.revision)
        throw new Error("Stale goal revision");
    if (!change.revision || change.revision === goal.revision)
        throw new Error("Goal revision must change");
    const rejected = new Set([...(goal.rejectedMethods ?? []), ...(change.rejectedMethods ?? [])]);
    return {
        ...goal,
        revision: change.revision,
        outcome: change.outcome ? `${goal.outcome}\nRevision: ${change.outcome}` : goal.outcome,
        acceptance: change.acceptance ?? goal.acceptance,
        scope: change.scope ?? goal.scope,
        decisions: [...new Set([...(change.decisions ?? goal.decisions)].filter((decision) => !rejected.has(decision)))],
        openQuestions: change.openQuestions ?? goal.openQuestions,
        orcaTaskIds: goal.orcaTaskIds,
        rejectedMethods: [...rejected],
    };
}
export function attachTask(goal, taskId) {
    if (!taskId)
        throw new Error("Missing Orca task ID");
    if (goal.orcaTaskIds.includes(taskId))
        return goal;
    return { ...goal, orcaTaskIds: [...goal.orcaTaskIds, taskId] };
}
export function goalKey(projectRoot, actorId, sessionId) {
    if (!projectRoot || !actorId || !sessionId)
        throw new Error("Goal identity required");
    return `goal_${createHash("sha256").update(JSON.stringify([projectRoot, actorId, sessionId])).digest("hex")}`;
}
function goalStore(projectRoot) {
    return new FileProjectionStore(`${projectRoot}/.codexorch/goals`);
}
function goalDatabase(projectRoot) {
    const directory = join(projectRoot, ".codexorch", "goals");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(join(directory, "metadata.sqlite"), { timeout: 5000 });
    db.exec("CREATE TABLE IF NOT EXISTS goal_sessions (key TEXT PRIMARY KEY, revision TEXT NOT NULL, value TEXT NOT NULL)");
    db.exec("CREATE TABLE IF NOT EXISTS goal_assignments (goal_key TEXT NOT NULL, operation_key TEXT NOT NULL, dispatch_id TEXT, task_id TEXT, PRIMARY KEY (goal_key, operation_key))");
    db.exec("CREATE TABLE IF NOT EXISTS goal_history (goal_id TEXT PRIMARY KEY, value TEXT NOT NULL)");
    db.exec(`CREATE TABLE IF NOT EXISTS goal_lineage (actor_id TEXT NOT NULL, host TEXT NOT NULL,
    terminal_handle TEXT NOT NULL, session_id TEXT NOT NULL, goal_key TEXT NOT NULL,
    PRIMARY KEY (actor_id, host, terminal_handle))`);
    db.exec(`CREATE TABLE IF NOT EXISTS goal_session_lineage (actor_id TEXT NOT NULL, host TEXT NOT NULL,
    session_id TEXT NOT NULL, goal_key TEXT NOT NULL, source_session_id TEXT, PRIMARY KEY (actor_id, host, session_id))`);
    const columns = db.prepare("PRAGMA table_info(goal_assignments)").all();
    for (const [name, type] of [["goal_id", "TEXT"], ["revision", "TEXT"], ["attempt", "INTEGER"],
        ["run_id", "TEXT"], ["goal_snapshot", "TEXT"], ["workspace_id", "TEXT"], ["worker_workspace_id", "TEXT"]]) {
        if (!columns.some((column) => column.name === name))
            db.exec(`ALTER TABLE goal_assignments ADD COLUMN ${name} ${type}`);
    }
    return db;
}
function validSession(projectRoot, key, session) {
    if (session.projectRoot !== projectRoot || goalKey(projectRoot, session.actorId, session.sessionId) !== key ||
        !session.goal?.id || !Array.isArray(session.goal.orcaTaskIds))
        throw new Error("Invalid goal session");
}
export async function loadGoalSession(projectRoot, key) {
    const db = goalDatabase(projectRoot);
    try {
        const row = db.prepare("SELECT value FROM goal_sessions WHERE key = ?").get(key);
        if (row) {
            const stored = JSON.parse(row.value);
            validSession(projectRoot, key, stored);
            return stored;
        }
        const legacy = await goalStore(projectRoot).load(key);
        if (!legacy)
            return undefined;
        validSession(projectRoot, key, legacy);
        db.prepare("INSERT OR IGNORE INTO goal_sessions VALUES (?, ?, ?)")
            .run(key, legacy.goal.revision, JSON.stringify(legacy));
        const migrated = db.prepare("SELECT value FROM goal_sessions WHERE key = ?").get(key);
        return JSON.parse(migrated.value);
    }
    finally {
        db.close();
    }
}
export function resolveGoalLineage(projectRoot, actorId, host, sessionId, terminalHandle, resume = false, sourceSessionId) {
    const key = goalKey(projectRoot, actorId, `${host}:${sessionId}`);
    const db = goalDatabase(projectRoot);
    try {
        db.exec("BEGIN IMMEDIATE");
        try {
            const stored = db.prepare("SELECT value FROM goal_sessions WHERE key = ?");
            const mapped = db.prepare("SELECT goal_key FROM goal_session_lineage WHERE actor_id = ? AND host = ? AND session_id = ?");
            const legacy = terminalHandle && db.prepare(`SELECT goal_key FROM goal_lineage
        WHERE actor_id = ? AND host = ? AND terminal_handle = ? AND session_id = ?`);
            const lookup = (id) => mapped.get(actorId, host, id)?.goal_key ??
                (legacy && legacy.get(actorId, host, terminalHandle, id)?.goal_key) ??
                goalKey(projectRoot, actorId, `${host}:${id}`);
            const exact = lookup(sessionId);
            const exactRow = stored.get(exact);
            let resolved = exactRow ? exact : key;
            if (!exactRow && resume) {
                const source = sourceSessionId && sourceSessionId !== sessionId ? lookup(sourceSessionId) : undefined;
                if (!source || !stored.get(source))
                    throw new Error("Ambiguous goal lineage: resume requires a stored source session");
                resolved = source;
            }
            const row = stored.get(resolved);
            if (row)
                validSession(projectRoot, resolved, JSON.parse(row.value));
            db.prepare(`INSERT INTO goal_session_lineage VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(actor_id, host, session_id) DO NOTHING`)
                .run(actorId, host, sessionId, resolved, sourceSessionId ?? null);
            if (terminalHandle)
                db.prepare(`INSERT INTO goal_lineage VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(actor_id, host, terminal_handle)
        DO UPDATE SET session_id = excluded.session_id, goal_key = excluded.goal_key`)
                    .run(actorId, host, terminalHandle, sessionId, resolved);
            db.exec("COMMIT");
            return resolved;
        }
        catch (error) {
            db.exec("ROLLBACK");
            throw error;
        }
    }
    finally {
        db.close();
    }
}
export async function saveGoalSession(key, session, expectedRevision) {
    validSession(session.projectRoot, key, session);
    const db = goalDatabase(session.projectRoot);
    try {
        db.exec("BEGIN IMMEDIATE");
        try {
            if (expectedRevision === null) {
                const inserted = db.prepare("INSERT OR IGNORE INTO goal_sessions VALUES (?, ?, ?)")
                    .run(key, session.goal.revision, JSON.stringify(session)).changes;
                if (!inserted)
                    throw new Error("Goal session already exists");
            }
            else if (expectedRevision !== undefined) {
                const row = db.prepare("SELECT value FROM goal_sessions WHERE key = ? AND revision = ?")
                    .get(key, expectedRevision);
                if (!row)
                    throw new Error("Stale goal revision");
                const current = JSON.parse(row.value);
                if (current.goal.id === session.goal.id)
                    session.goal.orcaTaskIds = [...new Set([...current.goal.orcaTaskIds, ...session.goal.orcaTaskIds])];
                else
                    db.prepare("INSERT OR REPLACE INTO goal_history VALUES (?, ?)")
                        .run(current.goal.id, JSON.stringify(current.goal));
                db.prepare("UPDATE goal_sessions SET revision = ?, value = ? WHERE key = ?")
                    .run(session.goal.revision, JSON.stringify(session), key);
            }
            else {
                const previous = db.prepare("SELECT value FROM goal_sessions WHERE key = ?")
                    .get(key);
                if (previous) {
                    const old = JSON.parse(previous.value);
                    if (old.goal.id !== session.goal.id)
                        db.prepare("INSERT OR REPLACE INTO goal_history VALUES (?, ?)")
                            .run(old.goal.id, JSON.stringify(old.goal));
                }
                db.prepare("INSERT INTO goal_sessions VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET revision = excluded.revision, value = excluded.value")
                    .run(key, session.goal.revision, JSON.stringify(session));
            }
            db.exec("COMMIT");
        }
        catch (error) {
            db.exec("ROLLBACK");
            throw error;
        }
    }
    finally {
        db.close();
    }
}
export async function changeGoalSession(projectRoot, key, change) {
    const session = await loadGoalSession(projectRoot, key);
    if (!session)
        throw new Error("Missing goal");
    const db = goalDatabase(projectRoot);
    try {
        db.exec("BEGIN IMMEDIATE");
        try {
            const row = db.prepare("SELECT value FROM goal_sessions WHERE key = ?").get(key);
            if (!row)
                throw new Error("Missing goal");
            const current = JSON.parse(row.value);
            validSession(projectRoot, key, current);
            current.goal = change.revision ? reviseGoal(current.goal, change.revision)
                : attachTask(current.goal, change.taskId ?? "");
            db.prepare("UPDATE goal_sessions SET revision = ?, value = ? WHERE key = ?")
                .run(current.goal.revision, JSON.stringify(current), key);
            db.exec("COMMIT");
            return current.goal;
        }
        catch (error) {
            db.exec("ROLLBACK");
            throw error;
        }
    }
    finally {
        db.close();
    }
}
export function advanceGoal(previous, message) {
    const request = message.trim();
    if (!request)
        throw new Error("Empty goal request");
    const continuing = /^(?:devam(?:\s+et)?|continue|resume|kaldığın yerden devam)(?:[.!?]|\s*)$/iu.test(request);
    const rejection = /^(?:önceki yöntemi reddet|reject (?:the )?previous method)(?:[.!?]|\s*)$/iu.test(request);
    const restart = /^(?:yeniden başla|baştan başla|restart)(?:[.!?]|\s*)$/iu.test(request);
    if (previous && (continuing || rejection || restart)) {
        if (continuing)
            return previous;
        return reviseGoal(previous, {
            expectedRevision: previous.revision, revision: randomUUID(),
            ...(rejection ? { rejectedMethods: previous.decisions.slice(-1) } : {}),
            decisions: restart ? [] : previous.decisions,
        });
    }
    return {
        id: randomUUID(), revision: randomUUID(), outcome: request,
        acceptance: [], scope: [], decisions: [], openQuestions: [], orcaTaskIds: [],
    };
}
