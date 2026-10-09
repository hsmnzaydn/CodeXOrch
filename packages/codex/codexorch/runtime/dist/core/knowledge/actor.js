import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { bindProject } from "../project/binding/index.js";
const execute = promisify(execFile);
export async function resolveKnowledgeActor(root, explicit, hostActor) {
    let profile = {};
    try {
        profile = JSON.parse(await readFile(join(root, ".codexorch", "user-profile.json"), "utf8"));
    }
    catch (error) {
        if (error.code !== "ENOENT")
            throw error;
    }
    let boundActor;
    if (!explicit?.trim()) {
        const raw = process.env.CODEXORCH_KNOWLEDGE_BINDING ??
            await readFile(join(root, ".codexorch", "knowledge-binding.json"), "utf8")
                .catch((error) => {
                if (error.code === "ENOENT")
                    return undefined;
                throw error;
            });
        if (raw) {
            const binding = JSON.parse(raw);
            if (binding && typeof binding === "object" && !Array.isArray(binding)) {
                const value = binding;
                if (typeof value.actorId === "string" &&
                    value.personScope === `person:${value.actorId}` &&
                    typeof value.repository === "string") {
                    const head = await execute("git", ["-C", root, "rev-parse", "HEAD"])
                        .then(({ stdout }) => stdout.trim(), () => "local");
                    const project = await bindProject({ id: `local:${root}`, path: root, head });
                    if (value.repository === project.repository)
                        boundActor = value.actorId;
                }
            }
        }
    }
    let actorId = explicit?.trim() || boundActor ||
        (typeof profile.actorId === "string" && profile.actorId.trim()) ||
        hostActor?.trim() || undefined;
    if (!actorId) {
        const email = await execute("git", ["-C", root, "config", "--get", "user.email"])
            .then(({ stdout }) => stdout.trim().toLowerCase(), () => "");
        if (email)
            actorId = `git:${createHash("sha256").update(email).digest("hex")}`;
    }
    if (actorId && !/^[^\s*]+$/.test(actorId))
        throw new Error("Invalid knowledge actor ID");
    const teamScopes = profile.teamScopes ?? [];
    if (!Array.isArray(teamScopes) || !teamScopes.every((scope) => typeof scope === "string" && /^team:[^*]+$/.test(scope))) {
        throw new Error("Invalid user profile team scopes");
    }
    return { ...(actorId ? { actorId } : {}), teamScopes };
}
