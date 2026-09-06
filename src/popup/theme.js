/**
 * Redirect Blocker - Theme Bootstrap
 *
 * Loaded synchronously from <head> so the resolved theme is applied before the
 * first paint (no flash of the wrong theme). Uses localStorage because it is
 * synchronous; chrome.storage is async and would paint first.
 *
 * Stored value is one of THEME_SYSTEM | THEME_LIGHT | THEME_DARK.
 */

(function () {
    'use strict';

    // ============================================
    // Constants
    // ============================================

    const THEME_STORAGE_KEY = 'redirectBlocker.theme';
    const THEME_SYSTEM = 'system';
    const THEME_LIGHT = 'light';
    const THEME_DARK = 'dark';
    const THEME_ORDER = [THEME_SYSTEM, THEME_LIGHT, THEME_DARK];
    const LIGHT_MEDIA_QUERY = '(prefers-color-scheme: light)';

    // ============================================
    // Preference Handling
    // ============================================

    function getPreference() {
        try {
            const stored = localStorage.getItem(THEME_STORAGE_KEY);
            return THEME_ORDER.includes(stored) ? stored : THEME_SYSTEM;
        } catch {
            // Storage can be unavailable (e.g. blocked). Fall back to the OS setting.
            return THEME_SYSTEM;
        }
    }

    function setPreference(preference) {
        try {
            localStorage.setItem(THEME_STORAGE_KEY, preference);
        } catch {
            // Non-fatal: the theme still applies for this popup session.
        }
    }

    function resolve(preference) {
        if (preference === THEME_LIGHT || preference === THEME_DARK) return preference;
        return window.matchMedia(LIGHT_MEDIA_QUERY).matches ? THEME_LIGHT : THEME_DARK;
    }

    function apply(preference) {
        document.documentElement.dataset.theme = resolve(preference);
    }

    function nextPreference(preference) {
        const index = THEME_ORDER.indexOf(preference);
        return THEME_ORDER[(index + 1) % THEME_ORDER.length];
    }

    // Apply immediately, before the document body is parsed.
    apply(getPreference());

    // Follow the OS while the popup is open and no explicit choice was made.
    window.matchMedia(LIGHT_MEDIA_QUERY).addEventListener('change', () => {
        const preference = getPreference();
        if (preference === THEME_SYSTEM) apply(THEME_SYSTEM);
    });

    window.RedirectBlockerTheme = {
        SYSTEM: THEME_SYSTEM,
        LIGHT: THEME_LIGHT,
        DARK: THEME_DARK,
        getPreference,
        setPreference,
        apply,
        resolve,
        nextPreference
    };
})();
