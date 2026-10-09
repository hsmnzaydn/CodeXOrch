'use strict';

const PROJECT_ID_RE = /^g-p-[a-f0-9]{32}$/;
const MAX_PAYLOAD = 128 * 1024;
const OUTPUT_MODES = ['text', 'image'];

const GPT_PRO_INSTRUCTIONS = 'Every GPT Pro prompt must be a fully contextual deep-research brief, never a short one-line request. State the role and tell GPT Pro to take your time, prioritize depth and verified evidence over breadth, and label verified vs inferred; include full product context gathered by the caller beforehand (architecture, components, versions, prior findings), the owner goal and judging criteria, hard constraints and bans that must not be proposed, and numbered concrete questions. Require an explicit output format: ranked summary, evidence with strength, do-not-adopt list, deletion candidates, and sequenced plan. To finish a long coding job, read the result and, if work remains, call submit with continueTaskId and a short "continue with the remaining items: ..." follow-up; repeat until done.';

const TOOL_NAMES = ['ensure_project', 'submit', 'status', 'result', 'cancel', 'artifact'];
const CONTINUE_TASK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;

const TOOL_DESCRIPTIONS = {
  ensure_project: 'Idempotently admit a canonical Git repo and resolve its ChatGPT Project. Existing exact-label Projects are reused; if none exists, one is created and its g-p- ID is persisted for later submit calls.',
  status: 'Current local task state, queue reason and capacity. Follow pollIntervalMs/retryAfterMs; this read does not contact ChatGPT.',
  submit: `Submit one idempotent text or image task. projectId is optional: a missing binding is admitted, resolved or created atomically from any authenticated canonical Git repo before enqueue. Set outputMode=image for ChatGPT Images. Never retry an uncertain submission with a new key. ${GPT_PRO_INSTRUCTIONS}`,
  artifact: 'Fetch a task artifact: images as image content, text files as text, others as resource blob',
};

const TOOL_SCHEMAS = {
  ensure_project: {
    type: 'object',
    properties: {
      repo: { type: 'string', description: 'GitHub owner/repo or bitbucket.org/gitlab.com-prefixed repo; any owner is accepted after caller authentication' },
      workflowBinding: { type: 'object', description: 'Opaque caller binding used for scoped admission.', additionalProperties: true },
      project: { type: 'string', description: 'Exact ChatGPT Project display label. Defaults to the repo basename.' },
      projectId: { type: 'string', pattern: '^g-p-[a-f0-9]{32}$', description: 'Optional known exact Project ID. If supplied it is verified and never silently replaced.' },
    },
    required: ['repo', 'workflowBinding'],
  },
  submit: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: `Prompt text sent to ChatGPT Pro (max 64KiB). ${GPT_PRO_INSTRUCTIONS}` },
      continueTaskId: { type: 'string', pattern: CONTINUE_TASK_ID_RE.source, description: 'Optional finished text task ID from this caller, repo and Project; send this prompt in the same conversation.' },
      repo: { type: 'string', description: 'GitHub owner/repo or bitbucket.org/gitlab.com-prefixed repo; any owner is accepted after caller authentication' },
      idempotencyKey: { type: 'string', description: 'Unique key (<=200 chars); same key returns the prior task' },
      workflowBinding: { type: 'object', description: 'Opaque binding echoed back on status/result/cancel (use {} if none)', additionalProperties: true },
      projectId: { type: 'string', pattern: '^g-p-[a-f0-9]{32}$', description: 'Optional known exact ChatGPT Project ID. When omitted, the canonical Git repo is admitted and its durable exact-label Project binding is resolved or created before enqueue.' },
      project: { type: 'string', description: 'Optional exact display label. Defaults to the canonical repo basename during automatic bootstrap.' },
      outputMode: { type: 'string', enum: ['text', 'image'], default: 'text', description: 'Optional output contract. Use image to request ChatGPT Images and require at least one retrievable generated-image artifact.' },
    },
    required: ['prompt', 'repo', 'idempotencyKey', 'workflowBinding'],
  },
  status: {
    type: 'object',
    properties: {
      taskId: { type: 'string' },
      repo: { type: 'string' },
      workflowBinding: { type: 'object', additionalProperties: true },
    },
    required: ['taskId', 'repo', 'workflowBinding'],
  },
};
TOOL_SCHEMAS.result = TOOL_SCHEMAS.status;
TOOL_SCHEMAS.cancel = TOOL_SCHEMAS.status;
TOOL_SCHEMAS.artifact = {
  type: 'object',
  properties: {
    ...TOOL_SCHEMAS.status.properties,
    name: { type: 'string', description: 'artifact name from result.result.artifacts[].name' },
  },
  required: [...TOOL_SCHEMAS.status.required, 'name'],
};

function toolShapes(z) {
  const shape = {
    ensure_project: { repo: z.string(), workflowBinding: z.record(z.unknown()), project: z.string().optional(), projectId: z.string().regex(PROJECT_ID_RE).optional() },
    submit: { prompt: z.string().describe(TOOL_SCHEMAS.submit.properties.prompt.description), continueTaskId: z.string().regex(CONTINUE_TASK_ID_RE).optional(), repo: z.string(), idempotencyKey: z.string(), workflowBinding: z.record(z.unknown()), projectId: z.string().regex(PROJECT_ID_RE).optional(), project: z.string().optional(), outputMode: z.enum(['text', 'image']).optional() },
    status: { taskId: z.string(), repo: z.string(), workflowBinding: z.record(z.unknown()) },
  };
  shape.result = shape.status;
  shape.cancel = shape.status;
  shape.artifact = { ...shape.status, name: z.string() };
  return shape;
}

const REPO_PART_RE = /^[A-Za-z0-9_.-]+$/;
const GIT_HOSTS = new Set(['github.com', 'bitbucket.org', 'gitlab.com']);
function normalizeRepo(value) {
  if (typeof value !== 'string' || /[\x00-\x1f\x7f?#]/.test(value) || value.includes('..')) throw new Error('repo rejected');
  let raw = value.trim();
  if (!raw || raw.length > 500) throw new Error('repo rejected');
  raw = raw.replace(/\/+$/, '');
  let host = 'github.com';
  let repoPath;
  const scp = raw.match(/^(?:[^@/:\s]+@)?([^/:\s]+):(?!\/\/)([^\s]+)$/);
  if (scp) {
    [, host, repoPath] = scp;
  } else if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(raw)) {
    let parsed;
    try { parsed = new URL(raw); } catch { throw new Error('repo rejected'); }
    host = parsed.hostname;
    if (parsed.search || parsed.hash) throw new Error('repo rejected');
    repoPath = parsed.pathname.replace(/^\//, '');
  } else {
    const parts = raw.split('/');
    if (parts.length > 2) host = parts.shift();
    repoPath = parts.join('/');
  }
  host = host.toLowerCase().replace(/^www\./, '');
  if (!GIT_HOSTS.has(host)) throw new Error('repo rejected');
  const parts = repoPath.split('/');
  if (parts.length < 2 || (host !== 'gitlab.com' && parts.length !== 2)) throw new Error('repo rejected');
  parts[parts.length - 1] = parts[parts.length - 1].replace(/\.git$/i, '');
  if (parts.some(part => !part || part.length > 100 || !REPO_PART_RE.test(part) || part.includes('..'))) throw new Error('repo rejected');
  const canonicalPath = parts.map(part => part.toLowerCase()).join('/');
  return host === 'github.com' ? canonicalPath : `${host}/${canonicalPath}`;
}

function requireProjectId(value) {
  if (typeof value !== 'string' || !PROJECT_ID_RE.test(value)) throw new Error('projectId required');
  return value;
}

function validateToolInput(name, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid payload');
  const schema = TOOL_SCHEMAS[name];
  if (!schema) throw new Error(`unknown tool: ${name}`);
  for (const req of schema.required) {
    if (input[req] === undefined || input[req] === null) throw new Error(`${req} required`);
  }
  if (input.repo !== undefined) normalizeRepo(input.repo);
  if (input.continueTaskId !== undefined && (typeof input.continueTaskId !== 'string' || !CONTINUE_TASK_ID_RE.test(input.continueTaskId))) throw new Error('continueTaskId rejected');
  if (input.projectId !== undefined && input.projectId !== null) requireProjectId(input.projectId);
  if (input.outputMode !== undefined && input.outputMode !== null && !OUTPUT_MODES.includes(input.outputMode)) {
    throw new Error('invalid outputMode');
  }
  return true;
}

const RELAY_INJECTED_FIELDS = new Set(['repo', 'workflowBinding']);

const RELAY_TOOL_DESCRIPTIONS = {
  ensure_project: 'Optionally prewarm or inspect the automatically discovered Git repository to ChatGPT Project binding. Repository identity and workflow binding are injected by the relay.',
  submit: `Submit one idempotent GPT Pro text or image task for the current Git repository. Repo, durable caller binding and missing Project identity are resolved automatically. ${GPT_PRO_INSTRUCTIONS}`,
  status: 'Read current task status for the current Git repository.',
  result: 'Read a terminal task result for the current Git repository.',
  cancel: 'Cancel an owned task for the current Git repository.',
  artifact: 'Fetch a named artifact from a terminal task for the current Git repository.',
};

function relayPropertyProjection(toolName, propName) {
  if (propName === 'continueTaskId') return TOOL_SCHEMAS.submit.properties.continueTaskId;
  if (propName === 'taskId') return { type: 'string', minLength: 1, description: 'Task ID returned by submit.' };
  if (propName === 'name') return { type: 'string', minLength: 1 };
  if (propName === 'prompt') return { type: 'string', minLength: 1, maxLength: 65536, description: TOOL_SCHEMAS.submit.properties.prompt.description };
  if (propName === 'idempotencyKey') return { type: 'string', minLength: 1, maxLength: 200, description: 'Stable unique key. Reuse the same key after an uncertain response.' };
  if (propName === 'project') return {
    type: 'string',
    minLength: 1,
    maxLength: 200,
    description: toolName === 'ensure_project'
      ? 'Optional exact ChatGPT Project label; defaults to the Git repository name.'
      : 'Optional exact Project label; defaults to the Git repository name.',
  };
  if (propName === 'projectId') return {
    type: 'string',
    pattern: PROJECT_ID_RE.source,
    description: toolName === 'ensure_project'
      ? 'Optional already-known exact ChatGPT Project ID.'
      : 'Optional exact Project ID. Normally omit it; the service bootstraps the durable binding.',
  };
  if (propName === 'outputMode') return {
    type: 'string',
    enum: OUTPUT_MODES,
    default: 'text',
  };
  throw new Error(`unknown relay property: ${propName}`);
}

function relayPublicV1Tools() {
  const tools = [];
  for (const name of TOOL_NAMES) {
    const canonical = TOOL_SCHEMAS[name];
    const properties = {};
    const propOrder = name === 'submit'
      ? ['prompt', 'idempotencyKey', 'project', 'projectId', 'outputMode', 'continueTaskId']
      : Object.keys(canonical.properties).filter(p => !RELAY_INJECTED_FIELDS.has(p));
    for (const p of propOrder) {
      properties[p] = relayPropertyProjection(name, p);
    }
    const required = (canonical.required || []).filter(r => !RELAY_INJECTED_FIELDS.has(r));
    const inputSchema = {
      type: 'object',
      properties,
      ...(required.length ? { required } : {}),
      additionalProperties: false,
    };
    tools.push({
      name,
      description: RELAY_TOOL_DESCRIPTIONS[name],
      inputSchema,
    });
  }
  return tools;
}

function relayAllowedArguments(tools = relayPublicV1Tools()) {
  const allowed = {};
  for (const tool of tools) {
    allowed[tool.name] = new Set(Object.keys(tool.inputSchema.properties || {}));
  }
  return Object.freeze(allowed);
}

module.exports = {
  PROJECT_ID_RE,
  MAX_PAYLOAD,
  OUTPUT_MODES,
  GPT_PRO_INSTRUCTIONS,
  TOOL_NAMES,
  TOOL_DESCRIPTIONS,
  TOOL_SCHEMAS,
  RELAY_TOOL_DESCRIPTIONS,
  toolShapes,
  normalizeRepo,
  requireProjectId,
  validateToolInput,
  relayPublicV1Tools,
  relayAllowedArguments,
};
