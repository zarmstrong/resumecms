// @ts-check
// Builds an error with an http-ish status (400/404/409/500). Everything the
// store, the REST routes, and the MCP tools throw on purpose has this shape:
// routes map `.status` onto the response (routes/sendError.js) and the MCP
// layer surfaces it as `[<status>] <message>`.

/** @typedef {Error & { status: number, cause?: unknown }} HttpError */

/**
 * @param {number} status
 * @param {string} message
 * @returns {HttpError}
 */
export function httpError(status, message) {
  const err = /** @type {HttpError} */ (new Error(message));
  err.status = status;
  return err;
}
