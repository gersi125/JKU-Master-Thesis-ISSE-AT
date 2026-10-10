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
    const seen = new Set();
    for (const c of require(path.join(dir, f))) {
      if (seen.has(c.name)) throw new Error(`Duplicate case name in ${f}: "${c.name}"`);
      seen.add(c.name);

      const opts = c.known ? { todo: c.known } : {};



      it(c.name, opts, async () => {
        const r = await diff(c.before, c.after);

        if (c.silent) {
          assert.equal(r.meaningfulCount, 0, `expected no entries, got:\n${r.semantic}`);
          return;
        }

        // Invariant: a real change is never swallowed, and always yields a semantic line
        assert.ok(r.meaningfulCount > 0, `change was swallowed (actions: ${r.actions.length})`);
        assert.ok(r.semantic.length > 0, `actions exist but no semantic "Line" entry was produced`);

        for (const re of c.expect || []) {
          assert.match(r.semantic, re, `did not match ${re}\n--- log ---\n${r.semantic}`);
        }

        for (const re of c.forbid || []) {
          assert.doesNotMatch(r.semantic, re, `unexpected line ${re}\n--- log ---\n${r.semantic}`);
        }

        if (!c.known) matchSnapshot(`${group} ${c.name}`, r.semantic);
      });
    }
  });
}