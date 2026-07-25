# 豆包 ++（Doubao WPlus）企划案（v0.2 · 已对齐用户决策）

> 项目命名：`doubao_wplus`（对�?`deepseek-pp`，W = Web，Plus = 增强�?> 目录建议：`D:\xjx\MCP\Doubao++\doubao-wplus\`（新建，�?`deepseek-pp` 平级，不在原仓库里改�?> 目标：基�?`deepseek-pp` v0.7.5 改造为**豆包网页免费版（`www.doubao.com/chat`）专属增强插�?*，复�?80% 通用能力，对接豆�?20% 特有机制�?
---

## 0. 用户决策（v0.2 已确认）

| �?| 决策 |
|---|---|
| API Key | �?**不用**。走豆包网页免费版（�?doubao-wplus 一样拦截宿�?fetch）�?|
| DeepSeek 适配 | �?**保留作为可选宿�?*。`HostAdapter` 同时支持 `doubao` �?`deepseek`，运行期可切换�?|
| 豆包网页内嵌接管 | �?**�?*。在豆包输入框旁注入按钮，行为对�?doubao-wplus�?|
| 品牌资产 | �?**要豆包绿主色 + 豆包吉祥�?*。从 `www.doubao.com/browser-extension/landing` 现有素材取色 / 借鉴，不侵权前提下自绘�?|
| 项目命名 | **`doubao_wplus`**（npm 包名 / 仓库�?/ 文案统一�?|
| Chrome Web Store release pipeline | �?**�?*。打包脚�?+ 商店元数据（截图、描述、隐私声明）一并输出�?|

---

## 1. 核心可行性结�?
豆包网页**没有**直接暴露 OpenAI 兼容端点，但**已存�?*两条成熟"通过浏览器拦�?fetch 调用免费�?方案可借鉴�?
1. **`doubao2API`**（wkServer/doubao2API）�?Playwright + JS 拦截器自动注�?`a_bogus` / `msToken` 签名
2. **`Better_Doubao`**（Rex16200513）�?现成开源豆�?Web 增强插件参�?
豆包反爬核心�?**`a_bogus`**（字节系风控签名），必须从豆包原网页�?JS bundle 里调用其签名函数。我们的拦截器流程是�?- Content script 注入豆包主页
- 拦截 fetch / XHR
- 用豆包自带的 `window.byted_acrawler` 或注入同等签名函数计�?`a_bogus` / `msToken`
- 透传 / 修改请求体（注入记忆、Skill 指令、工具定义）
- 解析 SSE 流式响应，写回侧边栏

> 这一点是改造工作量�?*风险最�?*的一环。如�?`a_bogus` 算法版本升级，插件需要快速跟进。需在插件里加入**版本检�?+ 静默降级**（不阻断主流程，仅提示用户当前不可用工具）�?
---

## 2. 仓库改造蓝�?
### 2.1 新仓库目�?
```
D:\xjx\MCP\Doubao++\doubao-wplus\
├── wxt.config.ts                # 重写 host_permissions / matches
├── package.json                 # name: "doubao-wplus", version: "0.1.0"
├── README.md / README_EN.md
├── PRIVACY.md / STORE_LISTING.md
├── core/
�?  ├── constants.ts             # 抽离 HOST 常量、DOUBAO_* 端点
�?  ├── adapters/                # 新模块：宿主适配�?�?  �?  ├── types.ts             # HostAdapter 接口
�?  �?  ├── doubao/
�?  �?  �?  ├── adapter.ts       # 豆包 fetch 拦截 + a_bogus 注入
�?  �?  �?  ├── bogus-signer.ts  # 调用 / 复刻 a_bogus 签名
�?  �?  �?  ├── page-context.ts  # 豆包网页 DOM 抓取（bot �?/ 会话标题�?�?  �?  �?  └── endpoints.ts     # /chat /regenerate /history_messages
�?  �?  └── deepseek/            # �?deepseek/ 改名迁入，接口不�?�?  ├── interceptor/             # 通用 fetch-hook / XHR hook / SSE parser（不变）
�?  ├── tool/                    # 通用 tool-call XML 协议（不变）
�?  ├── memory/                  # 不变
�?  ├── skills/                  # 不变
�?  ├── mcp/                     # 不变
�?  ├── browser/                 # 不变
�?  ├── automation/              # 不变
�?  ├── export/                  # 不变（按 host 模板渲染�?�?  ├── pet/                     # 不变（替换素材）
�?  ├── i18n/                    # �?zh_CN / en
�?  └── prompt/                  # 不变
├── entrypoints/
�?  ├── content.ts               # matches: ['*://www.doubao.com/*', '*://*.doubao.com/*', '*://chat.deepseek.com/*']
�?  ├── background.ts            # 路由支持�?host
�?  ├── sidepanel/               # 不变
�?  └── options/                 # 不变
├── public/
�?  ├── icon/                    # 豆包绿主色（#4D6BFF / #00B86B 备用�?�?  ├── pet/doubao-pet-states.png
�?  └── _locales/
�?      ├── zh_CN/messages.json  # extension_name: "豆包 WPlus"
�?      └── en/messages.json     # extension_name: "Doubao WPlus"
├── docs/
�?  ├── doubao-pp-proposal.md    # �?本文�?�?  ├── STORE_LISTING.md         # Chrome Web Store 上架文案
�?  └── PRIVACY.md               # 隐私声明（仅本地存储 / 不上传用户数据）
├── packages/                    # �?packages/*（不动）
└── scripts/
    ├── build:chrome, build:edge, build:firefox, zip:all
    └── ci:quality
```

### 2.2 关键改造点（按风险排序�?
| �?| 模块 | 风险 | 说明 |
|---|---|---|---|
| 1 | `adapters/host.ts` 抽象 + �?host 路由 | �?| �?�?host 硬编�?改为可注册；DeepSeek 适配原样迁入做兼容通道 |
| 2 | **豆包 `a_bogus` 签名拦截** | **�?* | 第一版采用「调用豆包网页内 bundle �?`window.byted_acrawler`」策略；如失败再考虑把签�?JS 反编译成自包含模�?|
| 3 | 豆包 fetch-hook + SSE 解析 | �?| 路径匹配 `*://www.doubao.com/api/*`，复用现�?`sse-parser.ts` |
| 4 | 豆包内嵌按钮（输入框旁注�?豆包++"按钮�?| �?| �?Shadow DOM 注入，绕开豆包前端框架�?DOM 的劫�?|
| 5 | 豆包 page-context 抓取 | �?| 通过 `MutationObserver` 监听 URL / DOM 变化，抓 bot �?/ 会话标题 / 智能体标�?|
| 6 | i18n + UI 品牌�?| �?| 浅色 + 豆包绿主题；替换吉祥物为豆荚 / 豆子造型 |
| 7 | 跨浏览器构建（Chrome / Edge / Firefox�?| �?| 复用 WXT �?target；Firefox 需处理 `browser.*` 差异 |
| 8 | **Chrome Web Store 上架物料** | �?| 截图 5 �?+ 描述 16KB �?+ 隐私实践问卷 + 单用途说�?|
| 9 | 回归 + 发布 | �?| v0.1.0 灰度，监控反爬失败告�?|

### 2.3 保留（与宿主无关）的核心模块

- `core/memory/` 记忆系统（Dexie�?- `core/skills/` Skill 注册与执�?- `core/mcp/` MCP 客户�?- `core/browser/` 浏览器控�?- `core/automation/` 自动化任�?- `core/export/` 对话导出
- `core/i18n/`（仅扩字 + �?extension_name�?- 全部 React UI 组件（侧边栏 / 设置�?/ 对话列表�?- `core/interceptor/sse-parser.ts` SSE 解析（与协议无关�?
### 2.4 删除

- `core/deepseek/pow.ts` �?DeepSeek 专属 PoW，豆包不需�?- `public/deepseek/sha3_wasm_bg.wasm` �?同上
- `Bing 搜索`相关代码（如有，豆包自带联网搜索�?- `OfficeCLI` 相关（如有，豆包自含办公能力�?
---

## 3. 改造工作量评估

| 工作�?| 预估工时 | 风险 |
|---|---|---|
| 新仓库搭�?+ 旧仓库搬�?+ GitHub rename | 0.5 人日 | �?|
| 抽离 HostAdapter + �?host 路由 | 1 人日 | �?|
| 豆包 `a_bogus` 拦截 / 签名 | 3 人日 | **�?*（含联调 + 回归�?|
| 豆包 fetch-hook + SSE + 内容脚本改�?| 1.5 人日 | �?|
| 豆包内嵌按钮（输入框�?Shadow DOM 注入�?| 1 人日 | �?|
| 豆包 page-context 抓取 | 2 人日 | �?|
| 品牌�?UI（豆包绿 / 吉祥�?/ icon�?| 1 人日 | �?|
| i18n 扩字 + 双语 README | 1 人日 | �?|
| Firefox 适配（如本期要） | 1 人日 | �?|
| **Chrome Web Store 打包 + 上架物料** | **1.5 人日** | �?|
| 联调 + 回归 + 内测灰度 | 2 人日 | �?|
| **合计** | **�?15.5 人日** | |

---

## 4. �?doubao-wplus 差异化卖�?
1. **多宿主支�?* �?一份代码同时支持豆�?+ DeepSeek，未来扩 Kimi / 通义 / 元宝 / ChatGPT 只需加一�?Adapter�?2. **零成本使�?* �?不依�?API Key，全程走网页免费版（�?doubao-wplus 同模式）�?3. **内嵌接管体验** �?豆包输入框旁直接出现"豆包++"按钮，一键注入记�?/ Skill / 工具�?4. **网页上下文桥** �?把豆包当前会�?/ Bot / 用户偏好带到侧边栏，跨会话复用�?5. **�?function calling 兜底** �?主路径用豆包原生协议，工具调用走 XML 协议时自动降级为提示词注入�?6. **Chrome Web Store 一键发�?* �?包含完整 `STORE_LISTING.md` + `PRIVACY.md` + zip 脚本�?
---

## 5. 执行顺序

1. �?已确�?6 项用户决策（v0.2�?2. 新建 `D:\xjx\MCP\Doubao++\doubao-wplus\` 仓库
3. �?`deepseek-pp` 拷贝 `core/interceptor/` `core/memory/` `core/skills/` `core/mcp/` `core/browser/` `core/automation/` `core/export/` `core/i18n/` `core/prompt/` `core/tool/` `core/pet/` `entrypoints/{sidepanel,options}/` `packages/` `scripts/`（约 0.5 天）
4. �?`adapters/host.ts`，迁�?`core/deepseek/` �?`adapters/deepseek/`（约 1 天）
5. **写豆�?`a_bogus` 拦截 + fetch-hook 跑�?hello-world 流式对话**�? 天，最高风险）
6. 加内嵌按�?+ page-context 抓取�? 天）
7. UI 品牌�?+ i18n + icon + 吉祥物（2 天）
8. Chrome / Edge 跨浏览器 + 打包脚本�?.5 天）
9. **Chrome Web Store 上架物料 + 发布**�?.5 天）
10. 灰度 + 监控 + 回归�? 天）

---

## 6. 立即可做的下一�?
> 等用户回�?开�?后立即执行�?
1. �?`D:\xjx\MCP\Doubao++\` �?`git clone deepseek-pp doubao-wplus`（或本地拷贝�?2. �?`package.json` name �?`doubao-wplus`，version �?`0.1.0`
3. �?`wxt.config.ts` 名称 + 描述 + host_permissions（保�?deepseek 域做兼容�?4. 创建 `core/adapters/{types.ts,doubao/,deepseek/}` 目录骨架
5. 把现�?`core/deepseek/` 全部迁入 `adapters/deepseek/`，改 import 路径
6. 抽出 `core/constants.ts` �?`HOST` 配置，支�?build-time 注入
7. 写一个最小可跑通的"豆包 hello world"拦截 demo
8. 同步�?`docs/doubao-pp-proposal.md` 迁到新仓�?
---

> 关键风险提示：`a_bogus` 反爬签名可能在任何时候升级，建议在插件里加一个轻量上报（不上传内容，仅上�?签名是否成功"），方便快速发现失效版本�?