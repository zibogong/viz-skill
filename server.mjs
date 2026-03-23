/**
 * viz Claude Code channel — two-way bridge
 *
 * HTML click  → POST /api/select → MCP notification → Claude analyzes
 * Claude done → calls send_analysis → SSE /api/stream/:id → browser updates in-place
 *
 * Register globally:
 *   claude mcp add --scope user viz -- node ~/.claude/skills/viz/server.mjs
 *
 * Start Claude Code with:
 *   claude --dangerously-load-development-channels server:viz
 */

import { Server }               from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createServer }         from 'node:http';

const PORT = 3747;

// Root page HTML served at GET / (set via set_viz_page tool)
let rootHtml = null;

// reply_id → Set<ServerResponse> — multiple SSE subscribers per reply_id
const pendingReplies = new Map();

// reply_id → content — cached when SSE dropped before analysis finished (5 min TTL)
const responseCache = new Map();

// reply_ids already delivered — prevents duplicate send_analysis calls (10 min TTL)
const sentIds = new Set();

// name → reply_id — dedup in-flight requests so re-clicks attach to the same result
const inFlightByKey = new Map();

// reply_id → name — reverse map for O(1) cleanup in send_analysis
const inFlightReplyToKey = new Map();

// ── MCP channel server ────────────────────────────────────────────────────────

const mcp = new Server(
  { name: 'viz', version: '1.0.0' },
  {
    capabilities: {
      experimental: { 'claude/channel': {} },
      tools: {},
    },
    instructions: `\
You are receiving click events from the viz HTML browser served at http://localhost:3747/.

When a <channel source="viz"> event arrives, the body is JSON with:
  - "name"       — display label of the clicked item
  - "path"       — source path hint (e.g. "src/gateway/")
  - "prompt"     — a self-contained analysis request
  - "reply_id"   — ID to pass to send_analysis when done
  - "drill_down" — always true; generate a focused content fragment
  - "context"    — optional extra context about the clicked component

Read the relevant source files at the given path. Generate a focused content
fragment (inner HTML only — no <html>/<head>/<body> tags) for the clicked component.

When done, call:
  send_analysis(reply_id, JSON.stringify({ html: "<fragment HTML>" }))

The browser will inject this fragment into the page in-place (no new tab, no file writes).`,
  },
);

// ── MCP Tools ─────────────────────────────────────────────────────────────────

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'set_viz_page',
      description: 'Set the full HTML page served at http://localhost:3747/. Call this to publish a new root visualization, then open the URL in the browser.',
      inputSchema: {
        type: 'object',
        properties: {
          html: { type: 'string', description: 'Complete HTML page (doctype + html + head + body)' },
        },
        required: ['html'],
      },
    },
    {
      name: 'send_analysis',
      description: 'Send a content fragment back to the viz page. The browser injects it in-place (drill-down navigation). Content must be JSON: {"html":"<fragment>"}.',
      inputSchema: {
        type: 'object',
        properties: {
          reply_id: { type: 'string', description: 'The reply_id from the channel event' },
          content:  { type: 'string', description: 'JSON string: {"html":"<inner HTML fragment>"}' },
        },
        required: ['reply_id', 'content'],
      },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  // ── set_viz_page ───────────────────────────────────────────────────────────
  if (req.params.name === 'set_viz_page') {
    rootHtml = String(req.params.arguments.html);
    return { content: [{ type: 'text', text: `Root page set (${rootHtml.length} bytes). Open http://localhost:${PORT}/ in the browser.` }] };
  }

  // ── send_analysis ──────────────────────────────────────────────────────────
  if (req.params.name === 'send_analysis') {
    const { reply_id, content } = req.params.arguments;
    const id = String(reply_id);

    if (sentIds.has(id)) {
      return { content: [{ type: 'text', text: 'Duplicate send_analysis ignored.' }] };
    }
    sentIds.add(id);
    setTimeout(() => sentIds.delete(id), 10 * 60 * 1000);

    // Clean up in-flight tracking
    const nameKey = inFlightReplyToKey.get(id);
    if (nameKey !== undefined) {
      inFlightByKey.delete(nameKey);
      inFlightReplyToKey.delete(id);
    }

    const subscribers = pendingReplies.get(id);
    if (subscribers && subscribers.size > 0) {
      for (const res of subscribers) {
        try {
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
          res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          res.end();
        } catch (_) {}
      }
      pendingReplies.delete(id);
    } else {
      responseCache.set(id, content);
      setTimeout(() => responseCache.delete(id), 5 * 60 * 1000);
    }

    return { content: [{ type: 'text', text: 'Fragment sent to viz page.' }] };
  }

  throw new Error(`unknown tool: ${req.params.name}`);
});

await mcp.connect(new StdioServerTransport());

// ── HTTP server ───────────────────────────────────────────────────────────────

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', c => (buf += c));
    req.on('end',  () => { try { resolve(JSON.parse(buf)); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

const WAITING_PAGE = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>viz</title>
<style>body{margin:0;background:#0d1117;display:flex;align-items:center;justify-content:center;height:100vh;font-family:monospace;color:#8b949e;flex-direction:column;gap:12px}
.sp{width:24px;height:24px;border:2px solid #30363d;border-top-color:#58a6ff;border-radius:50%;animation:s .8s linear infinite}@keyframes s{to{transform:rotate(360deg)}}</style></head>
<body><div class="sp"></div><div>Waiting for visualization&hellip;</div>
<script>setInterval(()=>fetch('/api/cache-status').then(r=>r.ok&&location.reload()),1500)</script>
</body></html>`;

createServer(async (req, res) => {
  cors(res);

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── GET / — serve root viz page ───────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(rootHtml ?? WAITING_PAGE);
    return;
  }

  // ── POST /api/select — HTML click → MCP channel notification ─────────────
  if (req.method === 'POST' && req.url === '/api/select') {
    const body = await readBody(req);
    const { name = 'item', path = '', prompt = '', drill_down, context, qa } = body;

    if (inFlightByKey.has(name)) {
      const existing = inFlightByKey.get(name);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, reply_id: existing, reused: true }));
      return;
    }

    const reply_id = String(body.reply_id || Math.random().toString(36).slice(2));

    inFlightByKey.set(name, reply_id);
    inFlightReplyToKey.set(reply_id, name);
    setTimeout(() => {
      if (inFlightByKey.get(name) === reply_id) inFlightByKey.delete(name);
      inFlightReplyToKey.delete(reply_id);
    }, 5 * 60 * 1000);

    await mcp.notification({
      method: 'notifications/claude/channel',
      params: {
        content: JSON.stringify({ name, path, prompt, reply_id, drill_down, context, qa }),
        meta: {
          name:     name.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 64),
          reply_id: reply_id.slice(0, 64),
        },
      },
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, reply_id }));
    return;
  }

  // ── GET /api/stream/:replyId — SSE ───────────────────────────────────────
  if (req.method === 'GET' && req.url.startsWith('/api/stream/')) {
    const replyId = req.url.slice('/api/stream/'.length);
    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    cors(res);
    res.writeHead(200);
    res.write(': connected\n\n');

    if (responseCache.has(replyId)) {
      const cached = responseCache.get(replyId);
      responseCache.delete(replyId);
      res.write(`data: ${JSON.stringify({ content: cached })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
      return;
    }

    if (!pendingReplies.has(replyId)) pendingReplies.set(replyId, new Set());
    const subscribers = pendingReplies.get(replyId);
    subscribers.add(res);

    const ka = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) {} }, 15000);
    req.on('close', () => {
      clearInterval(ka);
      subscribers.delete(res);
      if (subscribers.size === 0) pendingReplies.delete(replyId);
    });
    return;
  }

  // ── GET /api/result/:replyId — poll fallback ──────────────────────────────
  if (req.method === 'GET' && req.url.startsWith('/api/result/')) {
    const replyId = req.url.slice('/api/result/'.length);
    cors(res);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (responseCache.has(replyId)) {
      const content = responseCache.get(replyId);
      responseCache.delete(replyId);
      res.end(JSON.stringify({ content }));
    } else {
      res.end(JSON.stringify({ content: null }));
    }
    return;
  }

  // ── GET /api/cache-status — health check ──────────────────────────────────
  if (req.method === 'GET' && req.url === '/api/cache-status') {
    cors(res);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ channel: 'viz', status: 'ready' }));
    return;
  }

  res.writeHead(404); res.end('not found');
}).listen(PORT, () => {
  process.stderr.write(`[viz] HTTP listener on http://localhost:${PORT}\n`);
});
