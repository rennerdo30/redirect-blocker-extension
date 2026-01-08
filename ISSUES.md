# Redirect Blocker - Issues

## Open Issues

### Medium Priority

- [ ] **Firefox Compatibility** - Manifest V3 differences may require adjustments for Firefox
- [ ] **location.href Override Limited** - Modern browsers prevent overriding `window.location` (expected, other protections still work)

### Low Priority

- [ ] **Server-side Detection** - Some sites use server-side session tracking which can't be blocked client-side
- [ ] **Obfuscated Keys** - Sites may obfuscate localStorage key names to bypass filtering

## Resolved Issues

- [x] **DevTools Blocking** - Neutralized `devtools-detector` library and `debugger` loops
- [x] **Iframe Evasion** - Blocked attempts to use fresh iframes to bypass global hooks
- [x] **Inline Debugger Statements** - Handled via `MutationObserver` script stripping
- [x] **Reload Loops** - Blocked `location.reload()` and `history` API manipulation
- [x] **Icon not visible in browser** - Icons resized to correct dimensions (16x16, 48x48, 128x128)
- [x] **Popup null reference error** - Added null checks for DOM elements
- [x] **location.assign read-only error** - Wrapped in try-catch

## Future Enhancements

- [ ] Options page with advanced settings
- [ ] Import/export enabled sites list
- [ ] Per-site statistics view
- [ ] Firefox Add-on Store submission
- [ ] Chrome Web Store submission
