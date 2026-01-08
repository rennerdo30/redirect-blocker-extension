# Redirect Blocker - Specification

## Overview

Browser extension that prevents websites from detecting and redirecting multiple open tabs to the homepage. It includes advanced anti-debugging protections to neutralize evasive scripts.

## Operation Modes

| Mode | Description |
|------|-------------|
| **Off** | Extension completely disabled |
| **Specific Sites** | Protection enabled only for sites in the enabled list (default) |
| **Global** | Protection active on all websites |

## Features

### Detection Blocking

| Mechanism | How It's Blocked |
|-----------|------------------|
| BroadcastChannel API | Constructor replaced with stub |
| localStorage `storage` events | Event listener registration blocked |
| Suspicious localStorage keys | Writes to tab-detection keys blocked |
| Homepage redirects | `location.href` setters to `/` or suspicious paths blocked |
| Reload Loops | `location.reload()` and `history` navigation blocked |

### Anti-Debugging & Script Neutralization

| Technique | Defense Mechanism |
|-----------|------------------|
| **DevTools Detection** | `devtools-detector` library specifically neutralized via object stubbing |
| **Inline Debugger** | `MutationObserver` intercepts `<script>` tags, strips `debugger`, and re-injects |
| **Dynamic Debugger** | `Function` constructor and `eval` overridden to strip `debugger` from code |
| **Constructor Tunneling** | `Function.prototype.constructor` proxied to return a safe wrapper, preventing `(function(){}).constructor` bypasses |
| **Iframe Tunneling** | `HTMLIFrameElement.prototype.contentWindow` hooked to protecting new windows/iframes on creation |
| **Loaded Scripts** | `fetch` and `XMLHttpRequest` intercepted to strip `debugger` from .js files |
| **Console Clearing** | `console.clear()` blocked to prevent hiding logs |
| **Right-Click Block** | Context menu blocking prevented |

### Suspicious Keys Blocked

- `tabActive`, `tabCount`, `openTabs`
- `tabId`, `tabSession`, `tabHeartbeat`
- `multipleInstances`, `singleInstance`

## Technical Details

- **Manifest Version**: 3 (Chrome MV3)
- **Content Script World**: `MAIN` (same context as page scripts) for maximum interception power
- **Injection**: Programmatic (only on enabled sites/modes)
- **Log Forwarding**: Content script logs are forwarded to the Service Worker for persistent debugging

## Permissions

| Permission | Purpose |
|------------|---------|
| `storage` | Store settings and statistics |
| `activeTab` | Get current tab info |
| `scripting` | Inject content scripts |
| `tabs` | Monitor tab navigation and injection |

## Browser Support

- ✅ Chrome (primary)
- ✅ Edge (Chromium-based)
- ⚠️ Firefox (needs manifest adjustments)
