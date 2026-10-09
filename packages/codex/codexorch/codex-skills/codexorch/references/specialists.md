# Specialist selection

Use a verified available specialist for deep research, hard diagnosis or narrow expert review when it adds material value; keep ordinary execution native. Bind the exact project, checkout and read/write scope. Read-only advice grants no write authority. Record the actual response and target; queued work is not completion, and self-review is not independent review.

## Binding job routes

| Job / assignment role | Semantic route | Scope |
| --- | --- | --- |
| `sub-lead` | `codex-lead-model` | Existing Codex coordination |
| `producer` | `codex-sub-model` | Normal substantial implementation and test writing when allowed by the project pack; worker commits unless the project pack forbids it |
| `complex`, `high-risk`, `migration`, `integration-owner`, `release-blocker` | `codex-sub-high` | Difficult algorithmic work, complex debugging, migrations, integration risk or release blockers; the brief must briefly identify the concrete difficulty and the invariants to preserve |
| `reviewer` | `review-model` | Independent readonly review; never `codex-auto-review` or nested native `codex review` |
| `tester` | `tester-model` | Readonly interpretation of existing checks; not test writing or the UI/E2E specialist. Reports must rely on supplied evidence and distinguish failed, skipped, not-run and unknown outcomes from passed checks |
| `audit` | `long-context-model` | Explicit whole-repo / large-diff audit with input >220K tokens; smaller audits use `reviewer` |
| Summaries, commit/changelog text, extraction | `utility-model` | Use only an existing model caller; no separate launcher currently exists. Reports must rely on supplied evidence and distinguish failed, skipped, not-run and unknown outcomes from passed checks |
| `security-reviewer` | `security-review-model` | Explicit readonly security advice; no automatic review gate |
| `security-scan` | `strix-model` | On-demand Strix source/diff analysis; follow [security-scan.md](security-scan.md), not an Orca assignment role |

Resolve missing product decisions before implementation. Use `codex-sub-high` when technical uncertainty requires research; keep normal substantial implementation on `codex-sub-model`.

Use only the [Orca worker and reviewer route](orca-usage.md): paraphrase symptoms and state expected behavior, then `orca orchestration worker-start --spec <short brief> --worktree current --agent codex --model codex-sub-model`. For big jobs with independent parts, use [Big job: parallel lanes](orca-usage.md#big-job-parallel-lanes). Use `codex-sub-high` for hard work and `review-model` for the separate read-only Codex reviewer. Worker edits on the current branch, commits unless the project pack forbids it and reports one quick direct check. The applicable project pack's git policy wins. Reviewer target: the commit by default; for no-commit projects the recorded base SHA plus the full working-tree change set (tracked diff vs base, staged, and untracked files with contents). No commit is expected there. Review against expected behavior. Give worker and reviewer the same git policy, base SHA and short acceptance list (AC-1, AC-2, ...). Nobody edits the candidate during review. Use a fix worker and another review if needed. No test suite or fix-forward test loop. Orca owns the lifecycle; unavailable Orca means BLOCKED and asking the user to start Orca, with no fallback. Backend members and baked effort belong to the configured provider, not this toolkit; effort is determined solely by route selection, and request-level effort is not sent.

Provenance: `pre-release-2.108.13:skills/gpt-pro/SKILL.md` and its `references/` (MIT). Old relay paths, physical model pins and credential handling are not portable capability content; the specialist adapter owns live transport.
