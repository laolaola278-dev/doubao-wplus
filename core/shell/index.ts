export {
  OFFICECLI_BIN_PATH,
  DEPRECATED_SHELL_MCP_NATIVE_HOST,
  DEPRECATED_SHELL_MCP_NATIVE_HOST_SETTING_KEY,
  SHELL_MCP_NATIVE_HOST,
  SHELL_MCP_NATIVE_HOST_SETTING_KEY,
  SHELL_MCP_SERVER_NAME,
  SHELL_TOOL_NAMES,
  SHELL_TOOL_SPECS,
} from './contracts';

export type {
  ShellToolName,
  ShellToolSpec,
} from './contracts';

export {
  createShellMcpPresetInput,
} from './policy';

export type {
  ShellMcpPresetOptions,
} from './policy';

export {
  getShellNativeHostName,
  setShellNativeHostName,
} from './host-name-store';

export {
  buildTargetFilename,
  downloadAttachedFile,
  DOWNLOAD_ATTACHED_FILE_BYPASS_HEADER,
  DOWNLOAD_ATTACHED_FILE_TARGET_DIR,
  DOWNLOAD_ATTACHED_FILE_TOOL_NAME,
} from './attached-file-downloader';

export type {
  AttachedFileDownloadOutcome,
  AttachedFileDownloadResult,
  AttachedFileDownloadFailure,
  AttachedFileMetadata,
  ChromeDownloadsApi,
  ChromeDownloadItem,
  ChromeDownloadOptions,
  ChromeDownloadQuery,
  DownloadAttachedFileOptions,
} from './attached-file-downloader';

export {
  uploadAttachedFile,
  UPLOAD_ATTACHED_FILE_BYPASS_HEADER,
  UPLOAD_ATTACHED_FILE_DEFAULT_FIELD,
  UPLOAD_ATTACHED_FILE_DEFAULT_PATH,
  UPLOAD_ATTACHED_FILE_MAX_BYTES,
  UPLOAD_ATTACHED_FILE_TOOL_NAME,
} from './attached-file-uploader';

export type {
  UploadAttachedFileOptions,
  UploadAttachedFileOutcome,
  UploadAttachedFileResult,
  UploadAttachedFileFailure,
} from './attached-file-uploader';
