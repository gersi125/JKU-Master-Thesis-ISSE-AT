const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { init } = require('./adapter');
const { diff } = require('./harness');
const { matchSnapshot } = require('./snapshot');

const dir = path.join(__dirname, 'cases');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.cases.js'));

before(async () => { await init(); });

for (const f of files) {
  const group = f.replace('.cases.js', '');
  describe(group, () => {
    for (const c of require(path.join(dir, f))) {
      it(c.name, async () => {
        const r = await diff(c.before, c.after);

        if (c.silent) {
          assert.equal(r.meaningfulCount, 0, `expected no entries, got:\n${r.text}`);
          return;
        }

        // Invariant 1: a real change is never swallowed
        assert.ok(r.meaningfulCount > 0 && r.lines.length > 0,
          `change was swallowed (actions: ${r.actions.length})`);

        // Layer 1: semantic assertions
        for (const re of c.expect || []) {
          assert.match(r.text, re, `log did not match ${re}\n--- log ---\n${r.text}`);
        }

        // Layer 2: full-text snapshot, reviewed in git
        matchSnapshot(`${group} ${c.name}`, r.text);
      });
    }
  });
}