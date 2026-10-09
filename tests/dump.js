const fs = require('fs');
const path = require('path');
const { init } = require('./adapter');
const { diff } = require('./harness');

(async () => {
  await init();
  const dir = path.join(__dirname, 'cases');
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.cases.js'))) {
    for (const c of require(path.join(dir, f))) {
      const r = await diff(c.before, c.after);
      console.log(`\n=== ${f} :: ${c.name}  (meaningful=${r.meaningfulCount}) ===`);
      console.log(r.text || '(no output)');
    }
  }
})();