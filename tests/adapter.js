const parserSvc = require('../watch-ast-parserService')
const gumtreeSvc = require('../watch-ast-gumtreeService')

let ready = false;
async function init() {
  if (ready) return;
  await parserSvc.initParser();   // same call watch-ast.js makes at startup
  ready = true;
}

async function analyze(oldSrc, newSrc) {
  return gumtreeSvc.analyzeChange(oldSrc, newSrc);
}

module.exports = { init, analyze };