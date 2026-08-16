const { exec, spawn } = require('child_process');
const http = require('http');
const path = require('path');
const config = require('./watch-ast-config');

const { GUMTREE_CMD } = config;
// Fall back to sane defaults if these aren't in your config file yet —
// add them there if you want to override.
const WEBDIFF_PUBLIC_PORT   = config.WEBDIFF_PUBLIC_PORT   || 4567;
const WEBDIFF_INTERNAL_PORT = config.WEBDIFF_INTERNAL_PORT || 4567;
const WEBDIFF_REFRESH_MS    = config.WEBDIFF_REFRESH_MS    || 1000;

let gumtreeProcess = null;
let publicServer = null;
let refreshTimer = null;
let isRegenerating = false;

let latestPair = null;   // { oldPath, newPath } - most recent pair from the pipeline
let servedPair = null;   // { oldPath, newPath } - what the internal GumTree server currently shows
let lastUpdated = null;

// Called by gumtreeService.js whenever a new valid diff pair is produced.
// Just records state — the actual (re)launch happens on the interval below,
// decoupled from file-change events, so the page is always <= 1s stale.
function setLatestPair(oldPath, newPath) {
    latestPair = { oldPath, newPath };
}

function killGumTreeProcess(callback) {
    if (gumtreeProcess && gumtreeProcess.pid) {
        const oldPid = gumtreeProcess.pid;
        gumtreeProcess = null;
        exec(`taskkill /PID ${oldPid} /T /F`, { windowsHide: true }, (err) => {
            if (err) {
                console.log('  -> taskkill note (likely already exited):', err.message);
            }
            callback();
        });
    } else {
        callback();
    }
}

function spawnGumTreeWebDiff(oldPath, newPath) {
    const cmdLine = `"${GUMTREE_CMD}" webdiff --port ${WEBDIFF_INTERNAL_PORT} "${oldPath}" "${newPath}"`;

    gumtreeProcess = spawn(
        process.env.ComSpec || 'cmd.exe',
        ['/d', '/s', '/c', cmdLine],
        {
            shell: false,          // we're driving cmd.exe ourselves now
            detached: true,
            stdio: 'ignore',
            windowsHide: true
        }
    );

    gumtreeProcess.on('error', (err) => {
        console.log('  -> gumtree webdiff spawn error:', err.message);
    });

    gumtreeProcess.unref();

    servedPair = { oldPath, newPath };
    lastUpdated = Date.now();
}

// Runs every WEBDIFF_REFRESH_MS, unconditionally regenerating the diff —
// always-fresh over efficiency, per the chosen design.
function regenerate() {
    if (!latestPair || isRegenerating) return;

    const pairChanged = !servedPair ||
        latestPair.oldPath !== servedPair.oldPath ||
        latestPair.newPath !== servedPair.newPath;

    if (!pairChanged) return; // nothing new — leave the browser alone

    isRegenerating = true;
    const { oldPath, newPath } = latestPair;
    killGumTreeProcess(() => {
        spawnGumTreeWebDiff(oldPath, newPath);
        isRegenerating = false;
    });
}

function statusJson() {
    return JSON.stringify({
        ready: !!servedPair,
        oldFile: servedPair ? path.basename(servedPair.oldPath) : null,
        newFile: servedPair ? path.basename(servedPair.newPath) : null,
        lastUpdated,
        internalPort: WEBDIFF_INTERNAL_PORT,
        refreshMs: WEBDIFF_REFRESH_MS
    });
}

const WRAPPER_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>AST Diff Monitor</title>
<style>
  html, body { margin:0; height:100%; font-family: -apple-system, Segoe UI, sans-serif; background:#1e1e1e; }
  #bar { background:#252526; color:#ccc; padding:6px 12px; font-size:12px; display:flex; justify-content:space-between; }
  #frame { width:100%; height:calc(100% - 30px); border:none; background:#fff; }
  #placeholder { color:#888; text-align:center; margin-top:80px; font-size:14px; }
</style>
</head>
<body>
  <div id="bar">
    <span id="pairLabel">Waiting for first change...</span>
    <span id="clock"></span>
  </div>
  <div id="placeholder">Waiting for the first valid snapshot pair from watch-ast.js...</div>
  <iframe id="frame" style="display:none"></iframe>
<script>
  const REFRESH_MS = ${WEBDIFF_REFRESH_MS};
  const INTERNAL_PORT = ${WEBDIFF_INTERNAL_PORT};
  const frame = document.getElementById('frame');
  const placeholder = document.getElementById('placeholder');
  const pairLabel = document.getElementById('pairLabel');
  const clock = document.getElementById('clock');

 let lastSeenUpdate = null;

    async function tick() {
        try {
            const res = await fetch('/status', { cache: 'no-store' });
            const status = await res.json();
            clock.textContent = new Date().toLocaleTimeString();

            if (!status.ready) {
                placeholder.style.display = 'block';
                frame.style.display = 'none';
                pairLabel.textContent = 'Waiting for first change...';
                return;
            }

            placeholder.style.display = 'none';
            frame.style.display = 'block';
            pairLabel.textContent = status.oldFile + ' -> ' + status.newFile +
                ' (updated ' + new Date(status.lastUpdated).toLocaleTimeString() + ')';

            if (status.lastUpdated !== lastSeenUpdate) {
                lastSeenUpdate = status.lastUpdated;
                frame.src = 'http://127.0.0.1:' + INTERNAL_PORT + '/?_=' + Date.now();
            }
        } catch (e) {
            pairLabel.textContent = 'Regenerating diff...';
        }
    }

  tick();
  setInterval(tick, REFRESH_MS);
</script>
</body>
</html>`;

function startWebDiffServer() {
    if (publicServer) return; // already running

    publicServer = http.createServer((req, res) => {
        if (req.url === '/status') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(statusJson());
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

    refreshTimer = setInterval(regenerate, WEBDIFF_REFRESH_MS);
}

function stopWebDiffServer() {
    if (refreshTimer) clearInterval(refreshTimer);
    if (publicServer) publicServer.close();
    killGumTreeProcess(() => {});
}

module.exports = {
    startWebDiffServer,
    stopWebDiffServer,
    setLatestPair
};