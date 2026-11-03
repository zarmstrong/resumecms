// Builds an error with an http-ish status (400/404/409/500). Everything the
// store, the REST routes, and the MCP tools throw on purpose has this shape:
// routes map `.status` onto the response (routes/sendError.js) and the MCP
// layer surfaces it as `[<status>] <message>`.
export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
