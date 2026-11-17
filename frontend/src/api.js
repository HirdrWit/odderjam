/**
 * @fileoverview Fetch helpers that never leave a request unanswered (no React),
 * tested in errors.test.js: non-ok and rejected requests become an error string
 * in plain English, never a blank table or raw exception text.
 */

/**
 * @param {*} err What was thrown, if anything.
 * @param {?number=} status HTTP status, if there was a response.
 * @return {string} A short sentence for the user. Raw error text is not included.
 */
export function plainError(err, status) {
  if (status === 404) return 'The server could not find that.';
  if (status === 429) return 'Too many requests. Wait a moment and retry.';
  if (status >= 500) return 'The server hit an error.';
  if (status >= 400) return 'The server rejected the request.';
  return 'Could not reach the server.';
}

/** Error carrying the HTTP status of a failed response. */
export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {?number} status
   */
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * @param {string} url
 * @param {function(string): !Promise<!Response>=} fetchFn
 * @return {!Promise<*>} The parsed JSON. Rejects with ApiError on a non-ok
 *     response or a body that is not JSON.
 */
export async function fetchJson(url, fetchFn = (...a) => fetch(...a)) {
  const r = await fetchFn(url);
  if (!r.ok) throw new ApiError(`HTTP ${r.status}`, r.status);
  try {
    return await r.json();
  } catch {
    throw new ApiError('Response was not JSON', r.status);
  }
}

/**
 * @param {?string} url A falsy url fetches nothing and clears the state.
 * @param {function(string): !Promise<!Response>=} fetchFn
 * @return {!Promise<{data: *, error: ?string}>}
 */
export async function loadState(url, fetchFn) {
  if (!url) return {data: null, error: null};
  try {
    return {data: await fetchJson(url, fetchFn), error: null};
  } catch (err) {
    console.error('request failed', url, err);
    return {data: null, error: plainError(err, err && err.status)};
  }
}
