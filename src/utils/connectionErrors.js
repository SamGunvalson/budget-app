const NETWORK_ERROR_PATTERNS = [
  'failed to fetch',
  'networkerror',
  'network request failed',
  'load failed',
  'fetch failed',
];

const TLS_ERROR_PATTERNS = ['certificate', 'ssl', 'tls', 'err_cert', 'secure connection'];

const includesAny = (value, patterns) => patterns.some((pattern) => value.includes(pattern));

export const getConnectionErrorMessage = (error, fallbackMessage) => {
  const code = error?.code;
  const message = String(error?.message || '').toLowerCase();
  const deviceOffline =
    typeof navigator !== 'undefined' && Object.hasOwn(navigator, 'onLine') && !navigator.onLine;

  if (code === 'INVALID_SERVER_URL') {
    return 'Enter a valid server URL (for example: https://budget.example.ts.net).';
  }

  if (code === 'SERVER_CONFIG_NOT_FOUND') {
    return 'Could not load server config. Verify the URL points to your Budget App server root.';
  }

  if (code === 'INCOMPLETE_SERVER_CONFIG') {
    return 'Server is missing runtime SUPABASE_URL/SUPABASE_ANON_KEY values.';
  }

  if (code === 'INVALID_SERVER_CONFIG') {
    return 'Server returned an invalid config file. Ensure env-config.js is available.';
  }

  if (code === 'CONNECTION_TIMEOUT') {
    return 'Connection timed out. Confirm the device is on your Tailscale network and try again.';
  }

  if (code === 'SUPABASE_HANDSHAKE_FAILED') {
    return 'Server config loaded, but Supabase auth endpoint could not be reached.';
  }

  if (deviceOffline) {
    return 'This device appears offline. Reconnect to the internet/Tailscale and retry.';
  }

  if (includesAny(message, TLS_ERROR_PATTERNS)) {
    return 'Secure connection failed. Check the certificate/TLS setup for this server.';
  }

  if (includesAny(message, NETWORK_ERROR_PATTERNS) || code === 'SERVER_CONFIG_FETCH_FAILED') {
    return 'Could not reach the server. Verify URL, VPN/Tailscale connectivity, and CORS settings.';
  }

  return fallbackMessage || error?.message || 'Connection failed. Please try again.';
};

export const isLikelyConnectionError = (error) => {
  if (!error) return false;
  if (error?.code) return true;
  const message = String(error?.message || '').toLowerCase();
  return (
    includesAny(message, NETWORK_ERROR_PATTERNS) ||
    includesAny(message, TLS_ERROR_PATTERNS) ||
    message.includes('timeout')
  );
};
