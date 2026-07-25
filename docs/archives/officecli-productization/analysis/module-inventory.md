# Module Inventory

Preliminary direction: productize OfficeCLI inside doubao-wplus with a built-in `/officecli` skill and a controlled local execution provider through MCP, stdio bridge, or Native Messaging.

Score legend: green = compliant, yellow = partial, red = violation.

| Module | Responsibility | Dependencies | Files | Lines | Complexity | S.U.P.E.R Score |
|:--|:--|:--|--:|--:|:--|:--|
| `core/skill` | Built-in/custom skill registry and `/skill` parsing | `core/constants`, `core/types`, `chrome.storage.local` | 3 | 297 | Medium | S yellow, U green, P yellow, E red, R yellow |
| `core/tool` | Provider-neutral tool contracts, XML invocation catalog, memory tool runtime, history, dispatch | `core/memory`, `core/mcp`, `chrome.storage.local` | 6 | 786 | High | S yellow, U yellow, P green, E yellow, R yellow |
| `core/mcp` | MCP server config, discovery cache, protocol client, transports, policy, execution | `core/tool`, `core/version`, Chrome permissions/native messaging, fetch | 11 | 1911 | High | S yellow, U green, P green, E yellow, R green |
| `core/prompt` | Prompt augmentation and tool schema rendering | `core/memory`, `core/tool`, `core/constants` | 2 | 141 | Medium | S yellow, U green, P yellow, E green, R yellow |
| `core/interceptor` | DeepSeek request/response hook, SSE parsing, tool extraction/stripping, history cleanup | `core/prompt`, `core/skill`, `core/tool`, `core/token`, browser APIs | 3 | 1411 | Critical | S red, U yellow, P yellow, E red, R red |
| `core/automation` | Automation scheduling, DeepSeek runner, PoW handling, MCP continuation loop | `core/prompt`, `core/interceptor`, `core/tool`, DeepSeek APIs, `js-sha3` | 7 | 2162 | Critical | S yellow, U yellow, P yellow, E red, R yellow |
| `core/state-support` | Memory, presets, theme, model, background, WebDAV sync, browser wrapper | Dexie, Chrome storage, fetch | ~13 | ~850 | Medium | S yellow, U green, P yellow, E red, R yellow |
| `entrypoints/background.ts` | Service worker message router, stores, MCP API, tool execution, automation, broadcast hub | Nearly all `core/*`, Chrome runtime/tabs/alarms | 1 | 675 | High | S red, U yellow, P red, E red, R red |
| `entrypoints/content.ts` | Isolated-world bridge, tool result rendering, restore, theme/background patches, manual continuation | `core/tool`, `core/background`, `core/automation/messages`, DOM, Chrome runtime | 1 | 1848 | Critical | S red, U yellow, P yellow, E red, R red |
| `entrypoints/main-world.content.ts` | Page-context hook installation and bridge to content script | `core/interceptor`, `core/ui`, `core/automation` | 1 | 181 | Medium | S yellow, U green, P yellow, E red, R yellow |
| `entrypoints/sidepanel` | React management UI for memory, skill, preset, automation, MCP, settings | React, Chrome messages, shared types | 17 | 3863 | Critical | S red, U yellow, P red, E red, R red |
| `scripts` | MCP smoke and live mock verification | Node `http`, `assert`, duplicated test helpers | 2 | 775 | Medium | S yellow, U green, P yellow, E green, R red |
| Config/build | WXT config, TypeScript config, package scripts, release workflow | WXT, Tailwind, GitHub Actions | 4 key files | n/a | Medium | S green, U green, P yellow, E yellow, R yellow |

## Module Details

### `core/skill`

- **Path**: `core/skill/`
- **Responsibility**: Store built-in and custom skills, merge them for runtime state, and parse `/skill args` invocations.
- **Public API**: `BUILTIN_SKILLS`, `getAllSkills`, `saveSkill`, `deleteSkill`, `replaceAllCustomSkills`, `parseSkillCommand`.
- **OfficeCLI Consideration**: This is the correct place for a built-in `/officecli` skill. It should remain prompt-only and reference available OfficeCLI tools instead of embedding executable behavior.
- **S.U.P.E.R Assessment**:
  - **S**: Partial. The module is small, but `builtin.ts` is a growing static array.
  - **U**: Compliant. Storage and parsing flow outward to prompt injection.
  - **P**: Partial. `Skill` is typed but not schema-versioned or dependency-aware.
  - **E**: Violation for productized OfficeCLI because built-in skill text cannot reflect installed OfficeCLI version, host health, or enabled roots.
  - **R**: Partial. Replacing skill storage is easy; replacing static built-ins with packaged skill files would require registry changes.

### `core/tool`

- **Path**: `core/tool/`
- **Responsibility**: Define tool descriptor/call/result contracts, parse invocation names, execute memory tools, and route runtime tool calls.
- **Public API**: `ToolDescriptor`, `ToolCall`, `ToolResult`, `createToolInvocationCatalog`, `getRuntimeToolDescriptors`, `executeRuntimeToolCall`.
- **OfficeCLI Consideration**: Existing contracts are the right abstraction. The current runtime dispatch is still memory-vs-MCP specific, so OfficeCLI should enter as MCP first unless a generic local provider registry is introduced.
- **S.U.P.E.R Assessment**:
  - **S**: Partial. Contracts, invocation parsing, memory provider, runtime, and history are split, but dispatch still encodes provider choices.
  - **U**: Partial. Runtime imports MCP and memory directly.
  - **P**: Compliant. Tool boundaries are serializable typed structures.
  - **E**: Partial. In-process memory tools are environment-light; MCP/native execution depends on browser APIs.
  - **R**: Partial. MCP providers are replaceable; local providers are not yet registry-based.

### `core/mcp`

- **Path**: `core/mcp/`
- **Responsibility**: Persist MCP server configs, normalize discovered tools, apply allowlist/execution policy, create transports, and execute `tools/call`.
- **Public API**: `createMcpServer`, `updateMcpServer`, `refreshMcpServerDiscovery`, `getMcpToolDescriptors`, `executeMcpToolCall`, `createMcpTransport`.
- **OfficeCLI Consideration**: This is the strongest fit for controlled OfficeCLI execution. A local OfficeCLI MCP server or native host can reuse discovery, allowlist, timeouts, max result bytes, call history, manual continuation, and automation continuation.
- **S.U.P.E.R Assessment**:
  - **S**: Partial. Store, client, discovery, and transports are separated, but OfficeCLI-specific policy would need more structure.
  - **U**: Compliant. Calls flow from background/runtime to transport and back as results.
  - **P**: Compliant. Server config, tool definitions, and JSON-RPC messages are typed.
  - **E**: Partial. Transport types are configurable, but Native Messaging host installation is external and browser-specific.
  - **R**: Compliant. Transports are swappable behind `createMcpTransport`.

### `core/prompt` and `core/interceptor`

- **Path**: `core/prompt/`, `core/interceptor/`
- **Responsibility**: Build prompt augmentation, render tool schemas, mutate DeepSeek requests, parse streaming responses, and hide tool XML from visible/history text.
- **Public API**: `buildPromptAugmentation`, `renderToolSchemas`, `installFetchHook`, `updateHookState`, `extractToolCalls`, `stripToolCalls`.
- **OfficeCLI Consideration**: OfficeCLI tool schemas will be injected through descriptors. Large document outputs require concise schemas and capped results to avoid leaking full document bodies into prompt history.
- **S.U.P.E.R Assessment**:
  - **S**: Violation in `fetch-hook.ts`, which combines hook install, prompt mutation, SSE filtering, response bookkeeping, token speed tracking, and history cleanup.
  - **U**: Partial. Main flow is clear, but the hook owns too much cross-cutting state.
  - **P**: Partial. Tool schemas are descriptor-driven; DeepSeek response patches are still loosely typed.
  - **E**: Violation. Tightly coupled to DeepSeek API and browser stream/IndexedDB internals.
  - **R**: Violation. Replacing response parsing or prompt injection has high blast radius.

### `core/automation`

- **Path**: `core/automation/`
- **Responsibility**: Store and schedule automations, run prompts against DeepSeek, handle PoW/auth/session state, and run MCP continuation loops.
- **Public API**: `runDeepSeekAutomation`, `scanDueAutomations`, `runAutomation`, automation store and schedule helpers.
- **OfficeCLI Consideration**: Automation can use OfficeCLI automatically if OfficeCLI appears as MCP. Write tools need idempotency and per-run operation tracking to avoid duplicate document mutations across continuation loops.
- **S.U.P.E.R Assessment**:
  - **S**: Partial. Submodules are focused; runner remains large.
  - **U**: Partial. Scheduler-to-runner flow is clear, but page-context and background execution are tightly coordinated.
  - **P**: Partial. Automation request/result contracts exist, but tool mutation idempotency is not modeled.
  - **E**: Violation. DeepSeek auth/PoW/session assumptions are page-specific.
  - **R**: Partial. Replacing the runner is possible but expensive.

### `entrypoints/background.ts`

- **Path**: `entrypoints/background.ts`
- **Responsibility**: Central WebExtension service worker, message switch, persistence API, MCP API, automation execution, and broadcast hub.
- **OfficeCLI Consideration**: Avoid adding OfficeCLI as many new switch branches. If productized onboarding is needed, add narrow helper APIs and keep execution in `core/mcp` or a dedicated host/provider module.
- **S.U.P.E.R Assessment**:
  - **S**: Violation. It owns many workflows.
  - **U**: Partial. It is the correct coordinator, but the switch is broad.
  - **P**: Violation. Runtime messages use `unknown` casts and are not fully reflected in `MessageAction`.
  - **E**: Violation by design at entrypoint level.
  - **R**: Violation. Adding/removing features often touches this file.

### `entrypoints/content.ts`

- **Path**: `entrypoints/content.ts`
- **Responsibility**: Bridge main-world messages to background, render tool result cards, restore execution blocks, manage theme/background/token-speed DOM integrations, and request manual continuation.
- **OfficeCLI Consideration**: Keep OfficeCLI result display generic. Do not add document-specific DOM rendering here unless artifact previews become a distinct, isolated component.
- **S.U.P.E.R Assessment**:
  - **S**: Violation. Multiple page integration responsibilities are mixed.
  - **U**: Partial. Bridge direction is clear.
  - **P**: Partial. Tool result shape is typed, but DOM rendering is not separated by artifact type.
  - **E**: Violation. Coupled to DeepSeek DOM and extension runtime.
  - **R**: Violation. Rendering and bridge behavior are hard to replace independently.

### `entrypoints/sidepanel`

- **Path**: `entrypoints/sidepanel/`
- **Responsibility**: React UI for configuration and management.
- **OfficeCLI Consideration**: A polished OfficeCLI UX should be a thin preset/onboarding surface over MCP/native configuration, not a second execution system. `McpPage.tsx` is already large and should be decomposed before substantial Office-specific UI is added.
- **S.U.P.E.R Assessment**:
  - **S**: Violation. Large pages combine data loading, forms, validation, actions, and rendering.
  - **U**: Partial. Data generally flows UI to background, but raw message calls are scattered.
  - **P**: Violation. No typed sidepanel client for runtime messages.
  - **E**: Violation. Browser and DOM assumptions are embedded in pages.
  - **R**: Violation. Replacing the MCP UI or adding OfficeCLI onboarding would touch large components.

### `scripts`

- **Path**: `scripts/`
- **Responsibility**: Validate MCP descriptor rendering, parsing, transport timeout paths, manual continuation, and automation continuation.
- **OfficeCLI Consideration**: Extend these scripts with a fake OfficeCLI provider and a real temp-file smoke where possible. Avoid further duplication of production parser logic.
- **S.U.P.E.R Assessment**:
  - **S**: Partial. Scripts each validate one broad scenario.
  - **U**: Compliant. Input-to-assertion flow is clear.
  - **P**: Partial. Mock schemas exist, but duplicated helper logic can drift.
  - **E**: Compliant for Node-based smoke tests.
  - **R**: Violation. Changes to production parser may not affect duplicated test helpers.

## OfficeCLI Integration Implications

1. Prefer MCP/native as the execution boundary because it reuses existing contracts, allowlist, result limits, history, and automation continuation.
2. Add `/officecli` as a skill prompt affordance, not a command executor.
3. Define OfficeCLI artifact/result schemas before UI work.
4. Avoid raw command execution from model payloads; expose named Office operations only.
5. Before adding major OfficeCLI UI, decompose `McpPage.tsx` or build a narrow onboarding component that writes a normal MCP server config.
