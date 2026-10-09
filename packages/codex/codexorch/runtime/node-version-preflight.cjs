const { spawn, spawnSync } = require("node:child_process");
const { accessSync, constants, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync } = require("node:fs");
const { createHash } = require("node:crypto");
const { homedir } = require("node:os");
const { dirname, join } = require("node:path");
const { pathToFileURL } = require("node:url");

function supported(version) {
  const [major, minor] = version.replace(/^v/, "").split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 13);
}

function install(directory, run = spawnSync, platform = process.platform, arch = process.arch) {
  const staging = mkdtempSync(join(directory, ".node-"));
  try {
    const command = (binary, args) => {
      const result = run(binary, args, { timeout: 180_000, stdio: "pipe" });
      if (result.status !== 0 || result.error) throw new Error(`${binary} failed: ${result.error?.message || result.stderr || result.status}`);
    };
    const base = "https://nodejs.org/dist/latest-v24.x";
    const sums = join(staging, "SHASUMS256.txt");
    command("curl", ["--fail", "--silent", "--show-error", "--max-time", "120", "-o", sums, `${base}/SHASUMS256.txt`]);
    const entry = readFileSync(sums, "utf8").split(/\r?\n/).map((line) => line.trim().split(/\s+/))
      .find(([hash, name]) => /^[a-f0-9]{64}$/.test(hash) &&
        new RegExp(`^node-v24\\.\\d+\\.\\d+-${platform}-${arch}\\.tar\\.gz$`).test(name));
    if (!entry) throw new Error(`Node 24 tarball unavailable for ${platform}/${arch}`);
    const [checksum, name] = entry;
    const archive = join(staging, name);
    command("curl", ["--fail", "--silent", "--show-error", "--max-time", "120", "-o", archive, `${base}/${name}`]);
    if (createHash("sha256").update(readFileSync(archive)).digest("hex") !== checksum)
      throw new Error("Node tarball checksum mismatch");
    const extracted = join(staging, "node");
    mkdirSync(extracted);
    command("tar", ["-xzf", archive, "-C", extracted, "--strip-components=1"]);
    const binary = join(extracted, "bin", "node");
    accessSync(binary, constants.X_OK);
    const check = run(binary, ["--version"], { timeout: 5_000, encoding: "utf8", stdio: "pipe" });
    if (check.status !== 0 || !supported(check.stdout || "")) throw new Error("Installed Node version unreadable or unsupported");
    renameSync(extracted, join(directory, "node"));
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function preflight(args, version = process.version, launch = spawn, home = homedir()) {
  const native = join(__dirname, "dist", "entrypoints", "host-hooks", "native.js");
  if (supported(version)) {
    process.env.NODE_NO_WARNINGS = "1";
    process.removeAllListeners("warning");
    process.argv = [process.execPath, native, ...args];
    return import(pathToFileURL(native).href).catch(error => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
  }
  const directory = join(home, ".codexorch", "runtime");
  const binary = join(directory, "node", "bin", "node");
  try {
    accessSync(binary, constants.X_OK);
    const child = launch(binary, [native, ...args], {
      stdio: "inherit", env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    child.on("error", () => { process.exitCode = 0; });
    child.on("exit", (code) => { process.exitCode = code ?? 0; });
    return child;
  } catch { }
  const lock = join(directory, ".node-install");
  try {
    mkdirSync(directory, { recursive: true });
    try {
      if (Date.now() - statSync(lock).mtimeMs >= 600_000) rmSync(lock, { recursive: true, force: true });
    } catch { }
    try {
      mkdirSync(lock);
      const child = launch(process.execPath, [__filename, "--install", args[0]], {
        detached: true, stdio: "ignore", env: { ...process.env, NODE_NO_WARNINGS: "1" },
      });
      child.on("error", () => { rmSync(lock, { recursive: true, force: true }); });
      child.unref();
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    if (args[1] === "session")
      process.stderr.write(`CodeXOrch: installing Node 24 runtime (found ${version})\n`);
  } catch { }
}

module.exports = { supported, install, preflight };
if (require.main === module) {
  if (process.argv[2] === "--runtime") {
    try {
      let binary = process.execPath;
      if (!supported(process.version)) {
        const directory = join(homedir(), ".codexorch", "runtime");
        binary = join(directory, "node", "bin", "node");
        try { accessSync(binary, constants.X_OK); } catch {
          mkdirSync(directory, { recursive: true });
          install(directory);
        }
      }
      process.stdout.write(`${dirname(binary)}\n`);
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  } else if (process.argv[2] === "--install") {
    const directory = join(homedir(), ".codexorch", "runtime");
    Promise.resolve().then(() => install(directory)).catch(async (error) => {
      const { writeBugDraft } = await import(pathToFileURL(join(__dirname, "dist/core/issues/draft.js")).href);
      await writeBugDraft({ host: process.argv[3], event: "node-install", step: "install", error });
      const { startIssueAutofile } = await import(pathToFileURL(join(__dirname, "dist/entrypoints/host-hooks/issue-autofile.js")).href);
      startIssueAutofile();
    }).catch(() => undefined).finally(() => rmSync(join(directory, ".node-install"), { recursive: true, force: true }));
  } else {
    Promise.resolve(preflight(process.argv.slice(2))).catch(() => { process.exitCode = 0; });
  }
}
