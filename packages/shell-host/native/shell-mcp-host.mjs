#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  arch,
  homedir,
  hostname,
  platform,
  release as osRelease,
  tmpdir,
  type as osType,
  version as osVersion,
} from 'node:os';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';

// Resolve package root from this script's location (native/ -> package root).
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

// Ensure child processes can find node and project binaries via PATH.
// Chrome-launched native hosts inherit a minimal PATH that often excludes
// Homebrew/nvm/fnm directories, breaking #!/usr/bin/env node shebangs.
const nodeBinDir = dirname(process.execPath);
const localBinDirs = [
  resolve(PROJECT_ROOT, 'node_modules', '.bin'),
  resolve(PROJECT_ROOT, '..', '..', 'node_modules', '.bin'),
].filter(existsSync);
const PATH_SEPARATOR = platform() === 'win32' ? ';' : ':';
const currentPath = getEnvironmentPath(process.env) || (platform() === 'win32' ? '' : '/usr/bin:/bin');
const localAppData = process.env.LOCALAPPDATA || resolve(homedir(), 'AppData', 'Local');
const userBinDirs = platform() === 'win32'
  ? [resolve(localAppData, 'OfficeCLI')]
  : [
      resolve(homedir(), '.local', 'bin'),
      resolve(homedir(), '.pyenv', 'shims'),
      resolve(homedir(), 'miniconda3', 'bin'),
      resolve(homedir(), 'anaconda3', 'bin'),
      resolve(homedir(), 'miniforge3', 'bin'),
      resolve(homedir(), 'mambaforge', 'bin'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
    ];
const POWERSHELL_EXE = resolvePowerShellExe();
const managedPathDirs = new Set([nodeBinDir, ...localBinDirs, ...userBinDirs]);
const existingPathDirs = splitPath(currentPath).filter(d => !managedPathDirs.has(d));
const hostPath = dedupePathDirs([
  nodeBinDir,
  ...userBinDirs,
  ...readWindowsUserMachinePathDirs(),
  ...existingPathDirs,
  ...localBinDirs,
]).join(PATH_SEPARATOR);
setEnvironmentPath(process.env, hostPath);

const MCP_PROTOCOL_VERSION = '2025-06-18';
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 128_000;
const DEFAULT_PYTHON_TIMEOUT_MS = 10_000;
const MAX_PYTHON_TIMEOUT_MS = 30_000;
const MAX_PYTHON_CODE_BYTES = 60_000;
const MAX_PYTHON_OUTPUT_BYTES = 64_000;
const PYTHON_PACKAGE_CHECKS = ['numpy', 'pandas', 'sympy'];
const PYTHON_NOT_FOUND_MESSAGE = 'No local Python interpreter found. Tried environment variables, PATH entries, common paths, and python/python3/py --version.';
const MAX_LOCAL_SKILLS = 80;
const MAX_LOCAL_SKILL_BYTES = 120_000;
const MAX_LOCAL_RESOURCE_FILES_PER_SKILL = 16;
const MAX_LOCAL_RESOURCE_BYTES_PER_SKILL = 100_000;
const MAX_LOCAL_RESOURCE_FILE_BYTES = 40_000;
const MAX_LOCAL_TOTAL_CONTENT_BYTES = 420_000;
const MAX_READ_LOCAL_FILE_BYTES = 16 * 1024 * 1024; // 16 MB；与扩展侧 upload 上限（64 MB）保持安全差
const LOCAL_TEXT_RESOURCE_EXTENSIONS = new Set(['.md', '.txt', '.yaml', '.yml', '.json', '.tex']);
const LOCAL_SCRIPT_EXTENSIONS = new Set(['.py', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.sh', '.bash', '.zsh', '.ps1', '.rb', '.pl', '.php', '.lua', '.r']);
function resolvePowerShellExe() {
  if (platform() !== 'win32') return 'powershell.exe';
  const systemRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  const psPath = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (existsSync(psPath)) return psPath;
  const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pwshPath = join(programFiles, 'PowerShell', '7', 'pwsh.exe');
  if (existsSync(pwshPath)) return pwshPath;
  return 'powershell.exe';
}

const DEFAULT_SHELL = platform() === 'win32' ? POWERSHELL_EXE : process.env.SHELL || '/bin/sh';
const WINDOWS_POWERSHELL_UTF8_PREAMBLE = [
  '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)',
  '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
  '$OutputEncoding = [Console]::OutputEncoding',
  'try { chcp.com 65001 > $null } catch {}',
].join('; ');

const TOOL_DEFINITIONS = [
  {
    name: 'shell_exec',
    title: 'Execute Shell Command',
    description: 'Execute a command in the shell reported by shell_status. Returns stdout, stderr, and exit code.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute.' },
        cwd: { type: 'string', description: 'Working directory. Defaults to user home.' },
        env: { type: 'object', additionalProperties: { type: 'string' }, description: 'Additional environment variables to set.' },
        timeout_ms: { type: 'integer', minimum: 1000, maximum: 600000, description: 'Timeout in milliseconds. Default 120000.' },
      },
      required: ['command'],
      additionalProperties: false,
    },
    annotations: { operation: 'write', risk: 'high' },
  },
  {
    name: 'shell_status',
    title: 'Shell Host Status',
    description: 'Report host health, platform, shell, current working directory, and Node.js version.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { operation: 'read', risk: 'low' },
  },
  {
    name: 'python_status',
    title: 'Python Interpreter Status',
    description: 'Report whether a local Python interpreter is available and which quick-validation packages can be imported.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { operation: 'read', risk: 'low' },
  },
  {
    name: 'python_exec',
    title: 'Execute Python Code',
    description: 'Run short Python code for calculation, reasoning checks, and small data transformations. Do not install packages, access sensitive local files, or use network access.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Short Python code to execute. Keep it focused on computation or validation.' },
        timeout_ms: { type: 'integer', minimum: 1000, maximum: MAX_PYTHON_TIMEOUT_MS, description: 'Timeout in milliseconds. Default 10000.' },
      },
      required: ['code'],
      additionalProperties: false,
    },
    annotations: { operation: 'execute', risk: 'high' },
  },
  {
    name: 'local_skill_preview',
    title: 'Preview Local Skill Folder',
    description: 'Read SKILL.md files, nearby text resources, and script file manifests from a local Skill folder. Does not execute local code.',
    inputSchema: {
      type: 'object',
      properties: {
        rootPath: { type: 'string', description: 'Absolute local folder path that contains one or more SKILL.md files.' },
        selectedPaths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional SKILL.md paths relative to rootPath. When omitted, previews all detected Skills up to the limit.',
        },
      },
      required: ['rootPath'],
      additionalProperties: false,
    },
    annotations: { operation: 'read', risk: 'medium' },
  },
  {
    name: 'local_folder_pick',
    title: 'Pick Local Folder',
    description: 'Open the operating system folder picker and return the absolute path selected by the user.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Optional prompt shown in the native folder picker.' },
        defaultPath: { type: 'string', description: 'Optional local folder path to use as the initial picker location.' },
      },
      additionalProperties: false,
    },
    annotations: { operation: 'read', risk: 'low' },
  },
  {
    // B-08 输出回路的桥接工具：扩展需要把本机文件上传到 chat.deepseek.com
    // 但浏览器侧没有 file:// 权限。Native host 跑在用户机器上、有 fs 访问，
    // 由它读取文件内容（base64 编码）并回给扩展，扩展再走 fetch 上传。
    // 风险 medium：用户必须显式提供 local_path；size 有上限防滥用。
    name: 'read_local_file',
    title: 'Read Local File',
    description: '读取本机文件的原始字节（base64 编码），返回给调用方。常用于把 officecli 等工具生成的文档回传给浏览器侧的扩展，以便上传到 DeepSeek。',
    inputSchema: {
      type: 'object',
      properties: {
        local_path: {
          type: 'string',
          description: '本机绝对路径。',
        },
        max_bytes: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_READ_LOCAL_FILE_BYTES,
          description: '可选。允许读取的最大字节数；默认 ' + MAX_READ_LOCAL_FILE_BYTES + '。',
        },
      },
      required: ['local_path'],
      additionalProperties: false,
    },
    annotations: { operation: 'read', risk: 'medium' },
  },
];

// --- Native messaging framing (4-byte LE length prefix) ---

let buffer = Buffer.alloc(0);
let messageResolve = null;
const messageQueue = [];

function onStdinData(chunk) {
  buffer = Buffer.concat([buffer, chunk]);
  drainBuffer();
}

function drainBuffer() {
  while (true) {
    if (buffer.length < 4) return;
    const len = buffer.readUInt32LE(0);
    if (len === 0 || len > 10 * 1024 * 1024) {
      process.stderr.write(`[shell-mcp-host] Invalid message length: ${len}\n`);
      process.exit(1);
    }
    if (buffer.length < 4 + len) return;
    const json = buffer.subarray(4, 4 + len).toString('utf8');
    buffer = buffer.subarray(4 + len);
    try {
      const msg = JSON.parse(json);
      if (messageResolve) {
        const r = messageResolve;
        messageResolve = null;
        r(msg);
      } else {
        messageQueue.push(msg);
      }
    } catch (err) {
      process.stderr.write(`[shell-mcp-host] JSON parse error: ${err.message}\n`);
    }
  }
}

let stdinEnded = false;
const EOF = Symbol('EOF');

function readMessage() {
  if (messageQueue.length > 0) return Promise.resolve(messageQueue.shift());
  if (stdinEnded) return Promise.resolve(EOF);
  return new Promise((resolve) => { messageResolve = resolve; });
}

process.stdin.on('data', onStdinData);
process.stdin.on('end', () => {
  stdinEnded = true;
  if (messageResolve) {
    const r = messageResolve;
    messageResolve = null;
    r(EOF);
  }
});
process.stdin.on('error', () => {
  stdinEnded = true;
  if (messageResolve) {
    const r = messageResolve;
    messageResolve = null;
    r(EOF);
  }
});

function writeNativeMessage(message) {
  return new Promise((resolve) => {
    const json = JSON.stringify(message);
    const body = Buffer.from(json, 'utf8');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    process.stdout.write(header);
    process.stdout.write(body, resolve);
  });
}

// --- JSON-RPC helpers ---

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id, code, message, data) {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } };
}

// --- Request handlers ---

function handleInitialize(id) {
  return jsonRpcResult(id, {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: { tools: {} },
    serverInfo: { name: 'dwplus-shell', version: '1.0.0' },
    instructions: 'General-purpose shell execution host. Use shell_exec for local commands and python_exec only for short computation or validation snippets.',
  });
}

function handleListTools(id) {
  return jsonRpcResult(id, { tools: TOOL_DEFINITIONS });
}

async function handleCallTool(id, params) {
  const name = params?.name;
  const args = params?.arguments ?? {};

  if (name === 'shell_status') {
    return jsonRpcResult(id, {
      content: [{ type: 'text', text: `Shell host ready on ${platform()} ${arch()}` }],
      structuredContent: {
        ok: true,
        data: {
          platform: platform(),
          arch: arch(),
          osType: osType(),
          osRelease: osRelease(),
          osVersion: osVersion(),
          windowsVersion: getWindowsVersionLabel(),
          shell: DEFAULT_SHELL,
          cwd: homedir(),
          nodeVersion: process.version,
          hostname: hostname(),
          path: getEnvironmentPath(process.env),
          pathEntries: splitPath(getEnvironmentPath(process.env)),
        },
      },
    });
  }

  if (name === 'shell_exec') {
    const command = args.command;
    if (typeof command !== 'string' || command.trim().length === 0) {
      return jsonRpcResult(id, {
        isError: true,
        content: [{ type: 'text', text: 'command is required and must be a non-empty string.' }],
      });
    }

    const cwd = typeof args.cwd === 'string' && args.cwd.trim() ? args.cwd.trim() : homedir();
    const env = createChildEnv(args.env);
    const timeoutMs = typeof args.timeout_ms === 'number' && args.timeout_ms >= 1000
      ? Math.min(args.timeout_ms, 600_000)
      : DEFAULT_TIMEOUT_MS;

    try {
      const result = await execCommand(command, { cwd, env, timeoutMs });
      return jsonRpcResult(id, {
        content: [{ type: 'text', text: formatExecSummary(result) }],
        structuredContent: {
          ok: result.exitCode === 0,
          data: result,
        },
        isError: result.exitCode !== 0,
      });
    } catch (err) {
      return jsonRpcResult(id, {
        isError: true,
        content: [{ type: 'text', text: err.message }],
      });
    }
  }

  if (name === 'python_status') {
    return jsonRpcResult(id, await createPythonStatusResult());
  }

  if (name === 'python_exec') {
    return jsonRpcResult(id, await executePythonTool(args));
  }

  if (name === 'local_skill_preview') {
    return jsonRpcResult(id, createLocalSkillPreviewResult(args));
  }

  if (name === 'local_folder_pick') {
    return jsonRpcResult(id, createLocalFolderPickResult(args));
  }

  if (name === 'read_local_file') {
    return jsonRpcResult(id, createReadLocalFileResult(args));
  }

  return jsonRpcError(id, -32602, `Unknown tool: ${name}`);
}

// --- Local folder picker ---

function createLocalFolderPickResult(args) {
  const title = typeof args?.title === 'string' && args.title.trim()
    ? args.title.trim()
    : 'Choose a local Skill folder';
  const defaultPath = typeof args?.defaultPath === 'string' && args.defaultPath.trim()
    ? resolveFolderPickerDefault(args.defaultPath)
    : '';

  try {
    const selectedPath = pickLocalFolder({ title, defaultPath });
    const normalizedPath = resolveLocalPath(selectedPath);
    const selectedStat = safeStat(normalizedPath);
    if (!selectedStat || !selectedStat.isDirectory()) {
      throw new Error(`Selected path is not a readable directory: ${normalizedPath}`);
    }

    return {
      content: [{ type: 'text', text: `Selected local folder: ${normalizedPath}` }],
      structuredContent: {
        ok: true,
        data: { path: normalizedPath },
      },
    };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: normalizeFolderPickerError(err) }],
    };
  }
}

// B-08: 读取本机文件并以 base64 返回，供 upload_attached_file 工具回填到浏览器侧。
function createReadLocalFileResult(args) {
  const localPath = typeof args?.local_path === 'string' ? args.local_path.trim() : '';
  if (!localPath) {
    return {
      isError: true,
      content: [{ type: 'text', text: 'local_path is required and must be a non-empty string.' }],
    };
  }
  const resolved = resolveLocalPath(localPath);
  let stat;
  try {
    stat = statSync(resolved);
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Cannot stat local file: ${resolved} (${err.message})` }],
    };
  }
  if (!stat.isFile()) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Local path is not a regular file: ${resolved}` }],
    };
  }
  const requestedMax = typeof args?.max_bytes === 'number' && args.max_bytes > 0
    ? Math.min(Math.floor(args.max_bytes), MAX_READ_LOCAL_FILE_BYTES)
    : MAX_READ_LOCAL_FILE_BYTES;
  if (stat.size > requestedMax) {
    return {
      isError: true,
      content: [{
        type: 'text',
        text: `Local file exceeds the ${requestedMax}-byte limit (size=${stat.size}): ${resolved}`,
      }],
    };
  }
  let bytes;
  try {
    bytes = readFileSync(resolved);
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Cannot read local file: ${resolved} (${err.message})` }],
    };
  }
  const base64 = bytes.toString('base64');
  return {
    content: [{
      type: 'text',
      text: `Read local file ${resolved} (${bytes.byteLength} bytes)`,
    }],
    structuredContent: {
      ok: true,
      data: {
        localPath: resolved,
        fileName: basename(resolved),
        sizeBytes: bytes.byteLength,
        mimeType: null, // 由扩展侧按后缀推断
        contentBase64: base64,
        truncated: false,
      },
    },
  };
}

function pickLocalFolder({ title, defaultPath }) {
  const hostPlatform = platform();
  if (hostPlatform === 'darwin') return pickLocalFolderOnMac(title, defaultPath);
  if (hostPlatform === 'win32') return pickLocalFolderOnWindows(title, defaultPath);
  return pickLocalFolderOnLinux(title, defaultPath);
}

function pickLocalFolderOnMac(title, defaultPath) {
  const script = [
    'on run argv',
    '  set promptText to item 1 of argv',
    '  set defaultPath to item 2 of argv',
    '  if defaultPath is not "" then',
    '    set chosenFolder to choose folder with prompt promptText default location (POSIX file defaultPath)',
    '  else',
    '    set chosenFolder to choose folder with prompt promptText',
    '  end if',
    '  return POSIX path of chosenFolder',
    'end run',
  ].join('\n');
  return execFileSync('osascript', ['-e', script, title, defaultPath || ''], {
    encoding: 'utf8',
    timeout: DEFAULT_TIMEOUT_MS,
    windowsHide: true,
  }).trim();
}

function pickLocalFolderOnWindows(title, defaultPath) {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    '$dialog.Description = $args[0]',
    '$dialog.ShowNewFolderButton = $false',
    'if ($args.Count -gt 1 -and $args[1]) { $dialog.SelectedPath = $args[1] }',
    'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
    '  [Console]::Out.Write($dialog.SelectedPath)',
    '} else {',
    '  [Environment]::Exit(2)',
    '}',
  ].join('; ');
  return execFileSync(POWERSHELL_EXE, ['-NoProfile', '-STA', '-Command', script, title, defaultPath || ''], {
    encoding: 'utf8',
    timeout: DEFAULT_TIMEOUT_MS,
    windowsHide: false,
  }).trim();
}

function pickLocalFolderOnLinux(title, defaultPath) {
  const linuxPickers = [
    {
      command: 'zenity',
      args: ['--file-selection', '--directory', '--title', title, ...(defaultPath ? ['--filename', ensureTrailingPathSeparator(defaultPath)] : [])],
    },
    {
      command: 'kdialog',
      args: ['--getexistingdirectory', defaultPath || homedir(), '--title', title],
    },
  ];
  const missing = [];
  for (const picker of linuxPickers) {
    try {
      return execFileSync(picker.command, picker.args, {
        encoding: 'utf8',
        timeout: DEFAULT_TIMEOUT_MS,
        windowsHide: true,
      }).trim();
    } catch (err) {
      if (err?.code === 'ENOENT') {
        missing.push(picker.command);
        continue;
      }
      throw err;
    }
  }
  throw new Error(`No graphical folder picker is available. Install one of: ${missing.join(', ')}.`);
}

function resolveFolderPickerDefault(input) {
  const resolved = resolveLocalPath(input);
  const stat = safeStat(resolved);
  if (stat?.isDirectory()) return resolved;
  return homedir();
}

function ensureTrailingPathSeparator(value) {
  return value.endsWith('/') ? value : `${value}/`;
}

function normalizeFolderPickerError(err) {
  const message = err instanceof Error ? err.message : String(err);
  if (/User canceled|cancelled|canceled|exit code 2|The operation couldn.?t be completed/i.test(message)) {
    return 'Folder selection was cancelled.';
  }
  return message;
}

// --- Local Skill preview ---

function createLocalSkillPreviewResult(args) {
  const rootInput = args?.rootPath;
  if (typeof rootInput !== 'string' || rootInput.trim().length === 0) {
    return {
      isError: true,
      content: [{ type: 'text', text: 'rootPath is required and must be a non-empty string.' }],
    };
  }

  try {
    const selectedPaths = Array.isArray(args?.selectedPaths)
      ? new Set(args.selectedPaths.filter(item => typeof item === 'string' && item.trim()).map(normalizeRelativePath))
      : null;
    const data = scanLocalSkillFolder(rootInput, selectedPaths);
    return {
      content: [{ type: 'text', text: `Found ${data.skills.length} local Skill(s) in ${data.rootPath}` }],
      structuredContent: {
        ok: true,
        data,
      },
    };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
    };
  }
}

function scanLocalSkillFolder(rootInput, selectedPaths) {
  const rootPath = resolveLocalPath(rootInput);
  const rootStat = safeStat(rootPath);
  if (!rootStat || !rootStat.isDirectory()) {
    throw new Error(`Local Skill root is not a readable directory: ${rootPath}`);
  }

  const warnings = [];
  const allSkillPaths = findLocalSkillPaths(rootPath);
  if (allSkillPaths.length === 0) {
    throw new Error(`No SKILL.md found under ${rootPath}`);
  }
  if (allSkillPaths.length > MAX_LOCAL_SKILLS) {
    warnings.push(`Found ${allSkillPaths.length} Skills; preview is limited to ${MAX_LOCAL_SKILLS}.`);
  }

  const limitedPaths = allSkillPaths.slice(0, MAX_LOCAL_SKILLS);
  const selected = selectedPaths
    ? limitedPaths.filter(path => selectedPaths.has(path))
    : limitedPaths;
  if (selectedPaths && selected.length === 0) {
    throw new Error('Selected local Skill paths were not found under the root path.');
  }

  let totalContentBytes = 0;
  const skills = [];
  for (const skillPath of selected) {
    const item = readLocalSkill(rootPath, skillPath, totalContentBytes);
    totalContentBytes += item.contentBytes;
    skills.push(item.skill);
    warnings.push(...item.warnings);
  }

  return {
    rootPath,
    displayName: basename(rootPath) || rootPath,
    directoryName: basename(rootPath) || rootPath,
    skills,
    warnings: dedupeStrings(warnings),
    truncated: allSkillPaths.length > MAX_LOCAL_SKILLS || warnings.some(warning => warning.includes('content budget')),
  };
}

function findLocalSkillPaths(rootPath) {
  const result = [];
  walkLocalDirectory(rootPath, '', (relativePath, absolutePath, entry) => {
    if (!entry.isFile()) return;
    if (entry.name === 'SKILL.md') result.push(normalizeRelativePath(relativePath));
  });
  return result.sort((a, b) => a.localeCompare(b));
}

function readLocalSkill(rootPath, skillPath, usedContentBytes) {
  const absoluteSkillPath = resolveUnderRoot(rootPath, skillPath);
  const skillStat = safeStat(absoluteSkillPath);
  if (!skillStat || !skillStat.isFile()) {
    throw new Error(`Local Skill file is not readable: ${skillPath}`);
  }
  if (skillStat.size > MAX_LOCAL_SKILL_BYTES) {
    throw new Error(`${skillPath} exceeds the SKILL.md size limit (${skillStat.size} bytes).`);
  }

  const content = readTextFile(absoluteSkillPath);
  const directory = normalizeRelativePath(dirname(skillPath));
  const directoryPath = dirname(absoluteSkillPath);
  const bundle = collectLocalSkillResources(rootPath, directory, content, usedContentBytes + Buffer.byteLength(content, 'utf8'));
  const skill = {
    path: skillPath,
    directory,
    directoryPath,
    content,
    bodyBytes: Buffer.byteLength(content, 'utf8'),
    includedFiles: bundle.includedFiles,
    omittedFiles: bundle.omittedFiles,
    scriptFiles: bundle.scriptFiles,
    warnings: bundle.warnings,
  };
  const contentBytes = skill.bodyBytes + bundle.includedFiles.reduce((sum, file) => sum + file.bytes, 0);
  return {
    skill,
    contentBytes,
    warnings: bundle.warnings,
  };
}

function collectLocalSkillResources(rootPath, directory, skillBody, startingContentBytes) {
  const prefix = directory ? directory + '/' : '';
  const candidates = [];
  walkLocalDirectory(resolveUnderRoot(rootPath, directory || '.'), prefix, (relativePath, absolutePath, entry) => {
    if (!entry.isFile()) return;
    const normalized = normalizeRelativePath(relativePath);
    if (normalized === `${prefix}SKILL.md` || normalized.endsWith('/SKILL.md')) return;
    const stat = safeStat(absolutePath);
    if (!stat) return;
    candidates.push({
      path: normalized,
      absolutePath,
      bytes: stat.size,
    });
  }, { stopAtNestedSkillRoots: true });

  const scriptFiles = candidates
    .filter(candidate => isLocalScriptFile(candidate.path))
    .map(({ path, bytes }) => ({ path, bytes }));
  const textCandidates = candidates
    .filter(candidate => isLocalTextResource(candidate.path))
    .sort((a, b) => rankLocalResource(a.path, skillBody) - rankLocalResource(b.path, skillBody) || a.path.localeCompare(b.path));

  const includedFiles = [];
  const omittedFiles = [];
  const warnings = [];
  let resourceBytes = 0;
  let totalBytes = startingContentBytes;

  for (const candidate of textCandidates) {
    if (includedFiles.length >= MAX_LOCAL_RESOURCE_FILES_PER_SKILL) {
      omittedFiles.push({ path: candidate.path, bytes: candidate.bytes });
      continue;
    }
    if (candidate.bytes > MAX_LOCAL_RESOURCE_FILE_BYTES) {
      omittedFiles.push({ path: candidate.path, bytes: candidate.bytes });
      warnings.push(`${candidate.path} exceeds the per-file resource limit and was not bundled.`);
      continue;
    }
    if (resourceBytes + candidate.bytes > MAX_LOCAL_RESOURCE_BYTES_PER_SKILL) {
      omittedFiles.push({ path: candidate.path, bytes: candidate.bytes });
      continue;
    }
    if (totalBytes + candidate.bytes > MAX_LOCAL_TOTAL_CONTENT_BYTES) {
      omittedFiles.push({ path: candidate.path, bytes: candidate.bytes });
      warnings.push(`${candidate.path} was omitted because the local Skill preview reached the content budget.`);
      continue;
    }

    const content = readTextFile(candidate.absolutePath);
    const bytes = Buffer.byteLength(content, 'utf8');
    resourceBytes += bytes;
    totalBytes += bytes;
    includedFiles.push({ path: candidate.path, bytes, content });
  }

  if (omittedFiles.length > 0) {
    warnings.push(`${omittedFiles.length} local supporting file(s) were omitted.`);
  }

  return { includedFiles, omittedFiles, scriptFiles, warnings: dedupeStrings(warnings) };
}

function walkLocalDirectory(rootPath, prefix, visit, options = {}) {
  const stack = [{ absolutePath: rootPath, relativePrefix: prefix }];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = safeReadDirectory(current.absolutePath);
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.svn' || entry.name === '.hg') continue;
      const absolutePath = join(current.absolutePath, entry.name);
      const relativePath = normalizeRelativePath(join(current.relativePrefix, entry.name));
      visit(relativePath, absolutePath, entry);
      if (entry.isDirectory()) {
        if (options.stopAtNestedSkillRoots && hasLocalSkillFile(absolutePath)) continue;
        stack.push({ absolutePath, relativePrefix: relativePath });
      }
    }
  }
}

function resolveLocalPath(input) {
  const trimmed = input.trim();
  if (trimmed === '~') return homedir();
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return resolve(homedir(), trimmed.slice(2));
  }
  return resolve(trimmed);
}

function resolveUnderRoot(rootPath, relativePath) {
  const resolved = resolve(rootPath, relativePath);
  const rel = relative(rootPath, resolved);
  if (rel.startsWith('..') || rel === '..' || isAbsolute(rel)) {
    throw new Error(`Path escapes local Skill root: ${relativePath}`);
  }
  return resolved;
}

function readTextFile(filePath) {
  return readFileSync(filePath, 'utf8');
}

function safeReadDirectory(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function safeStat(path) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

function hasLocalSkillFile(directoryPath) {
  return safeStat(join(directoryPath, 'SKILL.md'))?.isFile() === true;
}

function isLocalTextResource(path) {
  return LOCAL_TEXT_RESOURCE_EXTENSIONS.has(pathExtension(path));
}

function isLocalScriptFile(path) {
  return LOCAL_SCRIPT_EXTENSIONS.has(pathExtension(path));
}

function rankLocalResource(path, skillBody) {
  const relativeName = path.split('/').slice(-2).join('/');
  if (skillBody.includes(path) || skillBody.includes(relativeName)) return 0;
  if (path.includes('/agents/')) return 1;
  if (path.includes('/references/')) return 2;
  if (path.includes('/templates/')) return 3;
  if (path.includes('/examples/')) return 4;
  return 5;
}

function pathExtension(path) {
  const name = path.split('/').pop() ?? '';
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index).toLowerCase() : '';
}

function normalizeRelativePath(path) {
  const normalized = String(path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  return normalized === '.' ? '' : normalized;
}

function dedupeStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

// --- Shell execution ---

function execCommand(command, { cwd, env, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const { shellBin, shellArgs } = createShellInvocation(command);

    const child = spawn(shellBin, shellArgs, {
      cwd,
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 3000);
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      if (stdoutBytes < MAX_OUTPUT_BYTES) {
        const remaining = MAX_OUTPUT_BYTES - stdoutBytes;
        stdout.push(chunk.length <= remaining ? chunk : chunk.subarray(0, remaining));
      }
      stdoutBytes += chunk.length;
    });

    child.stderr.on('data', (chunk) => {
      if (stderrBytes < MAX_OUTPUT_BYTES) {
        const remaining = MAX_OUTPUT_BYTES - stderrBytes;
        stderr.push(chunk.length <= remaining ? chunk : chunk.subarray(0, remaining));
      }
      stderrBytes += chunk.length;
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn command: ${err.message}`));
    });

    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        command,
        shell: shellBin,
        exitCode: timedOut ? -1 : (exitCode ?? -1),
        signal: signal || (timedOut ? 'SIGTERM' : null),
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        truncated: stdoutBytes > MAX_OUTPUT_BYTES || stderrBytes > MAX_OUTPUT_BYTES,
        timedOut,
      });
    });
  });
}

async function createPythonStatusResult() {
  const status = await detectPythonStatus();
  const text = status.available
    ? `Python ${status.version} ready at ${status.executable}`
    : PYTHON_NOT_FOUND_MESSAGE;

  return {
    content: [{ type: 'text', text }],
    structuredContent: {
      ok: true,
      data: status,
    },
  };
}

async function executePythonTool(args) {
  const code = args?.code;
  if (typeof code !== 'string' || code.trim().length === 0) {
    return {
      isError: true,
      content: [{ type: 'text', text: 'code is required and must be a non-empty string.' }],
    };
  }

  const codeBytes = Buffer.byteLength(code, 'utf8');
  if (codeBytes > MAX_PYTHON_CODE_BYTES) {
    return {
      isError: true,
      content: [{ type: 'text', text: `code exceeds ${MAX_PYTHON_CODE_BYTES} bytes.` }],
    };
  }

  const timeoutMs = typeof args.timeout_ms === 'number' && args.timeout_ms >= 1000
    ? Math.min(Math.floor(args.timeout_ms), MAX_PYTHON_TIMEOUT_MS)
    : DEFAULT_PYTHON_TIMEOUT_MS;
  const status = await detectPythonStatus();

  if (!status.available || !status.command) {
    return {
      isError: true,
      content: [{ type: 'text', text: PYTHON_NOT_FOUND_MESSAGE }],
      structuredContent: {
        ok: false,
        data: status,
      },
    };
  }

  const cwd = mkdtempSync(join(tmpdir(), 'deepseek-pp-python-'));
  try {
    const result = await execPythonProcess(status.command, status.commandArgs ?? [], {
      code,
      cwd,
      timeoutMs,
    });
    return {
      content: [{ type: 'text', text: formatPythonExecSummary(result) }],
      structuredContent: {
        ok: result.exitCode === 0,
        data: {
          ...result,
          pythonPath: status.executable,
          pythonVersion: status.version,
          cwd: '(temporary scratch directory)',
          limits: getPythonLimits(),
        },
      },
      isError: result.exitCode !== 0,
    };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: err.message }],
    };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

async function detectPythonStatus() {
  const candidates = getPythonCandidates();
  const candidateLabels = candidates.map(formatPythonCandidate);

  for (const candidate of candidates) {
    let versionText = null;
    try {
      const versionProbe = await execPythonVersionProbe(candidate);
      versionText = parsePythonVersionOutput(versionProbe);
      if (versionProbe.exitCode !== 0 || !versionText) continue;
    } catch {
      // Try the next environment value, path, or command name.
      continue;
    }

    try {
      const probe = await execPythonProbe(candidate);
      if (probe.exitCode !== 0 || !probe.stdout.trim()) continue;
      const data = JSON.parse(probe.stdout.trim());
      return {
        available: true,
        command: candidate.command,
        commandArgs: getPythonCommandArgs(candidate),
        executable: typeof data.executable === 'string' ? data.executable : candidate.command,
        version: typeof data.version === 'string' ? data.version : versionText,
        versionCheck: versionText,
        packages: normalizePythonPackages(data.packages),
        candidates: candidateLabels,
        isolation: 'python -I',
        policy: getPythonPolicy(),
        limits: getPythonLimits(),
      };
    } catch {
      // --version worked, but the JSON probe failed; try the next common executable name.
    }
  }

  return {
    available: false,
    command: null,
    commandArgs: [],
    executable: null,
    version: null,
    versionCheck: null,
    packages: Object.fromEntries(PYTHON_PACKAGE_CHECKS.map((name) => [name, false])),
    candidates: candidateLabels,
    isolation: 'python -I',
    policy: getPythonPolicy(),
    limits: getPythonLimits(),
  };
}

function getPythonCandidates() {
  const envCandidates = getPythonEnvCandidates();
  const pathCandidates = getPythonPathCandidates();
  const fallbackCandidates = platform() === 'win32'
    ? [
        { command: 'py', args: [], launcherArgs: ['-3'], source: 'command:py -3 --version' },
        { command: 'py.exe', args: [], launcherArgs: ['-3'], source: 'command:py.exe -3 --version' },
        { command: 'python', args: [], source: 'command:python --version' },
        { command: 'python.exe', args: [], source: 'command:python.exe --version' },
        { command: 'python3', args: [], source: 'command:python3 --version' },
        { command: 'python3.exe', args: [], source: 'command:python3.exe --version' },
      ]
    : [
        { command: 'python3', args: [], source: 'command:python3 --version' },
        { command: 'python', args: [], source: 'command:python --version' },
        { command: 'py', args: [], source: 'command:py --version' },
      ];
  return dedupePythonCandidates([...envCandidates, ...pathCandidates, ...fallbackCandidates]);
}

function getPythonEnvCandidates() {
  const names = [
    'DEEPSEEK_PP_PYTHON',
    'PYTHON_EXECUTABLE',
    'PYTHON',
    'PYTHON3',
  ];
  const candidates = [];
  for (const name of names) {
    const value = process.env[name];
    if (typeof value !== 'string' || value.trim().length === 0) continue;
    candidates.push({ command: value.trim(), args: [], source: 'env:' + name });
  }
  return candidates;
}

function getPythonPathCandidates() {
  return platform() === 'win32' ? getWindowsPythonPathCandidates() : getPosixPythonPathCandidates();
}

function getPosixPythonPathCandidates() {
  const candidates = [];
  const directPaths = [
    resolve(homedir(), '.pyenv', 'shims', 'python3'),
    resolve(homedir(), '.pyenv', 'shims', 'python'),
    resolve(homedir(), 'miniconda3', 'bin', 'python'),
    resolve(homedir(), 'anaconda3', 'bin', 'python'),
    resolve(homedir(), 'miniforge3', 'bin', 'python'),
    resolve(homedir(), 'mambaforge', 'bin', 'python'),
    '/opt/homebrew/bin/python3',
    '/opt/homebrew/bin/python',
    '/usr/local/bin/python3',
    '/usr/local/bin/python',
    '/usr/bin/python3',
    '/usr/bin/python',
    '/bin/python3',
    '/bin/python',
  ];
  for (const pythonPath of directPaths) addPythonPathCandidate(candidates, pythonPath, 'path:file');
  for (const root of ['miniconda3', 'anaconda3', 'miniforge3', 'mambaforge']) {
    addPythonEnvDirCandidates(candidates, resolve(homedir(), root, 'envs'));
  }
  addPythonEnvDirCandidates(candidates, resolve(homedir(), '.pyenv', 'versions'));
  return candidates;
}

function getWindowsPythonPathCandidates() {
  const candidates = [];
  addWindowsPathPythonCandidates(candidates);
  const dirs = [
    resolve(localAppData, 'Programs', 'Python'),
    process.env.ProgramFiles ? resolve(process.env.ProgramFiles) : '',
    process.env['ProgramFiles(x86)'] ? resolve(process.env['ProgramFiles(x86)']) : '',
  ].filter(Boolean);
  for (const dir of dirs) {
    for (const entry of readDirectoryEntries(dir)) {
      if (!/^Python\d+/i.test(entry.name)) continue;
      addPythonPathCandidate(candidates, resolve(dir, entry.name, 'python.exe'), 'path:file');
    }
  }
  return candidates;
}

function addWindowsPathPythonCandidates(candidates) {
  for (const dir of splitPath(getEnvironmentPath(process.env))) {
    for (const name of ['python.exe', 'python3.exe']) {
      addPythonPathCandidate(candidates, resolve(dir, name), 'path:PATH');
    }
  }
}

function addPythonEnvDirCandidates(candidates, envsDir) {
  for (const entry of readDirectoryEntries(envsDir)) {
    if (!entry.isDirectory()) continue;
    const pythonPath = platform() === 'win32'
      ? resolve(envsDir, entry.name, 'python.exe')
      : resolve(envsDir, entry.name, 'bin', 'python');
    addPythonPathCandidate(candidates, pythonPath, 'path:env');
  }
}

function addPythonPathCandidate(candidates, pythonPath, source) {
  if (!existsSync(pythonPath)) return;
  if (platform() === 'win32' && isWindowsAppExecutionAliasPath(pythonPath)) return;
  candidates.push({ command: pythonPath, args: [], source });
}

function isWindowsAppExecutionAliasPath(filePath) {
  const normalized = normalizeWindowsPathForCompare(filePath);
  const aliasDir = normalizeWindowsPathForCompare(resolve(localAppData, 'Microsoft', 'WindowsApps'));
  return normalized === aliasDir || normalized.startsWith(aliasDir + '/');
}

function normalizeWindowsPathForCompare(filePath) {
  return resolve(filePath).replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
}

function readDirectoryEntries(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}
function dedupePythonCandidates(candidates) {
  const seen = new Set();
  const result = [];
  for (const candidate of candidates) {
    const key = [candidate.command, ...(candidate.launcherArgs ?? []), ...candidate.args].join('\0');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

function getPythonCommandArgs(candidate) {
  return [...(candidate.launcherArgs ?? []), ...candidate.args];
}

function formatPythonCandidate(candidate) {
  const label = [candidate.command, ...getPythonCommandArgs(candidate)].join(' ');
  return candidate.source ? label + ' (' + candidate.source + ')' : label;
}

function execPythonVersionProbe(candidate) {
  return execProcess(candidate.command, [...getPythonCommandArgs(candidate), '--version'], {
    cwd: homedir(),
    env: createPythonChildEnv(),
    timeoutMs: 2_000,
    maxOutputBytes: 2_000,
  });
}

function parsePythonVersionOutput(probe) {
  const text = [probe.stdout, probe.stderr].join(' ').replace(/\s+/g, ' ').trim();
  const match = text.match(/Python\s+([0-9]+(?:\.[0-9]+){1,2})/i);
  return match ? match[1] : null;
}

function execPythonProbe(candidate) {
  const code = [
    'import importlib.util, json, sys',
    `packages = {name: importlib.util.find_spec(name) is not None for name in ${JSON.stringify(PYTHON_PACKAGE_CHECKS)}}`,
    'print(json.dumps({"executable": sys.executable, "version": sys.version.split()[0], "packages": packages}, ensure_ascii=False))',
  ].join('\n');

  return execProcess(candidate.command, [...getPythonCommandArgs(candidate), '-I', '-c', code], {
    cwd: homedir(),
    env: createPythonChildEnv(),
    timeoutMs: 5_000,
    maxOutputBytes: 16_000,
  });
}

function execPythonProcess(command, commandArgs, { code, cwd, timeoutMs }) {
  return execProcess(command, [...commandArgs, '-I', '-'], {
    cwd,
    env: createPythonChildEnv(),
    input: code,
    timeoutMs,
    maxOutputBytes: MAX_PYTHON_OUTPUT_BYTES,
  });
}

function execProcess(command, args, { cwd, env, input, timeoutMs, maxOutputBytes }) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 3000);
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      if (stdoutBytes < maxOutputBytes) {
        const remaining = maxOutputBytes - stdoutBytes;
        stdout.push(chunk.length <= remaining ? chunk : chunk.subarray(0, remaining));
      }
      stdoutBytes += chunk.length;
    });

    child.stderr.on('data', (chunk) => {
      if (stderrBytes < maxOutputBytes) {
        const remaining = maxOutputBytes - stderrBytes;
        stderr.push(chunk.length <= remaining ? chunk : chunk.subarray(0, remaining));
      }
      stderrBytes += chunk.length;
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn ${command}: ${err.message}`));
    });

    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        command: [command, ...args].join(' '),
        exitCode: timedOut ? -1 : (exitCode ?? -1),
        signal: signal || (timedOut ? 'SIGTERM' : null),
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        truncated: stdoutBytes > maxOutputBytes || stderrBytes > maxOutputBytes,
        timedOut,
        durationMs: Date.now() - startedAt,
      });
    });

    if (input != null) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
  });
}

function createPythonChildEnv() {
  const env = {};
  const keys = platform() === 'win32'
    ? ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA']
    : ['HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'LC_CTYPE'];

  for (const key of keys) {
    if (typeof process.env[key] === 'string') env[key] = process.env[key];
  }

  setEnvironmentPath(env, getEnvironmentPath(process.env));
  env.PYTHONUTF8 = '1';
  env.PYTHONIOENCODING = 'utf-8';
  env.PYTHONNOUSERSITE = '1';
  env.PIP_DISABLE_PIP_VERSION_CHECK = '1';
  return env;
}

function normalizePythonPackages(value) {
  const input = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(
    PYTHON_PACKAGE_CHECKS.map((name) => [name, input[name] === true]),
  );
}

function getPythonPolicy() {
  return {
    purpose: 'short computation, idea validation, and small data transformations',
    packageInstall: false,
    networkAccess: 'not_allowed_by_policy_not_os_enforced',
    filesystemAccess: 'temporary_cwd_only_by_policy_not_os_enforced',
  };
}

function getPythonLimits() {
  return {
    timeoutMsDefault: DEFAULT_PYTHON_TIMEOUT_MS,
    timeoutMsMax: MAX_PYTHON_TIMEOUT_MS,
    codeBytesMax: MAX_PYTHON_CODE_BYTES,
    outputBytesMax: MAX_PYTHON_OUTPUT_BYTES,
  };
}

function createChildEnv(extraEnv) {
  const explicitPath = getExplicitPathOverride(extraEnv);
  const env = extraEnv && typeof extraEnv === 'object' ? { ...process.env, ...extraEnv } : { ...process.env };
  const pathValue = explicitPath !== null ? explicitPath : (getEnvironmentPath(env) || getEnvironmentPath(process.env));
  setEnvironmentPath(env, pathValue);
  if (platform() === 'win32') {
    env.PYTHONUTF8 ??= '1';
    env.PYTHONIOENCODING ??= 'utf-8';
  }
  return env;
}

function createShellInvocation(command) {
  if (platform() === 'win32') {
    return {
      shellBin: DEFAULT_SHELL,
      shellArgs: [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `${WINDOWS_POWERSHELL_UTF8_PREAMBLE}; ${command}`,
      ],
    };
  }

  return { shellBin: DEFAULT_SHELL, shellArgs: ['-c', command] };
}

function splitPath(value) {
  return (value || '')
    .split(PATH_SEPARATOR)
    .map(entry => entry.trim())
    .filter(Boolean);
}

function getEnvironmentPath(env) {
  const canonicalKey = platform() === 'win32' ? 'Path' : 'PATH';
  if (typeof env[canonicalKey] === 'string') return env[canonicalKey];
  const key = Object.keys(env).find(name => name.toLowerCase() === 'path');
  return key ? env[key] || '' : '';
}

function setEnvironmentPath(env, value) {
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === 'path') delete env[key];
  }
  env[platform() === 'win32' ? 'Path' : 'PATH'] = value;
}

function getExplicitPathOverride(env) {
  if (!env || typeof env !== 'object') return null;
  let value = null;
  for (const [key, candidate] of Object.entries(env)) {
    if (key.toLowerCase() === 'path' && typeof candidate === 'string') {
      value = candidate;
    }
  }
  return value;
}

function dedupePathDirs(dirs) {
  const seen = new Set();
  const result = [];
  for (const dir of dirs) {
    if (!dir) continue;
    const key = platform() === 'win32'
      ? dir.replace(/[\\/]+$/, '').toLowerCase()
      : dir.replace(/\/+$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(dir);
  }
  return result;
}

function readWindowsUserMachinePathDirs() {
  if (platform() !== 'win32') return [];
  const command = [
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
    "$paths = @([Environment]::GetEnvironmentVariable('Path', 'Machine'), [Environment]::GetEnvironmentVariable('Path', 'User'))",
    "$paths | Where-Object { $_ } | ForEach-Object { [Environment]::ExpandEnvironmentVariables($_) }",
  ].join('; ');
  try {
    const out = execFileSync(POWERSHELL_EXE, [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      command,
    ], {
      encoding: 'utf8',
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    return splitPath(out.replace(/\r?\n/g, PATH_SEPARATOR));
  } catch (err) {
    process.stderr.write(`[shell-mcp-host] Could not read Windows User/Machine PATH: ${err.message}\n`);
    return [];
  }
}

function getWindowsVersionLabel() {
  if (platform() !== 'win32') return null;
  const release = osRelease();
  const parts = release.split('.').map(part => Number.parseInt(part, 10));
  const build = parts[2] || 0;
  if (parts[0] === 10 && build >= 22000) return `Windows 11 (${release})`;
  if (parts[0] === 10) return `Windows 10 (${release})`;
  return `Windows (${release})`;
}

function formatExecSummary(result) {
  const parts = [];
  if (result.timedOut) parts.push('[TIMED OUT]');
  if (result.exitCode !== 0) parts.push(`[exit ${result.exitCode}]`);
  if (result.truncated) parts.push('[output truncated]');
  if (result.stdout) parts.push(result.stdout.slice(0, 4000));
  if (result.stderr) parts.push(`STDERR: ${result.stderr.slice(0, 2000)}`);
  return parts.join('\n') || '(no output)';
}

function formatPythonExecSummary(result) {
  const parts = [];
  if (result.timedOut) parts.push('[TIMED OUT]');
  if (result.exitCode !== 0) parts.push(`[exit ${result.exitCode}]`);
  if (result.truncated) parts.push('[output truncated]');
  if (result.stdout) parts.push(result.stdout.slice(0, 4000));
  if (result.stderr) parts.push(`STDERR: ${result.stderr.slice(0, 2000)}`);
  return parts.join('\n') || '(no output)';
}

// --- Message dispatch ---

async function handleMessage(envelope) {
  if (envelope.protocol !== 'dwplus-mcp-native' || envelope.version !== 1) {
    await writeNativeMessage(jsonRpcError(null, -32600, 'Invalid envelope: expected dwplus-mcp-native v1'));
    return;
  }

  const message = envelope.message;
  if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    await writeNativeMessage(jsonRpcError(null, -32600, 'Invalid JSON-RPC request.'));
    return;
  }

  const id = message.id ?? null;

  if (!('id' in message)) {
    return;
  }

  let response;
  switch (message.method) {
    case 'initialize':
      response = handleInitialize(id);
      break;
    case 'tools/list':
      response = handleListTools(id);
      break;
    case 'tools/call':
      response = await handleCallTool(id, message.params);
      break;
    default:
      response = jsonRpcError(id, -32601, `Unsupported method: ${message.method}`);
  }

  await writeNativeMessage(response);
}

// --- Persistent main loop ---

async function main() {
  while (true) {
    let envelope;
    try {
      envelope = await readMessage();
    } catch {
      break;
    }
    if (envelope === EOF) break;
    try {
      await handleMessage(envelope);
    } catch (err) {
      process.stderr.write(`[shell-mcp-host] Error: ${err.message || err}\n`);
      await writeNativeMessage(jsonRpcError(null, -32603, err.message || 'Internal error'));
    }
  }
}

main().catch((err) => {
  process.stderr.write(`[shell-mcp-host] Fatal: ${err.message || err}\n`);
  process.exit(1);
});
