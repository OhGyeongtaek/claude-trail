// Issue #1 — FNV-1a session color hash + palette properties.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  fnv1a32,
  sessionColor,
  shortSessionId,
  SESSION_PALETTE,
} from '../src/lib/sessionColor.js';

test('fnv1a32 known vectors', () => {
  // Reference values: FNV-1a 32-bit
  assert.equal(fnv1a32(''), 0x811c9dc5);
  assert.equal(fnv1a32('a'), 0xe40c292c);
  assert.equal(fnv1a32('foobar'), 0xbf9cf968);
});

test('sessionColor is stable for same input', () => {
  const id = '8a3f1b22-1234-4abc-9def-0123456789ab';
  assert.equal(sessionColor(id), sessionColor(id));
});

test('sessionColor returns a palette entry', () => {
  for (const id of ['x', 'y', 'session-zzz', '0000', 'A'.repeat(40)]) {
    assert.ok(SESSION_PALETTE.includes(sessionColor(id)));
  }
});

test('sessionColor avoids red and green family for any input', () => {
  // Color-blind safety: never select pure red/green names.
  for (const c of SESSION_PALETTE) {
    assert.ok(!/^red/i.test(c), `palette has red-family entry: ${c}`);
    assert.ok(!/^green/i.test(c), `palette has green-family entry: ${c}`);
  }
});

test('sessionColor distribution: 1000 random ids cover at least 6 of 8 colors', () => {
  const counts = new Map<string, number>();
  for (let i = 0; i < 1000; i++) {
    const id = `sess-${i}-${Math.random().toString(36).slice(2)}`;
    const c = sessionColor(id);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  assert.ok(counts.size >= 6, `expected ≥6 distinct colors, got ${counts.size}`);
});

test('shortSessionId returns first 4 chars (or full when shorter)', () => {
  assert.equal(shortSessionId('abc'), 'abc');
  assert.equal(shortSessionId('abcd'), 'abcd');
  assert.equal(shortSessionId('abcdef-uuid'), 'abcd');
});
