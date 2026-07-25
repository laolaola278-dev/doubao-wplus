# Browser Control Parity â€?Progress Tracker

> **Task**: Implement Gemini-Nexus parity browser control in doubao-wplus with Chromium CDP, Accessibility Tree UID snapshots, controlled tabs/groups, browser action tools, sidepanel controls, and validation.
> **Started**: 2026-06-14
> **Last Updated**: 2026-06-14
> **Mode**: GITHUB_STANDARD
> **Repo**: zhu1090093659/deepseek-pp

## GitHub Resources

- **All Issues**: `gh issue list -R zhu1090093659/deepseek-pp --label "spec-driven" --state all`
- **Browser Control Issues**: `gh issue list -R zhu1090093659/deepseek-pp --search "Browser Control Parity" --state all`
- **Project Board**: unavailable in current `gh` auth scope; mode is `GITHUB_STANDARD`.

## References

- [Project Overview](../analysis/project-overview.md)
- [Module Inventory](../analysis/module-inventory.md)
- [Risk Assessment](../analysis/risk-assessment.md)
- [Task Breakdown](../plan/task-breakdown.md)
- [Dependency Graph](../plan/dependency-graph.md)
- [Milestones](../plan/milestones.md)

## Milestones

| Phase | Name | Milestone URL | Open | Closed | Total |
|:--|:--|:--|--:|--:|--:|
| 1 | Contracts, Capabilities, and Permissions | https://github.com/zhu1090093659/deepseek-pp/milestone/37 | 3 | 0 | 3 |
| 2 | Background Browser-Control Runtime | https://github.com/zhu1090093659/deepseek-pp/milestone/38 | 3 | 0 | 3 |
| 3 | Browser Action Tools | https://github.com/zhu1090093659/deepseek-pp/milestone/39 | 4 | 0 | 4 |
| 4 | Tool-Loop and Result Integration | https://github.com/zhu1090093659/deepseek-pp/milestone/40 | 3 | 0 | 3 |
| 5 | Sidepanel Browser Control UI | https://github.com/zhu1090093659/deepseek-pp/milestone/41 | 3 | 0 | 3 |
| 6 | Verification, Documentation, and Release Readiness | https://github.com/zhu1090093659/deepseek-pp/milestone/42 | 3 | 0 | 3 |

## Issue Mapping

| Task ID | Issue | Title | Status |
|:--|:--|:--|:--|
| T1.1 | #189 | Add browser-control contracts and settings | local done; GitHub open |
| T1.2 | #190 | Add platform capability gates for browser control | local done; GitHub open |
| T1.3 | #191 | Update manifest permissions and policy docs | local done; GitHub open |
| T2.1 | #192 | Implement CDP connection adapter | local done; GitHub open |
| T2.2 | #193 | Implement controlled tab and tab group manager | local done; GitHub open |
| T2.3 | #194 | Implement Accessibility Tree snapshot manager | local done; GitHub open |
| T3.1 | #195 | Implement navigation and page tools | local done; GitHub open |
| T3.2 | #196 | Implement observation tools | local done; GitHub open |
| T3.3 | #197 | Implement input tools | local done; GitHub open |
| T3.4 | #198 | Add browser-control descriptors and runtime dispatch | local done; GitHub open |
| T4.1 | #199 | Integrate manual and sidepanel chat observations | local done; GitHub open |
| T4.2 | #200 | Integrate inline agent and automation browser-control policy | local done; GitHub open |
| T4.3 | #201 | Add result budget and restore behavior | local done; GitHub open |
| T5.1 | #202 | Add Browser Control sidepanel page | local done; GitHub open |
| T5.2 | #203 | Add background browser-control message API | local done; GitHub open |
| T5.3 | #204 | Add browser-control i18n and navigation | local done; GitHub open |
| T6.1 | #205 | Add real Chrome browser-control smoke fixture and script | pending live Chrome smoke |
| T6.2 | #206 | Update docs and Chrome Web Store permission copy | local done; GitHub open |
| T6.3 | #207 | Run full validation and final diff review | local done; GitHub open |

## Quick Status Commands

```bash
# Phase progress
gh api repos/zhu1090093659/deepseek-pp/milestones \
  --jq '.[] | select(.number >= 37 and .number <= 42) | "\(.title): \(.open_issues) open, \(.closed_issues) closed"'

# Open tasks for the active phase
gh issue list -R zhu1090093659/deepseek-pp \
  --milestone "Phase 1: Contracts, Capabilities, and Permissions" \
  --state open \
  --json number,title

# All current browser-control spec tasks
gh issue list -R zhu1090093659/deepseek-pp \
  --milestone "Phase 1: Contracts, Capabilities, and Permissions" \
  --state all \
  --json number,title,state,milestone
```

## Phase Checklist

- [x] Phase 1: Contracts, Capabilities, and Permissions (3/3 tasks locally complete) â€?[milestone](https://github.com/zhu1090093659/deepseek-pp/milestone/37)
- [x] Phase 2: Background Browser-Control Runtime (3/3 tasks locally complete) â€?[milestone](https://github.com/zhu1090093659/deepseek-pp/milestone/38)
- [x] Phase 3: Browser Action Tools (4/4 tasks locally complete) â€?[milestone](https://github.com/zhu1090093659/deepseek-pp/milestone/39)
- [x] Phase 4: Tool-Loop and Result Integration (3/3 tasks locally complete) â€?[milestone](https://github.com/zhu1090093659/deepseek-pp/milestone/40)
- [x] Phase 5: Sidepanel Browser Control UI (3/3 tasks locally complete) â€?[milestone](https://github.com/zhu1090093659/deepseek-pp/milestone/41)
- [ ] Phase 6: Verification, Documentation, and Release Readiness (2/3 tasks locally complete; live Chrome smoke pending) â€?[milestone](https://github.com/zhu1090093659/deepseek-pp/milestone/42)

## Current Status

**Active Phase**: Phase 6 â€?Verification, Documentation, and Release Readiness.
**Active Task**: T6.1 / #205 â€?live Chrome smoke.
**Blockers**: No automated live Chrome extension smoke was run in this session because it would require loading/reloading the unpacked extension in the user's Chrome profile.

## Governance Status

**Shared instruction surface**: `AGENTS.md`, auto-generated from Claude project memory. Do not hand-edit unless the sync source is also updated.
**Claude Code instruction surface**: no root `CLAUDE.md`.
**Other platform rule surfaces**: `.codex/` exists but no project skill files were found.
**Memory surface**: Codex native memory.
**Memory fallback path**: none. Do not create repo-local fallback memory unless explicitly selected.

## Execution Telemetry

Per-task telemetry should be written to the corresponding GitHub Issue as comments. Adaptive drift state lives in Milestone descriptions under the `adaptive` YAML block.

## Notes

- The old active Better DeepSeek capability spec was replaced in `docs/analysis`, `docs/plan`, and `docs/progress`; archived copy remains at `docs/archives/better-deepseek-capability-adoption/`.
- Browser-control tools should be implemented as local doubao-wplus `ToolDescriptor`s with `browser_*` invocation names, not as external MCP tools.
- Chromium/Edge are the active target platforms. Firefox and Android must show explicit unsupported state and must not expose executable browser-control tools.
- Raw full Accessibility Tree snapshots must be budgeted and should not be stored directly in normal tool history.

## Next Steps

1. Load `dist/chrome-mv3` in Chrome/Edge, enable Browser Control from Capabilities > Browser, select a normal web tab, and run `browser_snapshot`.
2. Close or update GitHub issues #189-#207 after review/merge policy is selected.
3. Re-run release validation before publishing any version that includes new Chrome permissions.

## Session Log

| Date | Session | Summary |
|:--|:--|:--|
| 2026-06-14 | Planning | Ran spec-driven Phase 0-4 for Gemini-Nexus parity browser control, wrote analysis and plan docs, created GitHub milestones #37-#42 and issues #189-#207, and initialized this tracker. |
| 2026-06-14 | Implementation | Added local `browser_*` tools, CDP/debugger connection, controlled tabs/groups, Accessibility Tree snapshots, browser actions, runtime/inline-agent integration, sidepanel controls, Chromium permissions, CWS docs, and automated validation. Live Chrome extension smoke remains pending. |
