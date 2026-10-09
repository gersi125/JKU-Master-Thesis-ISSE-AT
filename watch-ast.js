process.on('uncaughtException', (err) => {
    console.log('  -> Uncaught error (process kept alive):', err.message);
});

const fs = require("fs");
const { TARGET_FILE } = require('./watch-ast-config');
const { initParser, parse, hashContent, normalizeForHash } = require('./watch-ast-parserService');
const { startWebDiffServer, stopWebDiffServer, setSource } = require('./watch-ast-webdiffService');
const { ensureSnapshotDir, saveSnapshot } = require('./watch-ast-snapshotService');
const { runGumTreeDiff } = require('./watch-ast-gumtreeService');

const POLL_INTERVAL_MS = 500;

let lastGoodSnapshotPath = null;
let lastGoodHash = null;
let lastSeenRawHash = null; // tracks raw content between ticks, independent of parse validity
let pollTimer = null;

async function init() {
    await initParser();
    ensureSnapshotDir();
    startWebDiffServer();

    // Seed the editor immediately with what's currently on disk, so the
    // left pane isn't empty until the first edit happens.
    try {
        const initialContent = fs.readFileSync(TARGET_FILE, 'utf8');
        setSource(initialContent);
        lastSeenRawHash = hashContent(initialContent);
    } catch (err) {
        console.log('  -> could not read initial file for editor seed:', err.message);
    }

    pollTimer = setInterval(pollFile, POLL_INTERVAL_MS);
    console.log(`Watching ${TARGET_FILE} (polling every ${POLL_INTERVAL_MS}ms)...`);
}

function pollFile() {
    let content;
    try {
        content = fs.readFileSync(TARGET_FILE, 'utf8');
    } catch (err) {
        // file locked mid-write, temporarily missing, etc. — just skip this tick
        return;
    }

    const rawHash = hashContent(content);
    if (rawHash === lastSeenRawHash) {
        // nothing changed since the last tick — skip re-parsing entirely
        return;
    }
    lastSeenRawHash = rawHash;

    onFileChanged(content);
}

function onFileChanged(content) {
    const tree = parse(content);
    const hasError = tree.rootNode.hasError;

    const newHash = hashContent(normalizeForHash(content));

    console.log('DEBUG: hasError=', hasError, 'newHash=', newHash.slice(0, 8), 'lastGoodHash=', lastGoodHash?.slice(0, 8));

    if (hasError) {
        // grammar issue — already fully excluded, nothing logged
        return;
    }

    if (newHash === lastGoodHash) {
        // content identical (ignoring whitespace/blank lines) to last valid snapshot
        return;
    }

    const newSnapshotPath = saveSnapshot(content);
    setSource(content); // push every valid version, even the very first one

    if (lastGoodSnapshotPath) {
        runGumTreeDiff(lastGoodSnapshotPath, newSnapshotPath);
    }

    lastGoodSnapshotPath = newSnapshotPath;
    lastGoodHash = newHash;
}

process.on('SIGINT', () => {
    if (pollTimer) clearInterval(pollTimer);
    stopWebDiffServer();
    process.exit(0);
});

init().catch(err => {
    console.error('Failed to initialize:', err);
    process.exit(1);
});