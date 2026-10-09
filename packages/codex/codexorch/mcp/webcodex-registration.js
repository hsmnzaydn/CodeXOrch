'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const runnerConfig = require('./webcodex-runner-config.js');

const MAX_OUTPUT = 64 * 1024;
const MAX_CHECKOUT_CONFIG_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT = 10000;
const DEFAULT_LOCK_TIMEOUT = 3000;
const STALE_LOCK_MS = 60000;
const home = (env = process.env) => String(env.HOME || env.USERPROFILE || os.homedir());
const canonical = (value) => { try { return fs.realpathSync.native(path.resolve(value)); } catch { return null; } };
const file = (value) => { try { return fs.statSync(value).isFile(); } catch { return false; } };
const executable = (value) => file(value) && (process.platform === 'win32' || (() => { try { fs.accessSync(value, fs.constants.X_OK); return true; } catch { return false; } })());
function readCheckoutFile(filePath) {
  let descriptor;
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (error) {
    return { status: error && error.code === 'ENOENT' ? 'missing' : 'unreadable' };
  }
  if (!stat.isFile() || stat.size > MAX_CHECKOUT_CONFIG_BYTES) return { status: 'unreadable' };
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0));
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.size > MAX_CHECKOUT_CONFIG_BYTES) return { status: 'unreadable' };
    const buffer = Buffer.alloc(MAX_CHECKOUT_CONFIG_BYTES + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const count = fs.readSync(descriptor, buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (count === 0) break;
      bytesRead += count;
    }
    if (bytesRead > MAX_CHECKOUT_CONFIG_BYTES) return { status: 'unreadable' };
    return { status: 'read', text: buffer.toString('utf8', 0, bytesRead) };
  } catch {
    return { status: 'unreadable' };
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch {}
    }
  }
}
function spawnCli(cliPath, args, options = {}, spawnImpl = spawnSync, platform = process.platform) {
  return platform === 'win32' && path.extname(cliPath).toLowerCase() === '.js'
    ? spawnImpl(process.execPath, [cliPath, ...args], options)
    : spawnImpl(cliPath, args, options);
}

function resolveProjectRoot(cwd = process.cwd()) {
  const start = canonical(cwd);
  if (!start) return null;
  const result = spawnSync('git', ['-C', start, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 2000, stdio: 'pipe' });
  if (!result || result.status !== 0) return null;
  return canonical(String(result.stdout || '').trim());
}

function findOnPath(name, env) {
  for (const dir of String(env.PATH || '').split(path.delimiter)) {
    const candidate = path.join(dir, name);
    if (executable(candidate)) return canonical(candidate);
  }
  return null;
}
function runnerConfigs(env) {
  if (env.WEBCODEX_RUNNER_CONFIG) return [path.resolve(env.WEBCODEX_RUNNER_CONFIG)].filter(file);
  const root = path.join(home(env), '.config', 'webcodex');
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 4 || found.length > 20) return;
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === 'runner.toml') found.push(full);
      else if (entry.isDirectory()) walk(full, depth + 1);
    }
  };
  walk(root, 0); return found;
}
function tomlLine(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote === '"' && ch === '\\') { i++; continue; }
    if (quote) { if (ch === quote) quote = null; }
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '#') return line.slice(0, i).trim();
  }
  return line.trim();
}
function tomlString(value) {
  if (typeof value !== 'string') return null;
  if (/^'[^'\r\n]*'$/.test(value)) return value.slice(1, -1);
  try { const parsed = JSON.parse(value); return typeof parsed === 'string' ? parsed : null; } catch { return null; }
}
function parseTomlConfig(configPath) {
  let text; try { text = fs.readFileSync(configPath, 'utf8'); } catch { return null; }
  const sections = { root: [], policy: [] };
  let section = 'root';
  for (const raw of text.split(/\r?\n/)) {
    const line = tomlLine(raw);
    if (/^\[/.test(line)) { section = line === '[policy]' ? 'policy' : null; continue; }
    if (section) sections[section].push(line);
  }
  const registryLines = sections.root.filter((line) => /^project_registry_dir\s*=/.test(line));
  if (registryLines.length !== 1) return null;
  const registry = tomlString(registryLines[0].slice(registryLines[0].indexOf('=') + 1).trim());
  if (!registry) return null;
  const policy = sections.policy.join('\n');
  const anywhere = sections.policy.filter((line) => /^allow_cwd_anywhere\s*=/.test(line));
  if (anywhere.length > 1 || (anywhere.length && !/^allow_cwd_anywhere\s*=\s*(true|false)$/.test(anywhere[0]))) return null;
  const roots = [];
  const rootFields = sections.policy.filter((line) => /^allowed_roots\s*=/.test(line));
  const block = policy.match(/^allowed_roots\s*=\s*\[([\s\S]*?)\]\s*$/m);
  if (rootFields.length > 1 || (rootFields.length && !block)) return null;
  if (block) {
    const strings = /'[^'\r\n]*'|"(?:[^"\\\r\n]|\\.)*"/g;
    if (block[1].replace(strings, '').replace(/[\s,]/g, '')) return null;
    for (const match of block[1].matchAll(strings)) {
      const root = tomlString(match[0]);
      if (!root || !path.isAbsolute(root)) return null;
      roots.push(root);
    }
  }
  return { projectRegistryDir: path.resolve(path.dirname(configPath), registry), allowedRoots: roots, allowCwdAnywhere: anywhere.length === 1 && /^allow_cwd_anywhere\s*=\s*true$/.test(anywhere[0]) };
}
function discoverCli(env) {
  if (env.WEBCODEX_BIN) return executable(env.WEBCODEX_BIN) ? canonical(env.WEBCODEX_BIN) : null;
  const pathHit = findOnPath('webcodex', env); if (pathHit) return pathHit;
  const candidates = [path.join(home(env), '.local', 'bin', 'webcodex')];
  const root = path.join(home(env), '.local', 'lib', 'webcodex');
  try { for (const version of fs.readdirSync(root).sort().reverse().slice(0, 10)) candidates.push(path.join(root, version, 'webcodex')); } catch {}
  return candidates.map((candidate) => executable(candidate) ? canonical(candidate) : null).find(Boolean) || null;
}
function discoverRegistrationContract({ env = process.env, root = null, runnerConfigFile = null, endpoint = null } = {}) {
  const cliPath = discoverCli(env);
  // Registration is the operation that makes a previously unseen checkout durable.
  // Therefore an uncovered root may still choose a deterministic local runner; the
  // trusted WebCodex CLI owns the policy/registry mutation and opt-out remains local.
  const selected = runnerConfig.selectRunnerConfig({
    env,
    projectRoot: root,
    allowUncovered: true,
    configFile: runnerConfigFile,
    endpoint,
  });
  if (selected.status !== 'ready' || !selected.config) {
    return { status: 'deferred', reason: selected.reason || 'runner config missing', cliPath, configPath: null };
  }
  const configPath = selected.config.file;
  if (!cliPath) return { status: 'deferred', reason: 'WebCodex CLI missing', cliPath: null, configPath };
  if (!selected.config.projectRegistryDir) return { status: 'deferred', reason: 'runner config malformed', cliPath, configPath };
  return {
    status: 'ready',
    cliPath,
    configPath,
    projectRegistryDir: selected.config.projectRegistryDir,
    allowedRoots: selected.config.allowedRoots,
    allowCwdAnywhere: selected.config.allowCwdAnywhere,
    selection: selected.registered ? 'existing-registration'
      : selected.score > 0 ? 'allowed-root'
        : selected.score === 0 ? 'stable-default' : 'stable-uncovered',
  };
}
function projectRegistrationPreference(root, env = process.env) {
  if (String(env.CODEXORCH_WEBCODEX_AUTOREGISTER || '') === '0') return 'opted_out';
  const result = readCheckoutFile(path.join(root, '.claude', 'codexorch.json'));
  if (result.status === 'unreadable') return 'unreadable';
  if (result.status !== 'read') return 'register';
  try {
    const config = JSON.parse(result.text);
    return config && config.webcodex && config.webcodex.autoRegister === false ? 'opted_out' : 'register';
  } catch {
    return 'register';
  }
}
function statePath(root, configPath, env = process.env) {
  const key = crypto.createHash('sha256').update(`${root}\0${configPath}`).digest('hex');
  return path.join(home(env), '.claude', 'codexorch', 'webcodex-registration', `${key}.json`);
}
function allowed(root, contract) {
  return contract.allowCwdAnywhere || contract.allowedRoots.some((candidate) => { const c = canonical(candidate); return c && (root === c || root.startsWith(`${c}${path.sep}`)); });
}
function readState(root, contract, env = process.env) { try { return JSON.parse(fs.readFileSync(statePath(root, contract.configPath, env), 'utf8')); } catch { return null; } }
function safeJson(raw) { try { return JSON.parse(String(raw).trim()); } catch { return null; } }
function samePathValue(left, right, platform = process.platform) {
  if (!left || !right) return false;
  const a = String(left);
  const b = String(right);
  return platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}
function sameCanonicalPath(left, right, platform = process.platform) {
  const a = canonical(left);
  const b = canonical(right);
  if (!a || !b) return false;
  return samePathValue(a, b, platform);
}
function returnedProject(output, root) {
  const project = output && output.project;
  return project && typeof project.id === 'string' && project.id.trim()
    && typeof project.path === 'string' && sameCanonicalPath(project.path, root) ? project : null;
}

function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch {}
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return !!error && error.code === 'EPERM'; }
}

function acquireRegistrationLock(lock, timeoutMs = DEFAULT_LOCK_TIMEOUT) {
  const token = `${process.pid}.${process.hrtime.bigint()}`;
  const ownerFile = path.join(lock, 'owner');
  const started = Date.now();
  while (Date.now() - started <= Math.max(0, timeoutMs)) {
    try {
      fs.mkdirSync(lock, { mode: 0o700 });
      fs.writeFileSync(ownerFile, `${token}\n`, { mode: 0o600, flag: 'wx' });
      return token;
    } catch (error) {
      if (error.code !== 'EEXIST') return null;
      try {
        const stat = fs.lstatSync(lock);
        if (stat.isSymbolicLink() || !stat.isDirectory()) return null;
        let observed = '';
        try { observed = fs.readFileSync(ownerFile, 'utf8').trim(); } catch {}
        const pid = Number.parseInt(observed.split('.', 1)[0], 10);
        const age = Date.now() - stat.mtimeMs;
        const stale = age > STALE_LOCK_MS && (!observed || !pidAlive(pid));
        if (stale) {
          let unchanged = false;
          try { unchanged = fs.readFileSync(ownerFile, 'utf8').trim() === observed; }
          catch { unchanged = !observed; }
          if (unchanged) { fs.rmSync(lock, { recursive: true, force: true }); continue; }
        }
      } catch {}
      if (Date.now() - started >= Math.max(0, timeoutMs)) break;
      sleepSync(40);
    }
  }
  return null;
}

function releaseRegistrationLock(lock, token) {
  try {
    const ownerFile = path.join(lock, 'owner');
    if (fs.readFileSync(ownerFile, 'utf8').trim() === token) fs.rmSync(lock, { recursive: true, force: true });
  } catch {}
}

function writeState(target, state) {
  const tmp = `${target}.${process.pid}.${process.hrtime.bigint()}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(state)}\n`, { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, target);
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

function registerProject({ root, contract, timeoutMs = DEFAULT_TIMEOUT, lockTimeoutMs = DEFAULT_LOCK_TIMEOUT, env = process.env } = {}) {
  if (!root || !contract || contract.status !== 'ready') return { status: 'deferred', reason: contract && contract.reason || 'contract unavailable' };
  const preference = projectRegistrationPreference(root, env);
  if (preference === 'opted_out') return { status: 'opted_out' };
  if (preference === 'unreadable') return { status: 'deferred', reason: 'registration unavailable' };
  const target = statePath(root, contract.configPath, env);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const lock = `${target}.lock`;
  const lockToken = acquireRegistrationLock(lock, Math.min(Math.max(0, lockTimeoutMs), Math.max(0, timeoutMs)));
  if (!lockToken) return { status: 'deferred', reason: 'registration lock unavailable', concurrent: true };
  try {
    const prior = readState(root, contract, env);
    const registration = registryRegistration(root, contract.projectRegistryDir);
    if (prior && prior.projectPath === root && prior.configPath === contract.configPath
      && ['persisted', 'reload_pending'].includes(prior.status)
      && registration) return { ...prior, registryFile: registration.file, runnerAvailability: 'unverified' };
    if (registration) {
      const state = {
        status: 'reload_pending',
        projectId: registration.projectId || (prior && prior.projectId) || null,
        projectPath: root,
        configPath: contract.configPath,
        registryFile: registration.file,
        runnerAvailability: 'unverified',
        recordedAt: new Date().toISOString(),
        recovered: true,
      };
      writeState(target, state);
      return state;
    }
    const result = spawnCli(contract.cliPath, ['project', 'register', '--config', contract.configPath, root, '--json'], { encoding: 'utf8', timeout: timeoutMs, maxBuffer: MAX_OUTPUT, stdio: 'pipe', shell: false, env });
    if (!result || result.error || result.status !== 0 || result.signal) {
      return { status: 'deferred', reason: result && result.error && result.error.code === 'ETIMEDOUT' ? 'timeout' : 'registration command failed' };
    }
    const output = safeJson(result && result.stdout);
    const project = returnedProject(output, root);
    if (!project) return { status: 'deferred', reason: 'invalid or wrong-root response' };
    const state = { status: output.runner_reload_required ? 'reload_pending' : 'persisted', projectId: project.id, projectPath: root, configPath: contract.configPath, runnerAvailability: 'unverified', recordedAt: new Date().toISOString() };
    writeState(target, state);
    return state;
  } catch (error) { return { status: 'deferred', reason: String(error.message || 'registration failed').replace(/[\r\n]/g, ' ').slice(0, 240) }; }
  finally { releaseRegistrationLock(lock, lockToken); }
}
function registryRegistration(root, registryDir) { return runnerConfig.registryRegistration(root, registryDir); }

function persistActivatedRegistration(root, contract, env, prior) {
  const target = statePath(root, contract.configPath, env);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const lock = `${target}.lock`;
  const token = acquireRegistrationLock(lock, DEFAULT_LOCK_TIMEOUT);
  if (!token) return false;
  try {
    const current = readState(root, contract, env) || prior || {};
    writeState(target, {
      ...current,
      status: 'persisted',
      projectPath: root,
      configPath: contract.configPath,
      runnerAvailability: 'reloaded',
      reloadedAt: new Date().toISOString(),
    });
    return true;
  } finally { releaseRegistrationLock(lock, token); }
}

function activateRegistration({ root, contract, result, env = process.env, platform = process.platform, spawnSyncImpl = spawnSync } = {}) {
  if (!result || result.status !== 'reload_pending') return { status: 'not_required', registration: result };
  if (String(env.CODEXORCH_WEBCODEX_AUTORELOAD || '1') === '0') {
    return { status: 'deferred', reason: 'runner autoreload opted out', registration: result };
  }
  const run = (command, args) => spawnSyncImpl(command, args, {
    env,
    encoding: 'utf8',
    timeout: 8000,
    maxBuffer: MAX_OUTPUT,
    windowsHide: true,
  });
  const runCli = (args) => spawnCli(contract.cliPath, args, {
    env,
    encoding: 'utf8',
    timeout: 8000,
    maxBuffer: MAX_OUTPUT,
    windowsHide: true,
  }, spawnSyncImpl, platform);
  let activation;
  if (platform === 'darwin') {
    const home = env.HOME || env.USERPROFILE || os.homedir();
    const plist = path.join(home, 'Library', 'LaunchAgents', 'local.webcodex.runner.pro-codexorch.plist');
    let plistText = '';
    try { plistText = fs.readFileSync(plist, 'utf8'); } catch {}
    if (!plistText || !plistText.includes(contract.configPath)) {
      return { status: 'deferred', reason: 'selected runner config is not installed in LaunchAgent', registration: result };
    }
    const uid = typeof process.getuid === 'function' ? process.getuid() : Number(env.UID || 0);
    const service = `gui/${uid}/local.webcodex.runner.pro-codexorch`;
    const printed = run('launchctl', ['print', service]);
    activation = printed && printed.status === 0
      ? run('launchctl', ['kickstart', '-k', service])
      : run('launchctl', ['bootstrap', `gui/${uid}`, plist]);
  } else {
    const installed = runCli(['runner', 'install', '--scope', 'user', '--config', contract.configPath, '--overwrite']);
    if (!installed || installed.status !== 0) {
      return { status: 'deferred', reason: 'runner service install failed', registration: result };
    }
    activation = runCli(['runner', 'restart', '--scope', 'user']);
  }
  if (!activation || activation.status !== 0) {
    return { status: 'deferred', reason: activation?.error?.code === 'ETIMEDOUT' ? 'runner reload timed out' : 'runner reload failed', registration: result };
  }
  if (!persistActivatedRegistration(root, contract, env, result)) {
    return { status: 'deferred', reason: 'runner reloaded but activation state could not be persisted', registration: result, runnerReloaded: true };
  }
  return {
    status: 'persisted',
    runnerReloaded: true,
    registration: { ...result, status: 'persisted', runnerAvailability: 'reloaded' },
  };
}

function readRegistrationStatus({ root, contract, env = process.env } = {}) {
  if (!root || !contract || contract.status !== 'ready') return { status: 'deferred', reason: contract && contract.reason || 'contract unavailable' };
  const preference = projectRegistrationPreference(root, env);
  if (preference === 'opted_out') return { status: 'opted_out' };
  if (preference === 'unreadable') return { status: 'deferred', reason: 'registration unavailable' };
  const state = readState(root, contract, env);
  const registration = registryRegistration(root, contract.projectRegistryDir);
  if (registration) {
    if (state && state.projectPath === root && state.configPath === contract.configPath
      && ['persisted', 'reload_pending'].includes(state.status)) return { ...state, registryFile: registration.file, runnerAvailability: 'unverified' };
    return { status: 'persisted', projectId: registration.projectId || null, projectPath: root, registryFile: registration.file, runnerAvailability: 'unverified', recovered: true };
  }
  return { status: 'not_registered' };
}
function cli(argv = process.argv.slice(2), env = process.env) {
  const args = [...argv];
  const rootIndex = args.indexOf('--root');
  const rootArg = rootIndex === -1 ? process.cwd() : args[rootIndex + 1];
  const missingRoot = !rootArg || (rootIndex !== -1 && rootArg.startsWith('--'));
  if (rootIndex !== -1) args.splice(rootIndex, missingRoot ? 1 : 2);
  const invalid = missingRoot || args.some((arg) => !['--status', '--json'].includes(arg));
  let result;
  if (invalid) {
    result = { status: 'deferred', reason: 'usage: webcodex-registration.js [--root PATH] [--status] [--json]' };
  } else {
    const root = resolveProjectRoot(rootArg);
    const contract = discoverRegistrationContract({ env, root });
    result = args.includes('--status') ? readRegistrationStatus({ root, contract, env }) : registerProject({ root, contract, env });
  }
  process.stdout.write(argv.includes('--json') ? `${JSON.stringify(result)}\n` : `${result.status}: ${result.reason || ''}\n`);
  return result;
}
if (require.main === module) cli();
module.exports = { resolveProjectRoot, discoverRegistrationContract, samePathValue, sameCanonicalPath, spawnCli, registerProject, activateRegistration, readRegistrationStatus, readCheckoutFile, projectRegistrationPreference, cli };
