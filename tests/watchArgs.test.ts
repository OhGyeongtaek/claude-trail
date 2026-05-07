// docs/DESIGN.md §6 — `watch` flag parsing.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseWatchArgs, buildFilterState } from '../src/commands/watch.js';

test('parseWatchArgs: --md sets md flag', () => {
  const r = parseWatchArgs(['--md']);
  assert.equal(r.md, true);
});

test('parseWatchArgs: --tools accepts comma-separated value', () => {
  const r = parseWatchArgs(['--tools', 'Read,Edit']);
  assert.equal(r.tools, 'Read,Edit');
});

test('parseWatchArgs: --tools without arg is ignored', () => {
  const r = parseWatchArgs(['--tools']);
  assert.equal(r.tools, undefined);
});

test('buildFilterState: defaults to ext=all + tools=all', () => {
  const f = buildFilterState({});
  assert.equal(f.ext, 'all');
  assert.equal(f.tools, 'all');
});

test('buildFilterState: --md → ext=md', () => {
  const f = buildFilterState({ md: true });
  assert.equal(f.ext, 'md');
});

test('buildFilterState: --tools Read filters to Read only', () => {
  const f = buildFilterState({ tools: 'Read' });
  assert.notEqual(f.tools, 'all');
  if (f.tools !== 'all') {
    assert.ok(f.tools.has('Read'));
    assert.ok(!f.tools.has('Edit'));
  }
});

test('buildFilterState: invalid tool names dropped silently', () => {
  const f = buildFilterState({ tools: 'Read,Bash,Junk' });
  if (f.tools !== 'all') {
    assert.equal(f.tools.size, 1);
    assert.ok(f.tools.has('Read'));
  } else {
    assert.fail('expected tool filter set');
  }
});

test('buildFilterState: empty tools spec → all', () => {
  const f = buildFilterState({ tools: 'Junk,Bash' });
  assert.equal(f.tools, 'all');
});

test('buildFilterState: --tools Task included', () => {
  const f = buildFilterState({ tools: 'Task' });
  if (f.tools !== 'all') {
    assert.ok(f.tools.has('Task'));
  }
});
