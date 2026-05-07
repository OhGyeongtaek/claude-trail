// docs/DESIGN.md §7, §8 — view-state reducer covering filters,
// /compact byproduct absorption, counters, top-files aggregation.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  initialState,
  step,
  matchesFilter,
  isAbsorbed,
  topFilesList,
} from '../src/ui/viewState.js';
import type { TrailEvent, FilterState } from '../src/types.js';

const ALL_FILTER: FilterState = { ext: 'all', tools: 'all' };
const MD_FILTER: FilterState = { ext: 'md', tools: 'all' };
const READ_ONLY_FILTER: FilterState = {
  ext: 'all',
  tools: new Set<'Read'>(['Read']),
};

function readEvent(opts: {
  ts: string;
  session: string;
  path: string;
  ext?: string | null;
}): TrailEvent {
  return {
    ts: opts.ts,
    session: opts.session,
    tool: 'Read',
    path: opts.path,
    ext: opts.ext ?? '.ts',
    meta: { tool_use_id: `toolu_${opts.ts}` },
  };
}

function controlEvent(opts: {
  ts: string;
  session: string;
  event: 'session_start' | 'session_end' | 'compact' | 'subagent_stop';
  meta: Record<string, unknown>;
}): TrailEvent {
  return {
    ts: opts.ts,
    session: opts.session,
    tool: '_control',
    event: opts.event,
    meta: opts.meta as never,
  };
}

// — counters & top files —

test('counters increment on file events; control events do not', () => {
  let s = initialState(ALL_FILTER);
  s = step(s, readEvent({ ts: '2026-05-07T01:00:00.000Z', session: 'A', path: 'a.ts' }));
  s = step(s, readEvent({ ts: '2026-05-07T01:00:01.000Z', session: 'A', path: 'b.ts' }));
  s = step(
    s,
    controlEvent({
      ts: '2026-05-07T01:00:02.000Z',
      session: 'A',
      event: 'session_start',
      meta: { source: 'startup' },
    }),
  );
  assert.equal(s.counters.Read, 2);
  assert.equal(s.events.length, 3);
});

test('top files aggregates Read/Edit/Write paths', () => {
  let s = initialState(ALL_FILTER);
  for (let i = 0; i < 3; i++) {
    s = step(
      s,
      readEvent({ ts: `2026-05-07T01:00:0${i}.000Z`, session: 'A', path: 'a.ts' }),
    );
  }
  s = step(s, readEvent({ ts: '2026-05-07T01:00:10.000Z', session: 'A', path: 'b.ts' }));
  const list = topFilesList(s.topFiles, 5);
  assert.deepEqual(
    list.map((x) => x.path),
    ['a.ts', 'b.ts'],
  );
  assert.equal(list[0]!.count, 3);
});

// — /compact byproduct absorption —

test('SubagentStop with agent_type:"" within compact window is absorbed', () => {
  let s = initialState(ALL_FILTER);
  s = step(
    s,
    controlEvent({
      ts: '2026-05-07T01:00:00.000Z',
      session: 'X',
      event: 'compact',
      meta: { trigger: 'manual' },
    }),
  );
  s = step(
    s,
    controlEvent({
      ts: '2026-05-07T01:00:00.500Z',
      session: 'X',
      event: 'subagent_stop',
      meta: { agent_id: 'a1', agent_type: '' },
    }),
  );
  // Only the PreCompact line should remain.
  assert.equal(s.events.length, 1);
  assert.equal((s.events[0] as { event: string }).event, 'compact');
});

test('SessionStart source:"compact" within compact window is absorbed', () => {
  let s = initialState(ALL_FILTER);
  s = step(
    s,
    controlEvent({
      ts: '2026-05-07T01:00:00.000Z',
      session: 'X',
      event: 'compact',
      meta: { trigger: 'auto' },
    }),
  );
  s = step(
    s,
    controlEvent({
      ts: '2026-05-07T01:00:00.700Z',
      session: 'X',
      event: 'session_start',
      meta: { source: 'compact' },
    }),
  );
  assert.equal(s.events.length, 1);
});

test('SubagentStop with non-empty agent_type is NOT absorbed', () => {
  let s = initialState(ALL_FILTER);
  s = step(
    s,
    controlEvent({
      ts: '2026-05-07T01:00:00.000Z',
      session: 'X',
      event: 'compact',
      meta: { trigger: 'manual' },
    }),
  );
  s = step(
    s,
    controlEvent({
      ts: '2026-05-07T01:00:00.300Z',
      session: 'X',
      event: 'subagent_stop',
      meta: { agent_id: 'a1', agent_type: 'Explore' },
    }),
  );
  assert.equal(s.events.length, 2);
});

test('absorption does not apply across sessions', () => {
  const pending = new Map<string, { tsMs: number }>();
  pending.set('A', { tsMs: Date.parse('2026-05-07T01:00:00.000Z') });
  const e: TrailEvent = controlEvent({
    ts: '2026-05-07T01:00:00.500Z',
    session: 'B', // different session
    event: 'subagent_stop',
    meta: { agent_id: 'a1', agent_type: '' },
  });
  assert.equal(isAbsorbed(e, pending), false);
});

test('absorption window expires after 30s', () => {
  let s = initialState(ALL_FILTER);
  s = step(
    s,
    controlEvent({
      ts: '2026-05-07T01:00:00.000Z',
      session: 'X',
      event: 'compact',
      meta: { trigger: 'manual' },
    }),
  );
  s = step(
    s,
    controlEvent({
      ts: '2026-05-07T01:01:00.000Z', // 60s later
      session: 'X',
      event: 'subagent_stop',
      meta: { agent_id: 'a1', agent_type: '' },
    }),
  );
  assert.equal(s.events.length, 2, 'late SubagentStop should be kept');
});

// — filters —

test('matchesFilter ext=md drops .ts file events', () => {
  const e: TrailEvent = readEvent({
    ts: '2026-05-07T01:00:00.000Z',
    session: 'A',
    path: 'a.ts',
    ext: '.ts',
  });
  assert.equal(matchesFilter(e, MD_FILTER), false);
});

test('matchesFilter ext=md keeps .md file events', () => {
  const e: TrailEvent = readEvent({
    ts: '2026-05-07T01:00:00.000Z',
    session: 'A',
    path: 'r.md',
    ext: '.md',
  });
  assert.equal(matchesFilter(e, MD_FILTER), true);
});

test('matchesFilter tools whitelist drops Edit when only Read allowed', () => {
  const e: TrailEvent = {
    ts: '2026-05-07T01:00:00.000Z',
    session: 'A',
    tool: 'Edit',
    path: 'a.ts',
    ext: '.ts',
    meta: { tool_use_id: 't' },
  };
  assert.equal(matchesFilter(e, READ_ONLY_FILTER), false);
});

test('matchesFilter: control events always pass any filter', () => {
  const e = controlEvent({
    ts: '2026-05-07T01:00:00.000Z',
    session: 'A',
    event: 'session_start',
    meta: { source: 'startup' },
  });
  assert.equal(matchesFilter(e, MD_FILTER), true);
  assert.equal(matchesFilter(e, READ_ONLY_FILTER), true);
});

// — stream cap —

test('stream cap drops oldest events when exceeded', () => {
  let s = initialState(ALL_FILTER, 3);
  for (let i = 0; i < 5; i++) {
    s = step(
      s,
      readEvent({
        ts: new Date(Date.parse('2026-05-07T01:00:00.000Z') + i * 1000).toISOString(),
        session: 'A',
        path: `f${i}.ts`,
      }),
    );
  }
  assert.equal(s.events.length, 3);
  assert.equal((s.events[0] as { path: string }).path, 'f2.ts');
  assert.equal((s.events[2] as { path: string }).path, 'f4.ts');
});
