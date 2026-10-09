const { analyze } = require('./adapter');

// Wraps a class-body snippet into a valid compilation unit so Tree-sitter parses it cleanly.
function inClass(body) {
  return `using System;\nusing System.Collections.Generic;\nusing System.Linq;\n\nnamespace T\n{\n    public class C\n    {\n${indent(body, 8)}\n    }\n}\n`;
}

// Wraps a statement snippet into a method body.
function inMethod(body) {
  return inClass(`public void M()\n{\n${indent(body, 4)}\n}`);
}

function indent(text, n) {
  const pad = ' '.repeat(n);
  return text.split('\n').map(l => (l.length ? pad + l : l)).join('\n');
}

const norm = s => s.replace(/\r\n/g, '\n');

async function diff(oldSrc, newSrc) {
  const r = await analyze(norm(oldSrc), norm(newSrc));
  return { ...r, text: r.lines.join('\n') };
}

module.exports = { inClass, inMethod, diff };