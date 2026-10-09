import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
export class FileProjectionStore {
    directory;
    constructor(directory) {
        this.directory = directory;
    }
    openKnowledge() {
        mkdirSync(this.directory, { recursive: true, mode: 0o700 });
        const db = new DatabaseSync(join(this.directory, "metadata.sqlite"), { timeout: 5000 });
        try {
            if (db.prepare("PRAGMA user_version").get().user_version === 0) {
                db.exec(`BEGIN IMMEDIATE;
          CREATE TABLE knowledge_revisions (
            scope TEXT NOT NULL, id TEXT NOT NULL, revision TEXT NOT NULL, record TEXT NOT NULL,
            PRIMARY KEY (scope, id, revision));
          CREATE TABLE knowledge_current (
            scope TEXT NOT NULL, id TEXT NOT NULL, revision TEXT NOT NULL,
            PRIMARY KEY (scope, id));
          CREATE TABLE knowledge_deliveries (
            scope TEXT NOT NULL, id TEXT NOT NULL, revision TEXT NOT NULL,
            backend TEXT NOT NULL, status TEXT NOT NULL,
            PRIMARY KEY (scope, id, revision, backend));`);
                try {
                    // Legacy per-id projections are imported once; their files remain as rollback copies.
                    for (const name of readdirSync(this.directory).filter((name) => /^knowledge-[a-f0-9]{24}-[a-f0-9]{64}\.json$/.test(name))) {
                        const record = JSON.parse(readFileSync(join(this.directory, name), "utf8"));
                        if (!record || typeof record !== "object")
                            continue;
                        const value = record;
                        if (typeof value.scope !== "string" || typeof value.id !== "string" ||
                            typeof value.revision !== "string" || typeof value.backend !== "string")
                            continue;
                        db.prepare("INSERT OR IGNORE INTO knowledge_revisions VALUES (?, ?, ?, ?)")
                            .run(value.scope, value.id, value.revision, JSON.stringify(record));
                        db.prepare("INSERT OR IGNORE INTO knowledge_current VALUES (?, ?, ?)")
                            .run(value.scope, value.id, value.revision);
                        if (typeof value.delivery === "string") {
                            db.prepare("INSERT OR IGNORE INTO knowledge_deliveries VALUES (?, ?, ?, ?, ?)")
                                .run(value.scope, value.id, value.revision, value.backend, value.delivery);
                        }
                    }
                    db.exec("PRAGMA user_version = 1; COMMIT");
                }
                catch (error) {
                    db.exec("ROLLBACK");
                    throw error;
                }
            }
            return db;
        }
        catch (error) {
            db.close();
            throw error;
        }
    }
    knowledge = {
        save: async (record) => {
            const db = this.openKnowledge();
            try {
                db.exec("BEGIN IMMEDIATE");
                try {
                    const existing = db.prepare("SELECT record FROM knowledge_revisions WHERE scope = ? AND id = ? AND revision = ?")
                        .get(record.scope, record.id, record.revision);
                    if (existing && existing.record !== JSON.stringify(record))
                        throw new Error("Knowledge revision already exists");
                    db.prepare("INSERT OR IGNORE INTO knowledge_revisions VALUES (?, ?, ?, ?)")
                        .run(record.scope, record.id, record.revision, JSON.stringify(record));
                    db.prepare("INSERT INTO knowledge_current VALUES (?, ?, ?) ON CONFLICT(scope, id) DO UPDATE SET revision = excluded.revision")
                        .run(record.scope, record.id, record.revision);
                    db.prepare("INSERT OR IGNORE INTO knowledge_deliveries VALUES (?, ?, ?, ?, 'saved')")
                        .run(record.scope, record.id, record.revision, record.backend);
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
        },
        current: async (scope, id) => {
            const db = this.openKnowledge();
            try {
                const row = db.prepare(`SELECT r.record FROM knowledge_current c
          JOIN knowledge_revisions r USING (scope, id, revision) WHERE c.scope = ? AND c.id = ?`)
                    .get(scope, id);
                return row ? JSON.parse(row.record) : undefined;
            }
            finally {
                db.close();
            }
        },
        scan: async (scope) => {
            const db = this.openKnowledge();
            try {
                return db.prepare("SELECT record FROM knowledge_revisions WHERE scope = ?")
                    .all(scope).map(({ record }) => JSON.parse(record));
            }
            finally {
                db.close();
            }
        },
        deliver: async (scope, id, revision, backend, status) => {
            const db = this.openKnowledge();
            try {
                db.prepare(`INSERT INTO knowledge_deliveries VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(scope, id, revision, backend) DO UPDATE SET status = excluded.status`)
                    .run(scope, id, revision, backend, status);
            }
            finally {
                db.close();
            }
        },
        delivery: async (scope, id, revision, backend) => {
            const db = this.openKnowledge();
            try {
                return db.prepare(`SELECT status FROM knowledge_deliveries
          WHERE scope = ? AND id = ? AND revision = ? AND backend = ?`)
                    .get(scope, id, revision, backend)?.status;
            }
            finally {
                db.close();
            }
        },
        claim: async (scope, id, revision, backend) => {
            const db = this.openKnowledge();
            try {
                db.exec("BEGIN IMMEDIATE");
                try {
                    const result = db.prepare(`INSERT INTO knowledge_deliveries VALUES (?, ?, ?, ?, 'pending')
            ON CONFLICT(scope, id, revision, backend) DO UPDATE SET status = 'pending'
            WHERE status = 'saved'`).run(scope, id, revision, backend);
                    db.exec("COMMIT");
                    return result.changes === 1;
                }
                catch (error) {
                    db.exec("ROLLBACK");
                    throw error;
                }
            }
            finally {
                db.close();
            }
        },
        release: async (scope, id, revision, backend) => {
            const db = this.openKnowledge();
            try {
                db.prepare(`UPDATE knowledge_deliveries SET status = 'saved'
          WHERE scope = ? AND id = ? AND revision = ? AND backend = ? AND status = 'pending'`)
                    .run(scope, id, revision, backend);
            }
            finally {
                db.close();
            }
        },
    };
    path(key) {
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(key))
            throw new Error("Invalid projection key");
        return join(this.directory, `${key}.json`);
    }
    async load(key) {
        try {
            return JSON.parse(await readFile(this.path(key), "utf8"));
        }
        catch (error) {
            if (error.code === "ENOENT")
                return undefined;
            throw error;
        }
    }
    async scan(prefix) {
        this.path(prefix);
        let names;
        try {
            names = await readdir(this.directory);
        }
        catch (error) {
            if (error.code === "ENOENT")
                return [];
            throw error;
        }
        return Promise.all(names.filter((name) => name.startsWith(prefix) && /^[a-zA-Z0-9_-]{1,128}\.json$/.test(name))
            .sort().map((name) => this.load(name.slice(0, -5))));
    }
    async save(key, value) {
        const target = this.path(key);
        const serialized = JSON.stringify(value);
        if (serialized === undefined)
            throw new Error("Projection must be JSON");
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const temporary = join(this.directory, `.${randomUUID()}.tmp`);
        try {
            await writeFile(temporary, serialized, { flag: "wx", mode: 0o600 });
            await rename(temporary, target);
        }
        catch (error) {
            await unlink(temporary).catch(() => undefined);
            throw error;
        }
    }
}
