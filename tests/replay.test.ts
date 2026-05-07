// Issue #3 — replay command pure helpers.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  parseReplayArgs,
  filterSession,
  filterTimeSlice,
} from '../src/commands/replayArgs.js';
import type { TrailEvent } from '../src/types.js';

function read(opts: { ts: string; session: string; path?: string }): TrailEvent {
  return {
    ts: opts.ts,
    session: opts.session,
    tool: 'Read',
    path: opts.path ?? 'a.ts',
    ext: '.ts',
    meta: { tool_use_id: `t-${opts.ts}` },
  };
}

test('parseReplayArgs requires session id', () => {
  const r = parseReplayArgs([]);
  assert.ok('error' in r);
});

test('parseReplayArgs accepts session id only', () => {
  const r = parseReplayArgs(['abc-123']);
  assert.ok(!('error' in r));
  if (!('error' in r)) {
    assert.equal(r.sessionId, 'abc-123');
    assert.equal(r.from, undefined);
    assert.equal(r.to, undefined);
  }
});

test('parseReplayArgs accepts --from / --to with HH:MM:SS', () => {
  const r = parseReplayArgs(['s1', '--from', '10:00:00', '--to', '11:30:45']);
  assert.ok(!('error' in r));
  if (!('error' in r)) {
    assert.equal(r.from, '10:00:00');
    assert.equal(r.to, '11:30:45');
  }
});

test('parseReplayArgs rejects malformed --from', () => {
  const r = parseReplayArgs(['s1', '--from', '10:00']);
  assert.ok('error' in r);
});

test('filterSession keeps only matching session_id', () => {
  const events = [
    read({ ts: '2026-05-07T10:00:00.000Z', session: 'A' }),
    read({ ts: '2026-05-07T10:00:01.000Z', session: 'B' }),
    read({ ts: '2026-05-07T10:00:02.000Z', session: 'A' }),
  ];
  assert.equal(filterSession(events, 'A').length, 2);
});

test('filterTimeSlice no-op when both bounds absent', () => {
  const events = [read({ ts: '2026-05-07T10:00:00.000Z', session: 'A' })];
  assert.deepEqual(filterTimeSlice(events), events);
});

test('filterTimeSlice ordering preserved (no reordering)', () => {
  const events = [
    read({ ts: '2026-05-07T10:00:00.000Z', session: 'A', path: 'a' }),
    read({ ts: '2026-05-07T10:00:01.000Z', session: 'A', path: 'b' }),
    read({ ts: '2026-05-07T10:00:02.000Z', session: 'A', path: 'c' }),
  ];
  const out = filterTimeSlice(events, '00:00:00', '23:59:59');
  assert.deepEqual(out.map((e) => (e as { path: string }).path), ['a', 'b', 'c']);
});
