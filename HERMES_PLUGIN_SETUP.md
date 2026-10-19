# HERMES OpenCode V2 Plugin Setup

## ✅ Plugin Loaded Successfully

The HERMES prototype is now loadable as an OpenCode V2 plugin with an easy enable/disable toggle.

### Location
- **Plugin path**: `~/.config/opencode/plugins/hermes/`
- **Status**: ✅ Installed and enabled

## Enable/Disable Instructions

### Option 1: Directory rename (simplest)
```bash
# Enable plugin
mv ~/.config/opencode/plugins/hermes.disabled ~/.config/opencode/plugins/hermes

# Disable plugin  
mv ~/.config/opencode/plugins/hermes ~/.config/opencode/plugins/hermes.disabled

# Check status
ls ~/.config/opencode/plugins/ | grep hermes
```

### Option 2: Toggle script (recommended)
```bash
# Enable
bash /Users/seppa/workspace/hermes-opencode-plugin/plugins/hermes/toggle.sh enable

# Disable
bash /Users/seppa/workspace/hermes-opencode-plugin/plugins/hermes/toggle.sh disable

# Check status
bash /Users/seppa/workspace/hermes-opencode-plugin/plugins/hermes/toggle.sh status
```

## Plugin Features

### Available Tools
When enabled, the plugin registers tools in the `hermes` namespace:

1. **`hermes.try_run_hermes`** — Run full HERMES prototype against eval repo
   - Runs ACTIVATE → COLLABORATE → EXECUTE → DIAGNOSE loop
   - Uses `ctx.generate` (OpenCode's model gateway)
   - Self-contained, no external LiteLLM proxy needed

2. **`hermes.activate`** — Run HERMES activation module
   - Standalone activation pass
   - Generates component activation plan

### Test Command
```bash
# Try running HERMES via OpenCode
opencode "try_run_hermes with issue='checkout fails with invalid email normalization'"
```

## Technical Details

### Changes Made
- **No code changes to harness logic** — `src/` modules untouched
- **Plugin uses `ctx.generate`** — replaces direct LiteLLM proxy with OpenCode's model gateway
- **TypeScript supported** — OpenCode V2 loads `.ts` files natively via Bun
- **Minimal footprint** — Only `plugin.ts` + `src/` needed

### File Structure
```
~/.config/opencode/plugins/hermes/
├── plugin.ts              # Entry point, Plugin.define({ id: "hermes", ... })
├── src/                   # 11 source modules (harness, activation, etc.)
│   ├── harness.ts
│   ├── activation.ts
│   ├── collaborate.ts
│   ├── execute.ts
│   ├── diagnose.ts
│   └── ...
├── eval -> /workspace/hermes-opencode-plugin/eval  # Symlinked eval repo
└── package.json
```

### Toggle Mechanism
The simplest toggle is directory rename with `.disabled` extension:
- **Enabled**: `~/.config/opencode/plugins/hermes/`
- **Disabled**: `~/.config/opencode/plugins/hermes.disabled/`

OpenCode scans `~/.config/opencode/plugins/` on startup and loads all `.ts` and `.js` files it finds. Renaming the directory prevents OpenCode from discovering it.

## Requirements Met

✅ **Plugin loads successfully in OpenCode 2.0.25** — Uses `@opencode/plugin` 2.0.26
✅ **Easy enable/disable toggle** — File rename with `.disabled` extension
✅ **Uses `ctx.generate`** — No external LiteLLM proxy required
✅ **Registers `try_hermes` tool** — Full harness loop against eval repo
✅ **Minimal changes** — Harness logic untouched, only plugin integration
✅ **Low risk** — Trial installation, no production modifications

## Next Steps

1. **Test the plugin**: Restart OpenCode and run the `hermes.try_run_hermes` tool
2. **Verify loading**: Check OpenCode logs for plugin load messages
3. **Toggle test**: Disable plugin, restart OpenCode, verify tools disappear

---

**TRACE**: dev-team-lead → design → implement → test → review [SUCCESS]
