# Graph setup

Use only for an explicit request to initialize or refresh a graph. Verify repository and project scope, inspect the available graph capability, preserve existing registry and ignores, then check actual graph/report output. Graph creation is not a prerequisite for ordinary bounded source reads. If the integration is unavailable, report that state without installing an unrequested provider.

Provenance: `pre-release-2.108.13:commands/graphify-setup.md` and `references/graphify-setup.md` (MIT). Legacy setup commands are not carried forward.

## Native discovery and explicit maintenance

Fresh SessionStart reports a short existing-graph status note and preserves local `.codexorch/` and `graphify-out/` excludes. It never installs the CLI, synchronizes skills, or schedules graph refreshes. A missing CLI or graph leaves ordinary scoped Read/Grep/Glob available.

For an explicit setup request, use the available normal dependency installer and Graphify's native `install --platform <host>`, `update .`, or `watch` commands. Verify the resulting graph with a native query. Use Orca automation only when recurring maintenance was requested; do not invent a startup scheduler.
