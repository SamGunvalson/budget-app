import { createClient } from '@supabase/supabase-js';
import { Capacitor, CapacitorHttp } from '@capacitor/core';

const SERVER_CONFIG_KEY = 'budgetApp.serverConfig.v2';
const LEGACY_SERVER_CONFIG_KEY = 'budgetApp.serverConfig.v1';
const ENV_CONFIG_PATH = '/env-config.js';
const PLACEHOLDER_PREFIX = '__';
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

const parseEnvConfig = (sourceText, serverOrigin) => {
  const getValue = (key) => sourceText.match(new RegExp(`${key}\\s*:\\s*["']([^"']+)["']`))?.[1] ?? '';
  const modeValue = getValue('BACKEND_MODE');
  const backendMode = modeValue && !modeValue.startsWith(PLACEHOLDER_PREFIX) ? modeValue.toLowerCase() : 'supabase';
  if (!['supabase', 'local'].includes(backendMode)) throw createSetupError('INVALID_SERVER_CONFIG', 'Server specifies an unsupported backend mode.');
  if (backendMode === 'local') return { backendMode, serverOrigin };

  const supabaseUrl = getValue('SUPABASE_URL');
  const supabaseAnonKey = getValue('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !supabaseAnonKey) throw createSetupError('INCOMPLETE_SERVER_CONFIG', `Could not read required runtime backend settings from ${serverOrigin}${ENV_CONFIG_PATH}.`);
  if (supabaseUrl.startsWith(PLACEHOLDER_PREFIX) || supabaseAnonKey.startsWith(PLACEHOLDER_PREFIX)) {
    throw createSetupError('INCOMPLETE_SERVER_CONFIG', 'This server is missing required runtime backend values. Configure its runtime environment.');
  }
  return { backendMode, serverOrigin, supabaseUrl, supabaseAnonKey };
};

const fetchTextNative = async (url) => {
  const response = await withTimeout(CapacitorHttp.get({ url, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' }, responseType: 'text' }), CONNECTION_TIMEOUT_MS, 'CONNECTION_TIMEOUT', 'Connection test timed out. Verify the server URL and your network/VPN.');
  if (!response || response.status < 200 || response.status >= 300) throw createSetupError('SERVER_CONFIG_NOT_FOUND', `Server responded with ${response?.status ?? 'an unknown status'} when loading ${ENV_CONFIG_PATH}.`);
  return typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
};
const fetchServerEnvConfig = async (serverOrigin) => {
  const configUrl = `${serverOrigin}${ENV_CONFIG_PATH}`;
  try {
    const sourceText = Capacitor.isNativePlatform()
      ? await fetchTextNative(configUrl)
      : await withTimeout(fetch(configUrl, { method: 'GET', cache: 'no-store' }).then(async (response) => {
          if (!response.ok) throw createSetupError('SERVER_CONFIG_NOT_FOUND', `Server responded with ${response.status} when loading ${ENV_CONFIG_PATH}.`);
          return response.text();
        }), CONNECTION_TIMEOUT_MS, 'CONNECTION_TIMEOUT', 'Connection test timed out. Verify the server URL and your network/VPN.');
    return parseEnvConfig(sourceText, serverOrigin);
  } catch (error) {
    if (error?.code) throw error;
    throw createSetupError('SERVER_CONFIG_FETCH_FAILED', `Could not reach ${serverOrigin}. Make sure the device can access that network.`, error);
  }
};

const nativeRequest = async (url) => {
  const response = await withTimeout(CapacitorHttp.get({ url, headers: { Accept: 'application/json' }, responseType: 'text' }), CONNECTION_TIMEOUT_MS, 'CONNECTION_TIMEOUT', 'Connection test timed out. Verify the server URL and your network/VPN.');
  let data = response.data;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch { data = null; } }
  return { status: response.status, data };
};
const validateLocalHandshake = async (serverOrigin) => {
  try {
    const response = Capacitor.isNativePlatform()
      ? await nativeRequest(`${serverOrigin}/auth/v1/health`)
      : await withTimeout(fetch(`${serverOrigin}/auth/v1/health`, { headers: { Accept: 'application/json' } }).then(async (res) => ({ status: res.status, data: await res.json().catch(() => null) })), CONNECTION_TIMEOUT_MS, 'CONNECTION_TIMEOUT', 'Local auth handshake timed out.');
    if (response.status < 200 || response.status >= 300 || response.data?.ok !== true) throw new Error('Health check did not return { ok: true }.');
  } catch (error) {
    if (error?.code === 'CONNECTION_TIMEOUT') throw error;
    throw createSetupError('LOCAL_HANDSHAKE_FAILED', `Local auth endpoint is unreachable or returned an invalid health response: ${error.message}`, error);
  }
};
const validateSupabaseHandshake = async ({ supabaseUrl, supabaseAnonKey }) => {
  const testClient = createClient(supabaseUrl, supabaseAnonKey);
  const { error } = await withTimeout(testClient.auth.getSession(), CONNECTION_TIMEOUT_MS, 'CONNECTION_TIMEOUT', 'Supabase handshake timed out.');
  if (error) throw createSetupError('SUPABASE_HANDSHAKE_FAILED', `Supabase auth endpoint is unreachable or rejected the key: ${error.message}`, error);
};

export const testServerConnection = async (serverInput) => {
  const serverOrigin = normalizeServerOrigin(serverInput);
  const config = await fetchServerEnvConfig(serverOrigin);
  if (config.backendMode === 'local') await validateLocalHandshake(serverOrigin);
  else await validateSupabaseHandshake(config);
  return { ...config, serverOrigin };
};

const normalizeStoredConfig = (parsed) => {
  const backendMode = parsed.backendMode || 'supabase';
  if (!parsed.serverOrigin || !['supabase', 'local'].includes(backendMode)) return null;
  if (backendMode === 'supabase' && (!parsed.supabaseUrl || !parsed.supabaseAnonKey)) return null;
  return {
    serverOrigin: parsed.serverOrigin,
    backendMode,
    ...(parsed.supabaseUrl ? { supabaseUrl: parsed.supabaseUrl } : {}),
    ...(parsed.supabaseAnonKey ? { supabaseAnonKey: parsed.supabaseAnonKey } : {}),
    configuredAt: parsed.configuredAt ?? null,
  };
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
    backendMode: config.backendMode || 'supabase',
    ...(config.supabaseUrl ? { supabaseUrl: config.supabaseUrl } : {}),
    ...(config.supabaseAnonKey ? { supabaseAnonKey: config.supabaseAnonKey } : {}),
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
