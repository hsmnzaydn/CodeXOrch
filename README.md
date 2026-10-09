# CodeXOrch

An open-source plugin suite for [OpenAI Codex](https://developers.openai.com/codex) that turns a single coding session into a supervised, multi-agent workflow: a lead agent plans and delegates, worker agents implement in isolated checkouts, and an independent reviewer verifies the result against explicit acceptance criteria before anything is released.

The toolkit grew out of daily production use across mobile, backend and web codebases, and is published so other maintainers can run Codex-driven development with the same guardrails.

## Why

Autonomous coding agents are fast but easy to misuse: they drift outside the task, leak credentials into logs, claim success without evidence, or duplicate work after a timeout. This toolkit encodes the operating rules that prevent those failures directly into Codex skills and hooks, so they apply on every prompt instead of living in a wiki.

## Features

- **Lead / worker / reviewer roles.** The lead orchestrates and reads; implementation happens in workers; a separate read-only reviewer marks each acceptance criterion as Met, Unmet or Unverified with evidence.
- **Scoped capabilities.** Only the expertise relevant to the current repository is loaded. General expertise (e.g. Flutter) is kept separate from project contracts and role instructions.
- **Lifecycle hooks.** `SessionStart`, `UserPromptSubmit` and `SessionEnd` hooks inject project context, goals and constraints, and checkpoint task state between turns.
- **Secret and PII redaction.** Credentials, tokens and personal data are redacted from prompts, reports and generated issue drafts.
- **Evidence-based verification.** Every change is reported with the command, target and observed result. A release is confirmed with a direct check in a fresh, isolated session.
- **Model routing.** Roles (implementation, review, utility) map to semantic model routes, so the model behind each role can change without editing prompts.
- **MCP integrations.** Optional MCP adapters for long-running research tasks and structured project memory, configured entirely through environment variables.
- **Native-first design.** The toolkit never re-implements what Codex, git or GitHub already provide; it adds guidance and guardrails on top of native commands.

## Repository layout

```
.agents/plugins/marketplace.json     Codex plugin marketplace definition
packages/codex/codexorch/             Core plugin
  .codex-plugin/plugin.json          Plugin manifest
  codex-skills/                      Orchestration, handoff and verification skills
  codex-hooks/hooks.json             Session and prompt lifecycle hooks
  runtime/                           Node.js runtime used by the hooks
  mcp/                               Optional MCP relay and tool contracts
packages/codex/codexorch-flutter/     Flutter expertise plugin
```

## Requirements

- Node.js 22.13 or newer
- Codex CLI with plugin support

## Installation

```bash
git clone https://github.com/hsmnzaydn/CodeXOrch.git
```

Register the cloned directory as a Codex plugin marketplace (it is defined in `.agents/plugins/marketplace.json`), then install:

- `codexorch` – the core orchestration plugin
- `codexorch-flutter` – optional, for Flutter projects

Start a new Codex session. The hooks run automatically.

## Configuration

No credentials, endpoints or account-specific services are bundled. Optional integrations are disabled until you configure them with your own environment variables:

| Variable | Purpose |
| --- | --- |
| `CODEXORCH_ROUTER_URL` | Base URL of your model routing gateway (optional) |
| `CODEXORCH_JEV_BASE_URL`, `JEV_API_KEY` | Optional semantic skill-selection service |
| `GPT_PRO_TASK_MCP_ENDPOINT`, `GPT_PRO_TASK_MCP_TOKEN` | Optional long-running research task relay |
| `FIGMA_API_KEY` | Optional Figma context MCP server |

When a variable is missing, the related integration is skipped. Core orchestration, hooks and skills work without any of them.

## Security

- Never commit credentials. All secrets are read from the environment.
- Report vulnerabilities privately through GitHub Security Advisories on this repository instead of a public issue.

## Contributing

Issues and pull requests are welcome. Please describe the observed behavior and the expected behavior, and keep changes small and focused.

## License

[MIT](LICENSE)
