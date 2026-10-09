const http = require('http');
const fs = require('fs');
const config = require('./watch-ast-config');

const { TARGET_FILE, DIFF_LOG } = config;
const WEBDIFF_PUBLIC_PORT = config.WEBDIFF_PUBLIC_PORT || 4567;
const WEBDIFF_REFRESH_MS  = config.WEBDIFF_REFRESH_MS  || 1000;


let publicServer = null;

// Editable-source state, pushed by watch-ast.js (content) and
// gumtreeService.js (highlights) whenever the watcher validates something.
let editorState = { content: '', highlights: [], updatedAt: null };

function setSource(content) {
    editorState = { content, highlights: [], updatedAt: Date.now() };
}

function setHighlights(highlights) {
    editorState = { ...editorState, highlights, updatedAt: Date.now() };
}

const LOG_TAIL_CHARS = 20000; // avoid shipping a huge file to the browser every tick

function readLogTail() {
    try {
        const content = fs.readFileSync(DIFF_LOG, 'utf8');
        if (content.length <= LOG_TAIL_CHARS) return content;
        return '...(truncated)...\n' + content.slice(-LOG_TAIL_CHARS);
    } catch (e) {
        return ''; // log file doesn't exist yet — nothing logged so far
    }
}

const WRAPPER_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>AST Diff Monitor</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/clike/clike.min.js"></script>
<style>
  html, body { margin:0; height:100%; font-family: -apple-system, Segoe UI, sans-serif; background:#1e1e1e; }
  #layout { display:flex; height:100%; }
  .col { flex:1 1 50%; display:flex; flex-direction:column; min-width:0; border-right:1px solid #333; }
  .col:last-child { border-right:none; }
  .bar { background:#252526; color:#ccc; padding:6px 12px; font-size:12px; display:flex; justify-content:space-between; flex:0 0 auto; }
  .body { flex:1 1 auto; position:relative; min-height:0; }
  #editorHost { position:absolute; inset:0; }
  .CodeMirror { height:100%; font-size:13px; }
  .gt-insert { background: rgba(46,160,67,0.35); }
  .gt-update { background: rgba(210,153,34,0.35); }
  .gt-delete-widget {
    background: rgba(248,81,73,0.15);
    border-left: 3px solid #f85149;
    color: #f85149;
    text-decoration: line-through;
    font-family: monospace;
    font-size: 12px;
    padding: 2px 8px;
    white-space: pre;
  }
  .gt-delete-tag { text-decoration: none; color: #888; margin-left: 8px; font-size: 11px; }
  .status-editing { color:#e2c08d; }
  .status-synced { color:#89d185; }
  .status-waiting { color:#888; }
  #logPane {
    position:absolute; inset:0; margin:0; overflow:auto;
    background:#1e1e1e; color:#d4d4d4; font-family: 'Consolas', monospace;
    font-size:12px; padding:10px; white-space:pre-wrap; word-break:break-word;
  }
</style>
</head>
<body>
<div id="layout">
  <div class="col">
    <div class="bar">
      <span id="editorLabel">Live editor — last known-good version</span>
      <span id="editorStatus" class="status-waiting">Loading...</span>
    </div>
    <div class="body"><div id="editorHost"></div></div>
  </div>
  <div class="col">
    <div class="bar">
      <span id="logLabel">diff-log.txt</span>
      <span id="logClock"></span>
    </div>
    <div class="body"><pre id="logPane">Waiting for log entries...</pre></div>
  </div>
</div>
<script>
  const REFRESH_MS = ${WEBDIFF_REFRESH_MS};
  const editorStatus = document.getElementById('editorStatus');

  const cm = CodeMirror(document.getElementById('editorHost'), {
    value: '',
    mode: 'text/x-csharp',
    lineNumbers: true,
    indentUnit: 4
  });

  let dirty = false;
  let saveTimer = null;
  let activeMarks = [];
  let activeWidgets = [];
  let lastAppliedSourceUpdate = null;
  let suppressNextChange = false;

  cm.on('change', () => {
    if (suppressNextChange) { suppressNextChange = false; return; }
    dirty = true;
    editorStatus.textContent = 'Editing (unsaved)...';
    editorStatus.className = 'status-editing';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 500);
  });

  async function saveNow() {
    const content = cm.getValue();
    editorStatus.textContent = 'Saving...';
    try {
      await fetch('/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });
      dirty = false;
      editorStatus.textContent = 'Saved - waiting for validation...';
      editorStatus.className = 'status-waiting';
    } catch (e) {
      editorStatus.textContent = 'Save failed';
    }
  }

  function applyHighlights(highlights) {
    activeMarks.forEach(m => m.clear());
    activeMarks = [];
    activeWidgets.forEach(w => w.clear());
    activeWidgets = [];

    (highlights || []).forEach(h => {
      if (h.type === 'insert' || h.type === 'update') {
        if (h.start == null || h.end == null) return;
        try {
          const from = cm.posFromIndex(h.start);
          const to = cm.posFromIndex(h.end);
          const cls = h.type === 'insert' ? 'gt-insert' : 'gt-update';
          activeMarks.push(cm.markText(from, to, { className: cls }));
        } catch (e) { /* offset out of range - skip this mark */ }
        return;
      }

      if (h.type === 'delete') {
        const lastLine = cm.lastLine();
        const line = Math.max(0, Math.min(h.lineHint == null ? 0 : h.lineHint, lastLine));
        const node = document.createElement('div');
        node.className = 'gt-delete-widget';
        node.textContent = '- ' + (h.label || '(removed)');
        const tag = document.createElement('span');
        tag.className = 'gt-delete-tag';
        tag.textContent = '(' + (h.elementType || 'element') + ' removed)';
        node.appendChild(tag);
        activeWidgets.push(cm.addLineWidget(line, node, { above: true, coverGutter: false }));
      }
    });
  }

  async function pollSource() {
    try {
      const res = await fetch('/source', { cache: 'no-store' });
      const src = await res.json();

      if (!src.updatedAt) {
        if (!dirty) editorStatus.textContent = 'Waiting for first valid snapshot...';
        return;
      }

      if (dirty) return;

      if (src.updatedAt !== lastAppliedSourceUpdate) {
        const cursor = cm.getCursor();
        const scroll = cm.getScrollInfo();
        if (cm.getValue() !== src.content) {
          suppressNextChange = true;
          cm.setValue(src.content);
          cm.setCursor(cursor);
          cm.scrollTo(scroll.left, scroll.top);
        }
        applyHighlights(src.highlights);
        lastAppliedSourceUpdate = src.updatedAt;
        editorStatus.textContent = 'Synced (' + new Date(src.updatedAt).toLocaleTimeString() + ')';
        editorStatus.className = 'status-synced';
      }
    } catch (e) { /* retry next tick */ }
  }

  const logPane = document.getElementById('logPane');
  const logClock = document.getElementById('logClock');
  let lastLogLength = -1;

  async function pollLog() {
    try {
      const res = await fetch('/log', { cache: 'no-store' });
      const data = await res.json();
      logClock.textContent = new Date().toLocaleTimeString();

      if (data.content.length !== lastLogLength) {
        lastLogLength = data.content.length;
        const wasAtBottom = logPane.scrollTop + logPane.clientHeight >= logPane.scrollHeight - 20;
        logPane.textContent = data.content || 'Waiting for log entries...';
        if (wasAtBottom) logPane.scrollTop = logPane.scrollHeight;
      }
    } catch (e) { /* retry next tick */ }
  }

  function tick() { pollSource(); pollLog(); }
  tick();
  setInterval(tick, REFRESH_MS);
</script>
</body>
</html>`;

function startWebDiffServer() {
    if (publicServer) return;

    publicServer = http.createServer((req, res) => {
        if (req.method === 'GET' && req.url === '/source') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(editorState));
            return;
        }
        
        if (req.method === 'GET' && req.url === '/log') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ content: readLogTail() }));
            return;
        }

        if (req.method === 'POST' && req.url === '/save') {
            let body = '';
            req.on('data', (chunk) => {
                body += chunk;
                if (body.length > 5_000_000) req.destroy();
            });
            req.on('end', () => {
                try {
                    const { content } = JSON.parse(body);
                    fs.writeFileSync(TARGET_FILE, content, 'utf8');
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: true }));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: e.message }));
                }
            });
            return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(WRAPPER_HTML);
    });

    publicServer.listen(WEBDIFF_PUBLIC_PORT, '127.0.0.1', () => {
        console.log(`  -> AST diff monitor live at http://127.0.0.1:${WEBDIFF_PUBLIC_PORT} (refresh every ${WEBDIFF_REFRESH_MS}ms)`);
    });

    publicServer.on('error', (err) => {
        console.log('  -> webdiff public server error:', err.message);
    });
}

function stopWebDiffServer() {
    if (publicServer) publicServer.close();
}

module.exports = {
    startWebDiffServer,
    stopWebDiffServer,
    setSource,
    setHighlights
};