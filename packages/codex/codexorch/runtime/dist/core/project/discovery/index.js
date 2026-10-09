import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
const markers = [
    ["package.json", "typescript", "npm"],
    ["pubspec.yaml", "dart", "pub"],
    ["go.mod", "go", "go"],
    ["Cargo.toml", "rust", "cargo"],
    ["pyproject.toml", "python", "python"],
    ["pom.xml", "java", "maven"],
    ["build.gradle", "kotlin", "gradle"],
    ["build.gradle.kts", "kotlin", "gradle"],
    ["project.godot", "gdscript", "godot"],
];
export async function discoverProject(binding) {
    if (!binding.canonicalRoot || !binding.workspaceId || !binding.repository) {
        throw new Error("Incomplete project binding");
    }
    const manifests = [];
    const languages = new Set();
    const packageManagers = new Set();
    const revisions = [];
    for (const [filename, language, manager] of markers) {
        const path = join(binding.canonicalRoot, filename);
        try {
            const content = await readFile(path);
            manifests.push(filename);
            languages.add(language);
            packageManagers.add(manager);
            revisions.push(`${filename}:${createHash("sha256").update(content).digest("hex")}`);
        }
        catch (error) {
            if (error.code !== "ENOENT")
                throw error;
        }
    }
    const buildCommands = [];
    const testCommands = [];
    let nodeTests = false;
    if (manifests.includes("package.json")) {
        const pkg = JSON.parse(await readFile(join(binding.canonicalRoot, "package.json"), "utf8"));
        if (!pkg || typeof pkg !== "object" || Array.isArray(pkg))
            throw new Error("Invalid package.json");
        const scripts = pkg.scripts;
        if (scripts !== undefined && (!scripts || typeof scripts !== "object" || Array.isArray(scripts))) {
            throw new Error("Invalid package scripts");
        }
        for (const [key, target] of [["build", buildCommands], ["test", testCommands]]) {
            if (typeof scripts?.[key] === "string") {
                target.push(`npm run ${key}`);
                if (key === "test")
                    nodeTests = /\bnode(?:\s+[^;&|]*)?\s+--test\b|\bnode\s+--test\b/
                        .test(scripts[key]);
            }
        }
        for (const [lock, manager] of [
            ["pnpm-lock.yaml", "pnpm"], ["yarn.lock", "yarn"], ["bun.lock", "bun"],
        ]) {
            try {
                await access(join(binding.canonicalRoot, lock));
                packageManagers.delete("npm");
                packageManagers.add(manager);
                for (const commands of [buildCommands, testCommands]) {
                    for (let index = 0; index < commands.length; index++)
                        commands[index] = commands[index].replace("npm run", `${manager} run`);
                }
                break;
            }
            catch (error) {
                if (error.code !== "ENOENT")
                    throw error;
            }
        }
    }
    let pytest = false;
    if (manifests.includes("pyproject.toml")) {
        const content = await readFile(join(binding.canonicalRoot, "pyproject.toml"), "utf8");
        pytest = /^\[tool\.pytest(?:\.ini_options)?\]/m.test(content);
        if (pytest)
            testCommands.push("python -m pytest -q");
    }
    const checks = [
        ...(nodeTests && testCommands.length ? [{ id: "node-tests", type: "test",
                runner: "node", command: packageManagers.has("pnpm") ? "pnpm" :
                    packageManagers.has("yarn") ? "yarn" : packageManagers.has("bun") ? "bun" : "npm",
                args: ["run", "test"] }] : []),
        ...(pytest ? [{ id: "pytest", type: "test", runner: "pytest",
                command: "python", args: ["-m", "pytest", "-q"] }] : []),
    ];
    return {
        binding,
        revision: createHash("sha256").update(JSON.stringify([binding.repository, binding.commit, revisions])).digest("hex"),
        languages: [...languages], packageManagers: [...packageManagers],
        buildCommands, testCommands, manifests,
        ...(checks.length ? { verificationProfile: { version: 1, checks,
                independentReview: true } } : {}),
    };
}
