---
name: viz
description: Generate an interactive HTML visualization of the current context, topic, or codebase being discussed, then open it in the browser. Use when the user asks to "visualize", "show a diagram", "make a viz", "draw this", "create a chart", or types "/viz". Also reacts automatically when the user clicks something in a previously generated HTML viz — the click arrives as a <channel source="viz"> event; read the JSON body and execute the prompt field to dive deeper.
---

## Two modes

### Mode 1 — Generate a visualization

Analyze the current conversation context and generate a focused, interactive HTML page.

**Steps:**
1. Generate the complete HTML (see template below).
2. Call the `set_viz_page` MCP tool with the HTML string — this publishes it to the server.
3. Open the page: `open http://localhost:3747/` (Bash tool).

**Do NOT** write to `/tmp` or any local file. Do NOT use the Write tool. The server hosts the page at `http://localhost:3747/`.

#### Pick the right structure

- **Architecture / system**: layered boxes with arrows showing data flow
- **Module / file**: function/class graph (nodes = symbols, edges = calls/uses)
- **Concept / explanation**: card grid or mind map
- **Comparison**: side-by-side table or split cards
- **Sequence / flow**: numbered step timeline

#### HTML template (complete boilerplate — copy exactly)

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>TITLE</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#0d1117;color:#c9d1d9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',monospace}
/* Loading overlay */
.loading-overlay{display:none;position:fixed;inset:0;background:rgba(13,17,23,.75);z-index:200;align-items:center;justify-content:center;flex-direction:column;gap:14px}
.loading-overlay.active{display:flex}
.lo-spinner{width:28px;height:28px;border:3px solid #30363d;border-top-color:#58a6ff;border-radius:50%;animation:spin .8s linear infinite}
.lo-label{font-size:13px;color:#8b949e}
@keyframes spin{to{transform:rotate(360deg)}}
/* ... your page styles ... */
</style>
</head>
<body>

<!-- Loading overlay (shown while sub-viz is generating) -->
<div class="loading-overlay" id="lo">
  <div class="lo-spinner"></div>
  <div class="lo-label" id="lo-label">Generating sub-visualization&hellip;</div>
</div>

<!-- Status banner -->
<div style="background:#1f3a5f;border-bottom:1px solid #388bfd;padding:10px 24px;display:flex;align-items:center;gap:10px;font-size:13px;color:#79c0ff">
  <span id="sdot" style="width:9px;height:9px;border-radius:50%;background:#484f58;flex-shrink:0;transition:background .4s"></span>
  <span id="stxt">Connecting to viz channel&hellip;</span>
  <span id="back-btn" onclick="popContent()" style="display:none;margin-left:auto;cursor:pointer;color:#58a6ff;font-size:13px;padding:2px 10px;border:1px solid #388bfd;border-radius:6px">&#8592; Back</span>
</div>

<!-- Toast -->
<div id="toast" style="position:fixed;bottom:32px;left:50%;transform:translateX(-50%) translateY(80px);background:#1a3a22;border:1px solid #3fb950;color:#56d364;padding:12px 24px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999;transition:transform .25s,opacity .25s;opacity:0;pointer-events:none"></div>

<!-- Main content area (root content inline; drill-downs injected here) -->
<div id="content">
  <!-- ROOT PAGE CONTENT HERE: cards, graphs, tables, etc. -->
  <!-- Each clickable item needs data-claude and data-name attributes -->
</div>

<script>
// ── Navigation stack + result cache ──────────────────────────────────────────
const _stack = [];           // previous innerHTML snapshots (for Back)
const _cache = new Map();    // name → html fragment (avoids re-requesting Claude)

function pushContent(html) {
  _stack.push(document.getElementById('content').innerHTML);
  document.getElementById('content').innerHTML = html;
  document.getElementById('back-btn').style.display = _stack.length > 0 ? '' : 'none';
  window.scrollTo(0, 0);
}

function popContent() {
  if (_stack.length === 0) return;
  document.getElementById('content').innerHTML = _stack.pop();
  document.getElementById('back-btn').style.display = _stack.length > 0 ? '' : 'none';
  window.scrollTo(0, 0);
}

// ── Utilities ─────────────────────────────────────────────────────────────────
let _tt;
function toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.style.transform='translateX(-50%) translateY(0)';t.style.opacity='1';clearTimeout(_tt);_tt=setTimeout(()=>{t.style.transform='translateX(-50%) translateY(80px)';t.style.opacity='0';},2800);}

function showLoading(name){
  document.getElementById('lo-label').textContent='Generating sub-visualization for "'+name+'"…';
  document.getElementById('lo').classList.add('active');
}
function hideLoading(){ document.getElementById('lo').classList.remove('active'); }

// ── SSE helper ────────────────────────────────────────────────────────────────
function attachSSE(replyId, name, doneCb) {
  let retries = 0;
  const es = new EventSource('http://localhost:3747/api/stream/' + replyId);

  function handleContent(content, name) {
    try {
      const parsed = JSON.parse(content);
      if (parsed.html) {
        if (name) _cache.set(name, parsed.html);
        pushContent(parsed.html);
        doneCb();
        return;
      }
    } catch (_) {}
    doneCb();
  }

  es.onmessage = e => {
    const d = JSON.parse(e.data);
    if (d.done) { es.close(); return; }
    if (d.content) { es.close(); handleContent(d.content, name); }
  };
  es.onerror = () => {
    retries++;
    if (retries > 3) {
      es.close();
      const poll = setInterval(async () => {
        try {
          const r = await fetch('http://localhost:3747/api/result/' + replyId, { signal: AbortSignal.timeout(2000) });
          if (r.ok) {
            const d = await r.json();
            if (d.content) { clearInterval(poll); handleContent(d.content, name); }
          }
        } catch (_) {}
      }, 2000);
      setTimeout(() => { clearInterval(poll); doneCb(); }, 120000);
    }
  };
  return es;
}

// ── Click handler ─────────────────────────────────────────────────────────────
async function onSelect(el) {
  const name = el.dataset.name || 'item';

  // Cache hit: show immediately, no Claude round-trip
  if (_cache.has(name)) {
    pushContent(_cache.get(name));
    return;
  }

  // Re-click while in-flight: reuse existing stream
  if (el.dataset.loading) {
    showLoading(name);
    attachSSE(el.dataset.replyId, name, () => { hideLoading(); delete el.dataset.loading; });
    return;
  }

  el.dataset.loading = '1';
  const replyId = Math.random().toString(36).slice(2) + Date.now().toString(36);
  el.dataset.replyId = replyId;

  showLoading(name);

  const done = () => { hideLoading(); delete el.dataset.loading; };
  attachSSE(replyId, name, done);

  try {
    const r = await fetch('http://localhost:3747/api/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        path:    el.dataset.path    || '',
        prompt:  el.dataset.claude  || '',
        context: el.dataset.context || '',
        reply_id: replyId,
        drill_down: true,
      }),
      signal: AbortSignal.timeout(3000),
    });
    if (r.ok) { toast('Generating "' + name + '" sub-viz…'); return; }
  } catch (_) {}

  // Fallback: copy prompt to clipboard
  done();
  try { await navigator.clipboard.writeText(el.dataset.claude || ''); } catch (_) {
    const ta = Object.assign(document.createElement('textarea'), { value: el.dataset.claude || '', style: 'position:fixed;opacity:0' });
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
  }
  toast('Channel offline — prompt copied');
}

document.addEventListener('click', e => { const el = e.target.closest('[data-claude]'); if (el) onSelect(el); });

// ── Status banner ─────────────────────────────────────────────────────────────
async function checkSrv() {
  const dot = document.getElementById('sdot'), txt = document.getElementById('stxt');
  try {
    await fetch('http://localhost:3747/api/cache-status', { signal: AbortSignal.timeout(1200) });
    dot.style.background = '#3fb950';
    txt.innerHTML = 'Channel active — click any item to drill down';
  } catch (_) {
    dot.style.background = '#484f58';
    txt.innerHTML = 'Channel offline — restart Claude Code with <code>--dangerously-load-development-channels server:viz</code>';
  }
}
checkSrv(); setInterval(checkSrv, 5000);
</script>

</body>
</html>
```

**Clickable items**: every card/node needs `data-claude="<self-contained prompt>"` and `data-name="<label>"`. Optional `data-path="<source path>"` and `data-context="<1–2 sentence summary>"` give sub-vizzes richer context.

Keep HTML self-contained (no CDN). Dark theme: `#0d1117` background, GitHub-style colors.

---

### Mode 2 — React to a viz click (drill-down, generate sub-viz fragment)

When a `<channel source="viz">` event arrives, the body is JSON:
- `name` — display label of clicked item
- `path` — source path hint
- `prompt` — self-contained analysis request
- `reply_id` — ID to pass to `send_analysis`
- `drill_down` — always `true`
- `context` — optional extra context about the parent component

**Generate a focused inner HTML fragment — no `<html>/<head>/<body>` tags, no file writes, no `open` command.**

The fragment will be injected into `#content` of the parent page in-place. Keep it self-contained CSS-wise (inline `<style>` is fine). Include clickable items with `data-claude`/`data-name`/`data-context` so further drill-downs work.

Fragment structure example:
```html
<style>/* fragment-specific styles */</style>
<div style="padding:24px">
  <h2 style="color:#e6edf3;margin:0 0 16px">COMPONENT_NAME</h2>
  <!-- cards, lists, diagrams for this component -->
  <div data-claude="Analyze X in detail..." data-name="X" data-context="X handles ...">...</div>
</div>
```

Once ready, call:
```
send_analysis(reply_id, JSON.stringify({ html: "<the fragment HTML string>" }))
```

The parent page receives this, calls `pushContent(fragment)`, and renders it in-place. The Back button appears automatically. The fragment itself can contain `data-claude` items that trigger further drill-downs.

**Do not** use the Write tool, `set_viz_page`, or the Bash `open` command for drill-down responses.

---

## Tips

- Keep each viz to ~1 screen — focused, not encyclopedic.
- Sub-viz fragments go one level deeper (e.g. parent = modules, child = files/functions in one module).
- Always add `data-context` with a 1–2 sentence summary on each card so the next drill-down has good context.
- The viz MCP server is registered globally: `claude mcp add --scope user viz -- node ~/.claude/skills/viz/server.mjs`
- Requires Claude Code started with `--dangerously-load-development-channels server:viz`.
- Navigation stack depth is unlimited — each drill-down pushes, Back pops.
