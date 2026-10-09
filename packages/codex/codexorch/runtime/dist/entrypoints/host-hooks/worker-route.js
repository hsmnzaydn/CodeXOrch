export function workerRouteRecipe(cwd, reportRenderer = "render-report.mjs") {
    const checkout = typeof cwd === "string" && cwd ? JSON.stringify(cwd) : "<user-checkout>";
    return `No product writes via Bash
Never disable the guard
Review/inceleme/kontrol readonly
No Orca:BLOCKED;start Orca;no fallback
Update prompt:update Codex;no retry
agent_readiness timeout:worker-show once;no spec:BLOCKED state/no retry
paraphrase symptoms;expected behavior
orca orchestration run-create --objective "<goal>"
orca orchestration worker-start --spec <short brief> --worktree current --agent codex --model codex-sub-model --timeout-ms 120000
hard:codex-sub-high
Worker edits ${checkout};commit unless pack forbids;ONE quick direct check;report;fresh session
No test suite/fix-forward loop
check --wait --types worker_done,escalation,question;reply;--ack id
lost reply:request-show;same --retry-request id
if absent, read result with worker-read and worker-show
worker-release --dispatch id
Silent worker: check inbox/worker-read; never stop for silence
SEPARATE read-only Codex reviewer
review-model
fix worker;review
Task/milestone end: Turkish HTML report;codexorch references/reporting.md;node ${JSON.stringify(reportRenderer)} <json> <html>;give owner HTML path`;
}
