const { inClass, L } = require('../harness');

module.exports = [
  { name: 'add parameter at end',    before: inClass('void F(int a) { }'), after: inClass('void F(int a, int b) { }'), expect: [L('+ param C.F(int,int) @2/2', 'int b')] },
  { name: 'add parameter at front',  before: inClass('void F(int a) { }'), after: inClass('void F(int z, int a) { }'), expect: [L('+ param C.F(int,int) @1/2', 'int z')] },
  { name: 'remove middle parameter', before: inClass('void F(int a, int b, int c) { }'), after: inClass('void F(int a, int c) { }'), expect: [L('- param C.F(int,int,int) @2/3', 'int b')] },
  { name: 'change parameter type',   before: inClass('void F(int a) { }'), after: inClass('void F(string a) { }'), expect: [L('~ type C.F(int)', 'int -> string')] },
  { name: 'rename parameter',        before: inClass('void F(int a) { }'), after: inClass('void F(int count) { }'), expect: [L('~ rename C.F(int)', 'param a -> count')] },
  { name: 'add default value',       before: inClass('void F(int a) { }'), after: inClass('void F(int a = 5) { }'), expect: [L('+ param C.F(int) @1/1', 'int a = 5')] },
  { name: 'add ref modifier',        before: inClass('void F(int a) { }'), after: inClass('void F(ref int a) { }'), expect: [L('+ mod C.F(int)', 'ref')] },
  { name: 'add generic constraint',  before: inClass('void F<T>(T o) { }'), after: inClass('void F<T>(T o) where T : class { }'), expect: [L('+ where C.F(T)', 'where T : class')] },
  {
    name: 'add generic parameter',
    before: inClass('void F(object o) { }'), after: inClass('void F<T>(T o) { }'),
    expect: [L('+ args C.F(T)', '<T>'), L('~ type C.F(object)', 'object -> T')],
    forbid: [L('~ id C.F'), L('+ id C.F')],
    known: 'also logs "~ id F" and "+ id F" although the name is unchanged',
  },
];