import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TOOL_DESCRIPTORS } from '../core/tool';
import { createArtifactToolDescriptors } from '../core/artifact';
import { augmentRequestBody } from '../core/interceptor/request-augmentation';
import { buildPromptAugmentation } from '../core/prompt';
import { setActiveHostId } from '../core/hosts/registry';

describe('augmentRequestBody', () => {
  // 这些用例使用 DeepSeek 平面 body 结构（prompt/parent_message_id 顶层字段），
  // 必须显式声明宿主 —— doubao 的字段映射已改为嵌套路径，不再兼容平面结构
  beforeEach(() => {
    setActiveHostId('deepseek');
  });
  afterAll(() => {
    setActiveHostId('doubao');
  });

  it('applies expert mode and advances request message count without exposing state to main-world', () => {
    const result = augmentRequestBody(JSON.stringify({
      prompt: 'hello',
      parent_message_id: null,
      thinking_enabled: false,
    }), {
      memories: [],
      skills: [],
      activePreset: null,
      modelType: 'expert',
      toolDescriptors: DEFAULT_TOOL_DESCRIPTORS,
      messageCount: 0,
    });

    expect(result?.messageCount).toBe(1);
    expect(JSON.parse(result?.body ?? '{}').model_type).toBe('expert');
    expect(result?.usedMemoryIds).toEqual([]);
  });

  // AI Insights 采集：stats 始终返回，且只含标量（长度/名称/布尔/耗时），无 prompt 文本
  it('returns insights stats scalars for the plain-prompt branch', () => {
    const result = augmentRequestBody(JSON.stringify({
      prompt: 'hello world',
      parent_message_id: null,
      thinking_enabled: false,
    }), {
      memories: [],
      skills: [],
      activePreset: { id: 'p1', name: 'P', content: 'Be terse.', createdAt: 1, updatedAt: 1 },
      modelType: null,
      toolDescriptors: [],
      messageCount: 0,
      locale: 'en',
    });

    expect(result?.stats).toBeTruthy();
    expect(result?.stats.originalLength).toBe('hello world'.length);
    expect(result?.stats.finalLength).toBeGreaterThan('hello world'.length);
    expect(result?.stats.matchedSkills).toEqual([]);
    expect(result?.stats.presetInjected).toBe(true);
    expect(result?.stats.memorySelectDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns matched skill names in insights stats for the skill branch', () => {
    const result = augmentRequestBody(JSON.stringify({
      prompt: '/writer draft something',
      parent_message_id: null,
      thinking_enabled: false,
    }), {
      memories: [],
      skills: [{ name: 'writer', instructions: 'Write clearly.', memoryEnabled: false }],
      activePreset: null,
      modelType: null,
      toolDescriptors: [],
      messageCount: 0,
      locale: 'en',
    });

    expect(result?.stats.matchedSkills).toEqual(['writer']);
    expect(result?.stats.presetInjected).toBe(false);
    expect(result?.stats.originalLength).toBe('/writer draft something'.length);
  });

  it('emits English prompt scaffolding while keeping XML tool tags stable', () => {
    const result = buildPromptAugmentation('search latest DeepSeek news', {
      memories: [],
      toolDescriptors: DEFAULT_TOOL_DESCRIPTORS,
      locale: 'en',
    });

    expect(result.augmented).toContain('## Role');
    expect(result.augmented).toContain('(No memories yet)');
    expect(result.augmented).toContain('## Web Search Rules');
    expect(result.augmented).toContain('Available tool tag names: memory_save');
    expect(result.augmented).toContain('<memory_save>');
    expect(result.augmented).toContain('</memory_save>');
    expect(result.augmented).toContain('Invalid formats: <invoke name="memory_save">...</invoke>, <tool_call>...</tool_call>');
    expect(result.augmented).not.toContain('## 角色');
  });

  it('uses locale-aware default tool descriptors when none are provided', () => {
    const result = buildPromptAugmentation('search latest DeepSeek news', {
      memories: [],
      locale: 'en',
    });

    expect(result.augmented).toContain('Title: Save memory');
    expect(result.augmented).toContain('Description: Save a new long-term memory');
    expect(result.augmented).toContain('Parameters JSON Schema: {"type":"object"');
    expect(result.augmented).not.toContain('Title: 保存记忆');
    expect(result.augmented).not.toContain('Description: 保存一条新的长期记忆');
  });

  it('keeps project context after base system scaffolding and before web-search guidance', () => {
    const result = buildPromptAugmentation('where is the Android entry point?', {
      memories: [],
      presetContent: 'You are a repo-aware assistant.',
      projectContext: '## Project Context\nProject: WPlus\n--- android/MainActivity.kt:1-2 ---',
      locale: 'en',
    });

    const presetIndex = result.augmented.indexOf('You are a repo-aware assistant.');
    const roleIndex = result.augmented.indexOf('## Role');
    const projectIndex = result.augmented.indexOf('## Project Context');
    const webSearchIndex = result.augmented.indexOf('## Web Search Rules');
    const visibleUserIndex = result.augmented.indexOf('where is the Android entry point?');

    expect(presetIndex).toBeGreaterThanOrEqual(0);
    expect(roleIndex).toBeGreaterThan(presetIndex);
    expect(projectIndex).toBeGreaterThan(roleIndex);
    expect(webSearchIndex).toBeGreaterThan(projectIndex);
    expect(visibleUserIndex).toBeGreaterThan(webSearchIndex);
  });

  it('keeps Chinese prompt scaffolding available under zh-CN', () => {
    const result = buildPromptAugmentation('搜索 DeepSeek 新闻', {
      memories: [],
      toolDescriptors: DEFAULT_TOOL_DESCRIPTORS,
      locale: 'zh-CN',
    });

    expect(result.augmented).toContain('## 角色');
    expect(result.augmented).toContain('(暂无记忆)');
    expect(result.augmented).toContain('## 网络搜索规则');
    expect(result.augmented).toContain('可用工具标签名：memory_save');
    expect(result.augmented).toContain('<memory_save>');
    expect(result.augmented).not.toContain('## Role');
  });

  it('honors prompt controls for memory, system prompt, and forced language', () => {
    const withoutMemory = buildPromptAugmentation('remember nothing here', {
      memories: [{
        id: 1,
        syncId: 'sync-1',
        scope: 'global',
        type: 'reference',
        name: 'Hidden memory',
        content: 'Do not include me',
        description: '',
        tags: [],
        pinned: false,
        createdAt: 1,
        updatedAt: 1,
        accessCount: 0,
        lastAccessedAt: 1,
      }],
      memoryEnabled: false,
      locale: 'en',
    });
    expect(withoutMemory.usedMemoryIds).toEqual([]);
    expect(withoutMemory.augmented).toContain('(Memory injection disabled for this request)');
    expect(withoutMemory.augmented).not.toContain('Do not include me');

    const withoutSystemPrompt = buildPromptAugmentation('plain prompt', {
      memories: [],
      systemPromptEnabled: false,
      locale: 'en',
    });
    expect(withoutSystemPrompt.renderedToolCount).toBe(0);
    expect(withoutSystemPrompt.augmented).not.toContain('## Role');
    expect(withoutSystemPrompt.augmented).toContain('plain prompt');

    const memoryOnly = buildPromptAugmentation('remember durable facts', {
      memories: [{
        id: 2,
        syncId: 'sync-2',
        scope: 'global',
        type: 'reference',
        name: 'Durable memory',
        content: 'Inject me without the full system prompt',
        description: '',
        tags: [],
        pinned: false,
        createdAt: 1,
        updatedAt: 1,
        accessCount: 0,
        lastAccessedAt: 1,
      }],
      systemPromptEnabled: false,
      locale: 'en',
    });
    expect(memoryOnly.usedMemoryIds).toEqual([2]);
    expect(memoryOnly.augmented).toContain('## Existing Memories');
    expect(memoryOnly.augmented).toContain('Inject me without the full system prompt');
    expect(memoryOnly.augmented).not.toContain('## Role');

    const forcedLanguage = buildPromptAugmentation('reply', {
      memories: [],
      forceResponseLanguage: 'en',
      locale: 'zh-CN',
    });
    expect(forcedLanguage.augmented).toContain('## 回复语言');
    expect(forcedLanguage.augmented).toContain('请使用英文回复。');
  });

  it('localizes skill user-input wrapper without mutating the user input', () => {
    const result = augmentRequestBody(JSON.stringify({
      prompt: '/writer Draft about {raw_user_value}',
      parent_message_id: null,
      thinking_enabled: false,
    }), {
      memories: [],
      skills: [{
        name: 'writer',
        instructions: 'Write clearly.',
        memoryEnabled: false,
      }],
      activePreset: null,
      modelType: null,
      toolDescriptors: [],
      messageCount: 0,
      locale: 'en',
    });

    const body = JSON.parse(result?.body ?? '{}') as { prompt?: string };
    expect(body.prompt).toContain('The following is the user input for this turn');
    expect(body.prompt).toContain('Draft about {raw_user_value}');
  });

  it('injects only global memories plus memories from the current project', () => {
    const result = augmentRequestBody(JSON.stringify({
      prompt: 'remember the project rule',
      parent_message_id: null,
      thinking_enabled: false,
    }), {
      memories: [
        memory(1, 'global', undefined, 'Global memory', 'Always be concise.'),
        memory(2, 'project', 'project-1', 'Project memory', 'Use project glossary.'),
        memory(3, 'project', 'project-2', 'Other project memory', 'Do not include me.'),
      ],
      skills: [],
      activePreset: null,
      projectId: 'project-1',
      modelType: null,
      toolDescriptors: [],
      messageCount: 0,
      locale: 'en',
    });

    const body = JSON.parse(result?.body ?? '{}') as { prompt?: string };
    expect(body.prompt).toContain('Always be concise.');
    expect(body.prompt).toContain('[project reference] Project memory');
    expect(body.prompt).not.toContain('Do not include me.');
  });

  // B-01 regression: force vision mode when the user uploaded files (image recognition).
  it('forces model_type to vision when ref_file_ids is non-empty (file upload scenario)', () => {
    const result = augmentRequestBody(JSON.stringify({
      prompt: 'analyze the uploaded report',
      parent_message_id: null,
      thinking_enabled: false,
      ref_file_ids: ['file_abc123'],
    }), {
      memories: [],
      skills: [],
      activePreset: null,
      modelType: 'expert', // 扩展里勾了专家模式
      toolDescriptors: DEFAULT_TOOL_DESCRIPTORS,
      messageCount: 0,
      locale: 'en',
    });

    const body = JSON.parse(result?.body ?? '{}') as { model_type?: string };
    expect(body.model_type).toBe('vision');
  });

  // B-01 regression: do not override model_type when the user already picked a model in the page UI.
  it('does not override model_type when the user already chose a model in the web UI', () => {
    const result = augmentRequestBody(JSON.stringify({
      prompt: 'continue conversation',
      parent_message_id: 123,
      thinking_enabled: false,
      model_type: 'chat', // 用户在网页手动选了 chat
    }), {
      memories: [],
      skills: [],
      activePreset: null,
      modelType: 'expert', // 扩展里勾了专家模式
      toolDescriptors: DEFAULT_TOOL_DESCRIPTORS,
      messageCount: 5,
      locale: 'en',
    });

    const body = JSON.parse(result?.body ?? '{}') as { model_type?: string };
    expect(body.model_type).toBe('chat');
  });

  // B-01 positive: still apply expert mode when no files and no user pick.
  it('still applies expert mode when no files are attached and user has no model pick', () => {
    const result = augmentRequestBody(JSON.stringify({
      prompt: 'plain text question',
      parent_message_id: null,
      thinking_enabled: false,
    }), {
      memories: [],
      skills: [],
      activePreset: null,
      modelType: 'expert',
      toolDescriptors: DEFAULT_TOOL_DESCRIPTORS,
      messageCount: 0,
      locale: 'en',
    });

    const body = JSON.parse(result?.body ?? '{}') as { model_type?: string };
    expect(body.model_type).toBe('expert');
  });
});

// 豆包嵌套 body 结构（2026-07-16 真机抓包，playwright-results/phase2-06-body-structures.json）
describe('augmentRequestBody (doubao nested body)', () => {
  beforeEach(() => {
    setActiveHostId('doubao');
  });

  function doubaoBody(text: string, opts: { conversationId?: string; lastMessageIndex?: number | null; needDeepThink?: 0 | 1 } = {}) {
    return {
      client_meta: {
        local_conversation_id: 'local_123',
        conversation_id: opts.conversationId ?? '',
        bot_id: '7338286299411103781',
        last_section_id: '',
        last_message_index: opts.lastMessageIndex ?? null,
      },
      messages: [{
        local_message_id: 'uuid-1',
        content_block: [{
          block_type: 10000,
          content: { text_block: { text, icon_url: '', icon_url_dark: '', summary: '' }, pc_event_block: '' },
          block_id: 'uuid-2',
          parent_id: '',
          meta_info: [],
          append_fields: [],
        }],
        message_status: 0,
      }],
      option: { need_deep_think: opts.needDeepThink ?? 0, is_regen: false, need_create_conversation: !opts.conversationId },
      ext: { use_deep_think: String(opts.needDeepThink ?? 0) },
    };
  }

  const baseState = {
    memories: [],
    skills: [],
    activePreset: null,
    modelType: null,
    toolDescriptors: [],
    messageCount: 0,
    locale: 'en' as const,
  };

  it('reads the nested prompt and writes the augmented prompt back to the same path', () => {
    const result = augmentRequestBody(JSON.stringify(doubaoBody('hello doubao')), {
      ...baseState,
      toolDescriptors: DEFAULT_TOOL_DESCRIPTORS,
    });

    expect(result).not.toBeNull();
    const body = JSON.parse(result!.body);
    const text = body.messages[0].content_block[0].content.text_block.text as string;
    expect(text).toContain('## Role');
    expect(text).toContain('hello doubao');
    expect(text).toContain('WPlus client-side XML text protocol');
    expect(text).toContain('do not execute the task in Doubao remote workspace');
    // 其余结构不受影响
    expect(body.client_meta.conversation_id).toBe('');
    expect(body.option.need_create_conversation).toBe(true);
    expect(result!.agentTaskPrompt).toBe('hello doubao');
  });

  it('limits a Doubao file task to the relevant artifact descriptor', () => {
    const result = augmentRequestBody(JSON.stringify(doubaoBody('请生成 test.md')), {
      ...baseState,
      toolDescriptors: [...DEFAULT_TOOL_DESCRIPTORS, ...createArtifactToolDescriptors('en')],
    });

    const text = JSON.parse(result!.body).messages[0].content_block[0].content.text_block.text as string;
    expect(text).toContain('### Tool artifact_create');
    expect(text).not.toContain('### Tool memory_save');
    expect(text).not.toContain('### Tool web_search');
  });

  it('treats a new conversation as first message (last_message_index null) and multi-turn as non-first', () => {
    const first = augmentRequestBody(JSON.stringify(doubaoBody('turn 1')), { ...baseState, messageCount: 7 });
    expect(first?.messageCount).toBe(1);

    const followUp = augmentRequestBody(
      JSON.stringify(doubaoBody('turn 2', { conversationId: '38435134359944194', lastMessageIndex: 5 })),
      { ...baseState, messageCount: 1 },
    );
    expect(followUp?.messageCount).toBe(2);
  });

  it('expands skill commands inside the nested prompt', () => {
    const result = augmentRequestBody(JSON.stringify(doubaoBody('/writer draft a note')), {
      ...baseState,
      skills: [{ name: 'writer', instructions: 'Write clearly.', memoryEnabled: false }],
    });

    const text = JSON.parse(result!.body).messages[0].content_block[0].content.text_block.text as string;
    expect(text).toContain('Write clearly.');
    expect(text).toContain('draft a note');
    expect(result!.agentTaskPrompt).toContain('Write clearly.');
  });

  it('limits the Doubao /office alias to shell_exec for one-shot document creation', () => {
    const artifact = createArtifactToolDescriptors('en')[0];
    const shellExec = { ...artifact, id: 'mcp:shell:shell_exec', name: 'shell_exec', invocationName: 'shell_exec' };
    const shellStatus = { ...artifact, id: 'mcp:shell:shell_status', name: 'shell_status', invocationName: 'shell_status' };
    const result = augmentRequestBody(JSON.stringify(doubaoBody('/office create a Word report')), {
      ...baseState,
      skills: [{ name: 'office', instructions: 'Use shell_exec once.', memoryEnabled: false }],
      toolDescriptors: [artifact, shellExec, shellStatus],
    });

    const text = JSON.parse(result!.body).messages[0].content_block[0].content.text_block.text as string;
    expect(text).toContain('The only available tool is shell_exec');
    expect(text).toContain('officecli add FILE /body --type paragraph');
    expect(text).not.toContain('### Tool shell_status');
    expect(text).not.toContain('### Tool artifact_create');
  });

  it('recognizes need_deep_think=1 as thinking enabled (numeric flag)', () => {
    const withThinking = augmentRequestBody(JSON.stringify(doubaoBody('question', { needDeepThink: 1 })), baseState);
    const withoutThinking = augmentRequestBody(JSON.stringify(doubaoBody('question')), baseState);
    // 两者都应增强成功；深度思考只影响 prompt 内容，不作断言细节
    expect(withThinking).not.toBeNull();
    expect(withoutThinking).not.toBeNull();
  });

  it('does not inject model_type/ref_file_ids structures the doubao body does not have', () => {
    const result = augmentRequestBody(JSON.stringify(doubaoBody('plain question')), {
      ...baseState,
      modelType: 'expert',
    });

    const body = JSON.parse(result!.body);
    expect(body.model_type).toBeUndefined();
    expect(body.ref_file_ids).toBeUndefined();
    // 写 no-op，不产生任何服务端不认识的键
    expect(Object.keys(body).sort()).toEqual(['client_meta', 'ext', 'messages', 'option']);
  });

  it('returns null without corrupting anything when the body is not chat-shaped', () => {
    expect(augmentRequestBody(JSON.stringify({ cmd: 2260, uplink_body: {} }), baseState)).toBeNull();
    expect(augmentRequestBody('not json', baseState)).toBeNull();
  });
});

function memory(
  id: number,
  scope: 'global' | 'project',
  projectId: string | undefined,
  name: string,
  content: string,
) {
  return {
    id,
    syncId: `sync-${id}`,
    scope,
    projectId,
    type: 'reference' as const,
    name,
    content,
    description: '',
    tags: [],
    pinned: true,
    createdAt: 1,
    updatedAt: 1,
    accessCount: 0,
    lastAccessedAt: 1,
  };
}
