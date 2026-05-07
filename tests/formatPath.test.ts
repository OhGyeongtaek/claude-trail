// docs/DESIGN.md §7 — path display rules.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { splitPath, ellipsizePath } from '../src/ui/formatPath.js';

test('splitPath: directory + base for nested path', () => {
  const r = splitPath('src/components/Card.tsx');
  assert.equal(r.dir, 'src/components/');
  assert.equal(r.base, 'Card.tsx');
});

test('splitPath: bare basename', () => {
  const r = splitPath('package.json');
  assert.equal(r.dir, '');
  assert.equal(r.base, 'package.json');
});

test('splitPath: "." stays as-is', () => {
  const r = splitPath('.');
  assert.equal(r.dir, '');
  assert.equal(r.base, '.');
});

test('splitPath: absolute path', () => {
  const r = splitPath('/abs/path/x.ts');
  assert.equal(r.dir, '/abs/path/');
  assert.equal(r.base, 'x.ts');
});

test('ellipsizePath: short path passthrough', () => {
  assert.equal(ellipsizePath('src/types.ts', 80), 'src/types.ts');
});

test('ellipsizePath: middle ellipsis preserves basename', () => {
  const out = ellipsizePath('src/components/cards/very/long/path/Card.tsx', 38);
  assert.ok(out.endsWith('Card.tsx'), `basename preserved: ${out}`);
  assert.ok(out.includes('…'));
  assert.ok(out.length <= 40);
});

test('ellipsizePath: returns input when basename alone exceeds maxWidth', () => {
  // basename "Card.tsx" length 8, maxWidth 4 → cannot fit, so passthrough.
  assert.equal(ellipsizePath('a/b/Card.tsx', 4), 'a/b/Card.tsx');
});

test('ellipsizePath: works with absolute path', () => {
  const out = ellipsizePath('/Users/me/repo/src/components/cards/Card.tsx', 30);
  assert.ok(out.endsWith('Card.tsx'));
});
