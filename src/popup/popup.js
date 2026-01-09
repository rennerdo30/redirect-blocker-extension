/**
 * Redirect Blocker - Popup Script
 *
 * Handles mode selection and per-site toggle.
 */

document.addEventListener('DOMContentLoaded', init);

let currentTab = null;
let currentHostname = null;
let toastTimeout = null;

// ============================================
// Toast Notifications
// ============================================

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) return;

    // Clear any existing timeout
    if (toastTimeout) {
        clearTimeout(toastTimeout);
    }

    // Remove existing classes
    toast.classList.remove('show', 'error', 'success');

    // Set message and type
    toast.textContent = message;
    if (type === 'error') toast.classList.add('error');
    if (type === 'success') toast.classList.add('success');

    // Show toast
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    // Auto-hide after 3 seconds
    toastTimeout = setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// ============================================
// Initialization
// ============================================

async function init() {
    // Get current tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tabs[0];

    if (currentTab && currentTab.url) {
        try {
            currentHostname = new URL(currentTab.url).hostname;
            document.getElementById('siteHostname').textContent = currentHostname;
        } catch {
            document.getElementById('siteHostname').textContent = 'N/A';
        }
    }

    // Load current settings
    await loadSettings();
    await loadStatistics();

    document.querySelectorAll('input[name="mode"]').forEach(radio => {
        radio.addEventListener('change', handleModeChange);
    });
    const siteToggle = document.getElementById('siteToggle');
    if (siteToggle) siteToggle.addEventListener('change', handleSiteToggle);
    document.getElementById('resetStats').addEventListener('click', handleResetStats);
}

async function loadSettings() {
    try {
        const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });

        // Set mode radio
        const modeRadio = document.querySelector(`input[name="mode"][value="${settings.mode}"]`);
        if (modeRadio) modeRadio.checked = true;

        // Update site section visibility
        updateSiteSectionVisibility(settings.mode);

        // Load site-specific state
        if (settings.mode === 'specific') {
            const siteToggle = document.getElementById('siteToggle');
            const siteEnabled = settings.enabledSites.includes(currentHostname);
            if (siteToggle) siteToggle.checked = siteEnabled;
            updateSiteStatus(siteEnabled);
        }
    } catch (error) {
        console.error('Failed to load settings:', error);
        showToast('Failed to load settings', 'error');
    }
}

async function loadStatistics() {
    try {
        const stats = await chrome.runtime.sendMessage({ type: 'GET_STATISTICS' });
        document.getElementById('totalBlocked').textContent = formatNumber(stats.totalBlocked || 0);
        document.getElementById('sitesProtected').textContent = Object.keys(stats.blockedBySite || {}).length;
    } catch (error) {
        console.error('Failed to load statistics:', error);
        showToast('Failed to load statistics', 'error');
    }
}

function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

function updateSiteSectionVisibility(mode) {
    const siteSection = document.getElementById('siteSection');
    if (siteSection) siteSection.style.display = mode === 'specific' ? 'block' : 'none';
}

function updateSiteStatus(enabled) {
    const statusEl = document.getElementById('siteStatus');
    if (!statusEl) return;
    if (enabled) {
        statusEl.textContent = 'Protected';
        statusEl.classList.add('active');
    } else {
        statusEl.textContent = 'Not protected';
        statusEl.classList.remove('active');
    }
}

async function handleModeChange(event) {
    const mode = event.target.value;

    try {
        await chrome.runtime.sendMessage({ type: 'SET_MODE', mode });
        updateSiteSectionVisibility(mode);
        showToast(`Mode changed to ${mode}`, 'success');

        // Delay reload slightly so user sees the toast
        if (currentTab?.id) {
            setTimeout(() => chrome.tabs.reload(currentTab.id), 300);
        }
    } catch (error) {
        console.error('Failed to set mode:', error);
        showToast('Failed to change mode', 'error');
    }
}

async function handleSiteToggle() {
    const enabled = document.getElementById('siteToggle').checked;

    try {
        if (enabled) {
            await chrome.runtime.sendMessage({ type: 'ENABLE_FOR_SITE', url: currentTab.url });
            showToast(`Protection enabled for ${currentHostname}`, 'success');
        } else {
            await chrome.runtime.sendMessage({ type: 'DISABLE_FOR_SITE', url: currentTab.url });
            showToast(`Protection disabled for ${currentHostname}`, 'success');
        }
        updateSiteStatus(enabled);

        // Delay reload slightly so user sees the toast
        if (currentTab?.id) {
            setTimeout(() => chrome.tabs.reload(currentTab.id), 300);
        }
    } catch (error) {
        console.error('Failed to toggle site:', error);
        showToast('Failed to toggle protection', 'error');
        document.getElementById('siteToggle').checked = !enabled;
    }
}

async function handleResetStats() {
    try {
        await chrome.runtime.sendMessage({ type: 'RESET_STATISTICS' });
        await loadStatistics();
        showToast('Statistics reset', 'success');
    } catch (error) {
        console.error('Failed to reset statistics:', error);
        showToast('Failed to reset statistics', 'error');
    }
}
