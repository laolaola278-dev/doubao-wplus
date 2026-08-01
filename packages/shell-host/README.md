# doubao-wplus-shell-host

Native Messaging Shell MCP host installer for Doubao WPlus.

```bash
npx doubao-wplus-shell-host install --browser chrome --extension-id <extension-id>
```

The installer writes the browser Native Messaging manifest, installs the Shell MCP host into the user's profile directory, and installs command-based OfficeCLI by default.

Useful commands:

```bash
npx doubao-wplus-shell-host status --browser chrome
npx doubao-wplus-shell-host uninstall --browser chrome
```

<!-- backward compat: old brand — deprecated npm package name -->
The former `deepseek-pp-shell-host` package name is deprecated. Existing installations should be migrated by installing the new package and registering the new `com.doubao_wplus.shell` host.
