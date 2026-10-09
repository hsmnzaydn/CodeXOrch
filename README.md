# Applixus Codex Toolkit

A Codex plugin collection with skills, hooks, MCP servers, and a runtime for
orchestrating coding agents with scoped capabilities, verification, and handoff.
Includes the core `applixus` plugin and reusable `applixus-flutter` expertise.
Requires Node.js >=22.13 and Codex with plugin support. Agent orchestration
workflows require Orca; optional MCP tools require their respective executables.

## Install

Clone this repository, then register it as a Codex plugin marketplace using
`.agents/plugins/marketplace.json`. Install `applixus` and, for Flutter work,
`applixus-flutter` from the `applixus-greenfield` marketplace.

## Configuration

No credentials or private service registrations are bundled. Export environment
variables before launching Codex; use only endpoints and credentials you own
or are authorized to access.

| Variable | Purpose |
| --- | --- |
| `APPLIXUS_ROUTER_URL` | Approved router API base URL; no bundled default. |
| `JEV_API_URL` | Full endpoint for the optional semantic adapter; no bundled default. |
| `JEV_API_KEY` | Optional semantic adapter credential, replacing the bundled key. |
| `APPLIXUS_9ROUTER_API_KEY` | Existing router credential override. |
| `FIGMA_API_KEY` | Credential inherited by the optional Figma context MCP server. |
| `GPT_PRO_TASK_MCP_ENDPOINT` | Full endpoint for the optional GPT Pro relay; no bundled default. |
| `GPT_PRO_TASK_MCP_TOKEN` | Optional GPT Pro relay credential. |

The router URL, semantic adapter URL/key, and relay endpoint now use environment
reads instead of private defaults. Figma inherits its key instead of receiving
a packaged value. Missing optional adapter configuration does not grant access.

Account-specific Memos, gbrain, and GPT Pro MCP registrations are excluded.
To enable these integrations, register your own MCP server in your local Codex
configuration, using an endpoint you control and environment-based credentials.
Generic runtime adapters and relay code remain available. Memos deployments
typically supply `MEMOS_BASE_URL` and `MEMOS_API_KEY`; remote gbrain deployments
should use their own URL and an environment-backed authorization header.
The Flutter product-specific project skill and catalog entry are excluded.

## License

MIT. See [LICENSE](LICENSE).
