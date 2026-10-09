const { inClass } = require('../harness');

module.exports = [
  { name: 'add parameter at end',    before: inClass('void F(int a) { }'),        after: inClass('void F(int a, int b) { }'), expect: [/F/, /b/, /2/] },
  { name: 'add parameter at front',  before: inClass('void F(int a) { }'),        after: inClass('void F(int z, int a) { }'), expect: [/z/, /1/] },
  { name: 'remove middle parameter', before: inClass('void F(int a, int b, int c) { }'), after: inClass('void F(int a, int c) { }'), expect: [/b/] },
  { name: 'change parameter type',   before: inClass('void F(int a) { }'),        after: inClass('void F(string a) { }'), expect: [/int/, /string/] },
  { name: 'rename parameter',        before: inClass('void F(int a) { }'),        after: inClass('void F(int count) { }'), expect: [/a/, /count/] },
  { name: 'add default value',       before: inClass('void F(int a) { }'),        after: inClass('void F(int a = 5) { }'), expect: [/5/] },
  { name: 'add ref modifier',        before: inClass('void F(int a) { }'),        after: inClass('void F(ref int a) { }'), expect: [/ref/] },
  { name: 'add generic parameter',   before: inClass('void F(object o) { }'),     after: inClass('void F<T>(T o) { }'), expect: [/T/] },
  { name: 'add generic constraint',  before: inClass('void F<T>(T o) { }'),       after: inClass('void F<T>(T o) where T : class { }'), expect: [/where|constraint|class/i] },
];