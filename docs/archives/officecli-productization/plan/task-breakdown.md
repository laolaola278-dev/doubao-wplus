# Task Breakdown

## Confirmed Task Definition

Productize OfficeCLI in doubao-wplus with a built-in `/officecli` skill and a controlled local execution path. The execution path must use the existing MCP/native/bridge tool platform rather than adding raw shell execution to the skill system or browser extension. Read/inspect tools can be auto-enabled by default; mutation tools must require explicit opt-in through allowlist or configuration.

## Overview

- **Total Phases**: 4
- **Total Tasks**: 13
- **Estimated Total Effort**: XL
- **Tracking Mode**: GITHUB_STANDARD

## S.U.P.E.R Design Constraints

- **S (Single Purpose)**: Keep prompt skill, OfficeCLI capability contracts, local provider execution, sidepanel onboarding, and verification in separate modules/files.
- **U (Unidirectional Flow)**: Preserve existing flow: DeepSeek output -> content bridge -> background runtime -> MCP/native provider -> structured result -> continuation.
- **P (Ports over Implementation)**: Define OfficeCLI tool schemas, artifact references, result summaries, root policy, and error codes before exposing execution.
- **E (Environment-Agnostic)**: No hidden assumption that `officecli` is globally available. Binary path, roots, port, write enablement, timeout, and output caps must be configurable.
- **R (Replaceable Parts)**: OfficeCLI should be replaceable with another local document provider by swapping the MCP/native provider, not by changing prompt/interceptor/runtime internals.

## Phase 1: OfficeCLI Skill And Contracts

**Goal**: Add the prompt affordance and define the constrained OfficeCLI product surface before execution code.

**Prerequisite**: Confirmed scope from Phase 2.

**S.U.P.E.R Focus**: S, P, R.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|
| T1.1 | Add built-in `/officecli` skill | P0 | S | - | A | S, P | Built-in skill appears with existing skills, teaches inspect-before-edit, validation, and tool-use boundaries without claiming direct execution. |
| T1.2 | Define OfficeCLI tool and artifact contracts | P0 | M | - | B | P, R | Contracts cover document path, operation id, root policy, read/write classification, capped text output, artifact references, and structured errors. |
| T1.3 | Define OfficeCLI default capability policy | P0 | S | T1.2 | B | P, E | Read tools are eligible for default auto use; write tools require explicit opt-in; policy is represented as data, not prompt-only text. |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| A | T1.1 | S | Low | `core/skill/builtin.ts` |
| B | T1.2, T1.3 | M | Low | `core/officecli/*`, `scripts/officecli-mcp-server.mjs` |

## Phase 2: Local OfficeCLI MCP Provider

**Goal**: Provide a local MCP-compatible wrapper around `officecli` that exposes named operations instead of raw shell commands.

**Prerequisite**: Phase 1 contracts.

**S.U.P.E.R Focus**: P, E, R.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|
| T2.1 | Implement local Streamable HTTP MCP wrapper | P0 | L | T1.2 | A | P, R | Wrapper handles `initialize`, `tools/list`, and `tools/call` for fixed OfficeCLI tools with no raw command payloads. |
| T2.2 | Add filesystem root and write policy enforcement | P0 | M | T2.1, T1.3 | A | E, P | Canonical paths must stay under configured roots; allowed extensions are `.docx`, `.xlsx`, `.pptx`; write tools fail unless enabled. |
| T2.3 | Add OfficeCLI execution adapter and structured errors | P0 | M | T2.1 | B | S, P | Adapter checks version, builds fixed argv arrays, applies timeouts/output caps, and returns typed errors for missing binary, lock, timeout, denied path, and command failure. |
| T2.4 | Add OfficeCLI provider smoke checks | P1 | M | T2.2, T2.3 | C | P, E | Smoke creates temp Office files where feasible, covers inspect/issues/validate and denied-write/denied-path behavior. |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| A | T2.1, T2.2 | L | Medium | `scripts/officecli-mcp-server.mjs`, `core/officecli/*` |
| B | T2.3 | M | Medium | `scripts/officecli-mcp-server.mjs` |
| C | T2.4 | M | Low | `scripts/officecli-smoke.mjs`, `package.json` |

## Phase 3: doubao-wplus OfficeCLI Onboarding

**Goal**: Make OfficeCLI discoverable and usable through the existing MCP configuration model without adding a parallel execution system.

**Prerequisite**: Phase 2 local provider.

**S.U.P.E.R Focus**: S, U, E.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|
| T3.1 | Add OfficeCLI MCP quick-start preset | P1 | M | T1.3, T2.1 | A | S, E | Sidepanel can create or prefill an OfficeCLI MCP server using the default loopback URL, read-tool allowlist, and safe limits. |
| T3.2 | Keep OfficeCLI execution on existing MCP path | P0 | S | T3.1 | A | U, R | No new raw executor branch is added to prompt/interceptor/content; OfficeCLI tools flow through normal MCP discovery/execution/history. |
| T3.3 | Add provider health and setup feedback | P1 | M | T2.3, T3.1 | B | E, P | UI/docs expose missing binary, denied root, write-disabled, and version/capability errors clearly. |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| A | T3.1, T3.2 | M | Medium | `entrypoints/sidepanel/pages/McpPage.tsx`, `core/mcp/*` |
| B | T3.3 | M | Medium | `entrypoints/sidepanel/pages/McpPage.tsx`, `docs/verification/*` |

## Phase 4: Verification And Documentation

**Goal**: Prove the feature works and document the local security boundary, setup path, and limits.

**Prerequisite**: Phases 1-3 complete.

**S.U.P.E.R Focus**: P, E.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|
| T4.1 | Extend automated validation | P0 | M | T2.4, T3.1 | A | P, E | `npm run compile`, existing MCP checks, and OfficeCLI smoke checks pass or document environment-specific skips. |
| T4.2 | Update README and operator notes | P1 | S | T3.3 | B | E | Docs explain OfficeCLI setup, local host/bridge requirement, root allowlist, read/write policy, and browser limits. |
| T4.3 | Run final diff review and release readiness check | P0 | S | T4.1, T4.2 | A | S, R | Diff review confirms no hidden raw shell path, no duplicated execution system, no broad fallbacks, and no unrelated changes. |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| A | T4.1, T4.3 | M | Low | `package.json`, `scripts/*`, implementation files |
| B | T4.2 | S | Low | `README.md`, `docs/verification/*` |
