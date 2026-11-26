// Turn non-JSON error responses (e.g. an nginx "502 Bad Gateway" HTML page)
// into a PostgREST-shaped JSON error, so callers show a readable message
// instead of raw HTML.
//
// The message keeps the standard reason phrase ("Bad Gateway", "Service
// Unavailable", "Gateway Timeout") because isConnectivityError() in
// connectivity.js matches on it to fall back to the offline cache.

const REASON_PHRASES = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  408: "Request Timeout",
  413: "Content Too Large",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

export function readableHttpErrorMessage(status, statusText = "") {
  const reason = REASON_PHRASES[status] || statusText || "Error";
  const label = `${status} ${reason}`;
  if (status >= 502 && status <= 504) {
    return `Server temporarily unavailable (${label}). Please try again in a moment.`;
  }
  if (status >= 500) return `Server error (${label}). Please try again.`;
  return `Request failed (${label}).`;
}

const isJson = (response) =>
  /\bjson\b/i.test(response.headers.get("content-type") || "");

/**
 * Return `response` unchanged unless it is an error with a non-JSON body;
 * in that case return an equivalent JSON error response.
 * @param {Response} response
 * @returns {Response}
 */
export function withReadableError(response) {
  if (response.ok || isJson(response)) return response;
  const body = {
    code: "",
    message: readableHttpErrorMessage(response.status, response.statusText),
    details: null,
    hint: null,
  };
  return new Response(JSON.stringify(body), {
    status: response.status,
    statusText: response.statusText,
    headers: { "Content-Type": "application/json" },
  });
}
