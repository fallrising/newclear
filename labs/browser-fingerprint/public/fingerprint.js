'use strict';
(() => {
  const observation = { ready: null, data: null, fingerprintId: null, error: null };
  const status = document.querySelector('#observation-status');
  const shortId = document.querySelector('#fingerprint-id');
  const details = document.querySelector('#observation-details');
  async function send(path, payload) {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(12000) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || '觀測記錄失敗');
    return body;
  }
  async function digest(value) {
    if (!window.crypto?.subtle) return null;
    const result = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function availableStorage(name) {
    try { const store = window[name]; const key = '__daylight_probe__'; store.setItem(key, '1'); store.removeItem(key); return true; }
    catch { return false; }
  }
  function webglInfo() {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl');
      if (!gl) return { available: false };
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      const info = { available: true, vendor: gl.getParameter(gl.VENDOR), renderer: gl.getParameter(gl.RENDERER), version: gl.getParameter(gl.VERSION), shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION), maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE), unmaskedVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null, unmaskedRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null };
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return info;
    } catch (error) { return { available: false, error: error.name }; }
  }
  async function canvasInfo() {
    try {
      const canvas = document.createElement('canvas'); canvas.width = 280; canvas.height = 70;
      const ctx = canvas.getContext('2d');
      if (!ctx) return { available: false };
      ctx.fillStyle = '#e8eddf'; ctx.fillRect(0, 0, 280, 70);
      ctx.font = '18px Arial'; ctx.fillStyle = '#405b3a'; ctx.fillText('Daylight 裝置觀測 ✳ 2026', 12, 28);
      ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = 'rgba(220,130,86,.6)';
      ctx.beginPath(); ctx.arc(225, 33, 22, 0, Math.PI * 2); ctx.fill();
      return { available: true, algorithm: 'sha256/png-data-url', hash: await digest(canvas.toDataURL()), sampleVersion: 1 };
    } catch (error) { return { available: false, error: error.name }; }
  }
  async function collect() {
    let userAgentData = null;
    let highEntropy = { available: false };
    if (navigator.userAgentData) {
      userAgentData = navigator.userAgentData.toJSON();
      try {
        const values = await navigator.userAgentData.getHighEntropyValues(['architecture', 'bitness', 'model', 'platformVersion', 'uaFullVersion', 'fullVersionList', 'wow64']);
        highEntropy = { available: true, ...values };
      } catch (error) { highEntropy = { available: false, error: error.name }; }
    }
    const plugins = Array.from(navigator.plugins || [], plugin => ({ name: plugin.name, description: plugin.description, filename: plugin.filename, version: null, mimeTypes: Array.from(plugin, mime => ({ type: mime.type, suffixes: mime.suffixes, description: mime.description })) }));
    return {
      schemaVersion: 1,
      browser: { userAgent: navigator.userAgent, appVersion: navigator.appVersion, vendor: navigator.vendor, platform: navigator.platform, userAgentData, highEntropy, webdriver: typeof navigator.webdriver === 'boolean' ? navigator.webdriver : null, pdfViewerEnabled: navigator.pdfViewerEnabled ?? null, plugins, mimeTypes: Array.from(navigator.mimeTypes || [], mime => ({ type: mime.type, suffixes: mime.suffixes, description: mime.description })), extensions: { enumerationAvailable: false, versionsAvailable: false, installed: null } },
      device: { hardwareConcurrency: navigator.hardwareConcurrency ?? null, deviceMemoryGiB: navigator.deviceMemory ?? null, maxTouchPoints: navigator.maxTouchPoints ?? null },
      screen: { width: screen.width, height: screen.height, availWidth: screen.availWidth, availHeight: screen.availHeight, colorDepth: screen.colorDepth, pixelDepth: screen.pixelDepth, devicePixelRatio, orientationType: screen.orientation?.type ?? null },
      viewport: { innerWidth, innerHeight, outerWidth, outerHeight, visualWidth: window.visualViewport?.width ?? null, visualHeight: window.visualViewport?.height ?? null, visualScale: window.visualViewport?.scale ?? null },
      locale: { language: navigator.language, languages: Array.from(navigator.languages || []), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, timezoneOffsetMinutes: new Date().getTimezoneOffset() },
      capabilities: { cookieEnabled: navigator.cookieEnabled, localStorage: availableStorage('localStorage'), sessionStorage: availableStorage('sessionStorage'), secureContext: isSecureContext, doNotTrack: navigator.doNotTrack ?? null, globalPrivacyControl: navigator.globalPrivacyControl ?? null, touchEvent: 'ontouchstart' in window, webGPU: 'gpu' in navigator, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, colorScheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' },
      rendering: { webgl: webglInfo(), canvas: await canvasInfo() },
      limitations: { plugins: 'navigator.plugins may expose fixed PDF compatibility entries; not installed browser extensions', pluginVersions: 'not exposed by Plugin API', extensions: 'ordinary pages cannot enumerate all installed extensions or their versions', osVersion: 'UA may be reduced; UA-CH platformVersion is not an exact OS build', identity: 'fingerprint hash is experimental; neither unique identity nor human/AI proof', clientClaims: 'all client fields are self-reported and can be altered', notCollected: ['authentication cookies', 'account data', 'typed text', 'precise geolocation', 'media-device IDs', 'WebRTC local IPs', 'installed-font enumeration'] },
      context: { collectedAt: new Date().toISOString(), route: location.pathname, protocol: location.protocol, sampleLabel: (new URLSearchParams(location.search).get('sample') || 'unlabelled').slice(0, 80), visibilityState: document.visibilityState }
    };
  }
  function display(data, receipt) {
    const browserVersion = data.browser.highEntropy.fullVersionList?.find(item => /Chromium|Google Chrome|Microsoft Edge/.test(item.brand));
    const platform = data.browser.userAgentData?.platform || data.browser.platform;
    status.textContent = '觀測已記錄';
    shortId.textContent = `指紋 ${receipt.fingerprintId.slice(0, 12)}…`;
    const fields = [['瀏覽器', browserVersion ? `${browserVersion.brand} ${browserVersion.version}` : data.browser.userAgent], ['平台回報', `${platform} · ${data.browser.highEntropy.platformVersion || '無版本資訊'}`], ['語言 / 時區', `${data.locale.language} · ${data.locale.timezone}`], ['螢幕 / 視窗', `${data.screen.width}×${data.screen.height} / ${data.viewport.innerWidth}×${data.viewport.innerHeight}`], ['WebDriver 訊號', String(data.browser.webdriver)], ['Plugin API', `${data.browser.plugins.length} 項（不代表擴充套件）`], ['擴充套件與版本', '一般網頁無法完整列出'], ['工作階段', receipt.sessionId.slice(0, 12) + '…']];
    details.replaceChildren();
    for (const [name, value] of fields) { const dt = document.createElement('dt'); dt.textContent = name; const dd = document.createElement('dd'); dd.textContent = value; details.append(dt, dd); }
  }
  observation.record = async (type, details = {}, event = null) => {
    await observation.ready;
    if (observation.error) return false;
    const eventDetails = { ...details };
    if (event) { eventDetails.isTrusted = event.isTrusted; eventDetails.eventKind = event.type; eventDetails.elapsedMs = Math.round(performance.now()); if (typeof event.pointerType === 'string') eventDetails.pointerType = event.pointerType; if (typeof event.inputType === 'string') eventDetails.inputType = event.inputType; }
    try { await send('/api/events', { type, details: eventDetails, clientTime: new Date().toISOString() }); return true; }
    catch (error) { observation.lastEventError = error.message; status.textContent = '操作事件記錄暫時失敗'; return false; }
  };
  window.daylightObservation = observation;
  observation.ready = (async () => {
    try {
      const data = await collect(); observation.data = data;
      const receipt = await send('/api/fingerprint', data);
      observation.fingerprintId = receipt.fingerprintId; observation.sessionId = receipt.sessionId; observation.runId = receipt.runId;
      display(data, receipt);
      await send('/api/events', { type: 'page_view', details: { action: 'loaded' }, clientTime: new Date().toISOString() });
    } catch (error) { observation.error = error.message; status.textContent = '觀測記錄失敗'; shortId.textContent = error.message; }
  })();
})();
