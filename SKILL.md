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

#### Writing style — non-technical first

Visualizations are read by everyone, not just engineers. Apply these rules to all generated content:

- **Plain labels**: write what something *does*, not what it *is* technically. Use "Handles login and signup" not "AuthService". Use "Stores user data" not "UserRepository".
- **No jargon in cards**: avoid words like "singleton", "middleware", "handler", "controller", "interface", "abstract", "instantiate". If a technical term is unavoidable, add a plain-English parenthetical.
- **Active descriptions**: use short action phrases — "Checks if the user is logged in", "Sends email notifications", "Saves files to disk".
- **Emoji anchors**: add a single emoji to each card title to give it a visual identity (e.g. "Login & Signup", "Email Sender", "File Storage"). Use intuitive, universal emojis.
- **Humanize groupings**: group things by *what users experience*, not by internal technical layers. "What happens when you log in" is better than "Auth pipeline".
- **Sub-viz fragments**: when drilling down, open with one sentence in plain English about what this component does for the user before any technical detail.

#### Pick the right structure

- **Architecture / system**: layered boxes with arrows showing data flow — label arrows with plain verbs ("sends", "stores", "reads")
- **Module / file**: card grid grouped by user-facing purpose, not file structure
- **Concept / explanation**: card grid or mind map with relatable analogies
- **Comparison**: side-by-side table with plain-English row labels
- **Sequence / flow**: numbered step timeline written as user actions ("User clicks Login", "System checks password")

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
/* Drill-down indicators — applied automatically to any [data-claude] element */
[data-claude]{cursor:pointer;position:relative;transition:box-shadow .18s,border-color .18s}
[data-claude]:hover{box-shadow:0 0 0 2px #388bfd!important;border-color:#388bfd!important}
[data-claude]::after{content:'⤵';position:absolute;top:6px;right:8px;font-size:11px;color:#58a6ff;opacity:.5;pointer-events:none;line-height:1}
[data-claude]:hover::after{opacity:1}

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

<!-- Q&A panel (completely independent of #content and navigation stack) -->
<div id="qa-panel" style="display:none;position:fixed;bottom:0;right:0;width:380px;max-height:60vh;background:#161b22;border:1px solid #30363d;border-radius:10px 10px 0 0;z-index:300;flex-direction:column;box-shadow:0 -4px 24px rgba(0,0,0,.5)">
  <div style="padding:10px 16px;background:#1f2937;border-bottom:1px solid #30363d;border-radius:10px 10px 0 0;display:flex;align-items:center;justify-content:space-between">
    <span style="font-size:13px;font-weight:600;color:#e6edf3">Ask about this visualization</span>
    <button onclick="toggleQA()" style="background:none;border:none;color:#8b949e;cursor:pointer;font-size:16px;padding:0 4px;line-height:1">&times;</button>
  </div>
  <div id="qa-history" style="flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:12px;min-height:60px"></div>
  <div style="padding:10px 12px;border-top:1px solid #30363d;display:flex;gap:8px">
    <input id="qa-input" type="text" placeholder="Ask a question…" onkeydown="if(event.key==='Enter')sendQuestion()" style="flex:1;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#c9d1d9;padding:6px 10px;font-size:13px;outline:none">
    <button onclick="sendQuestion()" style="background:#238636;border:none;border-radius:6px;color:#fff;padding:6px 14px;font-size:13px;cursor:pointer;white-space:nowrap">Ask</button>
  </div>
</div>

<!-- Q&A toggle button (fixed bottom-right) -->
<button id="qa-toggle-btn" onclick="toggleQA()" style="position:fixed;bottom:24px;right:24px;z-index:299;background:#238636;border:none;border-radius:20px;color:#fff;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 2px 12px rgba(0,0,0,.4)">? Ask</button>

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
    let html = null, answer = null;
    try {
      const parsed = JSON.parse(content);
      html   = parsed.html   || null;
      answer = parsed.answer || null;
    } catch (_) {
      // Not valid JSON — treat as raw HTML (Claude skipped JSON.stringify)
      html = content;
    }
    if (html) {
      if (name) _cache.set(name, html);
      pushContent(html);
      doneCb();
      return;
    }
    if (answer) {
      pushContent(`<div style="padding:24px;color:#c9d1d9;font-size:14px;white-space:pre-wrap">${answer}</div>`);
      doneCb();
      return;
    }
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

// ── Q&A panel (independent of drill-down flow) ────────────────────────────────
let _qaOpen = false;

function toggleQA() {
  _qaOpen = !_qaOpen;
  const panel = document.getElementById('qa-panel');
  const btn   = document.getElementById('qa-toggle-btn');
  panel.style.display = _qaOpen ? 'flex' : 'none';
  btn.style.display   = _qaOpen ? 'none' : 'block';
  if (_qaOpen) document.getElementById('qa-input').focus();
}

function _qaAppend(role, text, pending) {
  const history = document.getElementById('qa-history');
  const el = document.createElement('div');
  el.style.cssText = role === 'user'
    ? 'font-size:13px;color:#79c0ff;padding:6px 10px;background:#1f3a5f;border-radius:8px;align-self:flex-end;max-width:90%;word-break:break-word'
    : 'font-size:13px;color:#c9d1d9;padding:6px 10px;background:#21262d;border-radius:8px;align-self:flex-start;max-width:90%;word-break:break-word;white-space:pre-wrap';
  el.textContent = text;
  if (pending) el.id = 'qa-pending';
  history.appendChild(el);
  history.scrollTop = history.scrollHeight;
  return el;
}

async function sendQuestion() {
  const input = document.getElementById('qa-input');
  const q = input.value.trim();
  if (!q) return;
  input.value = '';
  input.disabled = true;

  _qaAppend('user', q);
  const pending = _qaAppend('assistant', '…', true);

  // Context = page title + current content heading (best-effort)
  const pageTitle = document.title || 'this visualization';
  const h2 = document.querySelector('#content h2,#content h3');
  const scope = h2 ? `${pageTitle} > ${h2.textContent.trim()}` : pageTitle;

  const replyId = 'qa-' + Math.random().toString(36).slice(2) + Date.now().toString(36);

  // SSE for the answer — handled separately, never touches #content or _stack
  const es = new EventSource('http://localhost:3747/api/stream/' + replyId);
  let retries = 0;

  function handleAnswer(content) {
    try {
      const parsed = JSON.parse(content);
      if (parsed.answer) { pending.textContent = parsed.answer; return; }
      if (parsed.html)   { pending.textContent = parsed.html.replace(/<[^>]+>/g, ''); return; }
    } catch (_) {}
    pending.textContent = content;
  }

  es.onmessage = e => {
    const d = JSON.parse(e.data);
    if (d.done) { es.close(); input.disabled = false; input.focus(); return; }
    if (d.content) { es.close(); handleAnswer(d.content); input.disabled = false; input.focus(); }
  };
  es.onerror = () => {
    retries++;
    if (retries > 3) {
      es.close();
      const poll = setInterval(async () => {
        try {
          const r = await fetch('http://localhost:3747/api/result/' + replyId, { signal: AbortSignal.timeout(2000) });
          if (r.ok) { const d = await r.json(); if (d.content) { clearInterval(poll); handleAnswer(d.content); input.disabled = false; input.focus(); } }
        } catch (_) {}
      }, 2000);
      setTimeout(() => { clearInterval(poll); pending.textContent = '(timed out)'; input.disabled = false; }, 120000);
    }
  };

  try {
    await fetch('http://localhost:3747/api/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'question', prompt: q, context: scope, reply_id: replyId, drill_down: false, qa: true }),
      signal: AbortSignal.timeout(3000),
    });
  } catch (_) {
    pending.textContent = '(channel offline — is Claude Code running with server:viz?)';
    input.disabled = false;
    es.close();
  }
}
</script>

</body>
</html>
```

**Clickable items**: every card/node needs `data-claude="<self-contained prompt>"` and `data-name="<label>"`. Optional `data-path="<source path>"` and `data-context="<1–2 sentence summary>"` give sub-vizzes richer context.

Keep HTML self-contained (no CDN). Dark theme: `#0d1117` background, GitHub-style colors.

---

### Mode 2 — React to a viz channel event

When a `<channel source="viz">` event arrives, the body is JSON:
- `name` — label of the clicked item or `"question"` for Q&A
- `path` — source path hint
- `prompt` — the question text or drill-down request
- `reply_id` — ID to pass to `send_analysis`
- `drill_down` — `true` for drill-down, `false` for Q&A
- `qa` — `true` when this is a Q&A question (not a drill-down)
- `context` — current page scope (page title + active heading) for Q&A, or component summary for drill-downs

#### If `qa: true` — answer the question

Read source files if helpful. Write a concise, direct answer (plain text, a few sentences to a paragraph).

Call:
```
send_analysis(reply_id, JSON.stringify({ answer: "<plain text answer>" }))
```

The answer appears in the Q&A panel only — **never** in `#content`, never affects navigation. Do not generate HTML.

#### If `drill_down: true` — generate a sub-viz fragment

**Generate a focused inner HTML fragment — no `<html>/<head>/<body>` tags, no file writes, no `open` command.**

The fragment is injected into `#content` in-place. Keep it self-contained CSS-wise (inline `<style>` is fine). Include `data-claude`/`data-name`/`data-context` on clickable items so further drill-downs work.

Apply the same plain-language rules as Mode 1: emoji titles, action-phrase descriptions, no jargon. Open each fragment with a one-sentence plain-English summary of what this piece does before any detail cards.

Fragment structure example:
```html
<style>/* fragment-specific styles */</style>
<div style="padding:24px">
  <p style="color:#8b949e;font-size:14px;margin:0 0 20px">This is where users log in, reset passwords, and manage their account security.</p>
  <h2 style="color:#e6edf3;margin:0 0 16px"> Login & Signup</h2>
  <!-- cards with plain-English labels -->
  <div data-claude="Explain how password reset works in plain English..." data-name="Password Reset" data-context="Sends a reset link by email">...</div>
</div>
```

Call:
```
send_analysis(reply_id, JSON.stringify({ html: "<the fragment HTML string>" }))
```

The parent page calls `pushContent(fragment)` and renders it in-place. The Back button appears automatically.

**Do not** use the Write tool, `set_viz_page`, or the Bash `open` command for either response type.

---

## Tips

- Keep each viz to ~1 screen — focused, not encyclopedic.
- Sub-viz fragments go one level deeper (e.g. parent = modules, child = files/functions in one module).
- Always add `data-context` with a 1–2 sentence summary on each card so the next drill-down has good context.
- The viz MCP server is registered globally: `claude mcp add --scope user viz -- node ~/.claude/skills/viz/server.mjs`
- Requires Claude Code started with `--dangerously-load-development-channels server:viz`.
- Navigation stack depth is unlimited — each drill-down pushes, Back pops.
