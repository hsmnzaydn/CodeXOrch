import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalog, selectSkillPaths } from "../../core/capabilities/catalog/index.js";
import { bindProject } from "../../core/project/binding/index.js";
import { discoverProject } from "../../core/project/discovery/index.js";
export async function selectedContext(root, head, request) {
    try {
        const runtime = fileURLToPath(new URL("../../../", import.meta.url));
        const host = existsSync(join(runtime, "../skills")) ? "claude" : "codex";
        const sourceRoot = join(runtime, "packages"), compiledRoot = resolve(runtime, "../../..");
        const packagesRoot = existsSync(join(sourceRoot, host, "codexorch/catalog.json")) ? sourceRoot :
            existsSync(join(compiledRoot, host, "codexorch/catalog.json")) ? compiledRoot : resolve(runtime, "..");
        const catalog = await loadCatalog(packagesRoot, host);
        const binding = await bindProject({ id: `local:${root}`, path: root, head }, catalog.capabilities);
        const selection = await selectSkillPaths({ request, host, catalog, binding, profile: await discoverProject(binding) });
        return { binding, skillRefs: selection.skillRefs,
            selectedCapabilities: selection.capabilities.map(({ id, version }) => ({ id, version })) };
    }
    catch {
        return undefined;
    }
}
