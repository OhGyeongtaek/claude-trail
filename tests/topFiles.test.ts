// docs/DESIGN.md §7 — TopFiles bar chart aggregation + normalization.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { topFilesList, initialState, step } from '../src/ui/viewState.js';
import { makeBar } from '../src/ui/TopFiles.js';
import type { TrailEvent, FilterState } from '../src/types.js';

const ALL: FilterState = { ext: 'all', tools: 'all' };

function fileEvent(opts: {
  ts: string;
  session: string;
  tool: 'Read' | 'Edit' | 'Write';
  path: string;
}): TrailEvent {
  return {
    ts: opts.ts,
    session: opts.session,
    tool: opts.tool,
    path: opts.path,
    ext: '.ts',
    meta: { tool_use_id: `t_${opts.ts}` },
  };
}

test('topFilesList: empty map → empty list', () => {
  assert.deepEqual(topFilesList(new Map(), 5), []);
});

test('topFilesList: sorted by count descending', () => {
  const m = new Map<string, number>([
    ['a.ts', 2],
    ['b.ts', 5],
    ['c.ts', 3],
  ]);
  const list = topFilesList(m, 10);
  assert.deepEqual(
    list.map((x) => x.path),
    ['b.ts', 'c.ts', 'a.ts'],
  );
});

test('topFilesList: respects N cap', () => {
  const m = new Map<string, number>([
    ['a.ts', 1],
    ['b.ts', 2],
    ['c.ts', 3],
    ['d.ts', 4],
  ]);
  assert.equal(topFilesList(m, 2).length, 2);
});

test('topFilesList: aggregates Read+Edit+Write through reducer', () => {
  let s = initialState(ALL);
  s = step(s, fileEvent({ ts: '2026-05-07T01:00:00.000Z', session: 'A', tool: 'Read', path: 'a.ts' }));
  s = step(s, fileEvent({ ts: '2026-05-07T01:00:01.000Z', session: 'A', tool: 'Edit', path: 'a.ts' }));
  s = step(s, fileEvent({ ts: '2026-05-07T01:00:02.000Z', session: 'A', tool: 'Write', path: 'a.ts' }));
  s = step(s, fileEvent({ ts: '2026-05-07T01:00:03.000Z', session: 'A', tool: 'Read', path: 'b.ts' }));
  const list = topFilesList(s.topFiles, 5);
  assert.equal(list[0]!.path, 'a.ts');
  assert.equal(list[0]!.count, 3);
  assert.equal(list[1]!.path, 'b.ts');
  assert.equal(list[1]!.count, 1);
});

test('topFilesList: Glob/Grep paths NOT counted', () => {
  let s = initialState(ALL);
  s = step(s, {
    ts: '2026-05-07T01:00:00.000Z',
    session: 'A',
    tool: 'Grep',
    path: 'src/',
    ext: null,
    meta: { tool_use_id: 't1', query: 'foo' },
  });
  s = step(s, {
    ts: '2026-05-07T01:00:01.000Z',
    session: 'A',
    tool: 'Glob',
    path: '.',
    ext: null,
    meta: { tool_use_id: 't2', pattern: '*.ts' },
  });
  assert.equal(s.topFiles.size, 0);
});

test('makeBar: max value renders full bar', () => {
  assert.equal(makeBar(10, 10, 12), '████████████');
});

test('makeBar: zero count → empty', () => {
  assert.equal(makeBar(0, 10, 12), '');
});

test('makeBar: tiny ratio still shows at least 1 cell', () => {
  // 1/100 of 12 cells rounds to 0; should still render 1 to indicate presence.
  assert.equal(makeBar(1, 100, 12), '█');
});

test('makeBar: scales proportionally', () => {
  // 5/10 of 12 cells = 6
  assert.equal(makeBar(5, 10, 12).length, 6);
});

test('makeBar: zero max guards against divide-by-zero', () => {
  assert.equal(makeBar(5, 0, 12), '');
});

test('makeBar: zero width returns empty', () => {
  assert.equal(makeBar(5, 10, 0), '');
});
