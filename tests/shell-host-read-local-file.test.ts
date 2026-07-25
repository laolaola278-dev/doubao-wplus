import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const testDir = dirname(fileURLToPath(import.meta.url));
const hostPath = resolve(testDir, '../packages/shell-host/native/shell-mcp-host.mjs');
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('shell native host read_local_file', () => {
  it('reads a real file and returns base64 bytes matching the source', async () => {
    const root = mkdtempSync(join(tmpdir(), 'deepseek-pp-read-local-'));
    tempRoots.push(root);
    const payload = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x68, 0x65, 0x6c, 0x6c, 0x6f]); // zip 头 + hello
    const file = join(root, 'sample.docx');
    writeFileSync(file, payload);

    const response = await callNativeHost({
      method: 'tools/call',
      id: 'read-1',
      params: { name: 'read_local_file', arguments: { local_path: file } },
    });
    expect(response.error).toBeUndefined();
    const data = response.result?.structuredContent?.data;
    expect(data).toBeTruthy();
    expect(data?.localPath).toBe(file);
    expect(data?.fileName).toBe('sample.docx');
    expect(data?.sizeBytes).toBe(payload.byteLength);
    expect(data?.truncated).toBe(false);
    const decoded = Buffer.from(data?.contentBase64 ?? '', 'base64');
    expect(decoded.equals(payload)).toBe(true);
  });

  it('rejects empty local_path with isError=true', async () => {
    const response = await callNativeHost({
      method: 'tools/call',
      id: 'read-2',
      params: { name: 'read_local_file', arguments: { local_path: '' } },
    });
    expect(response.error).toBeUndefined();
    expect(response.result?.isError).toBe(true);
    const text = response.result?.content?.[0]?.text ?? '';
    expect(text).toMatch(/local_path is required/);
  });

  it('rejects missing files with isError=true', async () => {
    const response = await callNativeHost({
      method: 'tools/call',
      id: 'read-3',
      params: { name: 'read_local_file', arguments: { local_path: 'C:/no/such/file.docx' } },
    });
    expect(response.error).toBeUndefined();
    expect(response.result?.isError).toBe(true);
    const text = response.result?.content?.[0]?.text ?? '';
    expect(text).toMatch(/Cannot stat|ENOENT|no such file/i);
  });

  it('rejects directories (only regular files allowed)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'deepseek-pp-read-local-dir-'));
    tempRoots.push(root);
    const response = await callNativeHost({
      method: 'tools/call',
      id: 'read-4',
      params: { name: 'read_local_file', arguments: { local_path: root } },
    });
    expect(response.error).toBeUndefined();
    expect(response.result?.isError).toBe(true);
    const text = response.result?.content?.[0]?.text ?? '';
    expect(text).toMatch(/not a regular file/);
  });

  it('honours max_bytes and rejects files that exceed the limit', async () => {
    const root = mkdtempSync(join(tmpdir(), 'deepseek-pp-read-local-big-'));
    tempRoots.push(root);
    const payload = Buffer.alloc(1024, 0x61); // 1KB of 'a'
    const file = join(root, 'big.bin');
    writeFileSync(file, payload);

    const response = await callNativeHost({
      method: 'tools/call',
      id: 'read-5',
      params: { name: 'read_local_file', arguments: { local_path: file, max_bytes: 64 } },
    });
    expect(response.error).toBeUndefined();
    expect(response.result?.isError).toBe(true);
    const text = response.result?.content?.[0]?.text ?? '';
    expect(text).toMatch(/exceeds the 64-byte limit/);
  });

  it('exposes read_local_file in the tools/list response', async () => {
    const response = await callNativeHost({ method: 'tools/list', id: 'list-1' });
    expect(response.error).toBeUndefined();
    const tools = response.result?.tools;
    expect(Array.isArray(tools)).toBe(true);
    const found = tools.find((t: { name: string }) => t.name === 'read_local_file');
    expect(found).toBeTruthy();
    expect(found?.inputSchema?.required).toEqual(['local_path']);
    expect(found?.annotations?.risk).toBe('medium');
  });
});

async function callNativeHost(message: { method: string; id: string; params?: unknown }) {
  const child = spawn(process.execPath, [hostPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = Buffer.alloc(0);
  let stderr = '';
  let settled = false;

  const response = await new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`Native host timed out. stderr: ${stderr}`));
    }, 10_000);

    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = Buffer.concat([stdout, chunk]);
      const message = tryReadNativeMessage(stdout);
      if (!message || settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.end();
      resolve(message);
    });
    child.on('error', (error) => { if (settled) return; settled = true; clearTimeout(timer); reject(error); });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Native host exited before responding (${code}). stderr: ${stderr}`));
    });

    child.stdin.end(createNativeFrame({
      protocol: 'dwplus-mcp-native',
      version: 1,
      message: { jsonrpc: '2.0', ...message },
    }));
  });

  child.kill();
  return response;
}

function createNativeFrame(envelope: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(envelope), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

function tryReadNativeMessage(buffer: Buffer): any | null {
  if (buffer.length < 4) return null;
  const length = buffer.readUInt32LE(0);
  if (buffer.length < 4 + length) return null;
  return JSON.parse(buffer.subarray(4, 4 + length).toString('utf8'));
}
