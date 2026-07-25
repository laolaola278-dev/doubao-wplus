## Task Breakdown

### Confirmed Task Definition

Build Codex-style automations for doubao-wplus.

Users can create an automation with a prompt, click to execute it immediately in a new DeepSeek chat session, and attach a cron/RRULE-like frequency so later runs continue in that automation's DeepSeek session. Scheduling and task state live in the extension background. Actual DeepSeek execution runs from the DeepSeek page main-world context so it can reuse the logged-in web session and DeepSeek's current challenge/proof-of-work flow.

### Overview

| Item | Value |
|:--|:--|
| Total phases | 5 |
| Total tasks | 16 |
| Estimated total effort | XL |
| Tracking mode | GITHUB_STANDARD |
| Primary implementation path | Background scheduler + content/main-world runner + side panel automation UI |

### S.U.P.E.R Design Constraints

- **S (Single Purpose)**: Automation storage, scheduling, tab orchestration, DeepSeek execution, and UI must be separate modules.
- **U (Unidirectional Flow)**: Side panel and alarms request work from background; background dispatches to content; content forwards to main-world runner; runner returns result.
- **P (Ports over Implementation)**: Automation objects, run records, bridge messages, and runner results must have explicit TypeScript contracts.
- **E (Environment-Agnostic)**: DeepSeek URL, minimum interval, history limits, and failure policies should be constants/config, not scattered magic values.
- **R (Replaceable Parts)**: Schedule parser, storage backend, and runner implementation should be replaceable without changing UI components.

### Phase 1: Automation Foundation

**Goal**: Establish automation data contracts, persistence, and schedule calculation before wiring execution.

**Prerequisite**: Phase 1 analysis complete.

**S.U.P.E.R Focus**: S, P, E.

| ID | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|
| T1.1 | Define automation domain contracts | P0 | M | None | A | S, P | `Automation`, `AutomationRun`, `AutomationStatus`, runner request/result, and message action types exist; fields include prompt, status, schedule, DeepSeek session id, parent message id, timestamps, and error state |
| T1.2 | Implement automation persistence store | P0 | M | T1.1 | A | S, P, R | CRUD APIs exist; run history append/update APIs exist; storage shape is migration-friendly; no UI logic in store |
| T1.3 | Implement schedule parser and next-run calculator | P0 | M | T1.1 | B | S, E, R | Supports RRULE-style minute/hour/day basics used by Codex examples; rejects too-frequent schedules; returns next run from a reference timestamp; unit-like pure functions are compile-safe |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| A | T1.1, T1.2 | M+M | Medium | `core/types.ts`, `core/automation/store.ts` |
| B | T1.3 | M | Low | `core/automation/schedule.ts` |

### Phase 2: Scheduler and Execution Bridge

**Goal**: Let background alarms dispatch due automation runs to a DeepSeek page and receive structured results.

**Prerequisite**: Phase 1 complete.

**S.U.P.E.R Focus**: U, P, R.

| ID | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|
| T2.1 | Add background scheduler and run locking | P0 | L | T1.2, T1.3 | A | U, E | Manifest includes `alarms`; background registers a wake alarm; due scanner handles ACTIVE tasks, missed runs, and one-run-at-a-time locks |
| T2.2 | Add content/main-world automation bridge protocol | P0 | L | T1.1 | B | U, P | Background can request an automation run from a DeepSeek tab; content forwards to main world; result/error returns through typed messages |
| T2.3 | Implement DeepSeek main-world session runner | P0 | XL | T2.2 | B | S, P, R | Runner can create a new automation session and continue an existing session through `/api/v0/chat/completion`; result includes session id, latest parent message id, assistant text, and completion status |
| T2.4 | Reconcile completion result with `history_messages` | P1 | L | T2.3 | C | P, R | After each run, latest message chain can be verified from `/api/v0/chat/history_messages`; stale or missing parent ids are detected and recorded |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| A | T2.1 | L | Medium | `entrypoints/background.ts`, `wxt.config.ts`, `core/automation/*` |
| B | T2.2, T2.3 | L+XL | High | `entrypoints/content.ts`, `entrypoints/main-world.content.ts`, `core/automation/runner.ts` |
| C | T2.4 | L | Medium | `core/automation/deepseek-history.ts`, runner result handling |

### Phase 3: Side Panel Automation UI

**Goal**: Give users a compact interface to create, run, schedule, pause, resume, and inspect automations.

**Prerequisite**: Phase 1 complete; Phase 2 bridge can be mocked if needed.

**S.U.P.E.R Focus**: S, U, P.

| ID | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|
| T3.1 | Add Automation tab and list page | P0 | M | T1.2 | A | S, U | Side panel has an Automation tab; list shows name, status, next run, last run, and session link |
| T3.2 | Add automation editor form | P0 | L | T3.1, T1.3 | A | P, E | Users can edit name, prompt, schedule, enabled state, and minimum interval validation errors |
| T3.3 | Add run controls and run history UI | P0 | L | T2.1, T2.2, T3.1 | B | U, P | Users can click Run Now, pause/resume, see in-progress state, recent results, error messages, and DeepSeek session URL |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| A | T3.1, T3.2 | M+L | Medium | `entrypoints/sidepanel/App.tsx`, automation page/components |
| B | T3.3 | L | Medium | automation page/components, background messages |

### Phase 4: Reliability, Safety, and Compatibility

**Goal**: Make automation behavior predictable under browser sleep, login failure, DeepSeek tab absence, and existing prompt augmentation.

**Prerequisite**: Phases 1-3 complete.

**S.U.P.E.R Focus**: E, R.

| ID | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|
| T4.1 | Implement DeepSeek tab orchestration and availability checks | P0 | L | T2.1, T2.2 | A | U, E | Background finds or opens `chat.deepseek.com`; detects unavailable runner/login/input state; records actionable failure |
| T4.2 | Add retry, timeout, missed-run, and rate-limit policy | P0 | M | T2.1, T2.3 | B | E, R | Runs have timeout; minimum interval enforced; missed runs are either coalesced or skipped by explicit policy; failures do not loop indefinitely |
| T4.3 | Define compatibility with memory/skill/preset injection | P1 | M | T2.3 | C | P, R | Automation requests either intentionally use existing injection or carry an explicit bypass/tag; behavior is documented and tested |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| A | T4.1 | L | Medium | background tab orchestration, bridge |
| B | T4.2 | M | Medium | scheduler, store, runner |
| C | T4.3 | M | High | `fetch-hook.ts`, runner integration |

### Phase 5: Verification and Documentation

**Goal**: Prove the feature works locally and document known browser/DeepSeek constraints.

**Prerequisite**: Phases 1-4 complete.

**S.U.P.E.R Focus**: P, E.

| ID | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|
| T5.1 | Add focused compile-time and pure-function checks | P0 | M | T1.3, T2.1 | A | P | `npm run compile` passes; schedule parser has deterministic test cases or equivalent checked examples |
| T5.2 | Run live DeepSeek automation verification | P0 | M | T2.3, T3.3, T4.1 | B | E | Manual/live checklist validates Run Now creates a session, scheduled run continues it, reload restores history |
| T5.3 | Update README and operator notes | P1 | S | T5.2 | C | P, E | Docs describe capabilities, limitations, browser sleep behavior, login requirement, and schedule syntax |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| A | T5.1 | M | Low | schedule tests/checks |
| B | T5.2 | M | Low | verification notes |
| C | T5.3 | S | Low | `README.md`, docs |
