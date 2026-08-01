#!/usr/bin/env node
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { arch, homedir, platform, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const HOST_NAME = 'com.doubao_wplus.shell';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, '..');
const HOST_SOURCE = resolve(PACKAGE_ROOT, 'native', 'shell-mcp-host.mjs');
const FIREFOX_EXTENSION_ID = 'doubao-wplus@workbuddy.local';
const SUPPORTED_BROWSERS = new Set(['chrome', 'chromium', 'edge', 'firefox']);
const COMMANDS = new Set(['install', 'status', 'uninstall']);
const OFFICECLI_REPO = 'iOfficeAI/OfficeCLI';
const OFFICECLI_BINARY = platform() === 'win32' ? 'officecli.exe' : 'officecli';
const OFFICECLI_MIRROR_BASE = 'https://d.officecli.ai';
const OFFICECLI_GITHUB_RELEASE_BASE = `https://github.com/${OFFICECLI_REPO}/releases/latest/download`;
const OFFICECLI_REQUIRED_HELP_PATTERNS = [
  /\bview\s+<file>\s+<mode>/,
  /\bget\s+<file>\s+<path>/,
  /\bset\s+<file>\s+<path>/,
  /\bbatch\s+<file>/,
  /\bvalidate\s+<file>/,
  /--json\b/,
];

function parseArgs(argv) {
  const args = {
    command: 'install',
    extensionId: null,
    browser: 'chrome',
    skipOfficecli: false,
    forceOfficecli: false,
  };
  const tokens = [...argv];

  if (tokens[0] && COMMANDS.has(tokens[0])) {
    args.command = tokens.shift();
  }

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '--extension-id' && tokens[i + 1]) args.extensionId = tokens[++i];
    else if (token === '--browser' && tokens[i + 1]) args.browser = tokens[++i].toLowerCase();
    else if (token === '--skip-officecli') args.skipOfficecli = true;
    else if (token === '--force-officecli') args.forceOfficecli = true;
    else if (token === '--help' || token === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${token}`);
    }
  }

  if (!SUPPORTED_BROWSERS.has(args.browser)) {
    throw new Error(`Unsupported browser: ${args.browser}`);
  }

  return args;
}

function printHelp() {
  console.log(`Doubao WPlus Shell Native Host installer

Usage:
  doubao-wplus-shell-host install --browser chrome --extension-id <extension-id>
  doubao-wplus-shell-host status --browser chrome
  doubao-wplus-shell-host uninstall --browser chrome

Commands:
  install              Install the Shell Native Host and OfficeCLI
  status               Show manifest, host, and OfficeCLI status
  uninstall            Remove the Shell Native Host manifest and installed host files

Options:
  --extension-id <id>  Chrome/Edge/Chromium extension ID
  --browser <name>     Target browser: chrome, chromium, edge, firefox (default: chrome)
  --skip-officecli     Install only the Shell Native Host
  --force-officecli    Reinstall OfficeCLI even if a compatible binary exists
  --help               Show this help

Examples:
  npx doubao-wplus-shell-host install --browser chrome --extension-id abcdefghijklmnopqrstuvwxyz123456
  npx doubao-wplus-shell-host install --browser firefox
`);
}

function getAppDataRoot() {
  const home = homedir();
  if (platform() === 'darwin') return `${home}/Library/Application Support/Doubao WPlus`;
  if (platform() === 'linux') return `${home}/.local/share/doubao-wplus`;
  if (platform() === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || resolve(home, 'AppData', 'Local');
    return resolve(localAppData, 'Doubao WPlus');
  }
  throw new Error(`Unsupported platform: ${platform()}`);
}

function getHostInstallDir() {
  const root = getAppDataRoot();
  return platform() === 'linux' ? resolve(root, 'native-host') : resolve(root, 'NativeHost');
}

function getManifestDir(browser) {
  const os = platform();
  const home = homedir();

  if (os === 'darwin') {
    switch (browser) {
      case 'chrome': return `${home}/Library/Application Support/Google/Chrome/NativeMessagingHosts`;
      case 'chromium': return `${home}/Library/Application Support/Chromium/NativeMessagingHosts`;
      case 'edge': return `${home}/Library/Application Support/Microsoft Edge/NativeMessagingHosts`;
      case 'firefox': return `${home}/Library/Application Support/Mozilla/NativeMessagingHosts`;
      default: return `${home}/Library/Application Support/Google/Chrome/NativeMessagingHosts`;
    }
  }

  if (os === 'linux') {
    switch (browser) {
      case 'chrome': return `${home}/.config/google-chrome/NativeMessagingHosts`;
      case 'chromium': return `${home}/.config/chromium/NativeMessagingHosts`;
      case 'edge': return `${home}/.config/microsoft-edge/NativeMessagingHosts`;
      case 'firefox': return `${home}/.mozilla/native-messaging-hosts`;
      default: return `${home}/.config/google-chrome/NativeMessagingHosts`;
    }
  }

  if (os === 'win32') {
    return resolve(getAppDataRoot(), 'NativeMessagingHosts');
  }

  throw new Error(`Unsupported platform: ${os}`);
}

function getManifestPath(browser) {
  return resolve(getManifestDir(browser), `${HOST_NAME}.json`);
}

function getRegistryKey(browser) {
  switch (browser) {
    case 'chrome': return `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;
    case 'edge': return `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`;
    case 'chromium': return `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${HOST_NAME}`;
    default: return null;
  }
}

function buildManifest(args, wrapperPath) {
  const manifest = {
    name: HOST_NAME,
    description: 'Doubao WPlus Shell MCP - General purpose shell execution via Native Messaging',
    path: wrapperPath,
    type: 'stdio',
  };

  if (args.browser === 'firefox') {
    manifest.allowed_extensions = [FIREFOX_EXTENSION_ID];
  } else {
    if (!args.extensionId) {
      throw new Error('--extension-id is required for Chrome/Edge/Chromium.');
    }
    manifest.allowed_origins = [`chrome-extension://${args.extensionId}/`];
  }

  return manifest;
}

function copyHostScript(installDir) {
  const hostPath = resolve(installDir, 'shell-mcp-host.mjs');
  mkdirSync(installDir, { recursive: true });
  copyFileSync(HOST_SOURCE, hostPath);
  if (platform() !== 'win32') chmodSync(hostPath, 0o755);
  return hostPath;
}

function createWrapper(hostPath) {
  const installDir = dirname(hostPath);
  const nodePath = process.execPath;

  if (platform() === 'win32') {
    return createWindowsExecutableWrapper(installDir, nodePath, hostPath);
  }

  const wrapperPath = resolve(installDir, 'shell-mcp-host');
  const content = `#!/bin/sh\nexec "${nodePath}" "${hostPath}" "$@"\n`;
  writeFileSync(wrapperPath, content, { mode: 0o755 });
  return wrapperPath;
}

function createWindowsExecutableWrapper(installDir, nodePath, hostPath) {
  const wrapperPath = resolve(installDir, 'shell-mcp-host.exe');
  const sourcePath = resolve(installDir, 'shell-mcp-host-launcher.cs');
  const frameworkRoot = resolve(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET');
  const compilerCandidates = [
    resolve(frameworkRoot, 'Framework64', 'v4.0.30319', 'csc.exe'),
    resolve(frameworkRoot, 'Framework', 'v4.0.30319', 'csc.exe'),
  ];
  const compiler = compilerCandidates.find(existsSync);
  if (!compiler) {
    throw new Error('Windows C# compiler was not found; cannot create the Native Messaging executable launcher.');
  }

  const source = `using System;
using System.Diagnostics;
using System.IO;
using System.Threading;

public static class ShellMcpHostLauncher {
  private static void Copy(Stream input, Stream output) {
    byte[] buffer = new byte[8192];
    int read;
    while ((read = input.Read(buffer, 0, buffer.Length)) > 0) {
      output.Write(buffer, 0, read);
      output.Flush();
    }
  }

  public static int Main() {
    var start = new ProcessStartInfo();
    start.FileName = "${escapeCSharpString(nodePath)}";
    start.Arguments = "\\\"${escapeCSharpString(hostPath)}\\\"";
    start.UseShellExecute = false;
    start.CreateNoWindow = true;
    start.RedirectStandardInput = true;
    start.RedirectStandardOutput = true;
    start.RedirectStandardError = true;

    using (var child = Process.Start(start)) {
      var inputThread = new Thread(delegate() {
        try { Copy(Console.OpenStandardInput(), child.StandardInput.BaseStream); }
        finally { try { child.StandardInput.Close(); } catch {} }
      });
      var outputThread = new Thread(delegate() { Copy(child.StandardOutput.BaseStream, Console.OpenStandardOutput()); });
      var errorThread = new Thread(delegate() { Copy(child.StandardError.BaseStream, Console.OpenStandardError()); });
      inputThread.IsBackground = true;
      outputThread.IsBackground = true;
      errorThread.IsBackground = true;
      inputThread.Start();
      outputThread.Start();
      errorThread.Start();
      child.WaitForExit();
      outputThread.Join(1000);
      errorThread.Join(1000);
      return child.ExitCode;
    }
  }
}
`;

  writeFileSync(sourcePath, source);
  try {
    execFileSync(compiler, ['/nologo', '/target:exe', `/out:${wrapperPath}`, sourcePath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } finally {
    rmSync(sourcePath, { force: true });
  }
  return wrapperPath;
}

function escapeCSharpString(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function writeWindowsRegistry(browser, manifestPath) {
  const regKey = getRegistryKey(browser);
  if (!regKey) return;

  try {
    execSync(`reg add "${regKey}" /ve /t REG_SZ /d "${manifestPath}" /f`, { stdio: 'pipe' });
    console.log(`Registry: ${regKey}`);
  } catch {
    console.error('Warning: Failed to write registry key. You may need to run as Administrator.');
    console.error(`  Manual: reg add "${regKey}" /ve /t REG_SZ /d "${manifestPath}" /f`);
  }
}

function removeWindowsRegistry(browser) {
  const regKey = getRegistryKey(browser);
  if (!regKey) return;

  try {
    execSync(`reg delete "${regKey}" /f`, { stdio: 'pipe' });
    console.log(`Removed registry key: ${regKey}`);
  } catch {
    console.log(`Registry key not removed or was already absent: ${regKey}`);
  }
}

function getOfficeCliInstallDir() {
  if (platform() === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || resolve(homedir(), 'AppData', 'Local');
    return resolve(localAppData, 'OfficeCLI');
  }
  return resolve(homedir(), '.local', 'bin');
}

function isProjectNodeModulesPath(path) {
  const normalized = path.replaceAll('\\', '/');
  return normalized.includes('/node_modules/.bin/');
}

function getPathOfficeCliCandidates() {
  const command = platform() === 'win32' ? 'where.exe' : 'which';
  const args = platform() === 'win32' ? [OFFICECLI_BINARY] : ['-a', 'officecli'];
  try {
    const out = execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function getOfficeCliCandidates() {
  const installPath = resolve(getOfficeCliInstallDir(), OFFICECLI_BINARY);
  const candidates = [installPath, ...getPathOfficeCliCandidates()]
    .filter(candidate => !isProjectNodeModulesPath(candidate));
  return [...new Set(candidates)];
}

function isCompatibleOfficeCli(binaryPath) {
  if (!existsSync(binaryPath)) return false;
  try {
    const help = execFileSync(binaryPath, ['--help'], {
      encoding: 'utf8',
      timeout: 20_000,
      env: { ...process.env, OFFICECLI_SKIP_UPDATE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return OFFICECLI_REQUIRED_HELP_PATTERNS.every(pattern => pattern.test(help));
  } catch {
    return false;
  }
}

function findCompatibleOfficeCli() {
  return getOfficeCliCandidates().find(isCompatibleOfficeCli) ?? null;
}

function detectLinuxMusl() {
  if (existsSync('/etc/alpine-release')) return true;
  try {
    const out = execFileSync('ldd', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return /musl/i.test(out);
  } catch {
    return false;
  }
}

function getOfficeCliAssetName() {
  const os = platform();
  const cpu = arch();
  if (os === 'darwin') {
    if (cpu === 'arm64') return 'officecli-mac-arm64';
    if (cpu === 'x64') return 'officecli-mac-x64';
  }
  if (os === 'linux') {
    const distro = detectLinuxMusl() ? 'linux-alpine' : 'linux';
    if (cpu === 'x64') return `officecli-${distro}-x64`;
    if (cpu === 'arm64') return `officecli-${distro}-arm64`;
  }
  if (os === 'win32') {
    if (cpu === 'x64') return 'officecli-win-x64.exe';
    if (cpu === 'arm64') return 'officecli-win-arm64.exe';
  }
  throw new Error(`Unsupported OfficeCLI platform: ${os}/${cpu}`);
}

async function fetchBytes(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'doubao-wplus-officecli-installer' },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function downloadWithFallback(asset, outPath) {
  const primary = `${OFFICECLI_MIRROR_BASE}/releases/latest/download/${asset}`;
  const fallback = `${OFFICECLI_GITHUB_RELEASE_BASE}/${asset}`;
  try {
    writeFileSync(outPath, await fetchBytes(primary));
    console.log(`  downloaded ${asset} via mirror`);
  } catch (primaryError) {
    console.log(`  mirror unavailable for ${asset}, falling back to GitHub`);
    try {
      writeFileSync(outPath, await fetchBytes(fallback));
    } catch (fallbackError) {
      throw new Error(`Failed to download ${asset}: mirror=${primaryError.message}; github=${fallbackError.message}`);
    }
  }
}

async function verifyOfficeCliChecksum(asset, binaryPath) {
  const sumsPath = resolve(tmpdir(), `officecli-SHA256SUMS-${process.pid}`);
  try {
    try {
      await downloadWithFallback('SHA256SUMS', sumsPath);
    } catch {
      console.log('  checksum file unavailable, skipping verification');
      return;
    }
    const sums = readFileSync(sumsPath, 'utf8');
    const expectedLine = sums.split(/\r?\n/).find(line => line.includes(asset));
    if (!expectedLine) {
      console.log('  checksum entry not found, skipping verification');
      return;
    }
    const expected = expectedLine.trim().split(/\s+/)[0].toLowerCase();
    const actual = createHash('sha256').update(readFileSync(binaryPath)).digest('hex');
    if (actual !== expected) {
      throw new Error(`Checksum mismatch for ${asset}: expected ${expected}, got ${actual}`);
    }
    console.log('  checksum verified');
  } finally {
    rmSync(sumsPath, { force: true });
  }
}

function verifyDownloadedOfficeCli(binaryPath) {
  if (platform() !== 'win32') {
    chmodSync(binaryPath, 0o755);
  }
  execFileSync(binaryPath, ['--version'], {
    timeout: 20_000,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, OFFICECLI_SKIP_UPDATE: '1' },
  });
  if (!isCompatibleOfficeCli(binaryPath)) {
    throw new Error('Downloaded OfficeCLI does not expose the required command-based interface.');
  }
}

function addOfficeCliToUserPath(installDir) {
  if (platform() === 'win32') {
    try {
      execFileSync('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `$p=[Environment]::GetEnvironmentVariable('Path','User'); if (($p -split ';') -notcontains '${installDir.replaceAll("'", "''")}') { [Environment]::SetEnvironmentVariable('Path', (($p.TrimEnd(';') + ';${installDir.replaceAll("'", "''")}').TrimStart(';')), 'User') }`,
      ], { stdio: 'pipe' });
      console.log(`Added ${installDir} to the user PATH.`);
    } catch {
      console.log(`Could not update the user PATH automatically. Add this directory manually: ${installDir}`);
    }
    return;
  }

  const shellRc = platform() === 'darwin' || process.env.SHELL?.includes('zsh')
    ? resolve(homedir(), '.zshrc')
    : resolve(homedir(), '.bashrc');
  const pathLine = `export PATH="${installDir}:$PATH"`;
  try {
    const existing = existsSync(shellRc) ? readFileSync(shellRc, 'utf8') : '';
    if (!existing.includes(installDir)) {
      writeFileSync(shellRc, `${existing}${existing.endsWith('\n') || existing.length === 0 ? '' : '\n'}\n${pathLine}\n`);
      console.log(`Added ${installDir} to PATH in ${shellRc}.`);
    }
  } catch {
    console.log(`Could not update shell PATH automatically. Add this line manually: ${pathLine}`);
  }
}

async function ensureOfficeCliInstalled({ force }) {
  if (!force) {
    const existing = findCompatibleOfficeCli();
    if (existing) {
      console.log(`OfficeCLI command binary already available: ${existing}`);
      return existing;
    }
  }

  const asset = getOfficeCliAssetName();
  const installDir = getOfficeCliInstallDir();
  const targetPath = resolve(installDir, OFFICECLI_BINARY);
  const tempPath = resolve(tmpdir(), `${OFFICECLI_BINARY}-${process.pid}`);
  const stagedPath = `${targetPath}.new`;

  console.log(`Installing OfficeCLI from ${OFFICECLI_REPO} (${asset})...`);
  await downloadWithFallback(asset, tempPath);
  await verifyOfficeCliChecksum(asset, tempPath);
  verifyDownloadedOfficeCli(tempPath);

  mkdirSync(installDir, { recursive: true });
  copyFileSync(tempPath, stagedPath);
  if (platform() !== 'win32') {
    chmodSync(stagedPath, 0o755);
  }
  if (platform() === 'darwin') {
    try { execFileSync('xattr', ['-d', 'com.apple.quarantine', stagedPath], { stdio: 'ignore' }); } catch {}
    try { execFileSync('codesign', ['-s', '-', '-f', stagedPath], { stdio: 'ignore' }); } catch {}
  }
  renameSync(stagedPath, targetPath);
  rmSync(tempPath, { force: true });

  addOfficeCliToUserPath(installDir);
  console.log(`OfficeCLI installed: ${targetPath}`);
  return targetPath;
}

function readManifest(manifestPath) {
  if (!existsSync(manifestPath)) return null;
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

function install(args) {
  const manifestPath = getManifestPath(args.browser);
  const manifestDir = dirname(manifestPath);
  const hostPath = copyHostScript(getHostInstallDir());
  const wrapperPath = createWrapper(hostPath);
  const manifest = buildManifest(args, wrapperPath);

  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  if (platform() === 'win32') {
    writeWindowsRegistry(args.browser, manifestPath);
  }

  console.log('\nInstalled native messaging host manifest:');
  console.log(`  ${manifestPath}\n`);
  console.log(`Host script: ${hostPath}`);
  console.log(`Wrapper:     ${manifest.path}`);
  console.log(`Host name:   ${HOST_NAME}`);
  console.log(`Browser:     ${args.browser}`);
  if (manifest.allowed_origins) console.log(`Origin:      ${manifest.allowed_origins[0]}`);
  if (manifest.allowed_extensions) console.log(`Extension:   ${manifest.allowed_extensions[0]}`);
  console.log('');
  if (args.skipOfficecli) {
    console.log('OfficeCLI install skipped by --skip-officecli.');
  }
}

function status(args) {
  const installDir = getHostInstallDir();
  const hostPath = resolve(installDir, 'shell-mcp-host.mjs');
  const wrapperPath = resolve(installDir, platform() === 'win32' ? 'shell-mcp-host.exe' : 'shell-mcp-host');
  const manifestPath = getManifestPath(args.browser);
  const manifest = readManifest(manifestPath);
  const officeCli = findCompatibleOfficeCli();
  const isReady = Boolean(manifest && existsSync(hostPath) && existsSync(manifest.path ?? wrapperPath));

  console.log('Doubao WPlus Shell Native Host status');
  console.log(`Browser:      ${args.browser}`);
  console.log(`Host name:    ${HOST_NAME}`);
  console.log(`Install dir:  ${installDir}`);
  console.log(`Host script:  ${existsSync(hostPath) ? 'found' : 'missing'} (${hostPath})`);
  console.log(`Wrapper:      ${existsSync(wrapperPath) ? 'found' : 'missing'} (${wrapperPath})`);
  console.log(`Manifest:     ${manifest ? 'found' : 'missing'} (${manifestPath})`);
  if (manifest) {
    console.log(`Target path:  ${manifest.path}`);
    if (manifest.allowed_origins) console.log(`Origins:      ${manifest.allowed_origins.join(', ')}`);
    if (manifest.allowed_extensions) console.log(`Extensions:   ${manifest.allowed_extensions.join(', ')}`);
  }
  if (platform() === 'win32') {
    const regKey = getRegistryKey(args.browser);
    if (regKey) console.log(`Registry:     ${regKey}`);
  }
  console.log(`OfficeCLI:    ${officeCli ? `compatible (${officeCli})` : 'missing or incompatible'}`);

  if (!isReady) {
    process.exitCode = 1;
  }
}

function uninstall(args) {
  const manifestPath = getManifestPath(args.browser);
  rmSync(manifestPath, { force: true });
  if (platform() === 'win32') {
    removeWindowsRegistry(args.browser);
  }
  rmSync(getHostInstallDir(), { recursive: true, force: true });
  console.log(`Removed Shell Native Host for ${args.browser}.`);
  console.log('OfficeCLI was left in place because it may be shared by other tools.');
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.command === 'status') {
    status(args);
    return;
  }
  if (args.command === 'uninstall') {
    uninstall(args);
    return;
  }

  install(args);
  if (!args.skipOfficecli) {
    await ensureOfficeCliInstalled({ force: args.forceOfficecli });
  }
  console.log(`\nDone. Restart ${args.browser} to activate.`);
}

const isDirect = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main().catch((err) => {
    console.error(`\nInstall failed: ${err.message}`);
    process.exit(1);
  });
}
