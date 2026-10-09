const { inMethod } = require('../harness');

module.exports = [
  { name: 'change literal',            before: inMethod('var x = 1;'), after: inMethod('var x = 2;'), expect: [/1/, /2/] },
  { name: 'change operator',           before: inMethod('var x = a + b;'), after: inMethod('var x = a - b;'), expect: [/\+|-/] },
  { name: 'add call argument',         before: inMethod('Foo(1);'), after: inMethod('Foo(1, 2);'), expect: [/Foo/, /2/] },
  { name: 'change method called',      before: inMethod('Foo();'), after: inMethod('Bar();'), expect: [/Foo/, /Bar/] },
  { name: 'add LINQ clause',           before: inMethod('var r = xs.Select(x => x);'), after: inMethod('var r = xs.Where(x => x > 0).Select(x => x);'), expect: [/Where/] },
  { name: 'string → interpolation',    before: inMethod('var s = "a";'), after: inMethod('var s = $"a{b}";'), expect: [/\$|interpol/i] },
  { name: 'insert lambda',             before: inMethod(''), after: inMethod('Func<int,int> f = x => x + 1;'), expect: [/f/] },
  { name: 'add await',                 before: inMethod('var t = Foo();'), after: inMethod('var t = await Foo();'), expect: [/await/i] },
  { name: 'add object initializer',    before: inMethod('var p = new P();'), after: inMethod('var p = new P { A = 1 };'), expect: [/A/] },
  { name: 'ternary introduced',        before: inMethod('var x = 1;'), after: inMethod('var x = ok ? 1 : 2;'), expect: [/\?|ternary|conditional/i] },
];