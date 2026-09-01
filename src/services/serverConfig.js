import { createClient } from "@supabase/supabase-js";
import { Capacitor, CapacitorHttp } from "@capacitor/core";

const SERVER_CONFIG_KEY = "budgetApp.serverConfig.v1";
const ENV_CONFIG_PATH = "/env-config.js";
const PLACEHOLDER_PREFIX = "__";
const CONNECTION_TIMEOUT_MS = 10000;

const createSetupError = (code, message, cause) => {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
};

const withTimeout = (promise, timeoutMs, timeoutCode, timeoutMessage) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(createSetupError(timeoutCode, timeoutMessage));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });

export const normalizeServerOrigin = (input) => {
  if (!input || typeof input !== "string") {
    throw createSetupError("INVALID_SERVER_URL", "Server URL is required.");
  }

  const trimmed = input.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsed;
  try {
    parsed = new URL(withProtocol);
  } catch (error) {
    throw createSetupError(
      "INVALID_SERVER_URL",
      "Enter a valid server URL.",
      error,
    );
  }

  if (!/^https?:$/i.test(parsed.protocol)) {
    throw createSetupError(
      "INVALID_SERVER_URL",
      "Server URL must start with http:// or https://.",
    );
  }

  parsed.pathname = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
};

const parseEnvConfig = (sourceText, serverOrigin) => {
  const supabaseUrlMatch = sourceText.match(
    /SUPABASE_URL\s*:\s*["']([^"']+)["']/,
  );
  const supabaseAnonKeyMatch = sourceText.match(
    /SUPABASE_ANON_KEY\s*:\s*["']([^"']+)["']/,
  );

  const supabaseUrl = supabaseUrlMatch?.[1] ?? "";
  const supabaseAnonKey = supabaseAnonKeyMatch?.[1] ?? "";

  if (!supabaseUrl || !supabaseAnonKey) {
    throw createSetupError(
      "INVALID_SERVER_CONFIG",
      `Could not read Supabase settings from ${serverOrigin}${ENV_CONFIG_PATH}.`,
    );
  }

  if (
    supabaseUrl.startsWith(PLACEHOLDER_PREFIX) ||
    supabaseAnonKey.startsWith(PLACEHOLDER_PREFIX)
  ) {
    throw createSetupError(
      "INCOMPLETE_SERVER_CONFIG",
      "This server is missing runtime Supabase values. Configure SUPABASE_URL and SUPABASE_ANON_KEY.",
    );
  }

  return { supabaseUrl, supabaseAnonKey };
};

const fetchEnvConfigTextNative = async (configUrl) => {
  const response = await withTimeout(
    CapacitorHttp.get({
      url: configUrl,
      headers: {
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    }),
    CONNECTION_TIMEOUT_MS,
    "CONNECTION_TIMEOUT",
    "Connection test timed out. Verify the server URL and your network/VPN.",
  );

  if (!response || response.status < 200 || response.status >= 300) {
    throw createSetupError(
      "SERVER_CONFIG_NOT_FOUND",
      `Server responded with ${response?.status ?? "an unknown status"} when loading ${ENV_CONFIG_PATH}.`,
    );
  }

  if (typeof response.data !== "string") {
    throw createSetupError(
      "INVALID_SERVER_CONFIG",
      `Could not read Supabase settings from ${configUrl}.`,
    );
  }

  return response.data;
};

const fetchServerEnvConfig = async (serverOrigin) => {
  const configUrl = `${serverOrigin}${ENV_CONFIG_PATH}`;

  try {
    const sourceText = Capacitor.isNativePlatform()
      ? await fetchEnvConfigTextNative(configUrl)
      : await withTimeout(
          fetch(configUrl, {
            method: "GET",
            cache: "no-store",
          }).then(async (response) => {
            if (!response.ok) {
              throw createSetupError(
                "SERVER_CONFIG_NOT_FOUND",
                `Server responded with ${response.status} when loading ${ENV_CONFIG_PATH}.`,
              );
            }
            return response.text();
          }),
          CONNECTION_TIMEOUT_MS,
          "CONNECTION_TIMEOUT",
          "Connection test timed out. Verify the server URL and your network/VPN.",
        );

    return parseEnvConfig(sourceText, serverOrigin);
  } catch (error) {
    if (error?.code) throw error;
    throw createSetupError(
      "SERVER_CONFIG_FETCH_FAILED",
      `Could not reach ${serverOrigin}. Make sure the device can access that network.`,
      error,
    );
  }
};

const validateSupabaseHandshake = async ({ supabaseUrl, supabaseAnonKey }) => {
  const testClient = createClient(supabaseUrl, supabaseAnonKey);
  const { error } = await withTimeout(
    testClient.auth.getSession(),
    CONNECTION_TIMEOUT_MS,
    "CONNECTION_TIMEOUT",
    "Supabase handshake timed out.",
  );

  if (error) {
    throw createSetupError(
      "SUPABASE_HANDSHAKE_FAILED",
      `Supabase auth endpoint is unreachable or rejected the key: ${error.message}`,
      error,
    );
  }
};

export const testServerConnection = async (serverInput) => {
  const serverOrigin = normalizeServerOrigin(serverInput);
  const resolvedConfig = await fetchServerEnvConfig(serverOrigin);
  await validateSupabaseHandshake(resolvedConfig);
  return { serverOrigin, ...resolvedConfig };
};

export const loadServerConfig = () => {
  const raw = localStorage.getItem(SERVER_CONFIG_KEY);
  if (!raw) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw createSetupError(
      "STORED_CONFIG_INVALID",
      "Stored server config is not valid JSON.",
      error,
    );
  }

  const { serverOrigin, supabaseUrl, supabaseAnonKey } = parsed ?? {};
  if (!serverOrigin || !supabaseUrl || !supabaseAnonKey) {
    throw createSetupError(
      "STORED_CONFIG_INCOMPLETE",
      "Stored server config is incomplete.",
    );
  }

  return {
    serverOrigin,
    supabaseUrl,
    supabaseAnonKey,
    configuredAt: parsed.configuredAt ?? null,
  };
};

export const saveServerConfig = (config) => {
  const payload = {
    serverOrigin: config.serverOrigin,
    supabaseUrl: config.supabaseUrl,
    supabaseAnonKey: config.supabaseAnonKey,
    configuredAt: new Date().toISOString(),
  };
  localStorage.setItem(SERVER_CONFIG_KEY, JSON.stringify(payload));
  return payload;
};

export const clearServerConfig = () => {
  localStorage.removeItem(SERVER_CONFIG_KEY);
};
