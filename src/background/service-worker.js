/**
 * Redirect Blocker - Background Service Worker
 * 
 * Manages extension state, per-site settings, and statistics.
 * 
 * Operation Modes:
 * - 'off': Protection completely disabled
 * - 'specific': Protection enabled only for sites in enabledSites list
 * - 'global': Protection enabled for all sites
 */

// Default settings
const DEFAULT_SETTINGS = {
    mode: 'specific',  // 'off' | 'specific' | 'global'
    enabledSites: [],  // Sites where protection is active (used in 'specific' mode)
    statistics: {
        totalBlocked: 0,
        blockedBySite: {}
    }
};

// ============================================
// Storage Management
// ============================================

async function getSettings() {
    try {
        const result = await chrome.storage.local.get('settings');
        return { ...DEFAULT_SETTINGS, ...result.settings };
    } catch (error) {
        console.error('[RedirectBlocker] Failed to get settings:', error);
        return DEFAULT_SETTINGS;
    }
}

async function saveSettings(settings) {
    try {
        await chrome.storage.local.set({ settings });
    } catch (error) {
        console.error('[RedirectBlocker] Failed to save settings:', error);
    }
}

// ============================================
// Mode Management
// ============================================

async function setMode(mode) {
    const settings = await getSettings();
    settings.mode = mode;
    await saveSettings(settings);
    console.log(`[RedirectBlocker] Mode set to: ${mode}`);
}

async function getMode() {
    const settings = await getSettings();
    return settings.mode;
}

// ============================================
// Per-Site Management (for 'specific' mode)
// ============================================

function getHostname(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return null;
    }
}

async function isSiteEnabled(url) {
    const hostname = getHostname(url);
    if (!hostname) return false;

    const settings = await getSettings();
    return settings.enabledSites.includes(hostname);
}

async function enableForSite(url) {
    const hostname = getHostname(url);
    if (!hostname) return false;

    const settings = await getSettings();
    if (!settings.enabledSites.includes(hostname)) {
        settings.enabledSites.push(hostname);
        await saveSettings(settings);
        console.log(`[RedirectBlocker] Enabled for site: ${hostname}`);
        return true;
    }
    return false;
}

async function disableForSite(url) {
    const hostname = getHostname(url);
    if (!hostname) return false;

    const settings = await getSettings();
    const index = settings.enabledSites.indexOf(hostname);
    if (index > -1) {
        settings.enabledSites.splice(index, 1);
        await saveSettings(settings);
        console.log(`[RedirectBlocker] Disabled for site: ${hostname}`);
        return true;
    }
    return false;
}

// ============================================
// Protection Check
// ============================================

async function shouldProtect(url) {
    const settings = await getSettings();

    switch (settings.mode) {
        case 'off':
            return false;
        case 'global':
            return true;
        case 'specific':
            return await isSiteEnabled(url);
        default:
            return false;
    }
}

// ============================================
// Statistics
// ============================================

async function incrementBlockedCount(url) {
    const hostname = getHostname(url) || 'unknown';
    const settings = await getSettings();

    settings.statistics.totalBlocked++;
    settings.statistics.blockedBySite[hostname] =
        (settings.statistics.blockedBySite[hostname] || 0) + 1;

    await saveSettings(settings);
}

async function getStatistics() {
    const settings = await getSettings();
    return settings.statistics;
}

async function resetStatistics() {
    const settings = await getSettings();
    settings.statistics = { totalBlocked: 0, blockedBySite: {} };
    await saveSettings(settings);
}

// ============================================
// Message Handling
// ============================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const handleAsync = async () => {
        switch (message.type) {
            case 'GET_SETTINGS':
                return await getSettings();

            case 'SET_MODE':
                await setMode(message.mode);
                return { success: true };

            case 'IS_SITE_ENABLED':
                return { enabled: await isSiteEnabled(message.url) };

            case 'SHOULD_PROTECT':
                return { protect: await shouldProtect(message.url) };

            case 'ENABLE_FOR_SITE':
                return { success: await enableForSite(message.url) };

            case 'DISABLE_FOR_SITE':
                return { success: await disableForSite(message.url) };

            case 'GET_STATISTICS':
                return await getStatistics();

            case 'INCREMENT_BLOCKED':
                await incrementBlockedCount(message.url);
                return { success: true };

            case 'RESET_STATISTICS':
                await resetStatistics();
                return { success: true };

            case 'LOG_ENTRY':
                // Logs from content script
                const prefix = `[CS @ ${new URL(message.url).hostname}]`;
                if (message.level === 'warn') {
                    console.warn(`${prefix} ${message.message}`);
                } else {
                    console.log(`${prefix} ${message.message}`);
                }
                return { success: true };

            default:
                return { error: 'Unknown message type' };
        }
    };

    handleAsync().then(sendResponse);
    return true;
});

// ============================================
// Extension Icon Badge (per-tab)
// ============================================

async function updateBadge(tabId, url) {
    if (!url) {
        try {
            const tab = await chrome.tabs.get(tabId);
            url = tab.url;
        } catch {
            return;
        }
    }

    const settings = await getSettings();
    const isProtected = await shouldProtect(url);

    if (settings.mode === 'off') {
        chrome.action.setBadgeBackgroundColor({ color: '#666666', tabId });
        chrome.action.setBadgeText({ text: 'OFF', tabId });
    } else if (isProtected) {
        chrome.action.setBadgeBackgroundColor({ color: '#4CAF50', tabId });
        chrome.action.setBadgeText({ text: 'ON', tabId });
    } else {
        chrome.action.setBadgeBackgroundColor({ color: '#666666', tabId });
        chrome.action.setBadgeText({ text: '', tabId });
    }
}

// Update badge when tab is activated
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    await updateBadge(activeInfo.tabId);
});

// Update badge when tab is updated AND inject script if protected
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // Inject script at the earliest opportunity for protected sites
    if (changeInfo.status === 'loading' && tab.url) {
        const protect = await shouldProtect(tab.url);
        if (protect) {
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tabId, allFrames: true },
                    files: ['src/content/blocker.js'],
                    injectImmediately: true,
                    world: 'MAIN'
                });
                console.log(`[RedirectBlocker] Injected blocker for: ${tab.url}`);
            } catch (error) {
                console.log(`[RedirectBlocker] Could not inject: ${error.message}`);
            }
        }
    }

    if (changeInfo.status === 'complete') {
        await updateBadge(tabId, tab.url);
    }
});

// ============================================
// Initialization
// ============================================

chrome.runtime.onInstalled.addListener(async (details) => {
    console.log('[RedirectBlocker] Extension installed:', details.reason);

    if (details.reason === 'install') {
        await saveSettings(DEFAULT_SETTINGS);
    }
});

console.log('[RedirectBlocker] Service worker started');
