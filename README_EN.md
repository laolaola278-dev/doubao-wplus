<h1 align="center">doubao-wplus</h1>

<p align="center">
  <strong>Doubao browser extension for a bilingual AI agent workspace with memory, projects, Skills, MCP tools, browser control, saved snippets, artifact downloads, conversation export, and automation.</strong>
</p>

<p align="center">
  <a href="README.md">Chinese README</a> ·
  <a href="#product-positioning">Product Positioning</a> ·
  <a href="#feature-overview">Feature Overview</a> ·
  <a href="#use-cases">Use Cases</a> ·
  <a href="#installation">Installation</a>
</p>

## Product Positioning

doubao-wplus is an open-source browser extension for [Doubao](https://www.doubao.com), with support for Chrome, Edge, and Firefox. It turns Doubao Web into an AI agent workspace where users can run English or Simplified Chinese UI, MCP tools, long-term memory, Skills, system prompt presets, web search, web fetch, conversation export, and scheduled automation in the same browser workflow.

In plain terms, it is a Doubao Chrome extension, Doubao MCP tools extension, Doubao memory plugin, Doubao conversation export tool, and AI agent browser extension for Doubao Web.

Language can follow the browser or be set to English or Simplified Chinese. doubao-wplus keeps the side panel, context menus, tool results, built-in Skill behavior, and continuation prompts in the selected language while preserving user-authored memories, presets, custom Skills, automation tasks, and sync data as written.

## Table of Contents

- [Product Positioning](#product-positioning)
- [Feature Overview](#feature-overview)
- [Use Cases](#use-cases)
- [Core Features](#core-features)
- [Installation](#installation)
- [Friendly Links](#friendly-links)

## Feature Overview

| Need | What doubao-wplus provides |
|------|--------------------------|
| AI agent browser extension | Turns DeepSeek Web into a browser-based workspace that can continue tasks, call tools, reuse memory, and schedule automation. |
| DeepSeek browser extension / DeepSeek Chrome extension | Adds side-panel chat, right-click text sending, tool-result rendering, and Chrome / Edge / Firefox support for DeepSeek Web. |
| Multilingual DeepSeek extension | Switches between English and Simplified Chinese, keeping UI, built-in tool descriptions, and model continuation behavior in the same language. |
| DeepSeek MCP tools | Lets you manage MCP services, tool permissions, and execution status in the side panel, then sends tool results back into the same conversation. |
| DeepSeek browser control | Lets doubao-wplus operate a user-selected browser tab after the user enables the feature and chooses the target. |
| DeepSeek memory | Automatically saves, filters, and injects long-term memory so different conversations can reuse user preferences, project context, and common facts. |
| DeepSeek Skills / `/skill` workflows | Switches quickly between built-in, custom, and GitHub-imported Skills for expert modes and task templates. |
| DeepSeek project context | Groups project instructions, project memories, and related DeepSeek conversations so matching chats get the right context automatically. |
| DeepSeek artifact downloads | Creates downloadable single files or project bundles for scripts, Markdown, JSON, HTML, and small project structures. |
| DeepSeek conversation export | Exports the current DeepSeek conversation from the reply action row with selectable HTML, Markdown, PDF, and image-manifest outputs, including attachment references and metadata. |
| DeepSeek saved snippets | Saves snippets, bookmarks, and reusable prompts that can be searched, inserted into chat, and exported as Markdown or JSON. |
| DeepSeek prompt controls | Controls memory, system prompt, preset cadence, and response language for different tasks. |
| DeepSeek automation | Runs fixed tasks in dedicated DeepSeek conversations with manual start, scheduled triggers, status tracking, and manual stop. |
| DeepSeek web search / web fetch | Searches the web or reads specified pages when current information or source material is needed, then continues to the final answer. |

## Use Cases

- Turn DeepSeek Web into an AI agent workspace with tool execution, MCP, memory, and automation.
- Use doubao-wplus in an English or Simplified Chinese workflow with matching UI, tool guidance, and model continuation prompts.
- Use DeepSeek side-panel chat, selected-text actions, and reusable prompt scenarios directly in Chrome, Edge, or Firefox.
- Let AI work in a user-selected Chrome or Edge tab while keeping explicit enable, target switching, and detach controls.
- Save project context, personal preferences, common workflows, and document-processing routines as long-term memory and reusable Skills.
- Back up your own DeepSeek conversation history locally as readable files for archive, migration, or later search.
- Let DeepSeek handle tasks that require multi-step tool execution, web search, page reading, or scheduled follow-up.

## Core Features

### Side-Panel Chat

- **Optional chat entry** - After it is enabled in settings, the side panel shows a Chat page where you can message DeepSeek directly.
- **Right-click selected text** - Select text and send it to the side-panel chat for quick explanation, summary, or rewriting.
- **Right-click scenarios** - Configure reusable scenario templates that wrap selected text in fixed prompts.
- **Official API Key** - After a Key is configured, side-panel chat and right-click scenarios can work on normal web pages; without a Key, right-click scenarios stay limited to DeepSeek Web.
- **Independent new conversations** - Create new side-panel conversations to avoid mixing with the current page conversation.
- **Streaming display** - Responses render continuously in the side panel. If login is missing, the extension prompts you to return to DeepSeek and sign in.

### Multilingual Experience

- **Language selection** - Follow the browser, or choose English or Simplified Chinese.
- **Consistent runtime language** - The side panel, context menus, tool results, built-in tool descriptions, and continuation prompts follow the selected language.
- **Matching model behavior** - Built-in Skills, tool-call guidance, web-search prompts, and long-task continuation prompts use the current language.
- **User content stays unchanged** - User-created memories, presets, custom Skills, automation prompts, MCP settings, and sync data are not translated or rewritten when the language changes.

### Project Context and Downloadable Artifacts

- **Project context** - Maintain project names, descriptions, and instructions in the side panel, then add related DeepSeek conversations to each project.
- **Project-aware chats** - Conversations assigned to a project automatically receive that project's instructions and project memories.
- **Project memory management** - Add, edit, pin, or delete memories that belong only to the selected project.
- **Single-file artifacts** - Ask doubao-wplus to create downloadable scripts, Markdown, JSON, HTML, or other text files.
- **Project bundles** - Download multi-file results as a bundle for prototypes, small tools, or documentation sets.
- **Local-first flow** - Project context, project memories, and generated artifacts are maintained and downloaded by the user without a doubao-wplus backend.

### Native-Feeling Tool Calls

- **Automatic detection and execution** - When the model asks to call a tool, the extension detects and runs it without requiring manual copying.
- **Clean visible output** - Technical call details stay hidden from the page; users see concise execution results.
- **Native-style rendering** - Tool results appear as collapsible blocks such as "Executed tools (2)" with itemized results.
- **Multiple tool calls per response** - A single answer can run multiple tool calls, which is useful for saving independent facts as separate memories.
- **Restored after refresh** - Tool execution records can be restored after the conversation page is refreshed.
- **Output speed indicator** - While a response is streaming, the input area shows live `tok/s` so you can tell whether the conversation is still producing output.

### Conversation Export

- **Current conversation export** - Export the current DeepSeek conversation from the same row as the official copy and share actions.
- **Selectable formats** - HTML is selected by default, with Markdown and PDF files available when needed.
- **Readable mode** - Extension-internal prompt and tool-call markup are hidden by default so exports are easier to read and search.
- **Attachment manifest** - Includes file references, names, sizes, statuses, and message links. File body export stays disabled until the download path is verified.
- **Image manifest** - Export a separate image attachment manifest for conversations that include screenshots, charts, or image files.
- **Single-message export** - Save an individual page message as Markdown when you only need one answer excerpt.
- **Local saves** - Export files are saved through the browser's local download flow. doubao-wplus does not operate a backend for collecting export data.

### Saved Items and Conversation Organization

- **Saved snippets and bookmarks** - Save reusable prompts, answer fragments, web leads, or reference notes in the side panel.
- **Fast insertion** - Insert a saved item into side-panel chat when reusing a fixed instruction or workflow.
- **Search and tags** - Search saved items by text or tags; tag DeepSeek history items and filter by title or tag.
- **Bulk export** - Export saved items as Markdown or JSON for migration, backup, or review.
- **Code block downloads** - Save code blocks from the DeepSeek page as local files with the matching file type.
- **What's new panel** - Settings can show a local version summary that users can dismiss.

### Built-In Web Tools

- **Web search** - The model can call `web_search` when it needs current information, fact checking, or source links.
- **Web fetch** - The model can call `web_fetch` to read visible text from a user-provided page for further summary or analysis.
- **Automatic continuation** - After search or fetch completes, the result returns to the same conversation and the model continues to the final answer.
- **Tool toggles** - Built-in web tools can be enabled or disabled individually from the Tools page in the side panel.
- **Permission management** - Page fetching can request per-site permission from the side panel, while search uses built-in permissions for common search sources.
- **Diagnostics** - The side panel includes search diagnostics to confirm current network and permission status.

### Agentic Continuation

- **Keep progressing through tasks** - Like Claude Code or Codex, the model can inspect tool results and decide the next step instead of stopping after one tool call.
- **Step-by-step continuation** - MCP tool results are sent back into the same conversation until the task is done or no more tools are needed.
- **Pacing control** - Multi-step continuation leaves a short interval between requests to reduce interruptions during long tasks.
- **Step blocks** - Continuous execution is displayed by step; completed steps collapse automatically so long tasks do not bury the main answer.
- **Refresh recovery** - Recent tool execution progress and final status can be restored after the page is refreshed.
- **Manual stop** - Long-running continuation can be stopped manually.

### Browser Control

- **Opt-in control** - Enable Browser Control from Capabilities > Browser, then select a target tab before browser tools are added to new conversations.
- **Visible web actions** - Supports navigation, click, hover, fill, key press, waiting for page content, dialog handling, and file attachment workflows.
- **Text snapshots** - The model receives page structure and visible-text summaries, not screenshots; node and text budgets can be adjusted.
- **Target control** - Review the attached state, refresh target tabs, switch the controlled tab, or detach Browser Control at any time.
- **Platform boundary** - Browser Control is available only on Chrome / Edge environments that support the required browser APIs, and disabled control does not inject browser tools into new conversations.

### Interactive Tools and Prompt Controls

- **Sandbox approvals** - Code execution that needs explicit permission shows a confirmation card before it continues.
- **Skill drafts** - AI can help draft a Skill, but the user reviews, edits, and confirms it before saving.
- **Memory import** - Import memory from another AI workflow with preview and per-item accept/reject controls.
- **Saved-item reuse** - Snippets and bookmarks can be reused as prompt material across conversations.
- **Voice input and read-aloud** - Use voice input and response read-aloud when the browser supports it; unsupported platforms show a clear status.
- **Prompt switches** - Disable memory, system prompt, or preset injection per task, or force a response language.

### Floating Pet

- **State-aware feedback** - DeepSeek pages can show the DeepSeek whale pet, which reacts to thinking, streaming, tool execution, success, and failure states.
- **Speech bubble** - The pet shows short status lines and rotates them during long thinking, streaming, or tool-execution periods.
- **Adjustable position** - Pin it to the lower-left or lower-right corner, or drag it to a custom position.
- **Adjustable appearance** - Configure size, opacity, and floating animation in settings.
- **Local persistence** - The on/off state, position, and appearance are stored locally in the browser and survive refreshes.

### MCP Tool System

- **Flexible connections** - Add remote or local MCP services for browser-side tools, local commands, or team tools.
- **Automatic execution by default** - Newly added MCP services run automatically by default, with per-service and per-tool switches for manual execution.
- **Permission and status management** - Authorize tools, test connections, refresh tool lists, and inspect status from the side panel.
- **Results return automatically** - Tool results return to the same conversation so the model can keep generating.
- **Agentic continuation support** - MCP tool results can feed back into the original conversation, supporting multi-step long-running tasks.
- **Local security** - MCP configuration and secrets stay in browser-local storage. WebDAV sync does not sync sensitive data.

### OfficeCLI Document Tools

- **Built-in `/officecli` Skill** - A controlled workflow for inspecting, locating issues, validating, and editing `.docx`, `.xlsx`, and `.pptx` files. Disabled by default and enabled manually from the Skills page.
- **Third-party Skill library** - Includes OfficeCLI Skills for DOCX, XLSX, PPTX, Pitch Deck, Academic Paper, Financial Model, Dashboard, Morph PPT, and more.
- **Third-party style library** - Includes the OfficeCLI PPT styles index and style descriptions, with chainable loading such as `/officecli-pptx /officecli-styles ...`.
- **Runs through Shell MCP** - After creating the Shell preset in the side panel, the model can call command-based OfficeCLI through `shell_exec`.
- **Automatic command-line installation** - `doubao-wplus-shell-host` installs the command-based OfficeCLI binary from iOfficeAI/OfficeCLI release assets according to your OS and processor type.
- **Command mode first** - The Skill checks that `officecli --help` exposes scriptable commands such as `view`, `get`, `set`, and `batch`.
- **Rejects hosted quota generation paths** - If the current binary only exposes hosted generation commands such as `new --prompt`, the Skill stops and asks you to switch to the command-based OfficeCLI binary.
- **Real local paths** - Document paths come from the user or from Shell MCP queries. The workflow does not guess placeholder directories.

Install the Shell Native Host:

```bash
npx doubao-wplus-shell-host install --browser chrome --extension-id <extension-id>
```


When developing from source, you can also use:

```bash
npm run shell:install -- --browser chrome --extension-id <extension-id>
```

### Memory System

- **Automatic memory** - The AI can recognize important information during conversation and save it as long-term memory.
- **Smart injection** - Each conversation automatically receives relevant memories selected by keyword matching, pin weight, access frequency, and other signals.
- **Four memory types** - User profile (`user`), behavioral feedback (`feedback`), topic context (`topic`), and reference material (`reference`).
- **Side-panel management** - View, edit, pin, delete, filter by type, and manage tags.
- **Import and export** - Back up and restore memories in JSON format.

### Skill System

- **Built-in Skills** - Includes ready-to-use general collaboration Skills and manually enabled third-party OfficeCLI document Skills.
- **Custom Skills** - Create your own Skills in the side panel with system instructions and parameters.
- **GitHub import** - Preview and import third-party Skills from a GitHub repository, directory, or direct `SKILL.md` link.
- **Local import** - Preview, import, and sync local Skill folders so personal workflows can be reused in doubao-wplus.
- **Source and update metadata** - GitHub-imported Skills show source repository, version, license, sync time, and upstream update checks.
- **Enable control** - Custom, locally imported, and GitHub-imported Skills can be enabled, disabled, or deleted independently without affecting other Skills.
- **Slash trigger** - Type `/` in the chat box to open autocomplete and inject the selected Skill's system prompt.
- **Memory integration** - Skills can choose whether to include memory context.

### System Prompt Presets

- **Custom presets** - Create multiple system prompt presets in the side panel for global roles or behavior instructions.
- **One-click activation** - Only one preset can be active at a time, and the active preset applies automatically.
- **First-message injection** - The active preset is injected before the first message of each new conversation.
- **Works with Skills and memory** - Preset content is layered together with Skill instructions and memory context.

### Automation Tasks

- **Manual or scheduled triggers** - Create tasks from the Automation page in the side panel, run them immediately, or schedule them with cron/RRULE.
- **Dedicated conversation per task** - The first run creates an independent conversation, and later runs reuse it for continuous tracking.
- **Flexible scheduling** - Supports manual runs, cron expressions such as `0 9 * * *`, and RRULE strings such as `FREQ=HOURLY;INTERVAL=1`. The minimum interval is 15 minutes.
- **Pause, edit, and delete** - Task cards support pause/enable, prompt and frequency editing, deletion, and opening the linked conversation.
- **Trackable run status** - Shows next run, previous run, latest status, and error messages.
- **Reuses the enhanced workflow** - Automation triggers the task; the resulting prompt can still use presets, memory, MCP tools, and agentic continuation.

## Installation

### Install from Chrome Web Store

Chrome users can install doubao-wplus directly from the [Chrome Web Store](https://chromewebstore.google.com/detail/doubao-wplus/kdmpkkahkhdmdhfkdihkopikgcocbpbf?hl=zh-CN). After installation, open [Doubao](https://www.doubao.com) and enable memory, Skills, MCP tools, web tools, conversation export, and automation from the side panel as needed.

If you need Shell MCP or local file tools, follow the Shell Native Host instructions shown on the side-panel `MCP` page.

### Build from Source

```bash
git clone https://github.com/laolaola278-dev/doubao-wplus.git
cd doubao-wplus
npm install
npm run build
```

By default, `npm run build` creates the Chrome MV3 build. Cross-browser builds:

```bash
npm run build:chrome
npm run build:edge
npm run build:firefox
npm run build:all
```

Shell MCP host smoke check:

```bash
npm run smoke:shell
```

### Android WebView Developer Baseline

The repository includes an Android WebView baseline for validating doubao-wplus mobile capability boundaries. The available local staging command is:

```bash
npm run build:android
```

This builds and stages the web assets. APK assembly and Android unit tests require a local JDK; without one, the Gradle entry points fail with an explicit install-and-retry message. Android intentionally disables browser-extension-only capabilities such as browser side panels, Native Messaging, Shell Host, context menus, and background alarms.

| Browser | Load entry | Build directory |
|---------|------------|-----------------|
| Chrome | `chrome://extensions/` -> Load unpacked | `dist/chrome-mv3/` |
| Edge | `edge://extensions/` -> Load unpacked | `dist/edge-mv3/` |
| Firefox | `about:debugging#/runtime/this-firefox` -> Load Temporary Add-on | `dist/firefox-mv3/manifest.json` |

## Friendly Links

- [OfficeCLI](https://github.com/iOfficeAI/OfficeCLI) - AI-friendly CLI for Office document processing
- [1flowbase](https://github.com/taichuy/1flowbase) - Open-source virtual model gateway for publishing multi-model workflows as OpenAI / Claude-compatible endpoints
- [FrontAgent](https://github.com/FrontAgent/FrontAgent) - AI agent platform for frontend engineering with RAG, Skills, SDD, MCP, CLI, and VS Code support
- [MuseAI](https://github.com/yejiming/MuseAI) - AI character and story-world interaction project for creating characters and continuing story interactions
- [Spec Driven Develop](https://github.com/zhu1090093659/spec_driven_develop) - A spec-driven development method for AI coding agents
- [Awesome-Prompts Role Playing](https://github.com/dongshuyan/Awesome-Prompts/tree/master/%E8%A7%92%E8%89%B2%E6%89%AE%E6%BC%94) - Curated role-playing prompt collection
- [LINUX DO](https://linux.do) - A next-generation open-source technology community

## License

MIT
