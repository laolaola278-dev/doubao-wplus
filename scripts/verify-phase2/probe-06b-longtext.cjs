// scripts/verify-phase2/probe-06b-longtext.cjs
// 补采 S4 长文本场景（probe-06 中逐字输入超时，改用 fill 一次性写入）
const path = require('path');
const fs = require('fs');
const {
  RESULTS_DIR,
  launch,
  installCdpCapture,
  waitForReplyStable,
} = require('./lib.cjs');

(async () => {
  const { ctx, page } = await launch();
  const { wire, fillPostData } = await installCdpCapture(ctx, page);

  await page.goto('https://www.doubao.com/chat/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(6000);

  const marker = 'P6S4b标记' + Math.floor(Math.random() * 10000);
  const longText = `${marker} 请回答"收到"两字即可。` + '天地玄黄，宇宙洪荒。日月盈昃，辰宿列张。'.repeat(140);
  console.log('TEXT_LENGTH:', longText.length);

  const ta = page.locator('textarea').first();
  await ta.click();
  await ta.fill(longText); // 一次性写入，触发 React onChange
  await page.waitForTimeout(800);
  const btn = page.locator('div[class*="send-btn"] button, button[data-testid*="send"]').first();
  try {
    await btn.click({ timeout: 3000 });
  } catch {
    await page.keyboard.press('Enter');
  }
  await waitForReplyStable(page, { timeoutMs: 90000 });
  await fillPostData();

  const reqs = wire.filter((r) => r.url.includes('/chat/completion'));
  const out = reqs.map((r) => {
    let parsed = null;
    let promptPath = null;
    let textLen = null;
    try {
      parsed = JSON.parse(r.postData);
      const t = parsed?.messages?.[0]?.content_block?.[0]?.content?.text_block?.text;
      if (typeof t === 'string' && t.includes(marker)) {
        promptPath = 'messages[0].content_block[0].content.text_block.text';
        textLen = t.length;
      }
      // 也检查是否存在文件引用型结构（长文本是否被转为附件）
    } catch {}
    return {
      url: r.url.slice(0, 100),
      status: r.status,
      bodyLength: r.postData ? r.postData.length : null,
      promptPath,
      textLen,
      contentBlockCount: parsed?.messages?.[0]?.content_block?.length ?? null,
      blockTypes: parsed?.messages?.[0]?.content_block?.map((b) => b.block_type) ?? null,
    };
  });
  fs.writeFileSync(path.resolve(RESULTS_DIR, 'phase2-06b-longtext.json'), JSON.stringify({ marker, textLength: longText.length, requests: out }, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await ctx.close();
})().catch((e) => {
  console.error('FATAL:', e.stack || e.message);
  process.exit(1);
});
