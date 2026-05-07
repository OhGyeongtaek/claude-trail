// docs/DESIGN.md §6 — `watch` flag parsing.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  parseWatchArgs,
  buildFilterState,
  parseDuration,
  parseExtList,
} from '../src/commands/watch.js';

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

// — issue #4: --ext / --since —

test('parseWatchArgs: --ext captures comma-separated value', () => {
  const r = parseWatchArgs(['--ext', '.ts,.tsx']);
  assert.equal(r.ext, '.ts,.tsx');
});

test('parseWatchArgs: --since captures duration string', () => {
  const r = parseWatchArgs(['--since', '30m']);
  assert.equal(r.since, '30m');
});

test('parseDuration accepts s/m/h/d', () => {
  assert.equal(parseDuration('45s'), 45_000);
  assert.equal(parseDuration('30m'), 30 * 60_000);
  assert.equal(parseDuration('2h'), 2 * 3_600_000);
  assert.equal(parseDuration('1d'), 86_400_000);
});

test('parseDuration rejects invalid input', () => {
  assert.equal(parseDuration(''), null);
  assert.equal(parseDuration('30'), null);
  assert.equal(parseDuration('m'), null);
  assert.equal(parseDuration('-5m'), null);
  assert.equal(parseDuration('0m'), null);
  assert.equal(parseDuration('30min'), null);
});

test('parseExtList drops entries without leading dot', () => {
  const s = parseExtList('.ts,tsx,.md');
  assert.ok(s);
  assert.equal(s!.size, 2);
  assert.ok(s!.has('.ts'));
  assert.ok(s!.has('.md'));
});

test('parseExtList returns null when nothing valid', () => {
  assert.equal(parseExtList('ts,tsx'), null);
  assert.equal(parseExtList(''), null);
});

test('buildFilterState: --ext takes precedence over --md', () => {
  const f = buildFilterState({ md: true, ext: '.ts,.tsx' });
  assert.equal(f.ext, 'all');
  assert.ok(f.extSet);
  assert.ok(f.extSet!.has('.ts'));
  assert.ok(f.extSet!.has('.tsx'));
});

test('buildFilterState: invalid --ext (no leading dot anywhere) falls back to plain ext', () => {
  const f = buildFilterState({ md: true, ext: 'ts' });
  assert.equal(f.extSet, undefined);
  assert.equal(f.ext, 'md');
});
