(function () {
  const globalScope = typeof window !== 'undefined' ? window : globalThis;
  const STORAGE_KEY = 'veyron-admin-api-base-url';

  function normalizeUrl(value) {
    const trimmed = (value || '').toString().trim();
    if (!trimmed) return '';
    if (/^\{\{.+\}\}$/.test(trimmed)) {
      return '';
    }
    return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
  }

  function extractFromObject(source) {
    if (!source || typeof source !== 'object') return '';
    const value = source.VITE_API_BASE_URL || source.API_BASE_URL || source.apiBaseUrl;
    return normalizeUrl(value);
  }

  function extractFromMeta() {
    if (typeof document === 'undefined') return '';
    const meta = document.querySelector('meta[name="vite-api-base-url"]');
    if (!meta) return '';
    const direct = normalizeUrl(meta.getAttribute('content'));
    if (direct) {
      return direct;
    }
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
    } catch (error) {
      console.warn('Unable to read stored API base URL', error);
      return '';
    }
  }

  function persistBaseUrl(value) {
    if (typeof localStorage === 'undefined') return;
    try {
      if (value) {
        localStorage.setItem(STORAGE_KEY, value);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (error) {
      console.warn('Unable to persist API base URL', error);
    }
  }

  const existingConfig = globalScope.adminApiConfig || {};
  const candidates = [
    normalizeUrl(existingConfig.baseUrl),
    extractFromObject(globalScope.__env__),
    extractFromObject(globalScope.__ENV__),
    extractFromObject(globalScope.ENV),
    extractFromObject(globalScope.appConfig),
    extractFromObject(globalScope.siteConfig),
    extractFromObject(typeof process !== 'undefined' ? process.env : null),
    extractFromMeta(),
    extractStored(),
  ].filter(Boolean);

  const resolvedBaseUrl = candidates.length ? candidates[0] : '';
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

  globalScope.adminApiConfig = mergedConfig;
  globalScope.siteConfig = Object.assign({}, globalScope.siteConfig, {
    apiBaseUrl: resolvedBaseUrl,
  });
})();
