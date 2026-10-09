'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const path = require('node:path');
const runnerConfig = require('./webcodex-runner-config.js');
const webcodexRegistration = require('./webcodex-registration.js');
const {
  GPT_PRO_INSTRUCTIONS,
  normalizeRepo,
  relayPublicV1Tools,
  relayAllowedArguments,
} = require('./tool-contract.js');

const VERSION = '2.98.1';
const DEFAULT_ENDPOINT = process.env.GPT_PRO_TASK_MCP_ENDPOINT ?? "";
const MAX_STDIN_BYTES = 4 * 1024 * 1024;
const REGISTRATION_TIMEOUT_MS = 1500;
const REGISTRATION_LOCK_TIMEOUT_MS = 250;
const CONFIG_FILE = path.join(__dirname, 'gpt-pro-client.json');
const USER_CONFIG_DIR = path.join(os.homedir(), '.config', 'codexorch', 'gpt-pro');
const USER_TOKEN_FILE = path.join(USER_CONFIG_DIR, 'owner.token');
const USER_CLIENT_FILE = path.join(USER_CONFIG_DIR, 'client-id');
const DEFAULT_WEBCODEX_CONFIG_ROOT = path.join(os.homedir(), '.config', 'webcodex');
const WEBCODEX_CLIENT_ID_RE = runnerConfig.CLIENT_ID_RE;
const DEFAULT_RETRY_AFTER_MS = 900 * 1000;
const MIN_RETRY_AFTER_MS = 1000;
const MAX_RATE_LIMIT_RETRIES = 5;
const REGISTRATION_RETRY_DELAY_MS = 60000;
const MAX_REGISTRATION_RETRIES = 5;
const monotonicNow = () => performance.now();
const TOOL_NAMES = new Set(['ensure_project', 'submit', 'status', 'result', 'cancel', 'artifact']);
const registrationTerminalByRoot = new Map();
const registrationInFlightByRoot = new Map();
const registrationRetryByRoot = new Map();
let registrationRetryCount = 0;

const TOOLS = relayPublicV1Tools();
const ALLOWED_ARGUMENTS = relayAllowedArguments(TOOLS);

function relayLog(message) {
  const line = `gpt-pro relay: ${String(message).replace(/[\r\n]+/g, ' ').slice(0, 240)}\n`;
  try {
    if (process.env.GPT_PRO_RELAY_STDERR) fs.appendFileSync(process.env.GPT_PRO_RELAY_STDERR, line, { mode: 0o600 });
    else process.stderr.write(line);
  } catch {}
}

function packagedConfig(file = CONFIG_FILE) {
  let descriptor;
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('client config is not a regular file');
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | (process.platform === 'win32' ? 0 : fs.constants.O_NOFOLLOW || 0));
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile()) throw new Error('client config is not a regular file');
    if (typeof process.getuid === 'function') {
      if (opened.uid !== process.getuid()) throw new Error('client config owner is not the current user');
      if ((opened.mode & 0o7077) !== 0) {
        fs.fchmodSync(descriptor, 0o600);
        const repaired = fs.fstatSync(descriptor);
        if (!repaired.isFile() || repaired.uid !== process.getuid() || (repaired.mode & 0o7077) !== 0) {
          throw new Error('client config permissions are not private');
        }
      }
    } else {
      // ponytail: Windows skips ACL audit; add ACL validation when platform support exists.
    }
    const value = JSON.parse(fs.readFileSync(descriptor, 'utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch {
    throw new Error('bundled client configuration is unavailable or unsafe');
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); }
      catch { throw new Error('bundled client configuration is unavailable or unsafe'); }
    }
  }
}

function validToken(value) {
  return runnerConfig.validToken(value);
}

function normalizeEndpoint(value) {
  let parsed;
  try { parsed = value instanceof URL ? new URL(value.toString()) : new URL(String(value || '').trim()); }
  catch { throw new Error('endpoint is invalid'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname.toLowerCase());
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
    throw new Error('endpoint must use HTTPS (loopback HTTP is allowed for local tests)');
  }
  if (parsed.username || parsed.password || parsed.hash) throw new Error('endpoint is invalid');
  return parsed;
}

function tokenFromFile(file, enforcePrivateMode) {
  if (!file) return '';
  let stat;
  try { stat = fs.lstatSync(file); }
  catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('credential file is not a regular file');
  if (enforcePrivateMode && process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    throw new Error('credential file permissions are not private');
  }
  const token = fs.readFileSync(file, 'utf8').trim();
  if (!validToken(token)) throw new Error('credential is invalid');
  return token;
}

function parseTomlString(raw) {
  const value = String(raw || '').trim();
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value); } catch { throw new Error('runner configuration contains an invalid string'); }
  }
  return '';
}

function parseTomlStringArray(raw) {
  const value = String(raw || '').trim();
  if (!value.startsWith('[') || !value.endsWith(']')) return [];
  const rows = [];
  for (const match of value.matchAll(/"(?:\\.|[^"\\])*"|'[^']*'/g)) {
    const parsed = parseTomlString(match[0]);
    if (parsed) rows.push(parsed);
  }
  return rows;
}

function parseRunnerConfig(file) {
  return runnerConfig.parseRunnerConfig(file, { enforcePrivate: true });
}

function findRunnerConfigFiles(root = DEFAULT_WEBCODEX_CONFIG_ROOT) {
  return runnerConfig.findRunnerConfigFiles({ root });
}

function resolveRunnerCredential(endpointUrl, options = {}) {
  const endpoint = endpointUrl instanceof URL ? endpointUrl : new URL(endpointUrl);
  let projectRoot = String(options.projectRoot || '').trim();
  if (projectRoot) {
    try { projectRoot = fs.realpathSync(projectRoot); } catch { projectRoot = path.resolve(projectRoot); }
  }
  const selected = runnerConfig.selectRunnerConfig({
    env: options.env || process.env,
    endpoint,
    projectRoot,
    configFile: options.configFile,
    configRoot: options.root || (options.env || process.env).WEBCODEX_RUNNER_CONFIG_ROOT || DEFAULT_WEBCODEX_CONFIG_ROOT,
    requireCredential: true,
    enforcePrivate: true,
    allowUncovered: true,
  });
  if (selected.status !== 'ready' || !selected.config) return null;
  return { ...selected.config, rootScore: selected.score, registered: selected.registered };
}

function resolveConnection(options = {}) {
  const env = options.env || process.env;
  const optionAuthMode = String(options.authMode || '').trim();
  const envAuthMode = String(env.GPT_PRO_TASK_MCP_AUTH_MODE || '').trim();
  const explicitTokenFile = String(env.GPT_PRO_TASK_MCP_TOKEN_FILE || '').trim();
  const runnerConfigFile = String(options.runnerConfigFile || env.WEBCODEX_RUNNER_CONFIG || '').trim();
  const explicitOverride = Boolean(optionAuthMode || envAuthMode || explicitTokenFile || runnerConfigFile || validToken(env.GPT_PRO_TASK_MCP_TOKEN));
  let bundledConfig;
  let bundledConfigLoaded = false;
  const bundled = () => {
    if (!bundledConfigLoaded) {
      try { bundledConfig = packagedConfig(options.bundledConfigFile || CONFIG_FILE); }
      catch (error) {
        if (!explicitOverride) throw error;
        bundledConfig = {};
      }
      bundledConfigLoaded = true;
    }
    return bundledConfig;
  };
  const endpoint = String(options.endpoint || env.GPT_PRO_TASK_MCP_ENDPOINT || bundled().endpoint || DEFAULT_ENDPOINT).trim();
  const parsed = normalizeEndpoint(endpoint);

  const requestedAuthMode = String(optionAuthMode || envAuthMode || bundled().authMode || 'auto').trim().toLowerCase();
  if (!['auto', 'runner', 'legacy'].includes(requestedAuthMode)) throw new Error('GPT Pro auth mode must be auto, runner or legacy');
  let token = '';
  let runnerClientId = '';
  let authMode = 'legacy-owner';
  let runner = null;
  let projectRoot = String(options.projectRoot || '').trim();
  if (!projectRoot) {
    try { projectRoot = resolveGitContext(options.cwd || process.cwd()).root; } catch {}
  }
  if (requestedAuthMode !== 'legacy') {
    runner = resolveRunnerCredential(parsed, {
      env,
      projectRoot,
      configFile: options.runnerConfigFile || env.WEBCODEX_RUNNER_CONFIG,
      root: options.runnerConfigRoot || env.WEBCODEX_RUNNER_CONFIG_ROOT,
    });
    if (runner) {
      token = runner.token;
      runnerClientId = runner.clientId;
      authMode = 'webcodex-runner';
    }
  }
  if (!token && requestedAuthMode === 'runner') throw new Error('paired WebCodex runner credential is unavailable');
  const explicitFile = String(env.GPT_PRO_TASK_MCP_TOKEN_FILE || '').trim();
  if (!token && explicitFile) token = tokenFromFile(explicitFile, true);
  if (!token && validToken(env.GPT_PRO_TASK_MCP_TOKEN)) token = env.GPT_PRO_TASK_MCP_TOKEN.trim();
  if (!token && validToken(bundled().ownerToken)) token = bundled().ownerToken.trim();
  if (!token) token = tokenFromFile(USER_TOKEN_FILE, true);
  if (!token) throw new Error('credential is unavailable');
  if (runnerClientId && !WEBCODEX_CLIENT_ID_RE.test(runnerClientId)) throw new Error('WebCodex runner client ID is invalid');
  const connection = {
    endpoint: parsed.toString(),
    token,
    runnerClientId: runnerClientId || null,
    authMode,
    runnerConfigFile: runner && runner.file || null,
    projectRoot: projectRoot || null,
  };
  if (runner) {
    Object.defineProperty(connection, 'refresh', {
      enumerable: false,
      value: () => resolveConnection({
        ...options,
        env,
        endpoint: parsed.toString(),
        authMode: 'runner',
        projectRoot,
        runnerConfigFile: runner.file,
      }),
    });
  }
  return connection;
}

function git(cwd, args) {
  return childProcess.execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    timeout: 10000,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

const normalizeGitHubRepo = normalizeRepo;

function resolveGitContext(start = process.cwd()) {
  const candidates = [
    process.env.CODEXORCH_PROJECT_ROOT,
    process.env.CODEX_WORKSPACE,
    process.env.INIT_CWD,
    start,
  ].filter(Boolean);
  let root = '';
  for (const candidate of candidates) {
    try {
      root = git(path.resolve(candidate), ['rev-parse', '--show-toplevel']);
      if (root) break;
    } catch {}
  }
  if (!root) throw new Error('GPT Pro requires a Git checkout');
  let origin;
  try { origin = git(root, ['remote', 'get-url', 'origin']); }
  catch { throw new Error('Git origin is required for GPT Pro project discovery'); }
  const repo = normalizeGitHubRepo(origin);
  let canonicalRoot;
  try { canonicalRoot = fs.realpathSync(root); } catch { canonicalRoot = path.resolve(root); }
  return { root: canonicalRoot, repo, project: repo.split('/').pop() };
}

function ensureClientId() {
  try {
    const existing = fs.readFileSync(USER_CLIENT_FILE, 'utf8').trim();
    if (/^[0-9a-f-]{36}$/i.test(existing)) return existing.toLowerCase();
  } catch {}
  fs.mkdirSync(USER_CONFIG_DIR, { recursive: true, mode: 0o700 });
  const value = crypto.randomUUID();
  const temp = `${USER_CLIENT_FILE}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temp, `${value}\n`, { mode: 0o600, flag: 'wx' });
    try { fs.renameSync(temp, USER_CLIENT_FILE); }
    catch {
      try { fs.unlinkSync(temp); } catch {}
      const raced = fs.readFileSync(USER_CLIENT_FILE, 'utf8').trim();
      if (/^[0-9a-f-]{36}$/i.test(raced)) return raced.toLowerCase();
      throw new Error('client identity is unavailable');
    }
  } finally { try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch {} }
  return value;
}

function buildContext(start, connection = {}) {
  const gitContext = resolveGitContext(start);
  const clientId = connection.runnerClientId || ensureClientId();
  const checkout = crypto.createHash('sha256').update(`${gitContext.repo}\0${gitContext.root}`).digest('hex').slice(0, 32);
  return {
    ...gitContext,
    workflowBinding: {
      principal: connection.runnerClientId ? `webcodex:${clientId}` : `toolkit:${clientId}`,
      checkout,
      transport: 'codexorch-zero-config-v2',
    },
  };
}

function injectContext(name, input, context) {
  const allow = ALLOWED_ARGUMENTS[name];
  if (!allow) throw new Error('tool not found');
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const args = {};
  for (const key of allow) if (source[key] !== undefined) args[key] = source[key];
  args.repo = context.repo;
  args.workflowBinding = context.workflowBinding;
  if ((name === 'ensure_project' || name === 'submit') && args.project === undefined) args.project = context.project;
  return args;
}

function registrationDeferredReason(reason) {
  const value = String(reason || '').slice(0, 240).toLowerCase();
  if (value.includes('timeout')) return 'registration_timeout';
  if (value.includes('lock')) return 'registration_lock_unavailable';
  if (value.includes('cli')) return 'webcodex_cli_unavailable';
  if (value.includes('malformed')) return 'runner_config_invalid';
  if (value.includes('config')) return 'runner_config_unavailable';
  if (value.includes('invalid') || value.includes('wrong-root')) return 'registration_response_invalid';
  if (value.includes('command failed')) return 'registration_failed';
  return 'registration_unavailable';
}

function publicRegistrationResult(status, reason = null) {
  return { status, reason };
}

function preflightWebcodexRegistration(root, api = webcodexRegistration, env = process.env, connection = {}, now = monotonicNow) {
  if (registrationTerminalByRoot.has(root)) return Promise.resolve(registrationTerminalByRoot.get(root));
  const inFlight = registrationInFlightByRoot.get(root);
  if (inFlight) return inFlight;
  const retry = registrationRetryByRoot.get(root);
  if (retry && (now() < retry.retryAt || registrationRetryCount >= MAX_REGISTRATION_RETRIES)) {
    return Promise.resolve(retry.outcome);
  }
  if (retry) registrationRetryCount++;
  let pending;
  pending = Promise.resolve().then(async () => {
    let outcome;
    try {
      const preference = webcodexRegistration.projectRegistrationPreference(root, env);
      if (preference === 'opted_out') {
        outcome = publicRegistrationResult('disabled', 'opted_out');
      } else if (preference === 'unreadable') {
        outcome = publicRegistrationResult('deferred', 'registration_unavailable');
      } else {
        const contract = api.discoverRegistrationContract({
          env,
          root,
          runnerConfigFile: connection.runnerConfigFile,
          endpoint: connection.endpoint,
        });
        if (!contract || contract.status !== 'ready') {
          outcome = publicRegistrationResult('deferred', registrationDeferredReason(contract && contract.reason));
        } else {
          const prior = api.readRegistrationStatus({ root, contract, env });
          if (prior && prior.status === 'opted_out') {
            outcome = publicRegistrationResult('disabled', 'opted_out');
          } else if (prior && ['persisted', 'reload_pending'].includes(prior.status)) {
            outcome = publicRegistrationResult('existing');
          } else {
            const registered = await api.registerProject({
              root,
              contract,
              env,
              timeoutMs: REGISTRATION_TIMEOUT_MS,
              lockTimeoutMs: REGISTRATION_LOCK_TIMEOUT_MS,
            });
            if (registered && registered.status === 'opted_out') {
              outcome = publicRegistrationResult('disabled', 'opted_out');
            } else if (registered && ['persisted', 'reload_pending'].includes(registered.status)) {
              outcome = publicRegistrationResult(registered.recovered ? 'existing' : 'registered');
            } else {
              outcome = publicRegistrationResult('deferred', registrationDeferredReason(registered && registered.reason));
            }
          }
        }
      }
    } catch {
      outcome = publicRegistrationResult('deferred', 'registration_unavailable');
    }
    if (outcome.status === 'deferred') {
      registrationRetryByRoot.set(root, { outcome, retryAt: now() + REGISTRATION_RETRY_DELAY_MS });
    } else {
      registrationTerminalByRoot.set(root, outcome);
      registrationRetryByRoot.delete(root);
    }
    return outcome;
  }).finally(() => {
    if (registrationInFlightByRoot.get(root) === pending) registrationInFlightByRoot.delete(root);
  });
  registrationInFlightByRoot.set(root, pending);
  return pending;
}

function registrationErrorWithOutcome(error, outcome) {
  const source = error && error.data;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return error;
  return { ...error, data: { ...source, webcodexRegistration: outcome } };
}

function addRegistrationToResult(result, outcome) {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return { ...result, webcodexRegistration: outcome };
  }
  return { value: result, webcodexRegistration: outcome };
}

function parseRemoteResponse(text, contentType, requestId) {
  const candidates = [];
  if (/application\/json/i.test(contentType || '')) {
    candidates.push(text.trim());
  } else {
    for (const frame of text.split(/\r?\n\r?\n/)) {
      const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
      if (data && data !== '[DONE]') candidates.push(data);
    }
    if (!candidates.length && text.trim().startsWith('{')) candidates.push(text.trim());
  }
  let fallback = null;
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      fallback = parsed;
      if (String(parsed.id) === String(requestId)) return parsed;
    } catch {}
  }
  if (fallback) return fallback;
  throw new Error('remote MCP returned an unreadable response');
}

function toolErrorText(response) {
  if (response?.error?.message) return String(response.error.message);
  if (response?.result?.isError && Array.isArray(response.result.content)) {
    return response.result.content.map(item => item && item.type === 'text' ? item.text : '').join(' ');
  }
  return '';
}

function projectIdFromToolResult(response) {
  const content = response?.result?.content;
  if (!Array.isArray(content)) return null;
  for (const item of content) {
    if (!item || item.type !== 'text') continue;
    try {
      const value = JSON.parse(item.text);
      if (/^g-p-[a-f0-9]{32}$/.test(value?.projectId || '')) return value.projectId;
    } catch {}
  }
  return null;
}

function positiveNumber(value) {
  const number = typeof value === 'number' ? value : Number(String(value || '').trim());
  return Number.isFinite(number) && number > 0 ? number : null;
}

function retryAfterHeaderMs(value, now = Date.now()) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return positiveNumber(Number(raw) * 1000);
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? positiveNumber(timestamp - now) : null;
}

function retryAfterBodyMs(text) {
  let payload;
  try { payload = JSON.parse(String(text || '')); } catch { return null; }
  const values = [];
  const visit = (value, depth) => {
    if (!value || typeof value !== 'object' || depth > 4) return;
    if (Object.prototype.hasOwnProperty.call(value, 'retryAfterMs')) {
      const hint = positiveNumber(value.retryAfterMs);
      if (hint !== null) values.push(hint);
    }
    if (depth >= 4) return;
    for (const child of Object.values(value)) visit(child, depth + 1);
  };
  visit(payload, 0);
  return values.length ? Math.max(...values) : null;
}

function retryAfterMs(response, text) {
  const hints = [
    retryAfterHeaderMs(response?.headers?.get?.('retry-after')),
    retryAfterBodyMs(text),
  ].filter(value => value !== null);
  return hints.length ? Math.max(MIN_RETRY_AFTER_MS, ...hints) : DEFAULT_RETRY_AFTER_MS;
}

function waitForRetry(ms, sleep = delay => new Promise(resolve => setTimeout(resolve, delay))) {
  let remaining = ms;
  return (async () => {
    while (remaining > 0) {
      const delay = Math.min(remaining, 0x7fffffff);
      await sleep(delay);
      remaining -= delay;
    }
  })();
}

async function withRateLimitRetry(operation, sleep, options = {}) {
  const maxRetries = Number.isInteger(options.maxRetries) && options.maxRetries >= 0
    ? options.maxRetries
    : MAX_RATE_LIMIT_RETRIES;
  for (let retry = 0; retry <= maxRetries; retry++) {
    try { return await operation(); }
    catch (error) {
      if (error?.httpStatus !== 429) throw error;
      if (retry === maxRetries) {
        relayLog(`rate limit retry exhausted after ${maxRetries} retries; task identity retained`);
        const exhausted = new Error(`remote MCP rate limit retry exhausted after ${maxRetries} retries (HTTP 429); task remains queued or outcome unknown; reuse same task identity`);
        exhausted.httpStatus = 429;
        exhausted.rateLimitRetries = maxRetries;
        throw exhausted;
      }
      await waitForRetry(error.retryAfterMs || DEFAULT_RETRY_AFTER_MS, sleep);
    }
  }
  throw new Error('remote MCP rate limit retry failed');
}

function httpStatusError(label, status) {
  const error = new Error(`${label} (HTTP ${status})`);
  error.httpStatus = Number(status);
  return error;
}

function reloadRunnerConnection(connection) {
  if (connection?.authMode !== 'webcodex-runner' || typeof connection.refresh !== 'function') {
    throw new Error('GPT Pro authentication rejected (HTTP 401); pair the WebCodex runner or refresh the legacy owner credential');
  }
  let refreshed;
  try { refreshed = connection.refresh(); }
  catch { throw new Error('GPT Pro runner credential reload failed after HTTP 401; re-pair or restart the WebCodex runner'); }
  if (!refreshed || refreshed.authMode !== 'webcodex-runner'
    || normalizeEndpoint(refreshed.endpoint).toString() !== normalizeEndpoint(connection.endpoint).toString()
    || refreshed.runnerClientId !== connection.runnerClientId) {
    throw new Error('GPT Pro runner identity changed during credential reload; restart the Codex session');
  }
  return refreshed;
}

async function withRunnerCredentialRetry(connection, operation) {
  try {
    return { value: await operation(connection), connection, retried: false };
  } catch (error) {
    if (error?.httpStatus !== 401) throw error;
  }
  const refreshed = reloadRunnerConnection(connection);
  try {
    return { value: await operation(refreshed), connection: refreshed, retried: true };
  } catch (error) {
    if (error?.httpStatus === 401) {
      throw new Error('GPT Pro runner authentication rejected after credential reload (HTTP 401); re-pair or restart the WebCodex runner');
    }
    throw error;
  }
}

function createRemoteCaller(connection, fetchImpl = globalThis.fetch, options = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Node.js 18 or newer is required');
  const endpoint = normalizeEndpoint(connection.endpoint).toString();
  let activeConnection = connection;
  let sequence = 0;
  const sleep = typeof options.sleep === 'function' ? options.sleep : ms => new Promise(resolve => setTimeout(resolve, ms));
  const timeoutMs = Math.max(5000, Math.min(180000, Number(process.env.GPT_PRO_RELAY_TIMEOUT_MS || 120000)));
  const callOnce = async (currentConnection, requestId, name, args) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers = {
      Authorization: `bearer ${currentConnection.token}`,
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
    };
    if (currentConnection.runnerClientId) headers['X-CodeXOrch-WebCodex-Client-Id'] = currentConnection.runnerClientId;
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method: 'tools/call', params: { name, arguments: args } }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new Error(error?.name === 'AbortError' ? 'remote MCP request timed out' : 'remote MCP is unreachable');
    } finally { clearTimeout(timer); }
    const text = await response.text();
    if (!response.ok) {
      const error = httpStatusError('remote MCP request failed', response.status);
      if (error.httpStatus === 429) error.retryAfterMs = retryAfterMs(response, text);
      throw error;
    }
    return parseRemoteResponse(text, response.headers.get('content-type') || '', requestId);
  };
  const call = async (name, args) => {
    const requestId = `relay-${process.pid}-${++sequence}`;
    const outcome = await withRunnerCredentialRetry(activeConnection,
      current => withRateLimitRetry(() => callOnce(current, requestId, name, args), sleep));
    activeConnection = outcome.connection;
    return outcome.value;
  };
  return async (name, args) => {
    let response = await call(name, args);
    if (name === 'submit' && !args.projectId && /projectId required/i.test(toolErrorText(response))) {
      const ensured = await call('ensure_project', { repo: args.repo, workflowBinding: args.workflowBinding, project: args.project });
      const projectId = projectIdFromToolResult(ensured);
      if (!projectId) return response;
      response = await call(name, { ...args, projectId });
    }
    return response;
  };
}

function jsonRpcError(id, message, code = -32000) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function createHandler(options = {}) {
  const connection = options.connection || resolveConnection({ cwd: options.cwd || process.cwd() });
  const remoteCall = options.remoteCall || createRemoteCaller(connection, options.fetchImpl);
  const registrationApi = options.registrationApi || webcodexRegistration;
  const env = options.env || process.env;
  const registrationClock = typeof options.now === 'function' ? options.now : monotonicNow;
  let context;
  const currentContext = () => (context ||= buildContext(options.cwd || process.cwd(), connection));
  return async request => {
    if (!request || typeof request !== 'object' || Array.isArray(request)) return jsonRpcError(null, 'invalid request', -32600);
    const { id, method } = request;
    if (method === 'notifications/initialized' || method === 'notifications/cancelled') return null;
    if (method === 'initialize') {
      return { jsonrpc: '2.0', id, result: {
        protocolVersion: request.params?.protocolVersion || '2025-03-26',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'codexorch-gpt-pro-zero-config', version: VERSION },
        instructions: GPT_PRO_INSTRUCTIONS,
      } };
    }
    if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
    if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
    if (method !== 'tools/call') return jsonRpcError(id, 'method not found', -32601);
    const name = request.params?.name;
    if (!TOOL_NAMES.has(name)) return jsonRpcError(id, 'tool not found', -32602);
    let registrationOutcome = null;
    try {
      const requestContext = currentContext();
      const args = injectContext(name, request.params?.arguments, requestContext);
      if (name === 'ensure_project' || name === 'submit') {
        registrationOutcome = await preflightWebcodexRegistration(requestContext.root, registrationApi, env, connection, registrationClock);
      }
      const remote = await remoteCall(name, args);
      if (remote?.error) {
        return {
          jsonrpc: '2.0',
          id,
          error: registrationOutcome ? registrationErrorWithOutcome(remote.error, registrationOutcome) : remote.error,
        };
      }
      if (!remote || remote.result === undefined) {
        const response = jsonRpcError(id, 'remote MCP returned no result');
        if (registrationOutcome) response.error.data = { webcodexRegistration: registrationOutcome };
        return response;
      }
      return {
        jsonrpc: '2.0',
        id,
        result: registrationOutcome
          ? addRegistrationToResult(remote.result, registrationOutcome)
          : remote.result,
      };
    } catch (error) {
      const response = jsonRpcError(id, String(error?.message || 'GPT Pro relay failed').slice(0, 240));
      if (registrationOutcome) response.error.data = { webcodexRegistration: registrationOutcome };
      return response;
    }
  };
}

async function checkConnection(options = {}) {
  const connection = options.connection || resolveConnection({ cwd: options.cwd || process.cwd(), env: options.env || process.env });
  const endpoint = normalizeEndpoint(connection.endpoint).toString();
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Node.js 18 or newer is required');
  const request = async currentConnection => {
    const headers = {
      Authorization: `bearer ${currentConnection.token}`,
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
    };
    if (currentConnection.runnerClientId) headers['X-CodeXOrch-WebCodex-Client-Id'] = currentConnection.runnerClientId;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: 'relay-check', method: 'initialize', params: {
          protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'codexorch-gpt-pro-check', version: VERSION },
        } }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new Error(error?.name === 'AbortError' ? 'GPT Pro MCP check timed out' : 'GPT Pro MCP is unreachable');
    } finally { clearTimeout(timer); }
    const text = await response.text();
    if (!response.ok) {
      const error = httpStatusError('GPT Pro MCP check failed', response.status);
      if (error.httpStatus === 429) error.retryAfterMs = retryAfterMs(response, text);
      throw error;
    }
    return parseRemoteResponse(text, response.headers.get('content-type') || '', 'relay-check');
  };
  let activeConnection = connection;
  const outcome = await withRunnerCredentialRetry(activeConnection,
    currentConnection => withRateLimitRetry(() => request(currentConnection), options.sleep));
  activeConnection = outcome.connection;
  const parsed = outcome.value;
  if (parsed?.error || !parsed?.result?.serverInfo) throw new Error('GPT Pro MCP initialization failed');
  return { endpoint: new URL(endpoint).origin, authMode: activeConnection.authMode, server: parsed.result.serverInfo.name, credentialReloaded: activeConnection !== connection };
}

function serveStdio(handler) {
  process.stdin.setEncoding('utf8');
  let buffer = '';
  const write = value => { if (value) process.stdout.write(`${JSON.stringify(value)}\n`); };
  const consume = line => {
    if (!line.trim()) return;
    let request;
    try { request = JSON.parse(line); }
    catch { write(jsonRpcError(null, 'parse error', -32700)); return; }
    Promise.resolve(handler(request)).then(write).catch(() => write(jsonRpcError(request?.id, 'relay failure')));
  };
  process.stdin.on('data', chunk => {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > MAX_STDIN_BYTES && !buffer.includes('\n')) {
      relayLog('input exceeded limit');
      process.exit(1);
      return;
    }
    for (;;) {
      const index = buffer.indexOf('\n');
      if (index < 0) break;
      const line = buffer.slice(0, index).replace(/\r$/, '');
      buffer = buffer.slice(index + 1);
      consume(line);
    }
  });
  process.stdin.on('end', () => { if (buffer.trim()) consume(buffer); });
}

function main() {
  if (process.argv.includes('--check')) {
    checkConnection().then(result => {
      process.stdout.write(`GPT Pro MCP ready (${result.authMode})\n`);
    }).catch(error => {
      relayLog(error?.message || 'connection check failed');
      process.exitCode = 1;
    });
    return;
  }
  let handler;
  try { handler = createHandler(); }
  catch (error) { relayLog(error?.message || 'startup failed'); process.exitCode = 1; return; }
  serveStdio(handler);
}

if (require.main === module) main();

module.exports = {
  TOOLS,
  buildContext,
  checkConnection,
  createHandler,
  createRemoteCaller,
  injectContext,
  normalizeEndpoint,
  normalizeGitHubRepo,
  parseRemoteResponse,
  parseRunnerConfig,
  resolveConnection,
  resolveGitContext,
  resolveRunnerCredential,
  serveStdio,
};
