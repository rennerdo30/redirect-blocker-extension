/**
 * Redirect Blocker - Content Script
 * 
 * This script runs at document_start in the MAIN world to intercept
 * and neutralize multi-tab detection mechanisms before they can execute.
 * 
 * NOTE: This script is only injected on sites where the user has enabled protection.
 */

(function () {
  'use strict';

  const LOG_PREFIX = '[RedirectBlocker]';
  let blockedCount = 0;
  let originalLocation = window.location.href;

  // ============================================
  // Logging Utility
  // ============================================

  function sendLogToBackground(level, message, ...args) {
    try {
      // Arguments might not be serializable (e.g. elements), so we stringify them safely
      const safeArgs = args.map(arg => {
        try {
          return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
        } catch (e) {
          return '[Unserializable]';
        }
      });

      chrome.runtime.sendMessage({
        type: 'LOG_ENTRY',
        level,
        message: `${message} ${safeArgs.join(' ')}`,
        url: window.location.href,
        timestamp: Date.now()
      }).catch(() => {
        // Ignore errors if background script is unreachable
      });
    } catch (e) {
      // Ignore
    }
  }

  function log(message, ...args) {
    if (typeof console !== 'undefined') {
      console.log(`${LOG_PREFIX} ${message}`, ...args);
    }
    sendLogToBackground('info', message, ...args);
  }

  function warn(message, ...args) {
    if (typeof console !== 'undefined') {
      console.warn(`${LOG_PREFIX} ${message}`, ...args);
    }
    sendLogToBackground('warn', message, ...args);
  }

  // ============================================
  // AGGRESSIVE: Script Interception & Debugger Removal
  // ============================================

  // Track processed scripts to avoid double-processing
  const processedScripts = new Set();

  // Helper to sanitize code
  function sanitizeCode(code, source = 'unknown') {
    let modified = false;
    let newCode = code;

    // 1. Strip basic debugger statements
    if (newCode.includes('debugger')) {
      newCode = newCode.replace(/debugger\s*;?/g, '/* debugger removed */');
      modified = true;
    }

    // 2. Strip constructor("debugger") pattern
    // Matches: .constructor("debugger") or .constructor('debugger') or .constructor(`debugger`)
    const constructorPattern = /\.constructor\s*\(\s*(["'`])debugger\1\s*\)/g;
    if (constructorPattern.test(newCode)) {
      newCode = newCode.replace(constructorPattern, '.constructor("/* debugger removed */")');
      modified = true;
      log('🔧 Stripped constructor("debugger") pattern from:', source);
    }

    if (modified) {
      log('🔧 Sanitized script from:', source);
    }
    return newCode;
  }

  // Override XMLHttpRequest to strip debugger from loaded scripts
  const OriginalXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function () {
    const xhr = new OriginalXHR();
    const originalOpen = xhr.open.bind(xhr);
    let isScript = false;
    let currentUrl = 'unknown';

    xhr.open = function (method, url, ...args) {
      if (url && (url.endsWith('.js') || url.includes('.js?'))) {
        isScript = true;
        currentUrl = url;
      }
      return originalOpen(method, url, ...args);
    };

    // Intercept response for scripts
    Object.defineProperty(xhr, 'responseText', {
      get: function () {
        const response = Object.getOwnPropertyDescriptor(OriginalXHR.prototype, 'responseText').get.call(this);
        if (isScript && response) {
          return sanitizeCode(response, `XHR: ${currentUrl}`);
        }
        return response;
      }
    });

    return xhr;
  };
  window.XMLHttpRequest.prototype = OriginalXHR.prototype;

  // Override fetch to strip debugger from responses
  const originalFetch = window.fetch;
  window.fetch = async function (input, init) {
    const response = await originalFetch.call(this, input, init);
    const url = typeof input === 'string' ? input : input.url;

    // Check if it's a JavaScript file
    if (url && (url.endsWith('.js') || url.includes('.js?') || response.headers.get('content-type')?.includes('javascript'))) {
      const originalText = response.text.bind(response);
      response.text = async function () {
        const text = await originalText();
        return sanitizeCode(text, `fetch: ${url}`);
      };
    }

    return response;
  };

  // MutationObserver to intercept script elements before they execute
  const scriptObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.tagName === 'SCRIPT') {
          interceptScript(node);
        }
      }
    }
  });

  function interceptScript(scriptEl) {
    // Skip if already processed
    if (processedScripts.has(scriptEl) || scriptEl.hasAttribute('data-rb-processed')) {
      return;
    }
    processedScripts.add(scriptEl);
    scriptEl.setAttribute('data-rb-processed', 'true');

    // Handle inline scripts
    if (scriptEl.textContent) {
      const originalContent = scriptEl.textContent;
      const cleanContent = sanitizeCode(originalContent, 'inline script');

      if (cleanContent !== originalContent) {
        // Create a new clean script
        const newScript = document.createElement('script');
        newScript.textContent = cleanContent;
        newScript.setAttribute('data-rb-processed', 'true');

        // Copy attributes
        for (const attr of scriptEl.attributes) {
          if (attr.name !== 'data-rb-processed') {
            newScript.setAttribute(attr.name, attr.value);
          }
        }

        // Block original and insert clean version
        scriptEl.type = 'javascript/blocked';
        scriptEl.parentNode?.insertBefore(newScript, scriptEl);
      }
    }

    // Handle external scripts - we intercept via fetch/XHR above
  }

  // Start observing immediately
  scriptObserver.observe(document.documentElement || document, {
    childList: true,
    subtree: true
  });

  log('🔧 Script debugger interceptor installed');

  // ============================================
  // 1. BroadcastChannel Override
  // ============================================

  const OriginalBroadcastChannel = window.BroadcastChannel;

  class BlockedBroadcastChannel {
    constructor(channelName) {
      log(`Blocked BroadcastChannel creation: "${channelName}"`);
      this._channelName = channelName;
      this._listeners = new Map();
      blockedCount++;
    }

    postMessage(message) {
      log(`Blocked BroadcastChannel.postMessage on "${this._channelName}":`, message);
      // Don't actually send the message
    }

    close() {
      log(`BroadcastChannel "${this._channelName}" closed`);
    }

    addEventListener(type, listener) {
      // Store but never call
      if (!this._listeners.has(type)) {
        this._listeners.set(type, []);
      }
      this._listeners.get(type).push(listener);
    }

    removeEventListener(type, listener) {
      if (this._listeners.has(type)) {
        const listeners = this._listeners.get(type);
        const index = listeners.indexOf(listener);
        if (index > -1) {
          listeners.splice(index, 1);
        }
      }
    }

    get onmessage() {
      return this._onmessage || null;
    }

    set onmessage(handler) {
      this._onmessage = handler;
      // Never call the handler
    }

    get onmessageerror() {
      return this._onmessageerror || null;
    }

    set onmessageerror(handler) {
      this._onmessageerror = handler;
    }

    get name() {
      return this._channelName;
    }
  }

  // Replace BroadcastChannel globally
  if (OriginalBroadcastChannel) {
    window.BroadcastChannel = BlockedBroadcastChannel;
    log('BroadcastChannel override installed');
  }

  // ============================================
  // 2. Anti-Debugging Protection
  // ============================================

  // AGGRESSIVE: Anti-Debugger & Constructor Protection
  (function antiDebugger() {
    // 1. Remove the self-inflicted 'debuggerTrap' which was causing pauses

    // 2. Hardened Function constructor override
    // Sites often use (function(){}).constructor("debugger")() to bypass window.Function
    const OriginalFunction = window.Function;
    const NativeFunction = OriginalFunction; // alias

    // Create the proxy handler
    function createFunctionProxy(msg) {
      log(msg || 'Blocked Function constructor');
      return function () { };
    }

    // Override window.Function
    window.Function = function (...args) {
      const body = args[args.length - 1] || '';
      if (typeof body === 'string' && body.includes('debugger')) {
        log('Blocked Function("debugger") call');
        blockedCount++;
        // Strip the debugger statement
        args[args.length - 1] = body.replace(/debugger\s*;?/g, '');
        return NativeFunction.apply(this, args);
      }
      return NativeFunction.apply(this, args);
    };

    // Ensure prototype chain still works but constructor points to our wrapper
    window.Function.prototype = NativeFunction.prototype;
    window.Function.prototype.constructor = window.Function;

    // Also try to patch the AsyncFunction constructor if it exists
    try {
      const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
      const OriginalAsyncFunction = AsyncFunction;

      window.AsyncFunction = function (...args) {
        const body = args[args.length - 1] || '';
        if (typeof body === 'string' && body.includes('debugger')) {
          log('Blocked AsyncFunction("debugger") call');
          blockedCount++;
          args[args.length - 1] = body.replace(/debugger\s*;?/g, '');
          return OriginalAsyncFunction.apply(this, args);
        }
        return OriginalAsyncFunction.apply(this, args);
      };

      // Patch prototype to catch (async function(){}).constructor
      Object.defineProperty(OriginalAsyncFunction.prototype, 'constructor', {
        value: window.AsyncFunction,
        writable: true,
        configurable: true
      });
    } catch (e) {
      // AsyncFunction might not be exposed globally or writable
    }

    log('Hardened Function/AsyncFunction overrides installed');
  })();

  // AGGRESSIVE: Neutralize "devtools-detector" library specifically
  // The user reported code uses this library: devtoolsDetector.addListener(...)
  try {
    Object.defineProperty(window, 'devtoolsDetector', {
      get: function () {
        log('Blocked access to devtoolsDetector');
        return {
          addListener: function () { },
          launch: function () { },
          isLaunch: function () { return false; },
          stop: function () { },
          setDetectDelay: function () { }
        };
      },
      set: function () {
        log('Blocked setting devtoolsDetector');
      },
      configurable: false
    });
  } catch (e) {
    log('Could not define devtoolsDetector property');
  }

  // AGGRESSIVE: The Ultimate Anti-Debugger via Function.prototype
  // This catches (function(){}).constructor("debugger")() which is the most common bypass
  try {
    const originalFunctionConstructor = Function.prototype.constructor;
    // We can't just overwrite the value because it might be restored.
    // Instead we define a getter that returns our proxy wrapper.
    Object.defineProperty(Function.prototype, 'constructor', {
      get: function () {
        // Return a wrapper that checks arguments
        const wrapper = function (...args) {
          const body = args[args.length - 1] || '';
          if (typeof body === 'string' && (body.includes('debugger') || body === 'debugger')) {
            log('🛡️ Blocked dynamic function with debugger');
            blockedCount++;
            // Return a no-op function
            return function () { };
          }
          // Otherwise behave like normal Function constructor
          return originalFunctionConstructor.apply(this, args);
        };
        // Masquerade as the real thing
        wrapper.prototype = originalFunctionConstructor.prototype;
        wrapper.toString = () => originalFunctionConstructor.toString();
        return wrapper;
      },
      set: function () {
        // Ignore attempts to reset it
        log('Blocked attempt to reset Function.constructor');
      },
      configurable: false
    });
    log('Function.prototype.constructor protection installed');
  } catch (e) {
    log('Function.prototype protection failed:', e);
  }

  // Block eval with debugger
  const originalEval = window.eval;
  window.eval = function (code) {
    if (typeof code === 'string' && code.includes('debugger')) {
      log('Stripped debugger from eval');
      blockedCount++;
      code = code.replace(/debugger\s*;?/g, '');
    }
    return originalEval.call(this, code);
  };

  // Prevent setInterval/setTimeout debugger loops
  const originalSetInterval = window.setInterval;
  const originalSetTimeout = window.setTimeout;

  window.setInterval = function (handler, timeout, ...args) {
    if (typeof handler === 'string' && handler.includes('debugger')) {
      log('Stripped debugger from setInterval');
      blockedCount++;
      handler = handler.replace(/debugger\s*;?/g, '');
    }
    return originalSetInterval.call(this, handler, timeout, ...args);
  };

  window.setTimeout = function (handler, timeout, ...args) {
    if (typeof handler === 'string' && handler.includes('debugger')) {
      log('Stripped debugger from setTimeout');
      blockedCount++;
      handler = handler.replace(/debugger\s*;?/g, '');
    }
    return originalSetTimeout.call(this, handler, timeout, ...args);
  };

  // Prevent console.clear() which sites use to hide debugging
  console.clear = function () {
    log('Blocked console.clear()');
  };

  // Block right-click prevention
  document.addEventListener('contextmenu', function (e) {
    e.stopImmediatePropagation();
  }, true);

  // Block keyboard shortcut prevention (F12, Ctrl+Shift+I, etc.)
  document.addEventListener('keydown', function (e) {
    e.stopImmediatePropagation();
  }, true);

  log('Anti-debugging protection installed');

  // ============================================
  // 2. localStorage Storage Event Blocking
  // ============================================

  const originalAddEventListener = window.addEventListener.bind(window);

  window.addEventListener = function (type, listener, options) {
    if (type === 'storage') {
      log('Blocked storage event listener registration');
      blockedCount++;
      // Don't register the listener
      return;
    }
    return originalAddEventListener(type, listener, options);
  };

  log('Storage event listener blocking installed');

  // ============================================
  // 3. location.href Protection
  // ============================================

  // Store the original location descriptor
  const originalLocationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');

  // Track navigation attempts
  let navigationAttempts = [];
  const MAX_NAVIGATION_HISTORY = 10;

  /**
   * AGGRESSIVE: Log and potentially block ALL navigation attempts
   */
  function shouldBlockNavigation(newUrl, method = 'unknown') {
    try {
      const currentUrl = new URL(originalLocation);
      const targetUrl = new URL(newUrl, currentUrl.origin);
      const isSameOrigin = targetUrl.origin === currentUrl.origin;
      const isHomepage = targetUrl.pathname === '/';
      const isDifferentPage = targetUrl.pathname !== currentUrl.pathname;

      // Log ALL navigation attempts for debugging
      log(`🔍 Navigation attempt [${method}]:`, {
        from: originalLocation,
        to: newUrl,
        sameOrigin: isSameOrigin,
        toHomepage: isHomepage,
        differentPage: isDifferentPage
      });

      // AGGRESSIVE: Block ANY same-origin redirect that goes to a different page
      // This catches the multi-tab redirect attack
      if (isSameOrigin && isDifferentPage) {
        log(`🛡️ BLOCKED redirect [${method}]: ${currentUrl.pathname} -> ${targetUrl.pathname}`);
        blockedCount++;
        return true;
      }

      // Block cross-origin redirects too (suspicious)
      if (!isSameOrigin) {
        log(`🛡️ BLOCKED cross-origin redirect [${method}]: ${currentUrl.origin} -> ${targetUrl.origin}`);
        blockedCount++;
        return true;
      }

    } catch (e) {
      log('URL parsing failed:', e);
    }

    return false;
  }

  // Override location.href setter
  const locationProxy = new Proxy(window.location, {
    set(target, prop, value) {
      if (prop === 'href') {
        log(`📍 location.href setter called with: ${value}`);
        if (shouldBlockNavigation(value, 'location.href')) {
          return true; // Pretend success but don't navigate
        }
      }
      target[prop] = value;
      return true;
    },
    get(target, prop) {
      const value = target[prop];
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    }
  });

  // Try to replace location (this may not work in all browsers)
  try {
    Object.defineProperty(window, 'location', {
      get() {
        return locationProxy;
      },
      configurable: false
    });
    log('location.href protection installed');
  } catch (e) {
    // Expected in modern browsers - other protections still work
    log('location.href override not available (expected in modern browsers)');
  }

  // Also override location.assign and location.replace
  try {
    const originalAssign = window.location.assign.bind(window.location);
    const originalReplace = window.location.replace.bind(window.location);
    const originalReload = window.location.reload.bind(window.location);

    Object.defineProperty(window.location, 'assign', {
      value: function (url) {
        if (shouldBlockNavigation(url, 'location.assign')) {
          return;
        }
        return originalAssign(url);
      },
      writable: false,
      configurable: false
    });

    Object.defineProperty(window.location, 'replace', {
      value: function (url) {
        if (shouldBlockNavigation(url, 'location.replace')) {
          return;
        }
        return originalReplace(url);
      },
      writable: false,
      configurable: false
    });

    Object.defineProperty(window.location, 'reload', {
      value: function () {
        log('🛡️ BLOCKED location.reload()');
        blockedCount++;
        return;
      },
      writable: false,
      configurable: false
    });

    log('location methods protection installed');
  } catch (e) {
    log('location methods could not be overridden (read-only):', e);
  }

  // Block History API manipulation
  try {
    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);
    const originalGo = history.go.bind(history);
    const originalBack = history.back.bind(history);
    const originalForward = history.forward.bind(history);

    history.pushState = function (state, unused, url) {
      if (url && shouldBlockNavigation(url, 'history.pushState')) {
        return;
      }
      return originalPushState(state, unused, url);
    };

    history.replaceState = function (state, unused, url) {
      if (url && shouldBlockNavigation(url, 'history.replaceState')) {
        return;
      }
      return originalReplaceState(state, unused, url);
    };

    // Block history navigation (go/back/forward) if it looks suspicious
    history.go = function (delta) {
      if (delta === 0 || delta === undefined || delta === null) {
        log('🛡️ BLOCKED history.go(0) reload');
        blockedCount++;
        return;
      }
      log(`⚠️ History.go(${delta}) called`);
      return originalGo(delta);
    };

    log('History API protection installed');
  } catch (e) {
    log('History API protection failed:', e);
  }

  // ============================================
  // 4. localStorage Write Interception
  // ============================================

  // Common keys used for tab detection
  const SUSPICIOUS_KEYS = [
    'tabactive', 'tab_active', 'activetab', 'active_tab',
    'tabcount', 'tab_count', 'opentabs', 'open_tabs',
    'tabid', 'tab_id', 'tabsession', 'tab_session',
    'multipleinstances', 'multiple_instances',
    'singleinstance', 'single_instance',
    'tabcheck', 'tab_check', 'tabheartbeat', 'tab_heartbeat'
  ];

  function isSuspiciousKey(key) {
    if (!key) return false;
    const lowerKey = key.toLowerCase().replace(/[-_]/g, '');
    return SUSPICIOUS_KEYS.some(suspicious =>
      lowerKey.includes(suspicious.replace(/[-_]/g, ''))
    );
  }

  const originalSetItem = Storage.prototype.setItem;
  const originalGetItem = Storage.prototype.getItem;

  Storage.prototype.setItem = function (key, value) {
    if (isSuspiciousKey(key)) {
      log(`Blocked suspicious localStorage write: "${key}" = "${value}"`);
      blockedCount++;
      return; // Don't actually write
    }
    return originalSetItem.call(this, key, value);
  };

  log('localStorage write interception installed');

  // ============================================
  // 5. Statistics Reporting
  // ============================================

  // Report blocked count periodically
  setInterval(() => {
    if (blockedCount > 0) {
      log(`Total blocked: ${blockedCount} redirect attempts`);
    }
  }, 30000);

  // ============================================
  // Initialization Complete
  // ============================================

  log('Redirect Blocker initialized successfully');
  log(`Protecting page: ${originalLocation}`);

  // ============================================
  // 6. Iframe & Environment Tunneling Protection
  // ============================================

  // Apply protections to a specific window object
  function protectWindow(win) {
    if (!win || win._rb_protected) return;

    try {
      // Mark as protected to avoid recursion
      Object.defineProperty(win, '_rb_protected', { value: true, configurable: false });

      // 1. Apply Function Override
      const NativeFunction = win.Function;
      win.Function = function (...args) {
        const body = args[args.length - 1] || '';
        if (typeof body === 'string' && (body.includes('debugger') || body === 'debugger')) {
          log('🛡️ Blocked debugger in iframe/new window');
          return function () { };
        }
        return NativeFunction.apply(this, args);
      };

      // Patch prototype chain
      win.Function.prototype = NativeFunction.prototype;
      try {
        Object.defineProperty(win.Function.prototype, 'constructor', {
          get: function () {
            const wrapper = function (...args) {
              const body = args[args.length - 1] || '';
              if (typeof body === 'string' && body.includes('debugger')) {
                return function () { };
              }
              return NativeFunction.apply(this, args);
            };
            wrapper.prototype = NativeFunction.prototype;
            wrapper.toString = () => NativeFunction.toString();
            return wrapper;
          },
          configurable: false
        });
      } catch (e) { }

      // 2. Block devtoolsDetector in the iframe
      try {
        Object.defineProperty(win, 'devtoolsDetector', {
          get: function () { return { addListener: function () { }, launch: function () { } }; },
          set: function () { },
          configurable: false
        });
      } catch (e) { }

      // 3. Block Eval
      const originalEval = win.eval;
      win.eval = function (code) {
        if (typeof code === 'string' && code.includes('debugger')) {
          return originalEval.call(this, code.replace(/debugger\s*;?/g, ''));
        }
        return originalEval.call(this, code);
      };

      log('🛡️ Protected new iframe/window environment');
    } catch (e) {
      log('Failed to protect iframe:', e);
    }
  }

  // Hook HTMLIFrameElement.prototype.contentWindow
  try {
    const iframeProto = HTMLIFrameElement.prototype;
    const originalContentWindow = Object.getOwnPropertyDescriptor(iframeProto, 'contentWindow');

    Object.defineProperty(iframeProto, 'contentWindow', {
      get: function () {
        const win = originalContentWindow.get.call(this);
        protectWindow(win);
        return win;
      },
      configurable: false
    });
    log('Iframe contentWindow hook installed');
  } catch (e) { /* Ignore */ }

  // Watch for new iframes
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.tagName === 'IFRAME') {
          // Try to protect immediately
          if (node.contentWindow) protectWindow(node.contentWindow);
          // And on load
          node.addEventListener('load', () => protectWindow(node.contentWindow));
        }
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

})();
