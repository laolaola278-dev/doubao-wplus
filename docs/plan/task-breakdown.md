# Task Breakdown

## Confirmed Task Definition

Implement Gemini-Nexus parity browser control in doubao-wplus as a first-class local capability, not a minimal MVP. The target includes controlled tabs and tab groups, `chrome.debugger`/CDP session management, Accessibility Tree UID snapshots, browser action tools, shared tool-loop integration, sidepanel controls, permission and platform governance, and validation.

## Scope Decisions

- **In scope**: Chromium/Edge browser control using `chrome.debugger`, `chrome.tabs`, and `chrome.tabGroups`.
- **In scope**: tool parity for navigation, tab/page management, snapshot, click, hover, fill, fill form, key press, type text, attach file, wait for text, dialog handling, and script evaluation.
- **In scope**: explicit enable/disable/status controls and user-visible detach state.
- **In scope**: integration with manual DeepSeek chat, sidepanel chat, inline agent, and automation through the existing local tool runtime.
- **Out of scope for active control**: Firefox and Android WebView execution. They must show explicit unsupported state and must not expose browser-control descriptors.
- **Tool naming**: use doubao-wplus XML-safe `browser_*` tool names while matching Gemini-Nexus behavior.
- **Fallback policy**: physical CDP input may use explicit JS fallback only when the result reports that fallback path; no silent success.

## Overview

- **Total Phases**: 6
- **Total Tasks**: 18
- **Estimated Total Effort**: XL
- **Tracking Mode**: GITHUB_STANDARD

## S.U.P.E.R Design Constraints

- **S**: Browser-control contracts, CDP connection, snapshot formatting, actions, settings, and UI live in separate modules.
- **U**: Browser actions flow UI/model -> runtime tool -> browser-control service -> Chrome API -> structured result.
- **P**: Cross-module I/O uses typed and serializable contracts.
- **E**: Chromium-only capabilities are capability-gated; unsupported platforms return explicit errors.
- **R**: CDP transport, snapshot formatter, action handlers, and UI should be replaceable independently.

## Testing and Governance Constraints

- Feature work requires automated tests.
- Permission and manifest changes must update `scripts/manifest-policy-check.mjs`, Chrome Web Store docs, and privacy docs.
- New durable browser-control rules go to the resolved native memory surface if execution reveals them.
- Do not create a repo-local memory fallback.

## Phase 1: Contracts, Capabilities, and Permissions

**Goal**: Establish explicit contracts and platform/manifest truth before adding behavior.
**Prerequisite**: Phase 1 analysis complete.
**S.U.P.E.R Focus**: P, E, R.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|:--|:--|
| T1.1 | Add browser-control contracts and settings | P0 | M | â€?| A | S, P, R | Unit tests for settings normalization and action payload helpers | Update memory only if stable gotcha emerges | Types cover controlled tabs, groups, snapshots, action results, settings; defaults are explicit; no Chrome API imports in pure contracts |
| T1.2 | Add platform capability gates for browser control | P0 | S | â€?| B | E, P | Update platform capability tests | None | Capabilities include debugger/tabs/tabGroups/browserControl/accessibilityTree; Firefox/Android are unsupported |
| T1.3 | Update manifest permissions and policy docs | P0 | M | T1.2 | C | E, P | `npm run build:all` then `npm run verify:manifest-policy` | None | Chromium manifests include required permissions; Firefox omits active control; privacy/submission docs justify permissions |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| A | T1.1 | M | Low | `core/browser-control/*` |
| B | T1.2 | S | Low | `core/platform/*`, `tests/platform-capabilities.test.ts` |
| C | T1.3 | M | Medium | `wxt.config.ts`, `scripts/manifest-policy-check.mjs`, docs |

## Phase 2: Background Browser-Control Runtime

**Goal**: Add a background-owned CDP runtime, controlled tab registry, and snapshot engine.
**Prerequisite**: Phase 1.
**S.U.P.E.R Focus**: S, U, P, E, R.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|:--|:--|
| T2.1 | Implement CDP connection adapter | P0 | L | T1.1 | A | S, P, E, R | Mock `chrome.debugger` attach/detach/sendCommand tests | None | Handles attach, detach, event forwarding, dialog state, restricted URL errors, and explicit detach cleanup |
| T2.2 | Implement controlled tab and tab group manager | P0 | L | T1.1, T1.2 | B | S, U, P | Mock `chrome.tabs` and `chrome.tabGroups` tests | None | Supports lock target, active fallback, group create/update/clear, list/select/new/close page scope |
| T2.3 | Implement Accessibility Tree snapshot manager | P0 | L | T2.1 | C | S, P, R | AX fixture formatter tests, stale UID tests, budget tests | Record snapshot budget rule if changed | Produces pruned UID tree, stable backend id mapping, stale UID errors, and budget metadata |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| A | T2.1 | L | Medium | `core/browser-control/connection*` |
| B | T2.2 | L | Medium | `core/browser-control/tabs*` |
| C | T2.3 | L | Medium | `core/browser-control/snapshot*` |

## Phase 3: Browser Action Tools

**Goal**: Implement Gemini-Nexus parity action handlers and local tool descriptors.
**Prerequisite**: Phase 2.
**S.U.P.E.R Focus**: S, U, P, R.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|:--|:--|
| T3.1 | Implement navigation/page tools | P0 | M | T2.2 | A | S, U, P | Unit tests for args and tab manager calls | None | `browser_list_pages`, `browser_select_page`, `browser_new_page`, `browser_close_page`, `browser_navigate_page` work through scoped registry |
| T3.2 | Implement observation tools | P0 | M | T2.1, T2.3 | B | S, P, R | Unit tests for snapshot/wait/dialog/evaluate | None | `browser_take_snapshot`, `browser_wait_for`, `browser_handle_dialog`, `browser_evaluate_script` return structured results |
| T3.3 | Implement input tools | P0 | L | T2.1, T2.3 | C | S, U, P | Unit tests for click/hover/fill/key/type/file | Record fallback rule if changed | `browser_click`, `browser_hover`, `browser_fill`, `browser_fill_form`, `browser_press_key`, `browser_type_text`, `browser_attach_file` support UID resolution and explicit fallback reporting |
| T3.4 | Add browser-control descriptors and runtime dispatch | P0 | M | T3.1, T3.2, T3.3 | D | P, R | Runtime descriptor/execution tests | None | Browser tools appear only when settings and platform support allow, and execute through one provider |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| A | T3.1 | M | Medium | `core/browser-control/actions/navigation*` |
| B | T3.2 | M | Medium | `core/browser-control/actions/observation*` |
| C | T3.3 | L | Medium | `core/browser-control/actions/input*` |
| D | T3.4 | M | High | `core/tool/runtime.ts`, `core/browser-control/tool*` |

## Phase 4: Tool-Loop and Result Integration

**Goal**: Make browser control behave consistently across all agent surfaces without reintroducing large-payload regressions.
**Prerequisite**: Phase 3.
**S.U.P.E.R Focus**: U, P, E.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|:--|:--|
| T4.1 | Integrate manual chat and sidepanel chat observations | P0 | M | T3.4 | A | U, P | Tool-loop tests for browser observation continuation | None | Tool results keep model observations useful but history storage compact |
| T4.2 | Integrate inline agent and automation policy | P0 | M | T3.4 | B | U, E, P | Inline agent and automation tests | None | Browser tools are allowed only when platform/settings support them and use shared provider |
| T4.3 | Add result budget and restore behavior | P0 | M | T4.1 | C | P, E | History/restore tests for snapshot-heavy outputs | Record budget invariant if changed | Large snapshots are truncated/handled predictably and never freeze UI/history |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| A | T4.1 | M | Medium | `entrypoints/background.ts`, `core/tool-loop/*` |
| B | T4.2 | M | Medium | `core/inline-agent/*`, `core/automation/*`, `entrypoints/content.ts` |
| C | T4.3 | M | Low | `core/tool/history.ts`, `core/tool/execution-restore.ts` |

## Phase 5: Sidepanel Browser Control UI

**Goal**: Provide a user-visible management surface for enabling, target selection, status, and detach.
**Prerequisite**: Phase 4.
**S.U.P.E.R Focus**: S, P, E.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|:--|:--|
| T5.1 | Add Browser Control sidepanel page | P0 | L | T4.1 | A | S, P, E | Component tests for status and toggles | None | Page shows enable state, platform support, controlled target, action history, detach button |
| T5.2 | Add background/browser-control message API | P0 | M | T2.2, T5.1 | B | P, U | Message handler tests | None | UI can get/set settings, get state, lock/select target, enable/disable control |
| T5.3 | Add i18n strings and navigation | P0 | S | T5.1 | C | S, E | i18n verification | None | Capabilities nav exposes Browser Control with zh/en strings |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| A | T5.1 | L | Medium | `entrypoints/sidepanel/pages/BrowserControlPage.tsx` |
| B | T5.2 | M | Medium | `entrypoints/background.ts`, `core/types.ts` |
| C | T5.3 | S | Low | `entrypoints/sidepanel/App.tsx`, i18n resources |

## Phase 6: Verification, Documentation, and Release Readiness

**Goal**: Prove the full integration and update public/operator docs.
**Prerequisite**: Phase 5.
**S.U.P.E.R Focus**: E, R.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|:--|:--|
| T6.1 | Add real Chrome smoke fixture and script | P0 | L | T5.2 | A | E, R | Browser smoke script or documented blocker | Record smoke command if stable | Smoke covers snapshot, click/fill, navigate/new/select/close, detach |
| T6.2 | Update docs and Chrome Web Store permission copy | P0 | M | T1.3, T5.1 | B | E, P | Docs leak check and manifest policy | None | README/store/privacy docs describe user-visible capability without internal protocol leakage |
| T6.3 | Run full validation and final diff review | P0 | M | T6.1, T6.2 | C | S, U, P, E, R | `npm run ci:quality` plus smoke best effort | Record durable validation gotchas | Full checks pass or blockers are explicit with next-best evidence |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| A | T6.1 | L | Medium | `scripts/*`, `test-pages/*`, tests |
| B | T6.2 | M | Medium | docs, README |
| C | T6.3 | M | Low | validation only |
