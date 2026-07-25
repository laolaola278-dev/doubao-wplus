# Custom CSS and Theme Preset Policy

Status: no-go for arbitrary custom CSS in the browser extension and Android WebView.

doubao-wplus should not inject user-authored or remote CSS into DeepSeek pages. The feature has a poor store-review posture, broad breakage risk on DeepSeek DOM changes, and a high support cost because styling bugs can look like product regressions.

Allowed theme work is limited to bounded first-party controls:

- Built-in light/dark theme behavior already supported by the extension.
- First-party background image and floating pet controls with explicit user action.
- Future first-party theme presets only if they are shipped in the extension bundle, do not fetch remote CSS, and can be disabled without affecting prompt, memory, Skill, MCP, export, or Android bridge behavior.

Rejected for this phase:

- Remote CSS URLs.
- Arbitrary text-area CSS injection.
- Marketplace/theme sharing that executes unreviewed styling payloads.
- CSS that changes DeepSeek request, auth, sync, or tool execution surfaces.

This keeps Phase 5 product polish compatible with store policy and Android WebView boundaries while leaving room for bounded built-in presets later.
