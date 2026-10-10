const { inClass, L } = require('../harness');

module.exports = [
  { name: 'reorder method parameters', before: inClass('public void Foo(int a, string b) { }'), after: inClass('public void Foo(string b, int a) { }'), expect: [L('mv param C.Foo(string,int) @1/2 -> @2/2', 'int a')] },
  { name: 'reorder properties', before: inClass('public int A { get; set; }\npublic int B { get; set; }'), after: inClass('public int B { get; set; }\npublic int A { get; set; }'), expect: [L('mv prop C @1/2 -> @2/2', 'A : int')] },
  { name: 'reorder methods', before: inClass('void A() { }\nvoid B() { }'), after: inClass('void B() { }\nvoid A() { }'), expect: [L('mv method C @1/2 -> @2/2', 'A()')] },
  { name: 'reorder arguments in call', before: inClass('void M() { Foo(1, "x"); }\nvoid Foo(int a, string b) { }'), after: inClass('void M() { Foo("x", 1); }\nvoid Foo(int a, string b) { }'), expect: [L('mv arg Foo in C.M() @1/2 -> @2/2')] },
  {
    name: 'reorder array initializer elements',
    before: inClass('int[] xs = { 1, 2, 3 };'), after: inClass('int[] xs = { 3, 2, 1 };'),
    expect: [L('mv elem xs in C.xs @1/3 -> @3/3', '1'), L('mv elem xs in C.xs @3/3 -> @1/3', '3')],
    forbid: [/@2\/3 -> @2\/3/],
    known: 'GumTree keeps "3" stationary and moves 1 and 2 around it; the log needs the full resulting order to be replayable',
  },
];