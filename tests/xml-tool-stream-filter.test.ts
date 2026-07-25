import { describe, expect, it } from 'vitest';
import { createArtifactToolDescriptors } from '../core/artifact';
import { createBufferedSSEParser, XmlToolStreamFilter } from '../core/interceptor/fetch-hook';
import { extractResponseTextFromParsed, parseSSEChunk, parseSSEData } from '../core/interceptor/sse-parser';

describe('XmlToolStreamFilter', () => {
  it('strips whitespace-padded artifact tags with large canvas HTML across SSE events', () => {
    const html = [
      '<!doctype html><html><body><canvas id="stage"></canvas>',
      '<script>',
      'const ctx = document.getElementById("stage").getContext("2d");'.repeat(3000),
      '</script></body></html>',
    ].join('');
    const payload = JSON.stringify({
      filename: 'canvas-design.html',
      content: html,
      language: 'html',
      previewMode: 'html',
    });

    const output = runFilter([
      sseText('Intro < artifact'),
      sseText('_create >' + payload.slice(0, 10_000)),
      sseText(payload.slice(10_000, 80_000)),
      sseText(payload.slice(80_000) + '</ artifact'),
      sseText('_create > done'),
    ]);

    expect(output).not.toContain('artifact_create');
    expect(output).not.toContain('<canvas');
    expect(output).not.toContain('getContext');
    expect(readVisibleText(output)).toBe('Intro  done');
  });

  it('keeps response fragment structure while suppressing a streamed artifact body', () => {
    const payload = JSON.stringify({
      filename: 'fragment-demo.html',
      content: '<!doctype html><canvas></canvas>',
      language: 'html',
    });

    const output = runFilter([
      sseFragment('Before < artifact'),
      sseFragment('_create >' + payload),
      sseFragment('</ artifact_create > after'),
    ]);

    expect(output).toContain('"p":"response/fragments"');
    expect(output).not.toContain('fragment-demo.html');
    expect(output).not.toContain('<canvas');
    expect(readVisibleText(output)).toBe('Before  after');
  });

  it('buffers partial SSE events before parsing full-text stream state', () => {
    const parsed: unknown[] = [];
    const parser = createBufferedSSEParser((event) => parsed.push(event));
    const event = sseText('Split event text');

    parser.append(event.slice(0, 8));
    parser.append(event.slice(8, 21));
    expect(parsed).toEqual([]);

    parser.append(event.slice(21));
    expect(parsed).toHaveLength(1);
    expect(extractResponseTextFromParsed(parsed[0])).toBe('Split event text');
  });

  it('extracts assistant text from Doubao STREAM_CHUNK content blocks', () => {
    const parsed = parseSSEData(JSON.stringify(createDoubaoStreamChunk('Doubao text')));
    expect(extractResponseTextFromParsed(parsed)).toBe('Doubao text');
    expect(extractResponseTextFromParsed({ text: ' delta' })).toBe(' delta');
  });

  it('detects and suppresses streamed artifact XML in Doubao content blocks', () => {
    const output = runFilter([
      doubaoInitial('Before <'),
      doubaoText('artifact'),
      doubaoDelta('_create>{"filename":"test.md","content":"ok"}</artifact'),
      doubaoDelta('_create> after'),
    ]);

    expect(output).not.toContain('"filename":"test.md"');
    expect(readVisibleText(output)).toBe('Before  after');
  });

  it('ignores tool-like XML in Doubao reasoning blocks and filters the final answer block', () => {
    const output = runFilter([
      doubaoReasoning('<artifact_create>{"filename":"reasoning.md"', 'planning'),
      doubaoDelta(',"content":"not executable"}</artifact_create>'),
      doubaoInitial('<artifact_create>'),
      doubaoDelta('{"filename":"final.md","content":"execute"}</artifact_create>'),
    ]);

    expect(output).toContain('reasoning.md');
    expect(output).not.toContain('final.md');
  });

  it('replaces the augmented Doubao user-message echo with the visible prompt', () => {
    const output = runFilter([
      `event: FULL_MSG_NOTIFY\ndata: ${JSON.stringify({
        message: {
          user_type: 1,
          content: JSON.stringify([{
            block_type: 10000,
            content: { text_block: { text: '## Role\ninternal instructions\n<!-- deepseek-pp-visible-user-prompt:start -->\n请生成 test.md\n<!-- deepseek-pp-visible-user-prompt:end -->' } },
          }]),
        },
      })}\n\n`,
    ], '请生成 test.md');

    expect(output).toContain('请生成 test.md');
    expect(output).not.toContain('internal instructions');
  });
});

function runFilter(chunks: string[], visiblePrompt = ''): string {
  const filter = new XmlToolStreamFilter(createArtifactToolDescriptors('en'), visiblePrompt);
  const decoder = new TextDecoder();
  const output: string[] = [];
  const controller = {
    enqueue(data: Uint8Array) {
      output.push(decoder.decode(data));
    },
  } as ReadableStreamDefaultController<Uint8Array>;

  for (const chunk of chunks) {
    filter.processChunk(chunk, controller);
  }
  filter.flush(controller);
  return output.join('');
}

function sseText(text: string): string {
  return `data: ${JSON.stringify({ p: 'response/content', o: 'APPEND', v: text })}\n\n`;
}

function sseFragment(text: string): string {
  return `data: ${JSON.stringify({ p: 'response/fragments', o: 'APPEND', v: [{ content: text }] })}\n\n`;
}

function doubaoText(text: string): string {
  return `event: STREAM_CHUNK\ndata: ${JSON.stringify(createDoubaoStreamChunk(text))}\n\n`;
}

function doubaoInitial(text: string): string {
  return `event: STREAM_MSG_NOTIFY\ndata: ${JSON.stringify({
    content: {
      content_block: [{ block_type: 10000, content: { text_block: { text } } }],
    },
  })}\n\n`;
}

function doubaoDelta(text: string): string {
  return `event: CHUNK_DELTA\ndata: ${JSON.stringify({ text })}\n\n`;
}

function doubaoReasoning(text: string, summary: string): string {
  return `event: STREAM_CHUNK\ndata: ${JSON.stringify({
    message_id: 'assistant-1',
    patch_op: [{
      patch_object: 1,
      patch_type: 1,
      patch_value: {
        content_block: [{
          block_type: 10000,
          block_id: 'reasoning-1',
          content: { text_block: { text, summary } },
          is_finish: false,
          patch_type: 1,
        }],
      },
    }],
  })}\n\n`;
}

function createDoubaoStreamChunk(text: string) {
  return {
    message_id: 'assistant-1',
    patch_op: [{
      patch_object: 1,
      patch_type: 1,
      patch_value: {
        content_block: [{
          block_type: 10000,
          content: { text_block: { text } },
          is_finish: false,
          patch_type: 1,
        }],
      },
    }],
  };
}

function readVisibleText(output: string): string {
  return parseSSEChunk(output)
    .map((event) => parseSSEData(event.data))
    .map((parsed) => extractResponseTextFromParsed(parsed))
    .filter((text): text is string => text !== null)
    .join('');
}
