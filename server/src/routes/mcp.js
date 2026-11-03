import express, { Router } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { store } from '../store.js';
import { createMcpAuth } from '../middleware/mcpAuth.js';
import { createMcpServer } from '../mcp/createMcpServer.js';

// MCP (Model Context Protocol) endpoint: POST /mcp, Streamable HTTP in
// stateless mode — every request gets a fresh server + transport and a
// plain JSON response (no SSE, so nothing for a reverse proxy to buffer).
// The server really does have to be per request: the SDK's Protocol class
// binds to exactly one transport and throws on a second connect(), so one
// shared McpServer couldn't serve two concurrent calls. The tool
// definitions themselves are built once (see mcp/createMcpServer.js);
// per request we only register them.
// Gated by RESUMECMS_MCP_TOKEN (see middleware/mcpAuth.js); mounted
// unconditionally so an unset token yields a 404 here rather than the SPA's
// index.html from the catch-all.
//
// index.js mounts this router *before* the app-wide express.json(), and the
// body parser below runs only after the token check, so an unauthenticated
// request is rejected without the server parsing up to 2 MB of JSON for it.
// That also means the router has to answer every method and sub-path
// itself — anything it let fall through would reach the SPA catch-all.
const router = Router();

router.use(createMcpAuth(process.env.RESUMECMS_MCP_TOKEN));
router.use(express.json({ limit: '2mb' }));
// Body-parser failures (malformed JSON, too large, unsupported charset or
// encoding, aborted request, ...) would otherwise fall to Express's HTML
// error page; an MCP client expects JSON-RPC. body-parser's errors all
// carry a status, and 4xx ones are marked safe to expose (http-errors'
// `expose`), so their own message can go back as-is.
router.use((err, req, res, next) => {
  const status = err.status ?? err.statusCode;
  if (!status) return next(err);
  const parseError = err.type === 'entity.parse.failed';
  const message = parseError ? 'Parse error: invalid JSON' : err.expose ? err.message : 'Internal server error';
  const code = parseError ? -32700 : status < 500 ? -32600 : -32603;
  res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });
});

const METHOD_NOT_ALLOWED = {
  jsonrpc: '2.0',
  error: { code: -32000, message: 'Method not allowed.' },
  id: null,
};

router.post('/', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const server = createMcpServer({ store });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  // server.close() closes its transport too.
  res.on('close', () => {
    server.close().catch(() => {});
  });
  try {
    await server.connect(transport);
    // express.json() has already parsed the body; handing it over means the
    // transport doesn't try to read the (consumed) request stream.
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('MCP request failed:', err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  }
});

// Every other method on the endpoint is a 405. Stateless mode has no
// sessions to resume (GET) or delete (DELETE) — the SDK would otherwise hold
// a GET open as an SSE stream — and nothing else is meaningful either.
router.all('/', (req, res) => {
  res.set('Allow', 'POST').status(405).json(METHOD_NOT_ALLOWED);
});
// Sub-paths don't exist; answer here rather than letting them reach the SPA.
router.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

export default router;
