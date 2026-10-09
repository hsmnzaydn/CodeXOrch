'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const CLIENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const validToken = value => typeof value === 'string' && value.trim().length >= 16 && !/\s/.test(value.trim());
const canonical = value => {
  if (!value) return null;
  try { return fs.realpathSync.native(path.resolve(value)); }
  catch { try { return path.resolve(value); } catch { return null; } }
};

function stripTomlComment(line) {
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

function parseTomlString(value) {
  const raw = String(value || '').trim();
  if (/^'[^'\r\n]*'$/.test(raw)) return raw.slice(1, -1);
  if (raw.startsWith('"') && raw.endsWith('"')) {
    try { const parsed = JSON.parse(raw); return typeof parsed === 'string' ? parsed : null; }
    catch { return null; }
  }
  return null;
}

function parseTomlArray(value) {
  const raw = String(value || '').trim();
  if (!raw.startsWith('[') || !raw.endsWith(']')) return null;
  const strings = /'[^'\r\n]*'|"(?:[^"\\\r\n]|\\.)*"/g;
  if (raw.slice(1, -1).replace(strings, '').replace(/[\s,]/g, '')) return null;
  const values = [];
  for (const match of raw.matchAll(strings)) {
    const parsed = parseTomlString(match[0]);
    if (parsed === null) return null;
    values.push(parsed);
  }
  return values;
}

function parseRunnerConfig(configPath, options = {}) {
  const resolved = canonical(configPath);
  if (!resolved) return null;
  let stat;
  try { stat = fs.statSync(resolved); } catch { return null; }
  if (!stat.isFile()) return null;
  if (options.enforcePrivate && process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    throw new Error('runner configuration permissions are not private');
  }
  const sections = { root: [], policy: [] };
  let section = 'root';
  for (const raw of fs.readFileSync(resolved, 'utf8').split(/\r?\n/)) {
    const line = stripTomlComment(raw);
    if (!line) continue;
    const heading = /^\[([^\]]+)\]$/.exec(line);
    if (heading) { section = heading[1] === 'policy' ? 'policy' : null; continue; }
    if (section) sections[section].push(line);
  }
  const rootValues = {};
  for (const line of sections.root) {
    const pair = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(line);
    if (!pair) continue;
    const parsed = parseTomlString(pair[2]);
    if (parsed !== null) rootValues[pair[1]] = parsed;
  }
  const policyText = sections.policy.join('\n');
  const anywhere = sections.policy.filter(line => /^allow_cwd_anywhere\s*=/.test(line));
  if (anywhere.length > 1 || (anywhere.length && !/^allow_cwd_anywhere\s*=\s*(true|false)$/.test(anywhere[0]))) return null;
  const allowCwdAnywhere = anywhere.length === 1 && /true$/.test(anywhere[0]);
  const rootFields = sections.policy.filter(line => /^allowed_roots\s*=/.test(line));
  if (rootFields.length > 1) return null;
  let allowedRoots = [];
  if (rootFields.length) {
    const block = policyText.match(/^allowed_roots\s*=\s*(\[[\s\S]*?\])\s*$/m);
    if (!block) return null;
    const parsed = parseTomlArray(block[1]);
    if (!parsed || parsed.some(value => !path.isAbsolute(value))) return null;
    allowedRoots = parsed.map(canonical).filter(Boolean);
  }
  const registryRaw = rootValues.project_registry_dir;
  return {
    file: resolved,
    serverUrl: rootValues.server_url || '',
    token: rootValues.token || '',
    clientId: rootValues.client_id || '',
    owner: rootValues.owner || '',
    projectRegistryDir: registryRaw ? path.resolve(path.dirname(resolved), registryRaw) : null,
    allowedRoots,
    allowCwdAnywhere,
  };
}

function findRunnerConfigFiles(options = {}) {
  const env = options.env || process.env;
  const explicit = String(options.configFile || env.WEBCODEX_RUNNER_CONFIG || '').trim();
  if (explicit) return [path.resolve(explicit)];
  const userHome = String(env.HOME || env.USERPROFILE || os.homedir());
  const root = path.resolve(options.root || env.WEBCODEX_RUNNER_CONFIG_ROOT || path.join(userHome, '.config', 'webcodex'));
  const found = [];
  const archivedSegment = name => /(?:^|[._-])(?:bak|backup|old|disabled|pre|archive)(?:[-_.]|$)/i.test(String(name || ''));
  const walk = (dir, depth) => {
    if (depth > 6 || found.length >= 64) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (archivedSegment(entry.name)) continue;
        walk(full, depth + 1);
      }
      else if (entry.isFile() && entry.name === 'runner.toml') found.push(path.resolve(full));
    }
  };
  walk(root, 0);
  return found.sort();
}

function registryRegistration(projectRoot, registryDir, platform = process.platform) {
  if (!projectRoot || !registryDir) return null;
  const target = canonical(projectRoot);
  let entries;
  try { entries = fs.readdirSync(registryDir).sort(); } catch { return null; }
  for (const name of entries) {
    if (!name.endsWith('.toml')) continue;
    const registryFile = path.join(registryDir, name);
    let text; try { text = fs.readFileSync(registryFile, 'utf8'); } catch { continue; }
    const pathMatch = text.match(/^\s*path\s*=\s*(.+?)\s*$/m);
    const parsedPath = pathMatch ? parseTomlString(stripTomlComment(pathMatch[1])) : null;
    const registered = parsedPath && canonical(parsedPath);
    if (registered && target && (platform === 'win32'
      ? registered.toLowerCase() === target.toLowerCase() : registered === target)) {
      const idMatch = text.match(/^\s*id\s*=\s*(.+?)\s*$/m);
      const parsedId = idMatch ? parseTomlString(stripTomlComment(idMatch[1])) : null;
      return {
        file: registryFile,
        projectPath: projectRoot,
        projectId: parsedId || path.basename(name, '.toml'),
      };
    }
  }
  return null;
}

function coverageScore(projectRoot, config) {
  if (!projectRoot) return 0;
  if (registryRegistration(projectRoot, config.projectRegistryDir)) return 1_000_000_000;
  let score = -1;
  for (const root of config.allowedRoots) {
    if (projectRoot === root || projectRoot.startsWith(`${root}${path.sep}`)) score = Math.max(score, root.length);
  }
  if (score >= 0) return score;
  return config.allowCwdAnywhere ? 0 : -1;
}

function selectRunnerConfig(options = {}) {
  const env = options.env || process.env;
  const explicit = String(options.configFile || env.WEBCODEX_RUNNER_CONFIG || '').trim();
  const projectRoot = canonical(options.projectRoot || options.root);
  let endpointOrigin = null;
  if (options.endpoint) {
    try { endpointOrigin = new URL(options.endpoint instanceof URL ? options.endpoint.toString() : String(options.endpoint)).origin; }
    catch { return { status: 'deferred', reason: 'endpoint invalid', config: null, candidates: [] }; }
  }
  const files = findRunnerConfigFiles({ env, configFile: explicit, root: options.configRoot });
  const candidates = [];
  for (const configPath of files) {
    let config;
    try { config = parseRunnerConfig(configPath, { enforcePrivate: !!options.enforcePrivate }); }
    catch (error) { if (explicit) throw error; else continue; }
    if (!config) continue;
    if (endpointOrigin) {
      let origin; try { origin = new URL(config.serverUrl).origin; } catch { continue; }
      if (origin !== endpointOrigin) continue;
    }
    if (options.requireCredential && (!validToken(config.token) || !CLIENT_ID_RE.test(config.clientId))) continue;
    const score = coverageScore(projectRoot, config);
    if (projectRoot && !explicit && score < 0 && !options.allowUncovered) continue;
    candidates.push({ config, score, registered: score >= 1_000_000_000 });
  }
  candidates.sort((a, b) => b.score - a.score || Buffer.compare(Buffer.from(a.config.file, 'utf8'), Buffer.from(b.config.file, 'utf8')));
  if (!candidates.length) {
    return { status: 'deferred', reason: files.length ? 'no eligible runner config for project root' : 'runner config missing', config: null, candidates: [] };
  }
  return { status: 'ready', config: candidates[0].config, score: candidates[0].score, registered: candidates[0].registered, candidates };
}

module.exports = {
  CLIENT_ID_RE,
  validToken,
  canonical,
  parseRunnerConfig,
  findRunnerConfigFiles,
  registryRegistration,
  coverageScore,
  selectRunnerConfig,
};
