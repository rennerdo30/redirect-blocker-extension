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

  // Report a blocked action to background for statistics
  function reportBlocked() {
    try {
      chrome.runtime.sendMessage({
        type: 'INCREMENT_BLOCKED',
        url: window.location.href
      }).catch(() => {
        // Ignore errors if background script is unreachable
      });
    } catch (e) {
      // Ignore
    }
  }

  // ============================================
  // AGGRESSIVE: Script Interception & Debugger Removal
  // ============================================

  // Track processed scripts to avoid double-processing
  const processedScripts = new Set();

  // Helper to sanitize code - removes debugger statements and common obfuscations
  function sanitizeCode(code, source = 'unknown') {
    let newCode = code;

    // 1. Strip basic debugger statements (with optional semicolon and whitespace)
    newCode = newCode.replace(/\bdebugger\s*;?/g, '/* debugger removed */');

    // 2. Strip constructor("debugger") pattern
    // Matches: .constructor("debugger") or .constructor('debugger') or .constructor(`debugger`)
    newCode = newCode.replace(/\.constructor\s*\(\s*(["'`])debugger\1\s*\)/g, '.constructor("/* noop */")');

    // 3. Strip eval("debugger") and similar patterns
    newCode = newCode.replace(/\b(eval|setTimeout|setInterval)\s*\(\s*(["'`])debugger\2/g, '$1($2/* noop */');

    // 4. Strip Function("debugger") constructor calls
    newCode = newCode.replace(/\bFunction\s*\(\s*(["'`])debugger\1\s*\)/g, 'Function($1/* noop */$1)');

    // 5. Strip new Function("debugger") pattern
    newCode = newCode.replace(/new\s+Function\s*\(\s*(["'`])debugger\1\s*\)/g, 'new Function($1/* noop */$1)');

    // 6. Strip string concatenation patterns like "de"+"bugger" or 'de'+'bugger'
    // This catches: "de" + "bugger", 'de' + 'bugger', "deb" + "ugger", etc.
    newCode = newCode.replace(/(["'])de(?:b(?:ug(?:g(?:er?)?)?)?)?(\1)\s*\+\s*(["'])(?:b?u?g?g?e?r?)\3/gi, '$1noop$2');

    // 7. Strip Unicode escape sequences for debugger: \u0064\u0065\u0062\u0075\u0067\u0067\u0065\u0072
    newCode = newCode.replace(/\\u0064\\u0065\\u0062\\u0075\\u0067\\u0067\\u0065\\u0072/gi, 'noop');

    // 8. Strip hex escape sequences: \x64\x65\x62\x75\x67\x67\x65\x72
    newCode = newCode.replace(/\\x64\\x65\\x62\\x75\\x67\\x67\\x65\\x72/gi, 'noop');

    if (newCode !== code) {
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
    let sanitizedResponse = null;

    xhr.open = function (method, url, ...args) {
      if (url && (url.endsWith('.js') || url.includes('.js?'))) {
        isScript = true;
        currentUrl = url;
      } else {
        isScript = false;
      }
      sanitizedResponse = null;
      return originalOpen(method, url, ...args);
    };

    // Helper to get and cache sanitized response
    function getSanitizedResponse() {
      if (sanitizedResponse !== null) return sanitizedResponse;
      const original = Object.getOwnPropertyDescriptor(OriginalXHR.prototype, 'responseText').get.call(xhr);
      if (isScript && original) {
        sanitizedResponse = sanitizeCode(original, `XHR: ${currentUrl}`);
      } else {
        sanitizedResponse = original;
      }
      return sanitizedResponse;
    }

    // Intercept responseText for scripts
    Object.defineProperty(xhr, 'responseText', {
      get: function () {
        return getSanitizedResponse();
      }
    });

    // Intercept response property (used when responseType is '' or 'text')
    Object.defineProperty(xhr, 'response', {
      get: function () {
        const responseType = xhr.responseType;
        if (isScript && (responseType === '' || responseType === 'text')) {
          return getSanitizedResponse();
        }
        // For other response types (arraybuffer, blob, etc.), return original
        return Object.getOwnPropertyDescriptor(OriginalXHR.prototype, 'response').get.call(this);
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
    const contentType = response.headers.get('content-type') || '';
    const isJavaScript = url && (
      url.endsWith('.js') ||
      url.includes('.js?') ||
      contentType.includes('javascript')
    );

    if (isJavaScript) {
      // Clone the response to avoid body consumption issues
      const clonedResponse = response.clone();

      // Create a new Response with sanitized body
      return new Response(
        new ReadableStream({
          async start(controller) {
            try {
              const text = await clonedResponse.text();
              const sanitized = sanitizeCode(text, `fetch: ${url}`);
              controller.enqueue(new TextEncoder().encode(sanitized));
              controller.close();
            } catch (e) {
              controller.error(e);
            }
          }
        }),
        {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        }
      );
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
      reportBlocked();
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
    // Hardened Function constructor override
    // Sites often use (function(){}).constructor("debugger")() to bypass window.Function
    const OriginalFunction = window.Function;
    const NativeFunction = OriginalFunction; // alias

    // Override window.Function
    window.Function = function (...args) {
      const body = args[args.length - 1] || '';
      if (typeof body === 'string' && body.includes('debugger')) {
        log('Blocked Function("debugger") call');
        blockedCount++;
        reportBlocked();
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
          reportBlocked();
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
            reportBlocked();
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
      reportBlocked();
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
      reportBlocked();
      handler = handler.replace(/debugger\s*;?/g, '');
    }
    return originalSetInterval.call(this, handler, timeout, ...args);
  };

  window.setTimeout = function (handler, timeout, ...args) {
    if (typeof handler === 'string' && handler.includes('debugger')) {
      log('Stripped debugger from setTimeout');
      blockedCount++;
      reportBlocked();
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
      reportBlocked();
      // Don't register the listener
      return;
    }
    return originalAddEventListener(type, listener, options);
  };

  log('Storage event listener blocking installed');

  // ============================================
  // 3. location.href Protection
  // ============================================

  // Suspicious redirect targets (paths that indicate forced logout/redirect)
  const SUSPICIOUS_PATHS = ['/', '/login', '/signin', '/auth', '/home', '/index', '/logout', '/signout'];

  // Track if user has interacted (clicks, etc.) - legitimate navigation
  // 500ms window to allow for async operations after user action
  let userInteracted = false;
  document.addEventListener('click', () => { userInteracted = true; setTimeout(() => { userInteracted = false; }, 500); }, true);
  document.addEventListener('submit', () => { userInteracted = true; setTimeout(() => { userInteracted = false; }, 500); }, true);
  document.addEventListener('keydown', (e) => {
    // Allow navigation from keyboard shortcuts (Enter on links, etc.)
    if (e.key === 'Enter') {
      userInteracted = true;
      setTimeout(() => { userInteracted = false; }, 500);
    }
  }, true);

  /**
   * Smart navigation blocking - only blocks suspicious redirect patterns
   */
  function shouldBlockNavigation(newUrl, method = 'unknown') {
    try {
      const currentUrl = new URL(originalLocation);
      const targetUrl = new URL(newUrl, currentUrl.origin);
      const isSameOrigin = targetUrl.origin === currentUrl.origin;
      const isFromDeepPage = currentUrl.pathname !== '/' && currentUrl.pathname.split('/').filter(Boolean).length > 0;
      const isToSuspiciousPath = SUSPICIOUS_PATHS.some(p =>
        targetUrl.pathname === p || targetUrl.pathname === p + '/' || targetUrl.pathname.startsWith(p + '/')
      );

      // Allow if user just clicked something (legitimate navigation)
      if (userInteracted) {
        log(`✅ Allowed navigation [${method}] (user interaction): ${targetUrl.pathname}`);
        return false;
      }

      // Log navigation attempts for debugging
      log(`🔍 Navigation attempt [${method}]:`, {
        from: currentUrl.pathname,
        to: targetUrl.pathname,
        sameOrigin: isSameOrigin,
        toSuspicious: isToSuspiciousPath,
        fromDeepPage: isFromDeepPage
      });

      // Block: Same-origin redirect from a deep page to homepage/login (classic multi-tab attack)
      if (isSameOrigin && isFromDeepPage && isToSuspiciousPath) {
        log(`🛡️ BLOCKED suspicious redirect [${method}]: ${currentUrl.pathname} -> ${targetUrl.pathname}`);
        blockedCount++;
        reportBlocked();
        return true;
      }

      // Block: Cross-origin redirects (only if programmatic, not user-initiated)
      if (!isSameOrigin) {
        log(`🛡️ BLOCKED cross-origin redirect [${method}]: ${currentUrl.origin} -> ${targetUrl.origin}`);
        blockedCount++;
        reportBlocked();
        return true;
      }

    } catch (e) {
      log('URL parsing failed:', e);
    }

    return false;
  }

  // NOTE: window.location cannot be overridden in modern browsers.
  // We rely on location.assign/replace/reload overrides instead.

  // Override location.assign, location.replace, and location.reload
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
        // Allow if user just interacted (legitimate refresh)
        if (userInteracted) {
          log('✅ Allowed location.reload() (user interaction)');
          return originalReload();
        }
        log('🛡️ BLOCKED location.reload()');
        blockedCount++;
        reportBlocked();
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
        // Allow if user just interacted
        if (userInteracted) {
          log('✅ Allowed history.go(0) (user interaction)');
          return originalGo(delta);
        }
        log('🛡️ BLOCKED history.go(0) reload');
        blockedCount++;
        reportBlocked();
        return;
      }
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

  Storage.prototype.setItem = function (key, value) {
    if (isSuspiciousKey(key)) {
      log(`Blocked suspicious localStorage write: "${key}" = "${value}"`);
      blockedCount++;
      reportBlocked();
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
