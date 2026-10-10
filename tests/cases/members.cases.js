const { inClass, L } = require('../harness');

module.exports = [
  { name: 'insert method',        before: inClass(''), after: inClass('public void Foo() { }'), expect: [L('+ method C.Foo()')] },
  { name: 'delete method',        before: inClass('public void Foo() { }'), after: inClass(''), expect: [L('- method C.Foo()')] },
  { name: 'rename method',        before: inClass('void Foo() { }'), after: inClass('void Bar() { }'), expect: [L('~ rename C', 'method Foo -> Bar')] },
  { name: 'change return type',   before: inClass('int Foo() { return 1; }'), after: inClass('long Foo() { return 1; }'), expect: [L('~ id C.Foo()', 'int -> long')] },
  { name: 'change modifier',      before: inClass('private int x;'), after: inClass('public int x;'), expect: [L('~ access C.x', 'private -> public')] },
  { name: 'add static modifier',  before: inClass('void Foo() { }'), after: inClass('static void Foo() { }'), expect: [L('+ mod C.Foo()', 'static')] },
  { name: 'insert field',         before: inClass(''), after: inClass('private readonly int _x = 5;'), expect: [L('+ field C._x', 'readonly')] },
  { name: 'insert auto property', before: inClass(''), after: inClass('public string Name { get; set; }'), expect: [L('+ prop C.Name', 'string')] },
  { name: 'insert constructor',   before: inClass(''), after: inClass('public C(int a) { }'), expect: [L('+ constructor', '(int a)')] },
  { name: 'insert nested class',  before: inClass(''), after: inClass('class Inner { }'), expect: [L('+ class C.Inner')] },
  { name: 'insert attribute',     before: inClass('void F() { }'), after: inClass('[Obsolete]\nvoid F() { }'), expect: [L('+ attribute C.F()', '[Obsolete]')] },
  {
    name: 'expression-bodied → block',
    before: inClass('int F() => 1;'), after: inClass('int F() { return 1; }'),
    expect: [L('~ body C.F()')],   // wording is your call; adjust once you decide it
    forbid: [L('+ method'), L('- method'), L('move')],
    known: 'reported as "+ method F" / "- method F" instead of a body change; labels garbled',
  },
];