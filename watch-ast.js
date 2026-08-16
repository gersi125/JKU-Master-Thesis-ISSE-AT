process.on('uncaughtException', (err) => {
    console.log('  -> Uncaught error (process kept alive):', err.message);
});

const fs = require("fs");
const { TARGET_FILE } = require('./watch-ast-config');
const { initParser, parse, hashContent, normalizeForHash } = require('./watch-ast-parserService');
const { ensureSnapshotDir, saveSnapshot } = require('./watch-ast-snapshotService');
const { runGumTreeDiff } = require('./watch-ast-gumtreeService');

let lastGoodSnapshotPath = null;
let lastGoodHash = null;

async function init() {
    await initParser();
    ensureSnapshotDir();

    fs.watch(TARGET_FILE, { persistent: true }, debounce(onFileChanged, 150));
    console.log(`Watching ${TARGET_FILE}...`);
}

function debounce(fn, ms) {
    let timer = null;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

function onFileChanged(eventType) {
    let content;
    try {
        content = fs.readFileSync(TARGET_FILE, 'utf8');
    } catch (err) {
        return;
    }

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
        // e.g. broke syntax then reverted, or only changed blank-line spacing.
        return;
    }

    const newSnapshotPath = saveSnapshot(content);

    if (lastGoodSnapshotPath) {
        runGumTreeDiff(lastGoodSnapshotPath, newSnapshotPath);
    }

    lastGoodSnapshotPath = newSnapshotPath;
    lastGoodHash = newHash;
}

init().catch(err => {
    console.error('Failed to initialize:', err);
    process.exit(1);
});

const { startWebDiffServer, stopWebDiffServer } = require('./watch-ast-webdiffService');

async function init() {
    await initParser();
    ensureSnapshotDir();
    startWebDiffServer();   // <-- live on :4567 the instant the script starts

    fs.watch(TARGET_FILE, { persistent: true }, debounce(onFileChanged, 150));
    console.log(`Watching ${TARGET_FILE}...`);
}

process.on('SIGINT', () => {
    stopWebDiffServer();
    process.exit(0);
});