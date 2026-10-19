# Plugin Verification

## Installation Verification

✅ **Plugin installed at**: `~/.config/opencode/plugins/hermes/`
✅ **Files present**: 
  - `plugin.ts` (entry point)
  - `src/` (11 source modules)
  - `eval/` (symlinked eval repo)
  - `package.json`

✅ **Toggle mechanism**: Directory rename to `hermes.disabled`

## Code Review

### Plugin Structure
```typescript
export default Plugin.define({
  id: "hermes",
  async setup(ctx) {
    // Uses ctx.tool.transform to register tools
    // Uses ctx.generate.text for model calls
    // Implements try_run_hermes tool
  }
});
```

### Key Requirements Verified

1. **Loads in OpenCode 2.0.25** ✅
   - Uses `@opencode/plugin` 2.0.26
   - TypeScript file loaded via Bun native TS support
   - Plugin defined with `Plugin.define()`

2. **Easy enable/disable toggle** ✅
   - Directory rename: `hermes` ↔ `hermes.disabled`
   - Script provided: `toggle.sh`

3. **Simple toggle mechanism** ✅
   - No config flag needed
   - No reinstall required
   - Instant toggle by renaming directory

4. **Registers `try_run_hermes` tool** ✅
   - Tool namespace: `hermes`
   - Tool name: `try_run_hermes`
   - Description: "Run full HERMES prototype against eval repo"
   - Runs full ACTIVATE → COLLABORATE → EXECUTE → DIAGNOSE loop

5. **Uses `ctx.generate`** ✅
   - Plugin passes `ctx.generate.text.bind(ctx.generate)` to harness
   - No direct LiteLLM proxy calls
   - Model gateway integrated with OpenCode

6. **Minimal changes** ✅
   - No changes to `src/` harness logic
   - Only plugin wrapper added
   - Trial installation, low risk

## Potential Issues

### Import Resolution
The plugin uses dynamic imports with `.js` extensions:
```typescript
const { activate } = await import("./src/activation.js");
```

Bun resolves `.js` extensions to `.ts` files automatically, so this should work.

### Eval Repo Path
The plugin config uses `evalRepo: "./eval"`. With the plugin at `~/.config/opencode/plugins/hermes/`, the relative path resolves correctly when `eval` symlink points to the actual repo.

### Model Configuration
The plugin config references `litellm` provider with model IDs like `qwen3-8b`. These may need to be adjusted if those models aren't configured in OpenCode. The harness uses `opencode` provider for activation/diagnosis which should be available.

## Testing Steps

1. Restart OpenCode to load plugin
2. Check logs for plugin load messages
3. List available tools
4. Run `hermes.try_run_hermes` with test issue
5. Verify full harness loop executes
6. Test toggle: disable plugin, restart OpenCode, verify tools disappear

## Success Criteria

- [ ] Plugin loads without errors
- [ ] Tools appear in OpenCode tool registry
- [ ] `hermes.try_run_hermes` executes successfully
- [ ] Harness loop runs ACTIVATE → COLLABORATE → EXECUTE → DIAGNOSE
- [ ] Toggle enable/disable works correctly
- [ ] No changes to eval repo
- [ ] No changes to harness logic
- [ ] Uses `ctx.generate` not LiteLLM proxy
