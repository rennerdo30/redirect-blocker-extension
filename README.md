# Redirect Blocker Extension

A Chrome extension (Manifest V3) that stops websites from detecting your other open tabs and
kicking you back to the homepage. It also neutralizes the anti-debugging tricks such sites tend to
use, so the page stays usable with DevTools open.

No build step, no dependencies, no telemetry: plain HTML/CSS/JavaScript loaded as an unpacked
extension. All settings and counters live in `chrome.storage.local` on your machine.

## Features

- **Multi-tab protection** — blocks `BroadcastChannel` and `localStorage`-based tab detection.
- **Anti-redirect** — blocks forced navigations to the homepage or login page, plus reload loops.
- **Anti-debugging** — neutralizes `debugger` statements, the `devtools-detector` library and
  right-click blockers.
- **Script sanitization** — strips `debugger` from inline and fetched scripts before they run.
- **Three operation modes** — off, per-site opt-in (default), or global.
- **Per-tab badge** — the toolbar icon shows `ON`, `OFF` or nothing for the current tab.
- **Light and dark popup UI** — follows your system theme, with a manual override in the popup.

## Installation

1. Clone or download this repository.
2. Open Chrome (or another Chromium browser such as Edge) and go to `chrome://extensions/`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked**.
5. Select the `redirect-blocker-extension` folder.

## Usage

1. Pin the extension icon to your browser toolbar.
2. On a site that misbehaves when several tabs are open:
   - Click the extension icon.
   - Keep the mode at **Specific sites** (recommended).
   - Switch the toggle in **Current site** on.
3. The tab reloads automatically and protection is active — the badge shows `ON`.

The popup also shows how many redirect attempts were blocked and how many sites were affected, and
lets you reset those counters. The theme button in the popup header cycles through
system → light → dark.

### Operation modes

| Mode | Behaviour |
|------|-----------|
| **Off** | Nothing is injected; badge shows `OFF`. |
| **Specific sites** (default) | Protection runs only on hostnames you enabled. |
| **Global** | Protection runs on every `http(s)` page. |

Internal pages (`chrome://`, extension pages, local files) cannot be scripted by any extension, so
the per-site toggle is disabled there.

## Project structure

```
manifest.json                     # MV3 manifest (permissions, popup, service worker)
src/background/service-worker.js  # State, messaging, badge, script injection
src/content/blocker.js            # Protection logic, injected into the page's MAIN world
src/popup/                        # Popup UI: popup.html, popup.css, popup.js, theme.js
test/redirect-test.html           # Manual test page that simulates tab detection
icons/                            # 16 / 48 / 128 px action icons
```

After editing any file, press the reload button on the extension card in `chrome://extensions/`.
Open `test/redirect-test.html` in two tabs to exercise the detection paths by hand.

## How it works

- **Script sanitization** — a `MutationObserver` rewrites `<script>` tags, and `fetch` /
  `XMLHttpRequest` are wrapped to strip `debugger` from loaded `.js` files.
- **Iframe tunneling** — `HTMLIFrameElement.prototype.contentWindow` is hooked so fresh iframes get
  the same protections instead of being used as a clean escape hatch.
- **Constructor tunneling** — `Function.prototype.constructor` is proxied to catch dynamic code such
  as `(function(){}).constructor("debugger")()`.
- **Reload prevention** — `location.reload()` and `history.go(0)` loops are blocked.
- **Log forwarding** — content-script logs are forwarded to the service worker so they survive
  navigations.

## Permissions

| Permission | Why it is needed |
|------------|------------------|
| `storage` | Persist mode, enabled sites and counters locally. |
| `activeTab` | Read the hostname of the tab shown in the popup. |
| `scripting` | Inject the blocker into protected pages. |
| `tabs` | Detect navigations and update the per-tab badge. |
| `<all_urls>` | Required because protection can be enabled for any site you choose. |

## Limitations

- `window.location` cannot be fully overridden in modern browsers; the other protections still apply.
- Server-side session tracking cannot be blocked from the page.
- Sites may obfuscate their `localStorage` key names to slip past key filtering.
- Firefox is untested — the manifest needs adjustments there.

See [ISSUES.md](ISSUES.md) for the current status and [SPECIFICATION.md](SPECIFICATION.md) for the
detailed behaviour matrix.

## License

[MIT](LICENSE)
