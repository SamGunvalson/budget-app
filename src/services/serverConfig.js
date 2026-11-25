import { Capacitor, CapacitorHttp } from '@capacitor/core';

const SERVER_CONFIG_KEY = 'budgetApp.serverConfig.v2';
const LEGACY_SERVER_CONFIG_KEY = 'budgetApp.serverConfig.v1';
const CONNECTION_TIMEOUT_MS = 10000;

const createSetupError = (code, message, cause) => {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
};
const withTimeout = (promise, timeoutMs, timeoutCode, timeoutMessage) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(createSetupError(timeoutCode, timeoutMessage)), timeoutMs);
  promise.then((value) => { clearTimeout(timer); resolve(value); }).catch((error) => { clearTimeout(timer); reject(error); });
});

export const normalizeServerOrigin = (input) => {
  if (!input || typeof input !== 'string') throw createSetupError('INVALID_SERVER_URL', 'Server URL is required.');
  const trimmed = input.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed;
  try { parsed = new URL(withProtocol); }
  catch (error) { throw createSetupError('INVALID_SERVER_URL', 'Enter a valid server URL.', error); }
  if (!/^https?:$/i.test(parsed.protocol)) throw createSetupError('INVALID_SERVER_URL', 'Server URL must start with http:// or https://.');
  parsed.pathname = '';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
};

const nativeRequest = async (url) => {
  const response = await withTimeout(CapacitorHttp.get({ url, headers: { Accept: 'application/json' }, responseType: 'text' }), CONNECTION_TIMEOUT_MS, 'CONNECTION_TIMEOUT', 'Connection test timed out. Verify the server URL and your network/VPN.');
  let data = response.data;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch { data = null; } }
  return { status: response.status, data };
};
const validateServerHealth = async (serverOrigin) => {
  try {
    const response = Capacitor.isNativePlatform()
      ? await nativeRequest(`${serverOrigin}/auth/v1/health`)
      : await withTimeout(fetch(`${serverOrigin}/auth/v1/health`, { headers: { Accept: 'application/json' } }).then(async (res) => ({ status: res.status, data: await res.json().catch(() => null) })), CONNECTION_TIMEOUT_MS, 'CONNECTION_TIMEOUT', 'Server health check timed out.');
    if (response.status < 200 || response.status >= 300 || response.data?.ok !== true) throw new Error('Health check did not return { ok: true }.');
  } catch (error) {
    if (error?.code === 'CONNECTION_TIMEOUT') throw error;
    throw createSetupError('HEALTH_CHECK_FAILED', `Auth service is unreachable or returned an invalid health response: ${error.message}`, error);
  }
};
export const testServerConnection = async (serverInput) => {
  const serverOrigin = normalizeServerOrigin(serverInput);
  await validateServerHealth(serverOrigin);
  return { serverOrigin };
};

// Configs saved before Supabase support was removed may carry
// backendMode: 'supabase' (or, in v1, only Supabase credentials); those servers
// no longer work, so treat them as unset.
const normalizeStoredConfig = (parsed) => {
  const isSupabase = parsed.backendMode ? parsed.backendMode !== 'local' : Boolean(parsed.supabaseUrl);
  if (!parsed.serverOrigin || isSupabase) return null;
  return { serverOrigin: parsed.serverOrigin, configuredAt: parsed.configuredAt ?? null };
};
export const loadServerConfig = () => {
  const currentRaw = localStorage.getItem(SERVER_CONFIG_KEY);
  const legacyRaw = currentRaw ? null : localStorage.getItem(LEGACY_SERVER_CONFIG_KEY);
  const raw = currentRaw || legacyRaw;
  if (!raw) return null;
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (error) { throw createSetupError('STORED_CONFIG_INVALID', 'Stored server config is not valid JSON.', error); }
  const normalized = normalizeStoredConfig(parsed ?? {});
  if (!normalized) throw createSetupError('STORED_CONFIG_INCOMPLETE', 'Stored server config is incomplete.');
  if (legacyRaw) {
    localStorage.setItem(SERVER_CONFIG_KEY, JSON.stringify(normalized));
    localStorage.removeItem(LEGACY_SERVER_CONFIG_KEY);
  }
  return normalized;
};
export const saveServerConfig = (config) => {
  const payload = {
    serverOrigin: config.serverOrigin,
    configuredAt: new Date().toISOString(),
  };
  localStorage.setItem(SERVER_CONFIG_KEY, JSON.stringify(payload));
  localStorage.removeItem(LEGACY_SERVER_CONFIG_KEY);
  return payload;
};
export const clearServerConfig = () => {
  localStorage.removeItem(SERVER_CONFIG_KEY);
  localStorage.removeItem(LEGACY_SERVER_CONFIG_KEY);
};
