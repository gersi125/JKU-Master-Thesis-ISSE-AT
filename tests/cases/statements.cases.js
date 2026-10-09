const { inMethod } = require('../harness');

module.exports = [
  { name: 'insert local variable',      before: inMethod(''), after: inMethod('int x = 1;'), expect: [/x/] },
  { name: 'multi-declarator split',     before: inMethod(''), after: inMethod('int a = 1, b = 2;'), expect: [/a/, /b/] },
  { name: 'insert if',                  before: inMethod(''), after: inMethod('if (true) { }'), expect: [/if/i] },
  { name: 'add else branch',            before: inMethod('if (true) { }'), after: inMethod('if (true) { } else { }'), expect: [/else/i] },
  { name: 'change condition',           before: inMethod('if (a > 1) { }'), after: inMethod('if (a >= 1) { }'), expect: [/a/] },
  { name: 'for → foreach',              before: inMethod('for (int i = 0; i < 3; i++) { }'), after: inMethod('foreach (var i in xs) { }'), expect: [/for/i] },
  { name: 'insert try/catch',           before: inMethod(''), after: inMethod('try { } catch (Exception e) { }'), expect: [/try/i, /catch/i] },
  { name: 'wrap statement in if',       before: inMethod('Foo();'), after: inMethod('if (ok) { Foo(); }'), expect: [/if/i] },
  { name: 'unwrap statement from if',   before: inMethod('if (ok) { Foo(); }'), after: inMethod('Foo();'), expect: [/if/i] },
  { name: 'wrap in using',              before: inMethod('Foo();'), after: inMethod('using (var s = Open()) { Foo(); }'), expect: [/using/i] },
  { name: 'insert switch case',         before: inMethod('switch (x) { case 1: break; }'), after: inMethod('switch (x) { case 1: break; case 2: break; }'), expect: [/case/i, /2/] },
  { name: 'insert return',              before: inMethod(''), after: inMethod('return;'), expect: [/return/i] },
  { name: 'move statement within block', before: inMethod('A();\nB();'), after: inMethod('B();\nA();'), expect: [/mov/i] },
];