# Browser evidence runner

Vendored from the approved codex-ui-evidence skill runner. Original SHA256: `b0c81e48604646dbe96469912c1f26d3a55bc4ad3dbdfe7568bcaedeaf38c5cd`. Only repository formatting is applied.

`capture-ui.mjs` always supplies an already sandboxed Chromium CDP endpoint; the runner's standalone launcher is not used. This preserves the original deterministic checks. The capture driver bounds subprocess time and closes its owned browser.
