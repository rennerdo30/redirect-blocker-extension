# Redirect Blocker Extension

A powerful Chrome extension that prevents websites from detecting multiple open tabs and forcing redirects. Includes advanced anti-debugging capabilities to bypass detection scripts.

Built as an unpacked Manifest V3 extension - it is not published on the Chrome Web Store, so it has to be loaded in developer mode.

## Features

- **🛡️ Multi-Tab Protection**: Blocks BroadcastChannel and localStorage detection methods.
- **🚫 Anti-Redirect**: Prevents forced redirects to homepage or login pages.
- **🔧 Anti-Debugging**: Neutralizes `debugger` statements, `devtools-detector`, and right-click blockers.
- **⚡ Advanced Interception**: Strips malicious code from scripts before they execute.
- **🔍 3 Operation Modes**: Off, Specific Sites (Opt-in), or Global.
- **📊 Statistics**: Counts blocked actions per site, shown in the popup and resettable there.

## Installation

1. Clone or download this repository.
2. Open Chrome and go to `chrome://extensions/`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked**.
5. Select the `redirect-blocker-extension` folder (the one containing `manifest.json`).

## Usage

1. Pin the extension icon to your browser toolbar.
2. When you visit a site that blocks multiple tabs:
   - Click the extension icon.
   - Ensure mode is **Specific Sites** (recommended).
   - Toggle **Enable for [hostname]**.
3. Reload the page. The protection is now active.

## Operation modes

Settings are stored in `chrome.storage.local` under the `settings` key.

| Mode | Behaviour |
|------|-----------|
| `off` | No injection at all. |
| `specific` | Default. Protection only on hostnames in the `enabledSites` list, which the popup toggle maintains. |
| `global` | Protection on every site. |

The content script is injected at `document_start` into the MAIN world, so protections are in
place before page scripts run. Because injection is per-site, the page has to be reloaded after
enabling a hostname.

## Technical Capabilities

- **Script Sanitization**: Uses `MutationObserver` and network interception to remove `debugger` statements from inline and loaded scripts.
- **Iframe Tunneling**: Hooks `HTMLIFrameElement.prototype.contentWindow` to inject protections into new iframes immediately.
- **Constructor Tunneling**: Proxies `Function.prototype.constructor` to intercept dynamic code execution (e.g. `(function(){}).constructor("debugger")()`).
- **Library Neutralization**: Targets and neutralizes the `devtools-detector` library.
- **Reload Prevention**: Blocks `location.reload()` loops and `history.go(0)` reloads.
- **Log Forwarding**: Debug logs are forwarded to the Service Worker for persistent analysis.

## Project structure

```
manifest.json                    Manifest V3 definition
src/background/service-worker.js Settings, per-site state, statistics, log collection
src/content/blocker.js           Injected protections (document_start, MAIN world)
src/popup/                       Popup UI (mode selection, per-site toggle, statistics)
test/redirect-test.html          Local page for trying the protections out
icons/                           Extension icons
```

Requested permissions: `storage`, `activeTab`, `scripting`, `tabs`, plus `<all_urls>` host
permissions (needed because protection can be enabled for any hostname).

## Known limitations

- Server-side session tracking cannot be blocked from the client.
- Modern browsers do not allow `window.location` itself to be replaced, so `location.href`
  overriding is limited - the remaining protections still apply.
- Only tested against Chromium-based browsers; Manifest V3 differences mean Firefox needs work.

See [ISSUES.md](ISSUES.md) for the current issue list and [SPECIFICATION.md](SPECIFICATION.md)
for the design notes.

## License

MIT License - see [LICENSE](LICENSE).
