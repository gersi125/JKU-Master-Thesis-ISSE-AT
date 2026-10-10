const { inMethod, L } = require('../harness');

module.exports = [
  { name: 'change literal', before: inMethod('var x = 1;'), after: inMethod('var x = 2;'), expect: [L('~ var C.M()', 'number 1 -> 2')] },
  { name: 'change operator', before: inMethod('var x = a + b;'), after: inMethod('var x = a - b;'), expect: [L('~ var C.M()', 'op + -> -')] },
  { name: 'add call argument', before: inMethod('Foo(1);'), after: inMethod('Foo(1, 2);'), expect: [L('+ arg Foo @2/2 in C.M()')] },
  { name: 'change method called', before: inMethod('Foo();'), after: inMethod('Bar();'), expect: [L('~ call C.M()', 'id Foo -> Bar')] },
  { name: 'add LINQ clause', before: inMethod('var r = xs.Select(x => x);'), after: inMethod('var r = xs.Where(x => x > 0).Select(x => x);'), expect: [L('~ var C.M()', '+Where(x=>x>0).')] },
  { name: 'insert lambda', before: inMethod(''), after: inMethod('Func<int,int> f = x => x + 1;'), expect: [L('+ var C.M()', 'Func<int,int> f')] },
  { name: 'add await', before: inMethod('var t = Foo();'), after: inMethod('var t = await Foo();'), expect: [L('~ var C.M()', '+await')] },

  // --- known defects ---
  { name: 'string → interpolation', before: inMethod('var s = "a";'), after: inMethod('var s = $"a{b}";'),
    expect: [L('~ var C.M()')],
    forbid: [/\["a";/],
    known: 'edit marker garbled: ["a"; -> $" a]' },
  { name: 'add object initializer', before: inMethod('var p = new P();'), after: inMethod('var p = new P { A = 1 };'),
    expect: [L('~ var C.M()', '+P'), /A = 1/],
    forbid: [L('- call')],
    known: 'initializer content hidden by "{ ... }", spurious "- call P()"' },
  { name: 'ternary introduced', before: inMethod('var x = 1;'), after: inMethod('var x = ok ? 1 : 2;'),
    expect: [L('+ ternary C.M()', 'ok ? 1 : 2')],
    forbid: [L('+ expr'), L('mv number')],
    known: 'duplicate "+ expr" / "+ ternary", spurious "mv number @2/2 -> @1/2"' },
];