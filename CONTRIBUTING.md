# Contributing

Thanks for contributing to doubao-wplus.

## 行为准则 / Code of Conduct

本项目采用 [贡献者公约](CODE_OF_CONDUCT.md)。所有参与者都应遵守其中规定，包括不可滥用声明和商用条款。

## 贡献者列表 / Contributors

欢迎通过 Pull Request 提交贡献。如果你的 PR 被合并，你可以选择将你的名字（或 GitHub 用户名）加入 README 的贡献者列表。

All pull requests must follow these rules before they can be reviewed or merged.

## Pull Request Requirements

1. Base the work on the latest code.
   - Rebase or merge the latest `main` before opening the PR.
   - Re-check this after force-pushes or when the PR becomes stale.

2. Keep the PR focused.
   - Do not mix unrelated features, release changes, dependency churn, or documentation rewrites.
   - Do not modify public README content with internal API paths, protocol details, or implementation internals.

3. Run local validation.
   - At minimum, run the checks that match the changed behavior.
   - For TypeScript or extension runtime changes, start with:

```bash
npm run compile
```

   - For broader extension changes, also run the relevant build or smoke checks:

```bash
npm run build:chrome
npm run build:all
npm run smoke:mcp
npm run verify:mcp:mock
npm run verify:automation
```

4. Provide evidence for user-facing features.
   - If the PR adds or changes a feature, UI workflow, browser permission path, built-in tool, MCP flow, automation flow, or continuation-loop behavior, attach screenshots or a short screen recording in the PR.
   - The evidence must show:
     - the extension loaded locally from the latest code or this PR head;
     - the feature enabled or configured when applicable;
     - successful use of the feature;
     - the visible result or output;
     - result feedback or continuation behavior when the feature participates in agent loops.

5. Do not hide failures.
   - Report failing commands, browser errors, and limitations in the PR body.
   - Do not add silent fallbacks, mock success paths, or swallowed errors to make a feature appear to work.

PRs that skip these requirements may be blocked until the missing information is provided.
