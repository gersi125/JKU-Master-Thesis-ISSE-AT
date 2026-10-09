const { inClass } = require('../harness');

module.exports = [
  {
    name: 'reorder method parameters',
    before: inClass('public void Foo(int a, string b) { }'),
    after:  inClass('public void Foo(string b, int a) { }'),
    expect: [/Foo/, /mov/i],        // loose semantic checks; tighten after your first dump
  },
  {
    name: 'reorder properties',
    before: inClass('public int A { get; set; }\npublic int B { get; set; }'),
    after:  inClass('public int B { get; set; }\npublic int A { get; set; }'),
    expect: [/B/, /mov/i],
  },
  {
    name: 'reorder methods',
    before: inClass('void A() { }\nvoid B() { }'),
    after:  inClass('void B() { }\nvoid A() { }'),
    expect: [/mov/i],
  },
  {
    name: 'reorder arguments in call',
    before: inClass('void M() { Foo(1, "x"); }\nvoid Foo(int a, string b) { }'),
    after:  inClass('void M() { Foo("x", 1); }\nvoid Foo(int a, string b) { }'),
    expect: [/argument/i],
  },
  {
    name: 'reorder array initializer elements',
    before: inClass('int[] xs = { 1, 2, 3 };'),
    after:  inClass('int[] xs = { 3, 2, 1 };'),
    expect: [/xs|array|initial/i],
  },
];