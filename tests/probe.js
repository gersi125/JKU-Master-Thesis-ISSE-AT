const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec } = require('child_process');

const GUMTREE_CMD = 'C:\\GumTree\\dist\\build\\distributions\\gumtree-4.0.0-beta8-SNAPSHOT\\bin\\gumtree.bat';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-'));
const a = path.join(dir, 'old.cs');
const b = path.join(dir, 'new.cs');
fs.writeFileSync(a, 'class C { int x = 1; }', 'utf8');
fs.writeFileSync(b, 'class C { int x = 2; }', 'utf8');

exec(`"${GUMTREE_CMD}" textdiff "${a}" "${b}" -f JSON`, { windowsHide: true }, (err, stdout, stderr) => {
  console.log('err   :', err && err.message);
  console.log('stderr:', stderr.slice(0, 300));
  console.log('stdout (first 600 chars):\n', stdout.slice(0, 600));
});