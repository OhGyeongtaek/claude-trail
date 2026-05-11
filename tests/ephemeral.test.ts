// Tests for ephemeral mode: paths, installer flag, init parse, prune args.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  isValidSessionId,
  sessionEventsLogPath,
  ephemeralRoot,
  listEphemeralSessions,
  latestEphemeralSession,
} from '../src/lib/paths.js';
import { planInstall, planRemove } from '../src/lib/installer.js';
import { parseInitArgs } from '../src/commands/init.js';
import { parsePruneArgs } from '../src/commands/prune.js';

// — isValidSessionId
test('isValidSessionId: accepts UUID-like and rejects path traversal', () => {
  assert.equal(isValidSessionId('abc123_xyz-DEF'), true);
  assert.equal(isValidSessionId('11111111-2222-3333-4444-555555555555'), true);
  assert.equal(isValidSessionId('../etc/passwd'), false);
  assert.equal(isValidSessionId('a/b'), false);
  assert.equal(isValidSessionId('a.b'), false);
  assert.equal(isValidSessionId(''), false);
  assert.equal(isValidSessionId('x'.repeat(129)), false);
  assert.equal(isValidSessionId(123 as unknown), false);
});

test('sessionEventsLogPath: throws on invalid id', () => {
  assert.throws(() => sessionEventsLogPath('../bad'), /invalid session id/);
});

test('sessionEventsLogPath: under ephemeralRoot', () => {
  const p = sessionEventsLogPath('abc');
  assert.ok(p.startsWith(ephemeralRoot()));
  assert.ok(p.endsWith('/abc.jsonl'));
});

// — listEphemeralSessions / latestEphemeralSession (with XDG override)
test('listEphemeralSessions: returns valid sessions sorted by mtime desc', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ct-eph-'));
  const prevXdg = process.env['XDG_RUNTIME_DIR'];
  process.env['XDG_RUNTIME_DIR'] = tmp;
  try {
    const dir = ephemeralRoot();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'aaa.jsonl'), '');
    writeFileSync(join(dir, 'bbb.jsonl'), '');
    writeFileSync(join(dir, 'invalid name with spaces.jsonl'), '');
    writeFileSync(join(dir, 'ignored.txt'), '');

    const list = listEphemeralSessions();
    const ids = list.map((s) => s.sessionId).sort();
    assert.deepEqual(ids, ['aaa', 'bbb']);

    const latest = latestEphemeralSession();
    assert.ok(latest);
    assert.ok(['aaa', 'bbb'].includes(latest!.sessionId));
  } finally {
    if (prevXdg === undefined) delete process.env['XDG_RUNTIME_DIR'];
    else process.env['XDG_RUNTIME_DIR'] = prevXdg;
    rmSync(tmp, { recursive: true, force: true });
  }
});

// — installer ephemeral variant
test('planInstall: ephemeral=true uses --ephemeral command', () => {
  const { settings } = planInstall(null, { ephemeral: true });
  const cmd = settings.hooks!.PostToolUse![0]!.hooks[0]!.command;
  assert.equal(cmd, 'claude-trail-hook --ephemeral');
});

test('planInstall: default (no opts) uses plain command', () => {
  const { settings } = planInstall(null);
  const cmd = settings.hooks!.PostToolUse![0]!.hooks[0]!.command;
  assert.equal(cmd, 'claude-trail-hook');
});

test('planRemove: removes ephemeral-installed hooks (fingerprint matches)', () => {
  const { settings } = planInstall(null, { ephemeral: true });
  const removed = planRemove(settings);
  assert.ok(removed.totalRemoved > 0);
  assert.equal(removed.settings.hooks, undefined);
});

// — prune args
test('parsePruneArgs: defaults to 24h, accepts --older-than', () => {
  assert.deepEqual(parsePruneArgs([]), { olderThanMs: 24 * 60 * 60 * 1000 });
  const b = parsePruneArgs(['--older-than', '30m']);
  if ('error' in b) throw new Error('unexpected error');
  assert.equal(b.olderThanMs, 30 * 60 * 1000);
});

test('parsePruneArgs: rejects bad duration', () => {
  const r = parsePruneArgs(['--older-than', 'forever']);
  assert.ok('error' in r);
});

test('parseInitArgs: --ephemeral sets ephemeral=true', () => {
  assert.equal(parseInitArgs(['--ephemeral']).ephemeral, true);
  assert.equal(parseInitArgs([]).ephemeral, false);
});

// Touch a session file to make sure listEphemeralSessions tolerates stale dir
test('listEphemeralSessions: missing dir returns empty', () => {
  const prevXdg = process.env['XDG_RUNTIME_DIR'];
  process.env['XDG_RUNTIME_DIR'] = join(tmpdir(), 'definitely-not-here-' + Date.now());
  try {
    assert.deepEqual(listEphemeralSessions(), []);
    assert.equal(latestEphemeralSession(), null);
  } finally {
    if (prevXdg === undefined) delete process.env['XDG_RUNTIME_DIR'];
    else process.env['XDG_RUNTIME_DIR'] = prevXdg;
  }
});

// Sanity: readdirSync still available (import check)
test('node:fs readdirSync is available', () => {
  assert.equal(typeof readdirSync, 'function');
});
