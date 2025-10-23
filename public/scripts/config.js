(function () {
  const globalScope = typeof window !== 'undefined' ? window : globalThis;

  // Where we can store/read a persisted value in the browser
  const STORAGE_KEY = 'veyron-admin-api-base-url';

  // OPTIONAL: If you want a hard fallback, put it here; otherwise leave empty to force explicit config
  const DEFAULT_BASE_URL = '';

  function normalizeUrl(value) {
    const trimmed = (value || '').toString().trim();
    if (!trimmed) return '';
    // Ignore template placeholders like {{...}}
    if (/^\{\{.+\}\}$/.test(trimmed)) return '';
    return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
  }

  // Read from a plain object that may hold env-like values
  function extractFromObject(source) {
    if (!source || typeof source !== 'object') return '';
    const value =
      source.VITE_API_BASE_URL ||
      source.NEXT_PUBLIC_API_BASE_URL ||
      source.REACT_APP_API_BASE_URL ||
      source.API_BASE_URL ||
      source.apiBaseUrl ||
      source.baseUrl;
    return normalizeUrl(value);
  }

  // Read from a meta tag in index.html: <meta name="api-base-url" content="https://...">
  // (Also supports legacy name "vite-api-base-url")
  function extractFromMeta() {
    if (typeof document === 'undefined') return '';
    const meta =
      document.querySelector('meta[name="api-base-url"]') ||
      document.querySelector('meta[name="vite-api-base-url"]');
    if (!meta) return '';
    const direct = normalizeUrl(meta.getAttribute('content'));
    if (direct) return direct;
    // Optional: <meta name="api-base-url" data-env-key="API_BASE_URL" data-api_base_url="...">
    const dataKey = meta.dataset ? meta.dataset.envKey || meta.dataset.env : '';
    if (!dataKey) return '';
    const candidate = meta.getAttribute(`data-${dataKey.toLowerCase()}`);
    return normalizeUrl(candidate);
  }

  function extractStored() {
    if (typeof localStorage === 'undefined') return '';
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return normalizeUrl(stored);
    } catch {
      return '';
    }
  }

  function persistBaseUrl(value) {
    if (typeof localStorage === 'undefined') return;
    try {
      if (value) localStorage.setItem(STORAGE_KEY, value);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }

  // Candidate sources, in priority order
  const existingConfig = globalScope.adminApiConfig || {};
  const candidates = [
    normalizeUrl(existingConfig.baseUrl),

    // Window-scoped env objects you might define at runtime
    extractFromObject(globalScope.__env__),
    extractFromObject(globalScope.__ENV__),
    extractFromObject(globalScope.ENV),
    extractFromObject(globalScope.appConfig),
    extractFromObject(globalScope.siteConfig),

    // Build-time env (only works if bundled)
    extractFromObject(typeof process !== 'undefined' ? process.env : null),

    // Meta tag in index.html
    extractFromMeta(),

    // User override persisted in localStorage
    extractStored(),

    // LAST resort fallback (optional)
    normalizeUrl(DEFAULT_BASE_URL),
  ].filter(Boolean);

  const resolvedBaseUrl = candidates.length ? candidates[0] : '';

  // Persist if we found a new value
  if (resolvedBaseUrl && resolvedBaseUrl !== normalizeUrl(existingConfig.baseUrl)) {
    persistBaseUrl(resolvedBaseUrl);
  }

  const mergedConfig = {
    baseUrl: resolvedBaseUrl,
    authToken: (existingConfig.authToken || '').toString().trim(),
    extraHeaders:
      existingConfig.extraHeaders && typeof existingConfig.extraHeaders === 'object'
        ? { ...existingConfig.extraHeaders }
        : {},
  };

  // Expose globally for app code
  globalScope.adminApiConfig = mergedConfig;
  globalScope.siteConfig = Object.assign({}, globalScope.siteConfig, { apiBaseUrl: resolvedBaseUrl });

  // Also expose easy globals for debugging and simple apps
  globalScope.baseUrl = resolvedBaseUrl;
  globalScope.API_BASE_URL = resolvedBaseUrl;

  // (Optional) nudge in console if still unset
  if (!resolvedBaseUrl) {
    // eslint-disable-next-line no-console
    console.warn(
      '[veyron-admin] API base URL not set. Define it via meta tag <meta name="api-base-url" content="https://...">, ' +
      'window.__env__ = { API_BASE_URL: "https://..." }, localStorage key "veyron-admin-api-base-url", ' +
      'or a build-time env (VITE_/REACT_APP_/NEXT_PUBLIC_).'
    );
  }
})();
