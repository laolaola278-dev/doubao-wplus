---
name: deepseek-automation
description: Use when implementing, resuming, reviewing, or verifying the doubao-wplus Codex-style automation feature in this repository. Covers reading docs/progress/MASTER.md, following GitHub Issues #1-#16, preserving the background scheduler plus DeepSeek main-world runner architecture, recording telemetry, and updating progress for the automation implementation plan.
---

## DeepSeek Automation

Use this project-local skill for the doubao-wplus automation implementation. The feature goal is: create Codex-style automations that can run immediately in a new DeepSeek chat session and then continue in that same automation session on a cron/RRULE-like schedule.

### Start Every Session

1. Read `docs/progress/MASTER.md`.
2. Confirm tracking mode. Current mode is `GITHUB_STANDARD`.
3. Query GitHub before starting work:

```bash
gh issue list -R zhu1090093659/deepseek-pp --label "spec-driven" --state open --json number,title,labels,milestone
```

4. Pick the next open issue in dependency order unless the user names a task.
5. Read the selected Issue body and linked local docs under `docs/analysis/` and `docs/plan/`.
6. Update `docs/progress/MASTER.md` Current Status at session start and end.

### Architecture Rules

- Keep scheduling in background code.
- Keep actual DeepSeek request execution in the DeepSeek page main-world context.
- Use content script only as a narrow bridge between background and main world.
- Do not add automation business logic directly into `fetch-hook.ts` unless the task is explicitly about hook compatibility.
- Prefer new focused files under `core/automation/`.
- Do not rely on background-only `fetch('/api/v0/chat/completion')` for MVP; DeepSeek web completion has challenge/proof-of-work behavior.
- Preserve existing memory, skill, preset, and tool-call behavior unless the Issue explicitly changes it.

### DeepSeek Web Facts

Verified on 2026-05-21:

- Completion endpoint: `/api/v0/chat/completion`.
- History endpoint: `/api/v0/chat/history_messages`.
- Completion request fields include `chat_session_id`, `parent_message_id`, `model_type`, `prompt`, `ref_file_ids`, `thinking_enabled`, `search_enabled`, `action`, and `preempt`.
- New session and same-session continuation work from the web UI.
- Reload restores the automation test session from history.
- Persist the latest valid parent message id after every run and reconcile it against history.

### S.U.P.E.R Principles

#### S - Single Purpose

From Unix philosophy.

- Each module, file, and function solves exactly one problem
- Prefer decomposition; power comes from composition
- One skill does one thing, one worker does one thing, one script does one thing

Litmus test: if you cannot describe a module's responsibility in a single sentence, it needs to be split.

Anti-pattern: a script that fetches data, computes metrics, renders charts, and sends notifications.

Correct approach:

```text
fetch_data.py  -> data retrieval only, outputs JSON
compute.py     -> computation only, reads JSON writes JSON
render.py      -> rendering only, reads JSON generates HTML
notify.py      -> notification only, reads JSON calls webhook
```

#### U - Unidirectional Flow

From Clean Architecture.

- Data always flows in one direction: input -> processing -> output
- Dependencies always point inward: outer layers depend on inner layers, inner layers know nothing about outer layers
- No reverse dependencies, no circular calls

Layered model:

```text
+-------------------------------+
|  Infrastructure (API, DB, UI) |  <- outermost, replaceable at will
+-------------------------------+
|  Adapters (transform, format) |
+-------------------------------+
|  Core business (pure logic)   |  <- innermost, zero external deps
+-------------------------------+
```

Litmus test: can the core logic run unit tests with zero external services? If not, the dependency direction is wrong.

#### P - Ports over Implementation

From Hexagonal Architecture.

- Define interface contracts (data structures, JSON Schema) before writing implementation
- Use intermediate formats (JSON files, standard data structures) to isolate upstream from downstream
- Swapping a data source, a rendering layer, or a notification channel requires zero changes to core logic

Practices:

1. Every module's input and output must be a serializable data structure
2. Module boundaries communicate via JSON files or standard data structures; in-process typed objects are fine, but cross-module interfaces must be serializable
3. Define explicit schemas - not "just read the code to figure out the format"

#### E - Environment-Agnostic

From 12-Factor App.

- Configuration injected via environment variables or config files, never hardcoded
- All dependencies explicitly declared (requirements.txt / package.json), no implicit reliance on global system packages
- Processes are stateless; all persistence delegated to external storage
- Logs go to stdout, not to files
- Same codebase runs on local machine, Cloudflare Workers, VPS, Docker

Configuration precedence:

```text
Environment variables > .env file > config.json > in-code defaults
```

Checklist:

- All API keys and webhook URLs read from environment variables?
- All dependencies explicitly declared in a dependency file?
- No hardcoded file path assumptions?
- Can a different machine run this code with zero modifications?

#### R - Replaceable Parts

The natural consequence and ultimate goal of S + U + P + E.

- Any layer can be replaced without affecting others
- Replacement cost is the core metric of architecture quality
- If replacing one component triggers cascading changes in unrelated modules, the architecture is broken

Replacement matrix:

| Replacing | Impact scope | Correct approach |
|:--|:--|:--|
| Data source API | Adapter layer only | Write new fetcher, output same JSON |
| Frontend renderer | Render layer only | Read same JSON, swap render implementation |
| Notification channel | Notification layer | Swap webhook adapter |
| Deployment platform | Deploy config only | Change wrangler.toml or Dockerfile |
| Programming language | Implementation only | JSON contracts unchanged, rewrite in any language |

### S.U.P.E.R Code Review Checklist

Run this before marking any task done.

1. The touched files each have one clear responsibility.
2. New automation logic is not dumped into `fetch-hook.ts`, `content.ts`, or `background.ts` when a focused module would do.
3. Data flows sidepanel/alarm -> background -> content -> main-world -> result without circular imports.
4. Cross-boundary messages have explicit TypeScript contracts.
5. Persisted objects are serializable and migration-friendly.
6. DeepSeek-specific behavior is isolated behind runner/history helpers.
7. Chrome-specific behavior is isolated behind background/tab orchestration helpers.
8. Errors are structured enough for run history and UI display.
9. The implementation can be tested or type-checked without a live DeepSeek page where possible.
10. `npm run compile` passes, or the blocking reason is recorded.

Scoring rule: all pass = proceed; 1-2 fail = fix first; 3+ fail = stop and refactor.

### Phase Guidance

- Phase 1: implement contracts, store, and schedule calculation first.
- Phase 2: add scheduler and bridge; keep the main-world runner isolated.
- Phase 3: add Automation UI after store contracts are stable.
- Phase 4: add tab/login failure handling, timeouts, retry/missed-run policy, and prompt injection compatibility.
- Phase 5: verify live DeepSeek behavior and document limitations.

### Progress and Telemetry

For every completed Issue:

1. Comment on the GitHub Issue with actual effort, S.U.P.E.R score, unplanned dependency count, files changed, and verification.
2. Update `docs/progress/MASTER.md` Current Status and phase counts if needed.
3. If a drift threshold in the milestone description is reached, stop and replan before continuing.

### Archive Trigger

When all GitHub Issues are closed and all milestones are complete, enter archive mode:

1. Move `docs/analysis/`, `docs/plan/`, and `docs/progress/` into `docs/archives/deepseek-automation/`.
2. Move this skill to `docs/archives/deepseek-automation/skill/SKILL.md`.
3. Update `docs/archives/README.md`.
4. Close milestones if they are still open.
