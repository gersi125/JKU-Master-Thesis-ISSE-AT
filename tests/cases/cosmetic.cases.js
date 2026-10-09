const { inClass } = require('../harness');

module.exports = [
  { name: 'whitespace only',     before: inClass('void F(){int x=1;}'), after: inClass('void F()\n{\n    int x = 1;\n}'), silent: true },
  { name: 'trailing newlines',   before: inClass('void F() { }'), after: inClass('void F() { }') + '\n\n\n', silent: true },
  { name: 'indent change',       before: inClass('int x;'), after: '\n' + inClass('int x;').replace(/\n/g, '\n  '), silent: true },
];