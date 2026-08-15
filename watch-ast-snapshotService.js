const fs = require('fs');
const path = require('path');
const { SNAPSHOT_DIR } = require('./watch-ast-config');

function ensureSnapshotDir() {
    if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
}

function saveSnapshot(content) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `Person_${timestamp}.cs`;
    const snapshotPath = path.join(SNAPSHOT_DIR, filename);
    fs.writeFileSync(snapshotPath, content, 'utf8'); // original content preserved, unnormalized
    console.log('  -> saved snapshot:', filename);
    return snapshotPath;
}

module.exports = {
    ensureSnapshotDir,
    saveSnapshot
};