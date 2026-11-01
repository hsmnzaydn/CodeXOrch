# Applixus Codex Toolkit

A Codex plugin collection with skills, hooks, MCP relay helpers and a prebuilt
runtime for scoped capabilities, coding-agent coordination, verification and handoff.
Includes `applixus` (core coordination and repository guidance) and
`applixus-flutter` (generic Flutter expertise). No client-specific product packs,
Claude plugin packages, credentials or source Git history are included.

## Install

Requires Node.js **22.13 or newer**, Codex with plugin support, and Git.
Orca is optional for reading the skills but required for the documented supervised
worker workflow; install and configure Orca independently.

Add `hsmnzaydn/applixus-codex-toolkit` as a marketplace in Codex plugin management,
then install `applixus` and optionally `applixus-flutter`. The marketplace is
`.agents/plugins/marketplace.json`; manifests are
`packages/codex/applixus/.codex-plugin/plugin.json` and
`packages/codex/applixus-flutter/.codex-plugin/plugin.json`.
The marketplace sources resolve to `packages/codex/<plugin>`.

Use Codex plugin reload after updates. Automatic toolkit updates are disabled;
update your marketplace checkout manually. Runtime dependencies are Node built-ins;
no root package installation is required. Prebuilt runtime files are distributed
as-is; upstream build tooling and source-only development infrastructure are excluded.

## Configuration

There are no bundled service credentials or private service defaults. Configure
only the optional services you actually use, outside the repository:

- `APPLIXUS_ROUTER_URL`: owner-approved OpenAI-compatible Responses base URL.
- `OPENAI_API_KEY`: credential for that configured model provider.
- `JEV_API_KEY` and `APPLIXUS_JEV_BASE_URL`: optional decision-service credential and HTTPS endpoint.
- `GPT_PRO_TASK_MCP_ENDPOINT` and `GPT_PRO_TASK_MCP_TOKEN`: optional owner-approved GPT Pro task relay endpoint and credential.
- `GPT_PRO_TASK_MCP_TOKEN_FILE` and `GPT_PRO_TASK_MCP_AUTH_MODE`: optional relay credential-file/authentication configuration.
- `WEBCODEX_RUNNER_CONFIG` or `WEBCODEX_RUNNER_CONFIG_ROOT`: optional independently configured runner registration.
- `CODEX_HOME`: Codex configuration directory when using the runtime installer.
- `LLM_API_KEY`, `LLM_API_BASE`, `STRIX_LLM`, `STRIX_API_TYPE`: optional owner-approved Strix scanner configuration.

The model names in `runtime/model-routes.json` are semantic routing aliases, not
public provider model IDs. Map them to models your configured provider supports
before dispatching agents. Missing optional endpoints/credentials leave those
integrations unavailable; this repository does not provision remote services.
MCP helpers are not automatically registered: configure them in your own Codex
settings only after supplying an approved endpoint and credential.

Issue autofiling is disabled by default. Set `APPLIXUS_ISSUE_AUTOFILE=1` and an
explicit `APPLIXUS_ISSUE_REPO=owner/repository` only with the repository owner
approval and authenticated GitHub CLI. Never commit `.env` files or tokens.

## License

MIT, copyright 2026 Serkan Özaydın / Applixus. See [LICENSE](LICENSE).
