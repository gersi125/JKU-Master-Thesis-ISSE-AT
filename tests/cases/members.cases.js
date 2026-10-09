const { inClass } = require('../harness');

module.exports = [
  { name: 'insert method',        before: inClass(''), after: inClass('public void Foo() { }'), expect: [/Foo/, /insert|add/i], pure: 'insert' },
  { name: 'delete method',        before: inClass('public void Foo() { }'), after: inClass(''), expect: [/Foo/, /delet|remov/i], pure: 'delete' },
  { name: 'rename method',        before: inClass('void Foo() { }'), after: inClass('void Bar() { }'), expect: [/Foo/, /Bar/] },
  { name: 'change return type',   before: inClass('int Foo() { return 1; }'), after: inClass('long Foo() { return 1; }'), expect: [/int/, /long/] },
  { name: 'change modifier',      before: inClass('private int x;'), after: inClass('public int x;'), expect: [/private/, /public/] },
  { name: 'add static modifier',  before: inClass('void Foo() { }'), after: inClass('static void Foo() { }'), expect: [/static/] },
  { name: 'insert field',         before: inClass(''), after: inClass('private readonly int _x = 5;'), expect: [/_x/, /readonly/] },
  { name: 'insert auto property', before: inClass(''), after: inClass('public string Name { get; set; }'), expect: [/Name/] },
  { name: 'expression-bodied → block', before: inClass('int F() => 1;'), after: inClass('int F() { return 1; }'), expect: [/F/] },
  { name: 'insert constructor',   before: inClass(''), after: inClass('public C(int a) { }'), expect: [/constructor/i] },
  { name: 'insert nested class',  before: inClass(''), after: inClass('class Inner { }'), expect: [/Inner/] },
  { name: 'insert attribute',     before: inClass('void F() { }'), after: inClass('[Obsolete]\nvoid F() { }'), expect: [/Obsolete|attribute/i] },
];