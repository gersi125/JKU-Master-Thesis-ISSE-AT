
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { init } = require('./adapter');
const { diff, inClass, inMethod } = require('./harness');

before(async () => { await init(); });

describe('invariants', () => {
  it('identical sources produce no entries', async () => {
    const src = inClass('void F() { int x = 1; }');
    const r = await diff(src, src);
    assert.equal(r.lines.length, 0);
    assert.equal(r.meaningfulCount, 0);
  });

  it('is deterministic', async () => {
    const a = inClass('void F(int a, int b) { }');
    const b = inClass('void F(int b, int a) { }');
    const r1 = await diff(a, b);
    const r2 = await diff(a, b);
    assert.equal(r1.text, r2.text);
  });

  it('pure insert mirrors pure delete', async () => {
    const a = inClass('');
    const b = inClass('void Foo() { }');
    const fwd = await diff(a, b);
    const rev = await diff(b, a);
    assert.match(fwd.text, /Foo/);
    assert.match(rev.text, /Foo/);
    const count = (acts, t) => acts.filter(x => x.action.startsWith(t)).length;
    assert.equal(count(fwd.actions, 'insert'), count(rev.actions, 'delete'));
  });

  it('survives a half-typed (syntax-error) file without throwing', async () => {
    const good = inClass('void F() { int x = 1; }');
    const broken = inClass('void F() { int x = ; ');   // unfinished
    await assert.doesNotReject(() => diff(good, broken));
  });

  it('several unrelated edits in one save are all reported', async () => {
    const a = inClass('void A() { }\nvoid B() { }\nint x;');
    const b = inClass('void A(int p) { }\nvoid B() { }\nlong x;');
    const r = await diff(a, b);
    assert.match(r.text, /A/);
    assert.match(r.text, /long/);
  });
});