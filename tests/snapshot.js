const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');

const DIR = path.join(__dirname, 'snapshots');

function fileFor(name) {
  return path.join(DIR, name.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '.txt');
}

function matchSnapshot(name, actual) {
  const file = fileFor(name);
  const text = actual.replace(/\r\n/g, '\n').trimEnd() + '\n';

  if (process.env.UPDATE_SNAPSHOTS === '1') {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(file, text, 'utf8');
    return;
  }
  assert.ok(fs.existsSync(file), `No snapshot for "${name}". Run: npm run test:update, then review it.`);
  assert.equal(text, fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
}

module.exports = { matchSnapshot };