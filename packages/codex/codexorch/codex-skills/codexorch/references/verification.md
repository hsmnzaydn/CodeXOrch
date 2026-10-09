# Verification scope

Use the Orca-only worker and separate read-only reviewer route. The worker commits unless the project pack forbids it, confirms changed behavior with ONE quick direct check of the command, app or page it touched and records target, command, exit, observations and gaps. The applicable project pack's git policy wins. Reviewer target: the commit by default; for no-commit projects the recorded base SHA plus the full working-tree change set (tracked diff vs base, staged, and untracked files with contents). No commit is expected there. Review against expected behavior. Give worker and reviewer the same git policy, base SHA and short acceptance list (AC-1, AC-2, ...). Nobody edits the candidate during review. If it finds a problem, start a fix worker and review again. No test suite or fix-forward test loop; no run is never a pass.

Temporary-path fixtures must resolve the host's actual temporary directory; `/private/tmp` aliases `/tmp` on macOS, not Linux. Reproduce path-sensitive CI failures on the workflow's operating system and Node version before changing a guard.

A release is confirmed with one quick direct check in a fresh session. Existing live smoke tooling remains available for optional diagnosis, not a required release step.

Provenance: `pre-release-2.108.13:skills/test-efficiency/SKILL.md` and `skills/test-efficiency/references/research.md` (MIT). Historical test-wave recipes are retired.
