(function () {
  const globalScope = typeof window !== 'undefined' ? window : globalThis;

  const STORAGE_KEY = 'veyron-admin-api-base-url';
  const SECRET_STORAGE_KEY = 'veyron-admin-secret';
  const DEFAULT_BASE_URL = '';

  function normalizeUrl(value) {
    const trimmed = (value || '').toString().trim();
    if (!trimmed) return '';
    if (/^\{\{.+\}\}$/.test(trimmed)) return '';
    return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
  }

  function normalizeSecret(value) {
    return (value || '').toString().trim();
  }

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

  function extractSecretFromObject(source) {
    if (!source || typeof source !== 'object') return '';
    const value =
      source.VITE_ADMIN_SECRET ||
      source.NEXT_PUBLIC_ADMIN_SECRET ||
      source.REACT_APP_ADMIN_SECRET ||
      source.ADMIN_SHARED_SECRET ||
      source.ADMIN_SECRET ||
      source.adminSecret ||
      source['x-admin-secret'];
    return normalizeSecret(value);
  }

  function extractTurnstileKeyFromObject(source) {
    if (!source || typeof source !== 'object') return '';
    const value =
      source.VITE_TURNSTILE_SITE_KEY ||
      source.NEXT_PUBLIC_TURNSTILE_SITE_KEY ||
      source.REACT_APP_TURNSTILE_SITE_KEY ||
      source.TURNSTILE_SITE_KEY ||
      source.turnstileSiteKey;
    return normalizeSecret(value);
  }

  function extractMetaUrl() {
    if (typeof document === 'undefined') return '';
    const meta =
      document.querySelector('meta[name="api-base-url"]') ||
      document.querySelector('meta[name="vite-api-base-url"]');
    if (!meta) return '';
    const direct = normalizeUrl(meta.getAttribute('content'));
    if (direct) return direct;
    const dataKey = meta.dataset ? meta.dataset.envKey || meta.dataset.env : '';
    if (!dataKey) return '';
    const candidate = meta.getAttribute(`data-${dataKey.toLowerCase()}`);
    return normalizeUrl(candidate);
  }

  function extractMetaSecret() {
    if (typeof document === 'undefined') return '';
    const meta = document.querySelector('meta[name="admin-secret"]');
    if (!meta) return '';
    const content = normalizeSecret(meta.getAttribute('content'));
    if (content) return content;
    if (meta.dataset) {
      return normalizeSecret(meta.dataset.secret || meta.dataset.adminSecret || '');
    }
    return '';
  }

  function extractMetaTurnstileKey() {
    if (typeof document === 'undefined') return '';
    const meta = document.querySelector('meta[name="turnstile-site-key"]');
    if (!meta) return '';
    const direct = normalizeSecret(meta.getAttribute('content'));
    if (direct) return direct;
    if (meta.dataset) {
      return normalizeSecret(meta.dataset.siteKey || meta.dataset.key || '');
    }
    return '';
  }

  function extractStoredBaseUrl() {
    if (typeof localStorage === 'undefined') return '';
    try {
      return normalizeUrl(localStorage.getItem(STORAGE_KEY));
    } catch (error) {
      return '';
    }
  }

  function extractStoredSecret() {
    if (typeof localStorage === 'undefined') return '';
    try {
      return normalizeSecret(localStorage.getItem(SECRET_STORAGE_KEY));
    } catch (error) {
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
      // ignore storage failures
    }
  }

  function persistSecret(value) {
    if (typeof localStorage === 'undefined') return;
    try {
      if (value) {
        localStorage.setItem(SECRET_STORAGE_KEY, value);
      } else {
        localStorage.removeItem(SECRET_STORAGE_KEY);
      }
    } catch (error) {
      // ignore storage failures
    }
  }

  const existingConfig = globalScope.adminApiConfig || {};

  const baseUrlCandidates = [
    normalizeUrl(existingConfig.baseUrl),
    extractFromObject(globalScope.__env__),
    extractFromObject(globalScope.__ENV__),
    extractFromObject(globalScope.ENV),
    extractFromObject(globalScope.appConfig),
    extractFromObject(globalScope.siteConfig),
    extractFromObject(typeof process !== 'undefined' ? process.env : null),
    extractMetaUrl(),
    extractStoredBaseUrl(),
    normalizeUrl(DEFAULT_BASE_URL),
  ].filter(Boolean);

  const resolvedBaseUrl = baseUrlCandidates.length ? baseUrlCandidates[0] : '';

  if (resolvedBaseUrl && resolvedBaseUrl !== normalizeUrl(existingConfig.baseUrl)) {
    persistBaseUrl(resolvedBaseUrl);
  }

  const existingSecret = normalizeSecret(
    (existingConfig.extraHeaders && existingConfig.extraHeaders['X-Admin-Secret']) ||
      existingConfig.adminSecret ||
      ''
  );

  const secretCandidates = [
    existingSecret,
    extractSecretFromObject(globalScope.__env__),
    extractSecretFromObject(globalScope.__ENV__),
    extractSecretFromObject(globalScope.ENV),
    extractSecretFromObject(globalScope.appConfig),
    extractSecretFromObject(globalScope.siteConfig),
    extractSecretFromObject(typeof process !== 'undefined' ? process.env : null),
    extractMetaSecret(),
    extractStoredSecret(),
  ].filter(Boolean);

  const resolvedSecret = secretCandidates.length ? secretCandidates[0] : '';

  if (resolvedSecret && resolvedSecret !== existingSecret) {
    persistSecret(resolvedSecret);
  }

  const existingSiteKey = normalizeSecret(
    existingConfig.turnstileSiteKey ||
      (globalScope.siteConfig && globalScope.siteConfig.turnstileSiteKey) ||
      ''
  );

  const siteKeyCandidates = [
    existingSiteKey,
    extractTurnstileKeyFromObject(globalScope.__env__),
    extractTurnstileKeyFromObject(globalScope.__ENV__),
    extractTurnstileKeyFromObject(globalScope.ENV),
    extractTurnstileKeyFromObject(globalScope.appConfig),
    extractTurnstileKeyFromObject(globalScope.siteConfig),
    extractTurnstileKeyFromObject(typeof process !== 'undefined' ? process.env : null),
    extractMetaTurnstileKey(),
  ].filter(Boolean);

  const resolvedTurnstileSiteKey = siteKeyCandidates.length ? siteKeyCandidates[0] : '';

  const mergedConfig = {
    baseUrl: resolvedBaseUrl,
    authToken: (existingConfig.authToken || '').toString().trim(),
    extraHeaders:
      existingConfig.extraHeaders && typeof existingConfig.extraHeaders === 'object'
        ? { ...existingConfig.extraHeaders }
        : {},
    adminSecret: resolvedSecret,
    turnstileSiteKey: resolvedTurnstileSiteKey,
  };

  if (resolvedSecret) {
    mergedConfig.extraHeaders['X-Admin-Secret'] = resolvedSecret;
  } else if (mergedConfig.extraHeaders['X-Admin-Secret']) {
    delete mergedConfig.extraHeaders['X-Admin-Secret'];
  }

  globalScope.adminApiConfig = mergedConfig;
  globalScope.siteConfig = Object.assign({}, globalScope.siteConfig, {
    apiBaseUrl: resolvedBaseUrl,
    turnstileSiteKey: resolvedTurnstileSiteKey,
  });

  globalScope.baseUrl = resolvedBaseUrl;
  globalScope.API_BASE_URL = resolvedBaseUrl;

  function setAdminApiSecret(nextSecret) {
    const normalised = normalizeSecret(nextSecret);
    persistSecret(normalised);
    const updatedHeaders = Object.assign({}, globalScope.adminApiConfig.extraHeaders || {});
    if (normalised) {
      updatedHeaders['X-Admin-Secret'] = normalised;
    } else {
      delete updatedHeaders['X-Admin-Secret'];
    }
    globalScope.adminApiConfig = Object.assign({}, globalScope.adminApiConfig, {
      extraHeaders: updatedHeaders,
      adminSecret: normalised,
    });
  }

  globalScope.setAdminApiSecret = setAdminApiSecret;

  if (!resolvedBaseUrl) {
    console.warn(
      '[veyron-admin] API base URL not set. Define it via meta tag <meta name="api-base-url" content="https://...">, ' +
        'window.__env__ = { API_BASE_URL: "https://..." }, localStorage key "veyron-admin-api-base-url", ' +
        'or a build-time env (VITE_/REACT_APP_/NEXT_PUBLIC_).'
    );
  }
})();
