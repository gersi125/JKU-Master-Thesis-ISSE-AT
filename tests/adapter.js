const svc = require('../watch-ast-gumtreeService');

async function init() {
  // If your parser needs async init (web-tree-sitter Parser.init + Language.load), call it here.
  if (typeof svc.init === 'function') await svc.init();
}

async function analyze(oldSrc, newSrc) {
  return svc.analyzeChange(oldSrc, newSrc);
}

module.exports = { init, analyze };