/**
 * 手工端到端冒烟：
 * 1) 落一个真实的 .docx-like 二进制（zip 头 + 几个段落）到 /tmp
 * 2) 启 mock 服务，校验 multipart 字段、boundary、ref_file_id 解析
 * 3) 调生产代码 `uploadAttachedFile`，readFileImpl 走 Node fs
 * 4) 打印 mock 服务收到的字节数 / 解析后的 ref_file_id
 */
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uploadAttachedFile, UPLOAD_ATTACHED_FILE_DEFAULT_FIELD, UPLOAD_ATTACHED_FILE_BYPASS_HEADER } from '../core/shell/attached-file-uploader';

async function startMock(): Promise<{ server: Server; baseUrl: string; record: { fields: Array<{ name: string; filename: string; contentType: string | null; bytes: number }>; bypass: string | null; boundary: string | null } }> {
  const record = { fields: [] as Array<{ name: string; filename: string; contentType: string | null; bytes: number }>, bypass: null as string | null, boundary: null as string | null };
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const rawCt = req.headers['content-type'];
      const contentType = Array.isArray(rawCt) ? rawCt[0] : rawCt;
      record.bypass = (Array.isArray(req.headers['x-dwplus-bypass-hook']) ? req.headers['x-dwplus-bypass-hook'][0] : req.headers['x-dwplus-bypass-hook']) ?? null;
      const boundaryMatch = /boundary=([^;]+)/.exec(contentType ?? '');
      const boundary = boundaryMatch ? boundaryMatch[1]?.trim().replace(/^"|"$/g, '') : null;
      record.boundary = boundary ?? null;
      if (boundary) {
        const text = body.toString('binary');
        const sep = `--${boundary}`;
        const parts = text.split(sep).slice(1, -1);
        for (const part of parts) {
          const trimmed = part.replace(/^\r\n/, '').replace(/\r\n$/, '');
          const headerEnd = trimmed.indexOf('\r\n\r\n');
          if (headerEnd < 0) continue;
          const headerBlock = trimmed.slice(0, headerEnd);
          const content = trimmed.slice(headerEnd + 4);
          const disposition = /Content-Disposition: form-data; name="([^"]+)"(?:; filename="([^"]+)")?/.exec(headerBlock);
          const type = /Content-Type: ([^\r\n]+)/.exec(headerBlock);
          if (disposition) {
            record.fields.push({
              name: disposition[1] ?? '',
              filename: disposition[2] ?? '',
              contentType: type ? (type[1] ?? null) : null,
              bytes: content.length,
            });
          }
        }
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ biz_data: { id: 'file_e2e_smoke_001' } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return { server, baseUrl: `http://127.0.0.1:${port}`, record };
}

async function main() {
  // 1) 造一个真实二进制（zip 头 + 假 docx 内容）
  const localPath = join(tmpdir(), 'dwplus-smoke-report.docx');
  // 简单构造：PK\x03\x04 zip 头 + 一段正文
  const payload = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]), // zip magic
    Buffer.from('fake-docx-content-for-e2e-smoke-'),
    Buffer.alloc(2048, 0x61), // 2KB 的 'a'
  ]);
  writeFileSync(localPath, payload);
  const size = statSync(localPath).size;
  console.log(`[smoke] wrote fake docx: ${localPath} (${size} bytes)`);

  // 2) 启 mock
  const { server, baseUrl, record } = await startMock();
  console.log(`[smoke] mock listening at ${baseUrl}`);

  try {
    // 3) 走生产 uploadAttachedFile，readFileImpl 走 Node fs
    const result = await uploadAttachedFile({
      localPath,
      readFileImpl: async (p) => {
        const fs = await import('node:fs/promises');
        const buf = await fs.readFile(p);
        const sep = p.includes('\\') ? '\\' : '/';
        const name = p.split(sep).pop() || p;
        return { name, sizeBytes: buf.byteLength, mimeType: null, bytes: new Uint8Array(buf) };
      },
      fetchImpl: globalThis.fetch,
      baseUrl,
      uploadPath: '/api/v0/file/upload',
    });

    // 4) 报告
    console.log('[smoke] uploadAttachedFile result:', JSON.stringify(result, null, 2));
    console.log('[smoke] mock record:');
    console.log('  - bypass header:', record.bypass);
    console.log('  - boundary:', record.boundary);
    console.log('  - fields:', record.fields);
    console.log('  - expected field:', UPLOAD_ATTACHED_FILE_DEFAULT_FIELD);
    console.log('  - expected bypass header:', UPLOAD_ATTACHED_FILE_BYPASS_HEADER);

    // 5) 断言
    let pass = true;
    if (!result.ok) { console.error('[smoke] FAIL: result.ok = false'); pass = false; }
    if (result.ok && result.refFileId !== 'file_e2e_smoke_001') { console.error('[smoke] FAIL: ref_file_id mismatch'); pass = false; }
    if (record.bypass !== '1') { console.error('[smoke] FAIL: bypass header missing'); pass = false; }
    if (!record.boundary) { console.error('[smoke] FAIL: boundary missing'); pass = false; }
    const fileField = record.fields.find((f) => f.name === UPLOAD_ATTACHED_FILE_DEFAULT_FIELD);
    if (!fileField) { console.error('[smoke] FAIL: file field missing'); pass = false; }
    else if (fileField.bytes !== size) { console.error(`[smoke] FAIL: file bytes mismatch (got ${fileField.bytes}, want ${size})`); pass = false; }
    console.log(pass ? '[smoke] PASS' : '[smoke] FAIL');
    process.exitCode = pass ? 0 : 1;
  } finally {
    server.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
