/**
 * Redirect Blocker - Popup Script
 *
 * Handles mode selection, per-site toggle, statistics and theme switching.
 */

// ============================================
// Constants
// ============================================

const MODE_SPECIFIC = 'specific';
const PROTECTABLE_PROTOCOLS = ['http:', 'https:'];
const TOAST_DURATION_MS = 3000;
const RELOAD_DELAY_MS = 300;
const RESET_CONFIRM_TIMEOUT_MS = 4000;
const COMPACT_NUMBER_THRESHOLD = 10000;

const MODE_LABELS = {
    off: 'Off',
    specific: 'Specific sites',
    global: 'Global'
};

const THEME_LABELS = {
    system: 'Theme: follow system',
    light: 'Theme: light',
    dark: 'Theme: dark'
};

const TEXT = {
    hostnameNoPage: 'No page selected',
    hostnameInternalPage: 'Internal browser page',
    statusProtected: 'Protected',
    statusNotProtected: 'Not protected',
    statusUnavailable: 'Protection is not available on this page',
    loadFailed: 'Could not load extension data.',
    settingsLoadFailed: 'Failed to load settings',
    statsLoadFailed: 'Failed to load statistics',
    modeChangeFailed: 'Failed to change mode',
    toggleFailed: 'Failed to toggle protection',
    statsResetFailed: 'Failed to reset statistics',
    statsReset: 'Statistics reset',
    resetLabel: 'Reset statistics',
    resetConfirmLabel: 'Confirm reset'
};

// ============================================
// State
// ============================================

let currentTab = null;
let currentHostname = null;
let isProtectablePage = false;
let toastTimeout = null;
let resetConfirmTimeout = null;
let resetConfirmPending = false;

document.addEventListener('DOMContentLoaded', init);

// ============================================
// Toast Notifications
// ============================================

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) return;

    if (toastTimeout) clearTimeout(toastTimeout);

    toast.classList.remove('show', 'error', 'success');
    toast.textContent = message;
    if (type === 'error') toast.classList.add('error');
    if (type === 'success') toast.classList.add('success');

    requestAnimationFrame(() => toast.classList.add('show'));

    toastTimeout = setTimeout(() => {
        toast.classList.remove('show');
    }, TOAST_DURATION_MS);
}

// ============================================
// Error Banner
// ============================================

function showErrorBanner(message = TEXT.loadFailed) {
    const banner = document.getElementById('errorBanner');
    const bannerMessage = document.getElementById('errorBannerMessage');
    if (bannerMessage) bannerMessage.textContent = message;
    if (banner) banner.hidden = false;
}

function hideErrorBanner() {
    const banner = document.getElementById('errorBanner');
    if (banner) banner.hidden = true;
}

// ============================================
// Theme
// ============================================

function renderTheme(preference) {
    const button = document.getElementById('themeToggle');
    if (!button) return;

    const label = THEME_LABELS[preference] || THEME_LABELS.system;
    button.setAttribute('aria-label', label);
    button.title = label;

    const icons = {
        system: button.querySelector('.icon-theme-system'),
        light: button.querySelector('.icon-theme-light'),
        dark: button.querySelector('.icon-theme-dark')
    };
    Object.entries(icons).forEach(([name, icon]) => {
        if (icon) icon.hidden = name !== preference;
    });
}

function initTheme() {
    const theme = window.RedirectBlockerTheme;
    const button = document.getElementById('themeToggle');
    if (!theme || !button) return;

    renderTheme(theme.getPreference());

    button.addEventListener('click', () => {
        const next = theme.nextPreference(theme.getPreference());
        theme.setPreference(next);
        theme.apply(next);
        renderTheme(next);
    });
}

// ============================================
// Initialization
// ============================================

async function init() {
    initTheme();

    const siteToggle = document.getElementById('siteToggle');
    const resetButton = document.getElementById('resetStats');
    const retryButton = document.getElementById('errorRetry');

    document.querySelectorAll('input[name="mode"]').forEach(radio => {
        radio.addEventListener('change', handleModeChange);
    });
    if (siteToggle) siteToggle.addEventListener('change', handleSiteToggle);
    if (resetButton) resetButton.addEventListener('click', handleResetStats);
    if (retryButton) retryButton.addEventListener('click', loadData);

    await resolveCurrentTab();
    await loadData();
}

async function resolveCurrentTab() {
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        currentTab = tabs[0] || null;
    } catch (error) {
        console.error('Failed to query the active tab:', error);
        currentTab = null;
    }

    let url = null;
    if (currentTab?.url) {
        try {
            url = new URL(currentTab.url);
        } catch {
            url = null;
        }
    }

    isProtectablePage = Boolean(url) && PROTECTABLE_PROTOCOLS.includes(url.protocol);
    currentHostname = isProtectablePage ? url.hostname : null;

    const hostnameLabel = currentHostname ||
        (url ? TEXT.hostnameInternalPage : TEXT.hostnameNoPage);
    const hostnameEl = document.getElementById('siteHostname');
    if (hostnameEl) {
        hostnameEl.textContent = hostnameLabel;
        hostnameEl.title = hostnameLabel;
    }

    // Internal pages (chrome://, extension pages, files) cannot be scripted, so
    // the per-site toggle must not pretend otherwise.
    const siteSection = document.getElementById('siteSection');
    const siteToggle = document.getElementById('siteToggle');
    if (siteSection) siteSection.classList.toggle('is-unavailable', !isProtectablePage);
    if (siteToggle) siteToggle.disabled = !isProtectablePage;
    if (!isProtectablePage) setSiteStatus(TEXT.statusUnavailable, false);
}

async function loadData() {
    hideErrorBanner();
    document.body.classList.add('is-loading');

    const results = await Promise.all([loadSettings(), loadStatistics()]);

    document.body.classList.remove('is-loading');
    if (results.includes(false)) showErrorBanner();
}

async function loadSettings() {
    try {
        const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });

        const modeRadio = document.querySelector(`input[name="mode"][value="${settings.mode}"]`);
        if (modeRadio) modeRadio.checked = true;

        updateSiteSectionVisibility(settings.mode);

        const siteToggle = document.getElementById('siteToggle');
        const siteEnabled = Boolean(currentHostname) &&
            Array.isArray(settings.enabledSites) &&
            settings.enabledSites.includes(currentHostname);
        if (siteToggle) siteToggle.checked = siteEnabled;
        if (isProtectablePage) updateSiteStatus(siteEnabled);

        return true;
    } catch (error) {
        console.error('Failed to load settings:', error);
        showToast(TEXT.settingsLoadFailed, 'error');
        return false;
    }
}

async function loadStatistics() {
    try {
        const stats = await chrome.runtime.sendMessage({ type: 'GET_STATISTICS' });
        const totalBlocked = stats?.totalBlocked || 0;
        const sitesAffected = Object.keys(stats?.blockedBySite || {}).length;

        setStatValue('totalBlocked', totalBlocked);
        setStatValue('sitesProtected', sitesAffected);

        const resetButton = document.getElementById('resetStats');
        if (resetButton) resetButton.disabled = totalBlocked === 0 && sitesAffected === 0;

        return true;
    } catch (error) {
        console.error('Failed to load statistics:', error);
        showToast(TEXT.statsLoadFailed, 'error');
        return false;
    }
}

// ============================================
// Rendering Helpers
// ============================================

function setStatValue(elementId, value) {
    const element = document.getElementById(elementId);
    if (!element) return;
    element.textContent = formatNumber(value);
    element.title = formatFullNumber(value);
}

/** Compact, locale-aware formatting for large counts. */
function formatNumber(value) {
    const options = value >= COMPACT_NUMBER_THRESHOLD
        ? { notation: 'compact', maximumFractionDigits: 1 }
        : {};
    return new Intl.NumberFormat(undefined, options).format(value);
}

function formatFullNumber(value) {
    return new Intl.NumberFormat().format(value);
}

function updateSiteSectionVisibility(mode) {
    const siteSection = document.getElementById('siteSection');
    if (siteSection) siteSection.hidden = mode !== MODE_SPECIFIC;
}

function setSiteStatus(text, active) {
    const statusEl = document.getElementById('siteStatus');
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.toggle('active', active);
}

function updateSiteStatus(enabled) {
    setSiteStatus(enabled ? TEXT.statusProtected : TEXT.statusNotProtected, enabled);
}

/** Reloading only makes sense for pages the extension can actually protect. */
function reloadCurrentTab() {
    if (!isProtectablePage || !currentTab?.id) return;

    const tabId = currentTab.id;
    setTimeout(async () => {
        try {
            await chrome.tabs.reload(tabId);
        } catch (error) {
            console.error('Failed to reload tab:', error);
        }
    }, RELOAD_DELAY_MS);
}

// ============================================
// Event Handlers
// ============================================

async function handleModeChange(event) {
    const mode = event.target.value;

    try {
        await chrome.runtime.sendMessage({ type: 'SET_MODE', mode });
        updateSiteSectionVisibility(mode);
        showToast(`Mode: ${MODE_LABELS[mode] || mode}`, 'success');
        reloadCurrentTab();
    } catch (error) {
        console.error('Failed to set mode:', error);
        showToast(TEXT.modeChangeFailed, 'error');
    }
}

async function handleSiteToggle() {
    const siteToggle = document.getElementById('siteToggle');
    if (!siteToggle) return;

    const enabled = siteToggle.checked;

    try {
        const type = enabled ? 'ENABLE_FOR_SITE' : 'DISABLE_FOR_SITE';
        await chrome.runtime.sendMessage({ type, url: currentTab.url });
        updateSiteStatus(enabled);
        showToast(enabled
            ? `Protection enabled for ${currentHostname}`
            : `Protection disabled for ${currentHostname}`, 'success');
        reloadCurrentTab();
    } catch (error) {
        console.error('Failed to toggle site:', error);
        showToast(TEXT.toggleFailed, 'error');
        siteToggle.checked = !enabled;
        updateSiteStatus(!enabled);
    }
}

// ============================================
// Statistics Reset (two-step, cannot be undone)
// ============================================

function setResetConfirmState(pending) {
    const resetButton = document.getElementById('resetStats');
    const resetLabel = document.getElementById('resetStatsLabel');
    resetConfirmPending = pending;
    if (resetButton) resetButton.classList.toggle('is-confirming', pending);
    if (resetLabel) resetLabel.textContent = pending ? TEXT.resetConfirmLabel : TEXT.resetLabel;
}

async function handleResetStats() {
    if (!resetConfirmPending) {
        setResetConfirmState(true);
        resetConfirmTimeout = setTimeout(() => setResetConfirmState(false), RESET_CONFIRM_TIMEOUT_MS);
        return;
    }

    if (resetConfirmTimeout) clearTimeout(resetConfirmTimeout);
    setResetConfirmState(false);

    try {
        await chrome.runtime.sendMessage({ type: 'RESET_STATISTICS' });
        await loadStatistics();
        showToast(TEXT.statsReset, 'success');
    } catch (error) {
        console.error('Failed to reset statistics:', error);
        showToast(TEXT.statsResetFailed, 'error');
    }
}
