# Obsidian sync plugin

This small plugin mirrors the latest generated weekly coaching observation notes from the Cloudflare Worker into an Obsidian vault.

It does **not** expose the vault to the internet. The Worker stays the 24/7 source and Obsidian catches up whenever the app is open.

## Install

Copy this folder to:

```
<Vault>/.obsidian/plugins/coach-reflection-sync/
```

Required files:

- `main.js`
- `manifest.json`

Then enable **Coach Reflection Sync** in Obsidian → Settings → Community plugins.

Set:

- Worker endpoint
- Sync token (same as Cloudflare secret `OBSIDIAN_SYNC_TOKEN`)
- Interval, default 10 minutes

The generated weekly files are intentionally treated as bot-owned mirrors. Edit coaching notes elsewhere if you do not want local edits overwritten.
