# Risk Assessment

## Analysis Baseline

Direction: productize OfficeCLI inside doubao-wplus through a built-in `/officecli` skill and controlled local Office document execution via MCP, stdio bridge, or browser Native Messaging.

Current usable foundation:

- Provider-neutral tool contracts: `ToolDescriptor`, `ToolCall`, and `ToolResult`.
- MCP server registry, discovery cache, HTTP/SSE/Streamable HTTP, stdio bridge, and Native Messaging transports.
- Manual chat and automation MCP continuation loops, capped at three rounds.
- Existing operator documentation already states that the extension cannot read arbitrary local files or launch stdio MCP processes directly from the browser sandbox.

Current hard constraint:

- OfficeCLI cannot execute inside the extension sandbox. It must run behind a local MCP server, bridge, or Native Messaging host.

## S.U.P.E.R Architecture Health Summary

| Principle | Status | Key Findings | Transformation Priority |
|:--|:--|:--|:--|
| **S** Single Purpose | Red | Large hotspots remain: `entrypoints/content.ts`, `core/interceptor/fetch-hook.ts`, `entrypoints/sidepanel/pages/McpPage.tsx`, `core/automation/runner.ts`, and `entrypoints/background.ts`. OfficeCLI must not be added inline to these files. | High |
| **U** Unidirectional Flow | Yellow | Main flow is mostly sound: sidepanel/content -> background -> tool runtime/MCP; main-world stays page-context only. Manual chat and automation continuation are parallel paths that can drift. | High |
| **P** Ports over Implementation | Yellow | Tool/MCP contracts exist, but there is no OfficeCLI-specific artifact schema, permission model, or payload validation. Native/bridge envelopes can still carry broad `command`, `args`, `cwd`, and `env`. | High |
| **E** Environment-Agnostic | Red | OfficeCLI is a local binary with version, file lock, filesystem root, and installation assumptions. Native Messaging manifests differ across Chrome, Edge, and Firefox. | High |
| **R** Replaceable Parts | Yellow | MCP transports are replaceable, but UI, permission, history, automation, and host setup are coupled enough that switching OfficeCLI execution strategy would have broad blast radius. | Medium |

**Overall Health**: 0/5 fully healthy, 3/5 partially workable. The transformation is feasible if OfficeCLI is modeled as a constrained local tool provider behind explicit contracts, not as raw command execution.

### S.U.P.E.R Violation Hotspots

| Hotspot | Severity | Why It Matters For OfficeCLI |
|:--|:--|:--|
| `core/mcp/transports/bridge.ts` / `native.ts` | Critical | Existing envelopes can forward command-like fields. A productized OfficeCLI feature needs named operations and host-enforced policy, not model-influenced shell arguments. |
| `entrypoints/sidepanel/pages/McpPage.tsx` | High | Already owns MCP form parsing, validation, permissions, allowlist, health, and history. Office-specific UX should not make this file larger without decomposition. |
| `core/tool/runtime.ts` | High | Dispatch is still memory vs MCP. OfficeCLI should enter as MCP/native first, or a generic provider registry should be introduced. |
| `core/automation/runner.ts` | High | Automations can repeat MCP calls. Office write operations need idempotency and stronger retry classification. |
| `entrypoints/content.ts` | High | Tool rendering should stay generic and artifact-based; Office document previews should not be embedded directly into the bridge file. |
| `core/skill/builtin.ts` | Medium | Adding `/officecli` is easy, but static skill text cannot reflect installed OfficeCLI version, configured roots, or enabled tools. |
| `entrypoints/background.ts` | Medium | New OfficeCLI setup APIs could further enlarge the central switch unless kept narrow. |
| `core/mcp/store.ts` | Medium | Good secret redaction exists, but OfficeCLI needs version/capability/root metadata and cache invalidation beyond transport/auth fingerprints. |

## Risk Matrix

| Risk | Impact | Likelihood | Severity | Mitigation |
|:--|:--|:--|:--|:--|
| Extension claims direct OfficeCLI execution | Feature is impossible or misleading | High | Critical | State clearly that execution requires local MCP server, bridge, or Native Messaging host. |
| Raw command execution escapes control boundary | Arbitrary local command/file access | Medium | Critical | Expose fixed OfficeCLI operations; never pass model payloads as shell strings. |
| Office document writes run automatically | User files can be corrupted or overwritten | Medium | Critical | Default write tools to manual/confirm; allow auto only for read, inspect, issues, and validation. |
| Path traversal or broad filesystem roots | Sensitive file disclosure or modification | High | Critical | Canonical root allowlist, extension filters, and no full-disk default. |
| Prompt injection through document content | Model triggers unsafe follow-up calls | Medium | High | Treat document text as untrusted; separate inspect vs mutate tools; require confirmation for mutation. |
| Native host differs per browser | Works in Chrome but fails Edge/Firefox | High | High | Ship per-browser install docs/scripts and host health checks. |
| OfficeCLI resident/file locks | Flaky edits or false corruption diagnosis | Medium | High | Host owns resident lifecycle, open/close, retry, and clear lock errors. |
| Large document outputs exceed prompt/history budget | Broken continuation or privacy leakage | High | High | Return capped summaries, issue lists, and artifact references; do not store full document bodies in chat history. |
| Discovery cache stale after OfficeCLI upgrade | Wrong schemas/tools injected | Medium | Medium | Include provider version and capability hash in discovery fingerprint. |
| Automation repeats write operations | Duplicate slides/edits across continuation loops | Medium | High | Mutation tools must be idempotent or carry operation IDs. |
| Release artifact incomplete | Extension zip ships without required host | High | High | Release OfficeCLI support as optional companion capability with separate install verification. |

## High-Severity Risks

### Local Execution Boundary

OfficeCLI productization should not expose raw shell execution. The browser extension may request named Office operations, but only a trusted local host or MCP server should decide the actual `officecli` binary path, allowed roots, command arguments, temporary files, and output locations.

### Built-In `/officecli` Skill

The skill should be a usage mode, not the execution authority. It can tell the model to inspect before mutating, prefer structured output, validate after edits, and ask for confirmation for risky writes. Actual capability must come from discovered OfficeCLI tools and host health.

The initial prompt surface should be narrower than the full OfficeCLI help text. A safer product surface is:

- `office_inspect_document`
- `office_view_issues`
- `office_validate_document`
- `office_apply_edit_plan`
- `office_export_preview`

### MCP / Native / Stdio Constraints

Browser-direct HTTP/SSE is suitable for remote or loopback MCP servers after host permission approval. Local stdio OfficeCLI requires either:

- a local HTTP bridge that owns process launch, filesystem roots, and OfficeCLI lifecycle;
- a Native Messaging host with per-browser manifest installation;
- an external MCP server that wraps OfficeCLI.

Native/bridge protocols need capability negotiation, version reporting, structured error codes, and clear health checks.

### Security Boundary

Minimum security model before product launch:

- Read-only tools can be auto-enabled.
- Write/export/delete tools require explicit opt-in or per-call confirmation.
- All paths resolve under user-approved roots.
- WebDAV sync must not sync OfficeCLI local roots, secrets, or raw document contents.
- Tool history stores summaries and artifact references, not full document bodies.
- Host logs and typed errors are visible enough for debugging.

## Technical Debt

- Several entrypoint/UI files remain large and multi-responsibility.
- Runtime messages are TypeScript-typed in places but use broad `unknown` casts at background boundaries.
- `MessageAction` does not appear to cover every runtime message currently handled.
- MCP smoke scripts duplicate normalization/parser concepts instead of importing production modules.
- OfficeCLI-specific version/capability/root state has no schema yet.
- Existing MCP UI is powerful but not an OfficeCLI onboarding experience.

## Compatibility Concerns

- Existing memory and generic MCP tools must keep working.
- Disabled/manual tools must remain excluded from prompt injection.
- Manual and automation continuation limits should remain bounded.
- Native Messaging setup varies by browser and operating system.
- `officecli watch` is long-running and interactive; it may not fit the existing request/response MCP timeout path without special handling.
- OfficeCLI outputs such as HTML previews and extracted text can be large and should be artifact-based.

## Testing Risks

Existing validation is useful but insufficient for OfficeCLI:

- `npm run smoke:mcp` covers mock MCP discovery, descriptor rendering, parsing, and timeout paths.
- `npm run verify:mcp:mock` covers manual and automation MCP continuation with a mock loopback server.
- These do not cover native host installation, bridge process lifecycle, OfficeCLI binary availability, file locks, denied paths, malformed payloads, or real `.docx/.xlsx/.pptx` documents.

Required additions:

- Mock OfficeCLI provider tests for schemas, result normalization, and denied path errors.
- Temp-document smoke tests for create/inspect/issues/validate and one bounded edit flow.
- Automation idempotency test for mutation tools.
- Browser packaging/docs checks for Chrome, Edge, and Firefox native host requirements.
- Manual browser smoke with an authenticated DeepSeek session and a real local OfficeCLI provider.
