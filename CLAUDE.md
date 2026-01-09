# CLAUDE.md - Project Rules for Redirect Blocker Extension

## Project Overview

Chrome extension (Manifest V3) that prevents websites from detecting multiple open tabs and forcing unwanted redirects. Uses aggressive JavaScript interception in the page's MAIN world context.

## Architecture

```
src/
├── background/service-worker.js  # Central state, IPC, script injection
├── content/blocker.js            # Protection logic (MAIN world)
└── popup/                        # Settings UI (html, js, css)
```

## Code Style Rules

### JavaScript

1. **Use async/await** - Never use raw Promises with `.then()` chains
2. **Error handling** - Always wrap chrome API calls in try-catch blocks
3. **Logging prefix** - Use `[RedirectBlocker]` prefix for all console logs
4. **IIFE for content scripts** - Wrap content scripts in `(function() { 'use strict'; ... })();`
5. **Section comments** - Use banner comments for major sections:
   ```javascript
   // ============================================
   // Section Name
   // ============================================
   ```

### Naming Conventions

- Functions: `camelCase` - `getSettings()`, `shouldProtect()`
- Constants: `UPPER_SNAKE_CASE` - `DEFAULT_SETTINGS`, `SUSPICIOUS_KEYS`
- Private vars: prefix with underscore - `this._channelName`
- DOM IDs: `camelCase` - `siteHostname`, `totalBlocked`
- CSS classes: `kebab-case` - `mode-option`, `stat-item`

### Chrome Extension Patterns

1. **Message handling** - Use async wrapper pattern:
   ```javascript
   chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
       const handleAsync = async () => { /* ... */ };
       handleAsync().then(sendResponse);
       return true; // Keep channel open for async response
   });
   ```

2. **Settings management** - Always merge with defaults:
   ```javascript
   const result = await chrome.storage.local.get('settings');
   return { ...DEFAULT_SETTINGS, ...result.settings };
   ```

3. **Script injection** - Use `injectImmediately: true` and `world: 'MAIN'`:
   ```javascript
   await chrome.scripting.executeScript({
       target: { tabId, allFrames: true },
       files: ['src/content/blocker.js'],
       injectImmediately: true,
       world: 'MAIN'
   });
   ```

## Content Script Rules (blocker.js)

### Override Patterns

1. **Store original before override**:
   ```javascript
   const OriginalBroadcastChannel = window.BroadcastChannel;
   window.BroadcastChannel = BlockedBroadcastChannel;
   ```

2. **Preserve prototype chain**:
   ```javascript
   window.Function.prototype = NativeFunction.prototype;
   window.Function.prototype.constructor = window.Function;
   ```

3. **Use Object.defineProperty for immutable overrides**:
   ```javascript
   Object.defineProperty(window, 'devtoolsDetector', {
       get: () => stubObject,
       set: () => {},
       configurable: false
   });
   ```

4. **Handle override failures gracefully**:
   ```javascript
   try {
       Object.defineProperty(window.location, 'assign', { ... });
   } catch (e) {
       log('Override failed (expected):', e);
   }
   ```

### Protection Priorities

1. Script sanitization (MutationObserver) - runs first
2. Constructor overrides (Function, eval)
3. API overrides (BroadcastChannel, localStorage)
4. Navigation blocking (location, history)
5. Iframe protection (contentWindow hook)

## Popup UI Rules

### CSS

1. **Use CSS custom properties** for theming:
   ```css
   :root {
       --bg-primary: #1a1a2e;
       --accent: #e94560;
       --success: #4ecca3;
   }
   ```

2. **Fixed popup dimensions**: width 300px, min-height 380px

3. **Transitions**: Use `cubic-bezier(0.4, 0, 0.2, 1)` for smooth animations

### JavaScript

1. **Always null-check DOM elements**:
   ```javascript
   const toggle = document.getElementById('siteToggle');
   if (toggle) toggle.addEventListener('change', handler);
   ```

2. **Reload tab after settings change**:
   ```javascript
   if (currentTab?.id) {
       chrome.tabs.reload(currentTab.id);
   }
   ```

## Known Limitations (DO NOT try to fix)

1. `window.location` cannot be overridden in modern browsers - this is expected
2. Server-side detection cannot be blocked client-side
3. Obfuscated code may bypass regex-based sanitization
4. MAIN world scripts can be detected by sophisticated sites

## Testing

1. Use `test/redirect-test.html` for manual testing
2. Test all three modes: Off, Specific Sites, Global
3. Verify badge updates correctly (ON/OFF/blank)
4. Test with DevTools open to verify anti-debugging works

## File Modification Rules

1. **Never modify manifest.json permissions** without explicit approval
2. **Keep blocker.js self-contained** - no imports/exports (MAIN world limitation)
3. **Service worker must use ES modules** - `"type": "module"` in manifest
4. **Icons must be exact sizes**: 16x16, 48x48, 128x128 PNG

## IPC Message Types

| Message | Direction | Purpose |
|---------|-----------|---------|
| `GET_SETTINGS` | popup -> bg | Load current settings |
| `SET_MODE` | popup -> bg | Change protection mode |
| `IS_SITE_ENABLED` | popup -> bg | Check if site is in list |
| `SHOULD_PROTECT` | any -> bg | Check if protection active |
| `ENABLE_FOR_SITE` | popup -> bg | Add site to list |
| `DISABLE_FOR_SITE` | popup -> bg | Remove site from list |
| `GET_STATISTICS` | popup -> bg | Load block counts |
| `INCREMENT_BLOCKED` | content -> bg | Update block count |
| `RESET_STATISTICS` | popup -> bg | Clear all stats |
| `LOG_ENTRY` | content -> bg | Forward logs to service worker |

## Common Pitfalls

1. **Don't use `console.log` directly in content script** - use the `log()` helper that forwards to service worker
2. **Don't modify Storage.prototype without checking key** - may break legitimate site functionality
3. **Don't block all navigation** - only block suspicious same-origin redirects
4. **Don't forget to increment blockedCount** - stats tracking requires this
5. **Don't use ES modules in content script** - MAIN world doesn't support them

## Git Commit Rules

**When to commit:**
- After completing a logical unit of work (feature, bug fix, refactor)
- Before making breaking changes
- When code is in a functional, working state
- After fixing issues identified in code reviews

**Commit message format:**
```
<type>: <short description>

<optional body with details>

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `refactor`: Code refactoring (no functional change)
- `docs`: Documentation only
- `style`: Code style/formatting
- `test`: Adding/updating tests

**Rules:**
1. NEVER commit code that doesn't work or has syntax errors
2. ALWAYS test that the extension loads without errors before committing
3. Keep commits atomic - one logical change per commit
4. Write clear, descriptive commit messages
5. Reference issue numbers if applicable

**Pre-commit checklist:**
- [ ] Extension loads in Chrome without errors
- [ ] No console errors in service worker
- [ ] Popup opens and displays correctly
- [ ] Changed functionality works as expected

## Build & Deploy

- No build process required - vanilla JS
- Load unpacked at `chrome://extensions/`
- Enable Developer mode for testing
