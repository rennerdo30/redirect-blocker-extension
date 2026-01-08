# Redirect Blocker Extension

A powerful Chrome extension that prevents websites from detecting multiple open tabs and forcing redirects. Includes advanced anti-debugging capabilities to bypass detection scripts.

## Features

- **🛡️ Multi-Tab Protection**: Blocks BroadcastChannel and localStorage detection methods.
- **🚫 Anti-Redirect**: Prevents forced redirects to homepage or login pages.
- **🔧 Anti-Debugging**: Neutralizes `debugger` statements, `devtools-detector`, and right-click blockers.
- **⚡ Advanced Interception**: Strips malicious code from scripts before they execute.
- **🔍 3 Operation Modes**: Off, Specific Sites (Opt-in), or Global.

## Installation

1. Clone or download this repository.
2. Open Chrome and go to `chrome://extensions/`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked**.
5. Select the `redirect-blocker-extension` folder.

## Usage

1. Pin the extension icon to your browser toolbar.
2. When you visit a site that blocks multiple tabs:
   - Click the extension icon.
   - Ensure mode is **Specific Sites** (recommended).
   - Toggle **Enable for [hostname]**.
3. Reload the page. The protection is now active.

## Technical Capabilities

- **Script Sanitization**: Uses `MutationObserver` and network interception to remove `debugger` statements from inline and loaded scripts.
- **Iframe Tunneling**: Hooks `HTMLIFrameElement.prototype.contentWindow` to inject protections into new iframes immediately.
- **Constructor Tunneling**: Proxies `Function.prototype.constructor` to intercept dynamic code execution (e.g. `(function(){}).constructor("debugger")()`).
- **Library Neutralization**: Targets and neutralizes the `devtools-detector` library.
- **Reload Prevention**: Blocks `location.reload()` loops and `history.go(0)` reloads.
- **Log Forwarding**: Debug logs are forwarded to the Service Worker for persistent analysis.

## License

MIT License
