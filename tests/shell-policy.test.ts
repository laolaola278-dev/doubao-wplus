import { describe, expect, it } from 'vitest';
import { createShellMcpPresetInput } from '../core/shell/policy';

describe('createShellMcpPresetInput', () => {
  it('defaults Shell MCP to explicit manual opt-in', () => {
    const preset = createShellMcpPresetInput();

    expect(preset.enabled).toBe(false);
    // B-02 fix: high-risk exec tools are listed so the model can reach
    // them, but execution defaults to manual so each call still requires
    // explicit user confirmation.
    //
    // B-03 fix: `download_attached_file` is the bridge between DeepSeek
    // `ref_file_ids` and a local path, so it must be in the default
    // allowlist alongside the exec tools.
    //
    // B-08 fix: `read_local_file` is the symmetric bridge for the output
    // path (model reads a local file via the native host, then the
    // extension uploads it back to DeepSeek). It must be allowed so the
    // upload pipeline can run end-to-end.
    expect(preset.allowlist).toEqual({
      mode: 'allow',
      toolNames: [
        'shell_status',
        'python_status',
        'local_skill_preview',
        'local_folder_pick',
        'shell_exec',
        'python_exec',
        'download_attached_file',
        'read_local_file',
      ],
    });
    expect(preset.execution).toEqual({ enabled: false, mode: 'manual' });
  });

  // B-02 regression: shell_exec / python_exec are listed even without options.
  it('exposes shell_exec and python_exec in the default allowlist', () => {
    const preset = createShellMcpPresetInput();
    expect(preset.allowlist?.toolNames).toContain('shell_exec');
    expect(preset.allowlist?.toolNames).toContain('python_exec');
  });

  // B-03 regression: download_attached_file must be reachable without options.
  it('exposes download_attached_file in the default allowlist', () => {
    const preset = createShellMcpPresetInput();
    expect(preset.allowlist?.toolNames).toContain('download_attached_file');
  });

  // B-08 regression: read_local_file must be reachable so the upload
  // bridge (model → native host → extension → DeepSeek) can run.
  it('exposes read_local_file in the default allowlist', () => {
    const preset = createShellMcpPresetInput();
    expect(preset.allowlist?.toolNames).toContain('read_local_file');
  });
});
