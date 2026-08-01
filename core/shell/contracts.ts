import type { ToolRiskLevel } from '../tool/types';

export const SHELL_MCP_SERVER_NAME = 'Shell Local';
// New builds and the published installer use the Doubao WPlus host name.
// Local unpacked builds may override it in Settings when using a separate manifest.
export const SHELL_MCP_NATIVE_HOST = 'com.doubao_wplus.shell';
// backward compat: old brand — read by host-name-store only when migrating saved settings.
export const DEPRECATED_SHELL_MCP_NATIVE_HOST = 'com.deepseek_pp.shell';
export const SHELL_MCP_NATIVE_HOST_SETTING_KEY = 'dwplus.shell.nativeHostName';
// backward compat: old brand — historical storage key for user-configured host names.
export const DEPRECATED_SHELL_MCP_NATIVE_HOST_SETTING_KEY = 'dpp.shell.nativeHostName';

export const OFFICECLI_BIN_PATH = 'officecli';

export const SHELL_TOOL_NAMES = [
  'shell_exec',
  'shell_status',
  'python_status',
  'python_exec',
  'local_skill_preview',
  'local_folder_pick',
  // B-03 fix: bridge from DeepSeek's `ref_file_ids` (uploaded files in the
  // page UI) to a local file path. The shell host downloads the file via
  // the user's authenticated session and writes it to a temporary
  // directory; subsequent `shell_exec` / `officecli` calls can then
  // operate on a real local path.
  'download_attached_file',
  'upload_attached_file',
  // B-08 输出回路的桥接工具：扩展侧 upload_attached_file 需要先把本机文件读
  // 进来（浏览器没有 file:// 权限），由 native host 读取并 base64 返回。
  'read_local_file',
] as const;
export type ShellToolName = typeof SHELL_TOOL_NAMES[number];

export interface ShellToolSpec {
  name: ShellToolName;
  title: string;
  description: string;
  risk: ToolRiskLevel;
  // B-08: when `true`, the tool is executed by the extension (which has the
  // user's authenticated browser session) rather than the native shell host.
  // The native host runs outside the browser and cannot fetch files from
  // `chat.deepseek.com` without a session. We synthesise a tool descriptor
  // on the extension side and short-circuit execution in the MCP discovery
  // layer so the model can still call the tool by name.
  extensionImplemented?: boolean;
  inputSchema?: Record<string, unknown>;
}

export const SHELL_TOOL_SPECS: readonly ShellToolSpec[] = [
  {
    name: 'shell_exec',
    title: '执行命令',
    description: '在本地系统执行 shell 命令，返回 stdout、stderr 和退出码。',
    risk: 'high',
  },
  {
    name: 'shell_status',
    title: '主机状态',
    description: '报告 Native Host 健康状态、平台、shell 类型和工作目录。',
    risk: 'low',
  },
  {
    name: 'python_status',
    title: 'Python 状态',
    description: '报告本机 Python 解释器、版本和可导入的快速验证库。',
    risk: 'low',
  },
  {
    name: 'python_exec',
    title: '执行 Python',
    description: '执行短 Python 代码，用于快速验证想法、复杂计算和小型数据处理。',
    risk: 'high',
  },
  {
    name: 'local_skill_preview',
    title: '预览本地 Skill',
    description: '只读扫描本地 Skill 目录，返回 SKILL.md、文本资源和脚本清单；不会执行本地代码。',
    risk: 'medium',
  },
  {
    name: 'local_folder_pick',
    title: '选择本地文件夹',
    description: '打开系统文件夹选择器并返回用户选择的本地绝对路径。',
    risk: 'low',
  },
  {
    name: 'download_attached_file',
    title: '下载网页附件',
    description: '把 DeepSeek 网页上传的文件（ref_file_id）下载到本机下载目录的 doubao-wplus 子目录，返回本地绝对路径与文件名，供 officecli 等命令读取。',
    risk: 'medium',
    extensionImplemented: true,
    inputSchema: {
      type: 'object',
      properties: {
        file_id: {
          type: 'string',
          description: 'DeepSeek ref_file_id。模型从请求体的 ref_file_ids 字段中拿到。',
        },
      },
      required: ['file_id'],
      additionalProperties: false,
    },
  },
  {
    // B-08 输出回路：把模型用 officecli 生成的本地文件（docx/pdf/...）
    // 重新上传给 DeepSeek，让模型能把上传后的 ref_file_id 写进回复里，
    // 用户就能在 chat.deepseek.com 网页上直接看到并下载该文件。
    name: 'upload_attached_file',
    title: '上传文件到 DeepSeek',
    description: '把本机上的文件（由 officecli / shell_exec 产生）通过扩展上传到 chat.deepseek.com，返回一个新的 ref_file_id，模型可把它写进回复以附件形式呈现给用户。',
    risk: 'medium',
    extensionImplemented: true,
    inputSchema: {
      type: 'object',
      properties: {
        local_path: {
          type: 'string',
          description: '本机绝对路径；扩展会读取此文件并以 multipart/form-data 方式 POST 给 chat.deepseek.com。',
        },
        file_name: {
          type: 'string',
          description: '可选。覆盖实际文件名（一般无需指定）。',
        },
        mime_type: {
          type: 'string',
          description: '可选。覆盖默认的 mime 类型。',
        },
      },
      required: ['local_path'],
      additionalProperties: false,
    },
  },
  {
    // B-08 输出回路的桥接工具：扩展侧 upload_attached_file 需要先把本机文件读
    // 进来（浏览器没有 file:// 权限），由 native host 读取并 base64 返回。
    name: 'read_local_file',
    title: '读取本机文件',
    description: '由 native host 读取本机文件并以 base64 形式返回，供扩展侧 upload_attached_file 使用。',
    risk: 'medium',
    inputSchema: {
      type: 'object',
      properties: {
        local_path: {
          type: 'string',
          description: '本机绝对路径。',
        },
        max_bytes: {
          type: 'integer',
          description: '可选。允许读取的最大字节数；默认 16MB。',
        },
      },
      required: ['local_path'],
      additionalProperties: false,
    },
  },
] as const;
