# Chrome Web Store Listing Draft

Last updated: 2026-06-17

## Package

- Current version: `0.7.5`
- Upload package: `dist/deepseek-plus-plus-0.7.5-chrome.zip`
- Category: Productivity
- Default language: English (United States)
- Homepage URL: `https://github.com/zhu1090093659/deepseek-pp`
- Support URL: `https://github.com/zhu1090093659/deepseek-pp/issues`
- Privacy policy URL: publish `docs/chrome-web-store/privacy-policy.md` and use its public URL.

## Store Listing

### Name

doubao-wplus

### Short Description

Bilingual memory, Skills, MCP tools, automation, Browser Control, and inline tool execution for DeepSeek.

### Detailed Description

doubao-wplus enhances the DeepSeek web app with English and Simplified Chinese support, persistent memory, reusable Skills, project context, saved snippets, built-in web search and page fetch tools, system prompt presets, MCP tool execution, optional Browser Control, local conversation export, downloadable artifacts, and scheduled automation.

Use it to keep useful facts across conversations, work in English or Simplified Chinese, attach project material when a task needs context, search the web when current information is needed, fetch page text for summarization, trigger custom or imported Skills with slash commands, connect user-configured MCP tools, operate a user-selected browser tab after Browser Control is enabled, save reusable snippets, export conversations locally, and let DeepSeek continue a task after tool results are returned. The extension runs on chat.deepseek.com and provides a side panel for managing memories, Skills, projects, saved items, presets, built-in tools, Browser Control, MCP servers, automation tasks, sync settings, and visual preferences.

Key features:

- Long-term memory for user profile, feedback, topic context, and references.
- English and Simplified Chinese UI, tool guidance, built-in Skill behavior, and continuation prompts.
- Project context and downloadable artifacts for reusable task materials and generated files.
- Saved snippets and bookmarks with search, prompt insertion, and Markdown/JSON export.
- Built-in web search and page fetch tools for current information and page summarization.
- Skill system with slash-command activation, user-defined prompts, and local or GitHub Skill imports.
- MCP tool management for user-configured remote or local tool services.
- Optional Browser Control for a user-selected tab, with text snapshots and visible browser actions after the user enables it.
- Inline tool execution UI that keeps execution traces readable without exposing implementation markers.
- Agent-style continuation that can pass tool results back into the same conversation.
- Local export for DeepSeek conversation history, with readable HTML, Markdown, PDF, and image-manifest outputs.
- Scheduled automation tasks that can run manually or on a timer.
- Optional WebDAV sync for memories, skills, and presets.
- Local customization, including DeepSeek page background and a small floating DeepSeek pet.

doubao-wplus does not operate a backend service for extension data. User configuration and extension data are stored locally in the browser unless the user explicitly enables WebDAV sync or connects a user-configured MCP endpoint/native host.

## zh-CN Localization Draft

### Name

doubao-wplus

### Short Description

�?DeepSeek 增加中英文体验、长期记忆、Skill、MCP 工具、自动化任务、浏览器控制和类原生工具执行体验�?
### Detailed Description

doubao-wplus �?DeepSeek 网页版增加中英文支持、长期记忆、Skill 技能、项目上下文、保存片段、内置网络搜索和网页获取工具、系统提示词预设、MCP 工具调用、可选浏览器控制、本地对话导出、可下载产物和自动化任务�?
你可以用它跨对话保存有用信息，在中文或英文环境中使用一致的界面和工具提示，在任务需要背景时附加项目资料，在需要实时信息时搜索互联网，获取网页文本用于总结，通过 `/skill` 快速切换工作模式，导入本机�?GitHub Skill，连接自己配置的 MCP 工具，在启用浏览器控制后操作用户选定的标签页，保存常用片段，本地导出对话，并�?DeepSeek 在工具结果返回后继续推进任务。扩展只�?chat.deepseek.com 运行，侧边栏用于管理记忆、Skill、项目、保存项、预设、内置工具、浏览器控制、MCP 服务、自动化任务、同步设置和个性化选项�?
核心功能�?
- 长期记忆：保存用户画像、行为反馈、话题上下文和参考资料�?- 中英文体验：界面、工具说明、内�?Skill 行为和续跑提示可跟随所选语言�?- 项目上下文和可下载产物：复用任务资料并保存生成文件�?- 保存片段和书签：支持搜索、插�?prompt，并导出 Markdown/JSON�?- 内置网络工具：支持联网搜索和网页文本获取�?- Skill 系统：支持斜杠命令触发内置、自定义、本机导入或 GitHub 导入技能�?- MCP 工具：支持用户配置的远程或本机工具服务�?- 可选浏览器控制：用户启用并选择目标标签页后，可提供文本快照和可见浏览器动作�?- 工具执行展示：隐藏原始调用格式，展示清晰的执行结果�?- Agent 式续跑：工具结果可回传到同一会话继续生成�?- 本地对话导出：支持将 DeepSeek 对话记录导出�?HTML、Markdown、PDF 和图片清单�?- 自动化任务：支持手动触发和定时触发�?- 可�?WebDAV 同步：同步记忆、技能和预设�?- 个性化设置：支�?DeepSeek 页面背景和悬浮小鲸鱼�?
doubao-wplus 不运营用于收集扩展数据的后台服务。除非用户主动开�?WebDAV 同步或配�?MCP 端点/本机 host，否则扩展数据保存在浏览器本地�?
## Assets

Mandatory assets prepared in this repo:

- Extension icon: `public/icon/128.png` (`128x128`)
- Small promotional image: `docs/chrome-web-store/assets/small-promo.png` (`440x280`)
- Screenshot: `docs/chrome-web-store/assets/screenshot-inline-tools-1280x800.png` (`1280x800`)

Optional existing screenshots for future store-gallery polish:

- `assets/screenshot-inline-tools.png`
- `assets/screenshot-sidepanel-memory.png`
- `assets/screenshot-sidepanel-saved.png`
- `assets/screenshot-sidepanel-projects.png`
- `assets/screenshot-sidepanel-skill.png`
- `assets/screenshot-sidepanel-mcp.png`
- `assets/screenshot-sidepanel-tools.png`
- `assets/screenshot-sidepanel-browser.png`
- `assets/screenshot-sidepanel-automation.png`
- `assets/screenshot-sidepanel-settings.png`
