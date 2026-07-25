#!/usr/bin/env node
/**
 * rebrand-deepseek-to-doubao.mjs
 * 批量将 i18n 资源文件中的 DeepSeek 元素替换为豆包/Doubao 专有名词。
 *
 * 用法: node scripts/rebrand-deepseek-to-doubao.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const FILES = [
  'core/i18n/resources/zh-CN.ts',
  'core/i18n/resources/en.ts',
];

// ─── zh-CN 替换规则 ──────────────────────────────────────
const ZH_REPLACEMENTS = [
  // 核心品牌名
  [/DeepSeek 的 Agentic 记忆/g, '豆包 WPlus 的 Agentic 记忆'],
  [/DeepSeek/g, '豆包'],
  [/deepseek/gi, 'doubao'], // 不区分大小写的 deepseek → doubao
  // URL / 域名
  [/chat\.deepseek\.com/g, 'doubao.com'],
  // API 相关
  [/请输入 DeepSeek API Key/g, '请输入豆包 API Key'],
  [/请配置 DeepSeek API Key，或先登录 chat\.deepseek\.com/g, '请配置豆包 API Key，或先登录 doubao.com'],
  [/未配置 Key 时，侧边栏对话依赖 DeepSeek 网页登录态/g, '未配置 Key 时，侧边栏对话依赖豆包网页登录态'],
  [/已清除，右键场景恢复为仅 DeepSeek 网页可用/g, '已清除，右键场景恢复为仅豆包网页可用'],
  // 页面/功能描述
  [/把 DeepSeek 对话加入项目/g, '把豆包对话加入项目'],
  [/当前活动标签页不是 DeepSeek 对话/g, '当前活动标签页不是豆包对话'],
  [/创建项目后，可以把当前 DeepSeek 对话加入项目/g, '创建项目后，可以把当前豆包对话加入项目'],
  [/在 DeepSeek 输入框中输入/g, '在豆包输入框中输入'],
  [/仅影响 chat\.deepseek\.com 网页对话/g, '仅影响 doubao.com 网页对话'],
  [/在 DeepSeek 页面显示状态联动宠物/g, '在豆包页面显示状态联动宠物'],
  [/为 DeepSeek 页面设置背景图片/g, '为豆包页面设置背景图片'],
  // 默认 shell host 名称
  [/com\.deepseek_pp\.shell/g, 'com.doubao_wplus.shell'],
  // 宠物名
  [/DeepSeek 小鲸鱼/g, '豆包小助手'],
  // 自动化描述
  [/把固定任务交给独立 DeepSeek 会话运行/g, '把固定任务交给独立豆包会话运行'],
  [/输入要定时发送到 DeepSeek 的内容/g, '输入要定时发送到豆包的内容'],
  // MCP 注入提示
  [/不会进入 DeepSeek Prompt/g, '不会进入豆包 Prompt'],
  // 工具结果提示
  [/请刷新当前 DeepSeek 页面后重试/g, '请刷新当前豆包页面后重试'],
  [/请重载 WPlus 扩展并刷新当前 DeepSeek 页面后重试/g, '请重载 WPlus 扩展并刷新当前豆包页面后重试'],
  [/请刷新当前 DeepSeek 页面后重试；如果仍失败/g, '请刷新当前豆包页面后重试；如果仍失败'],
  [/扩展已重新加载，请刷新当前 DeepSeek 页面后重试/g, '扩展已重新加载，请刷新当前豆包页面后重试'],
  // 沙箱描述
  [/不会在 DeepSeek 页面里执行/g, '不会在豆包页面里执行'],
  // 登录提示
  [/请先在 chat\.deepseek\.com 登录/g, '请先在 doubao.com 登录'],
  [/或刷新 DeepSeek 页面后重试/g, '或刷新豆包页面后重试'],
];

// ─── en 替换规则 ──────────────────────────────────────
const EN_REPLACEMENTS = [
  [/Agentic memory, skills, execution, automation, and MCP tools for DeepSeek/g,
   'Agentic memory, skills, execution, automation, and MCP tools for Doubao'],
  [/DeepSeek/g, 'Doubao'],
  [/deepseek/gi, 'doubao'],
  [/chat\.deepseek\.com/g, 'doubao.com'],
  [/\bDeepSeek API Key\b/g, 'Doubao API Key'],
  [/Please configure DeepSeek API Key.*?chat\.deepseek\.com/g,
   'Please configure Doubao API Key, or sign in to doubao.com first'],
];

let totalReplacements = 0;

for (const file of FILES) {
  const absPath = path.join(ROOT, file);
  if (!fs.existsSync(absPath)) { console.warn(`SKIP (not found): ${file}`); continue; }

  let content = fs.readFileSync(absPath, 'utf8');
  const replacements = file.includes('zh-CN') ? ZH_REPLACEMENTS : EN_REPLACEMENTS;
  let fileCount = 0;

  for (const [pattern, replacement] of replacements) {
    const matches = content.match(pattern);
    if (matches) {
      fileCount += matches.length;
      content = content.replace(pattern, replacement);
    }
  }

  fs.writeFileSync(absPath, content, 'utf8');
  console.log(`${file}: ${fileCount} replacements applied`);
  totalReplacements += fileCount;
}

console.log(`\nDone. Total: ${totalReplacements} replacements across ${FILES.length} files.`);
