## doubao-wplus Codex-Style Automations - Progress Tracker

> **Task**: Build browser-local Codex-style automations for doubao-wplus with run-now sessions and scheduled continuation in the same automation chat.
> **Started**: 2026-05-21
> **Last Updated**: 2026-05-21
> **Mode**: GITHUB_STANDARD
> **Repo**: zhu1090093659/deepseek-pp

### GitHub Resources

- **All Issues**: `gh issue list -R zhu1090093659/deepseek-pp --label "spec-driven" --state all`
- **Project Board**: Not created because tracking mode is `GITHUB_STANDARD`, not `GITHUB_FULL`.

### References

- [Project Overview](../analysis/project-overview.md)
- [Module Inventory](../analysis/module-inventory.md)
- [Risk Assessment](../analysis/risk-assessment.md)
- [Task Breakdown](../plan/task-breakdown.md)
- [Dependency Graph](../plan/dependency-graph.md)
- [Milestones](../plan/milestones.md)

### Milestones

| Phase | Name | Milestone URL | Open | Closed | Total |
|:--|:--|:--|--:|--:|--:|
| 1 | Automation Foundation | https://github.com/zhu1090093659/deepseek-pp/milestone/1 | 0 | 3 | 3 |
| 2 | Scheduler and Execution Bridge | https://github.com/zhu1090093659/deepseek-pp/milestone/2 | 0 | 4 | 4 |
| 3 | Side Panel Automation UI | https://github.com/zhu1090093659/deepseek-pp/milestone/3 | 0 | 3 | 3 |
| 4 | Reliability and Compatibility | https://github.com/zhu1090093659/deepseek-pp/milestone/4 | 0 | 3 | 3 |
| 5 | Verification and Documentation | https://github.com/zhu1090093659/deepseek-pp/milestone/5 | 0 | 3 | 3 |

### Issue Mapping

| Task ID | Issue | Title | Status |
|:--|:--|:--|:--|
| T1.1 | #1 | Define automation domain contracts | closed |
| T1.2 | #2 | Implement automation persistence store | closed |
| T1.3 | #3 | Implement schedule parser and next-run calculator | closed |
| T2.1 | #4 | Add background scheduler and run locking | closed |
| T2.2 | #5 | Add content/main-world automation bridge protocol | closed |
| T2.3 | #6 | Implement DeepSeek main-world session runner | closed |
| T2.4 | #7 | Reconcile completion result with history_messages | closed |
| T3.1 | #8 | Add Automation tab and list page | closed |
| T3.2 | #9 | Add automation editor form | closed |
| T3.3 | #10 | Add run controls and run history UI | closed |
| T4.1 | #11 | Implement DeepSeek tab orchestration and availability checks | closed |
| T4.2 | #12 | Add retry, timeout, missed-run, and rate-limit policy | closed |
| T4.3 | #13 | Define compatibility with memory/skill/preset injection | closed |
| T5.1 | #14 | Add focused compile-time and pure-function checks | closed |
| T5.2 | #15 | Run live DeepSeek automation verification | closed |
| T5.3 | #16 | Update README and operator notes | closed |

### Quick Status Commands

```bash
# Phase progress
gh api repos/zhu1090093659/deepseek-pp/milestones --jq '.[] | "\(.title): \(.open_issues) open, \(.closed_issues) closed"'

# Open tasks for current phase
gh issue list -R zhu1090093659/deepseek-pp --milestone "Phase 1: Automation Foundation" --state open --json number,title,labels

# All spec-driven issues
gh issue list -R zhu1090093659/deepseek-pp --label "spec-driven" --state all --json number,title,state,milestone
```

### Phase Checklist

- [x] Phase 1: Automation Foundation (3/3 tasks) - https://github.com/zhu1090093659/deepseek-pp/milestone/1
- [x] Phase 2: Scheduler and Execution Bridge (4/4 tasks) - https://github.com/zhu1090093659/deepseek-pp/milestone/2
- [x] Phase 3: Side Panel Automation UI (3/3 tasks) - https://github.com/zhu1090093659/deepseek-pp/milestone/3
- [x] Phase 4: Reliability and Compatibility (3/3 tasks) - https://github.com/zhu1090093659/deepseek-pp/milestone/4
- [x] Phase 5: Verification and Documentation (3/3 tasks) - https://github.com/zhu1090093659/deepseek-pp/milestone/5

### Execution Telemetry

- Per-task execution telemetry should be recorded in the corresponding GitHub Issue comments.
- Drift state lives in GitHub Milestone descriptions under the `adaptive` YAML block.
- Before closing any task, record actual effort, S.U.P.E.R score, and unplanned dependency count.

### Current Status

**Active Phase**: Complete

**Active Task**: None

**Blockers**: None

### Next Steps

1. Keep monitoring DeepSeek web API drift during regular use.
2. If DeepSeek changes auth, PoW, model type, session creation, or message ID shape again, reopen compatibility work under a new issue.

### Session Log

| Date | Session | Summary |
|:--|:--|:--|
| 2026-05-21 | Planning | Verified DeepSeek web session behavior in Chrome, generated analysis and plan docs, created GitHub labels, milestones, and Issues #1-#16. |
| 2026-05-21 | T1.1 | Added automation domain contracts, runner request/result types, bridge message types, and automation background message actions. Closed Issue #1. |
| 2026-05-21 | T1.2 | Added versioned automation persistence store, CRUD APIs, run history APIs, and background message handlers. Closed Issue #2. |
| 2026-05-21 | T1.3 | Added pure cron/RRULE schedule parser, deterministic next-run calculation, timezone validation, and minimum interval enforcement. Closed Issue #3 and completed Phase 1. |
| 2026-05-21 | T2.1 | Added alarms permission, background wake alarm, due scanner, missed-run coalescing, and one-run-at-a-time automation locks. Closed Issue #4. |
| 2026-05-21 | T2.2 | Added typed background-to-content-to-main-world automation bridge with structured result/error propagation. Closed Issue #5. |
| 2026-05-21 | T2.3-T2.4 | Added DeepSeek main-world automation runner for `/api/v0/chat/completion`, PoW challenge handling, SSE message id extraction, and `/api/v0/chat/history_messages` reconciliation. |
| 2026-05-21 | T3.1-T3.3 | Added side panel Automation tab, task editor, cron/RRULE/manual scheduling controls, run-now controls, pause/resume, session link, and recent run status. |
| 2026-05-21 | T4.1-T4.3 | Added DeepSeek tab orchestration, retry/timeout/missed-run policy, PoW worker fallback to local `DeepSeekHashV1` SHA3-256 solving, and documented compatibility with existing memory/skill/preset injection. |
| 2026-05-21 | T5.1/T5.3 | Verified `npm run compile`, `npm run build`, PoW SHA3 smoke check, and cron/RRULE schedule smoke check; updated README operator notes. Browser policy blocked automated extension-manager reload, so live extension run remains pending. |
| 2026-05-21 | T5.2 follow-up | Fixed live `create_pow_challenge` failure by matching DeepSeek's authenticated HTTP client headers: read page `userToken`, send `Authorization: Bearer ...`, `X-App-Version`, and `x-client-*` headers for PoW, completion, and history requests. Verified `npm run compile` + `npm run build`. |
| 2026-05-21 | T5.2 follow-up | Matched DeepSeek's first-run session flow: new automation runs now call `POST /api/v0/chat_session/create` with authenticated client headers, use the returned `chat_session.id` for completion, and keep existing automation sessions on later runs. Verified `npm run compile` + `npm run build`. |
| 2026-05-21 | T5.2 follow-up | Fixed `model_type` deserialization failure by changing the automation default from `chat` to DeepSeek's accepted `default`, mapping legacy saved values to `default` or `expert`, and limiting UI model choices to accepted variants. Verified `npm run compile` + `npm run build`. |
| 2026-05-21 | T5.2 follow-up | Fixed continuation failure where `parent_message_id` was replayed as a string. Automation now stores and sends DeepSeek message IDs as u32 numbers while migrating existing numeric-string storage on read. Verified `npm run compile` + `npm run build`. |
| 2026-05-21 | T5.2 closeout | User confirmed live automation works after reloading the updated extension. Closed Issue #15, completed Phase 5, and closed all spec-driven milestones. |
