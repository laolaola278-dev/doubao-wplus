// tests/host-selector-utils.test.ts
// 选择器 fallback 工具函数测试

import { describe, expect, it } from 'vitest';
import { queryFirst, queryAll } from '../core/hosts/shared/selector-utils';

function makeRoot(html: string): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = html;
  document.body.appendChild(div);
  return div;
}

describe('queryFirst', () => {
  it('返回第一个命中的元素', () => {
    const root = makeRoot('<div class="a"></div><div class="b"></div>');
    const el = queryFirst(['.a', '.b'], root);
    expect(el?.className).toBe('a');
  });

  it('首选不命中则回退到下一个', () => {
    const root = makeRoot('<div class="b"></div>');
    const el = queryFirst(['.a', '.b'], root);
    expect(el?.className).toBe('b');
  });

  it('全部不命中返回 null', () => {
    const root = makeRoot('<div></div>');
    expect(queryFirst(['.a', '.b'], root)).toBeNull();
  });

  it('跳过非法选择器', () => {
    const root = makeRoot('<div class="real"></div>');
    const el = queryFirst([':::invalid:::', '.real'], root);
    expect(el).not.toBeNull();
    expect(el?.className).toBe('real');
  });

  it('空数组返回 null', () => {
    const root = makeRoot('<div></div>');
    expect(queryFirst([], root)).toBeNull();
  });
});

describe('queryAll', () => {
  it('返回第一个有结果的数组（按优先级）', () => {
    const root = makeRoot('<span class="x"></span><span class="y"></span>');
    const els = queryAll(['.none', '.x', '.y'], root);
    expect(els).toHaveLength(1);
    expect(els[0]?.className).toBe('x');
  });

  it('全部不命中返回空数组', () => {
    const root = makeRoot('<div></div>');
    expect(queryAll(['.a', '.b'], root)).toEqual([]);
  });

  it('跳过非法选择器', () => {
    const root = makeRoot('<i class="ok"></i>');
    const els = queryAll([':::bad:::', '.ok'], root);
    expect(els).toHaveLength(1);
  });
});

describe('选择器稳定性 — 豆包 DOM 改版 fallback', () => {
  it('首选选择器失效时，回退到通用选择器', () => {
    // 模拟豆包改版：data-testid 选择器失效，回退到属性包含
    const root = makeRoot('<textarea class="semi-input-textarea"></textarea>');
    const el = queryFirst(
      [
        'textarea[data-testid="new-version"]',  // 新版，未命中
        'textarea.semi-input-textarea',         // 旧版，命中
      ],
      root,
    );
    expect(el).not.toBeNull();
    expect(el?.tagName.toLowerCase()).toBe('textarea');
  });
});
