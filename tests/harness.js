const { analyze } = require('./adapter');

function inClass(body) {
  return `using System;\nusing System.Collections.Generic;\nusing System.Linq;\n\nnamespace T\n{\n    public class C\n    {\n${indent(body, 8)}\n    }\n}\n`;
}

function inMethod(body) {
  return inClass(`public void M()\n{\n${indent(body, 4)}\n}`);
}

function indent(text, n) {
  const pad = ' '.repeat(n);
  return text.split('\n').map(l => (l.length ? pad + l : l)).join('\n');
}

const norm = s => s.replace(/\r\n/g, '\n');
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// L('+ method C.Foo()')              → matches "Line 9 + method C.Foo() : ..." at any line number
// L('~ var C.M()', 'number 1 -> 2')  → same prefix, and the tail text somewhere after it
const L = (prefix, tail = '') =>
  new RegExp('^Line \\S+ ' + esc(prefix) + (tail ? '.*' + esc(tail) : ''), 'm');

async function diff(oldSrc, newSrc) {
  const r = await analyze(norm(oldSrc), norm(newSrc));
  const semantic = r.lines.filter(l => l.startsWith('Line ')).join('\n');
  return { ...r, text: r.lines.join('\n'), semantic };
}

module.exports = { inClass, inMethod, diff, L };