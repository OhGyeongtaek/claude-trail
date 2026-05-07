// docs/DESIGN.md §11 — settings.json safe merge + precise removal.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  planInstall,
  planRemove,
  entryHasFingerprint,
  type Settings,
  type HookEntry,
} from '../src/lib/installer.js';

const OUR_CMD = 'node $CLAUDE_PROJECT_DIR/dist/hook.js';

// — fingerprint detection —

test('entryHasFingerprint: matches dist/hook.js', () => {
  assert.equal(
    entryHasFingerprint({
      hooks: [{ type: 'command', command: 'node /repo/dist/hook.js' }],
    }),
    true,
  );
});

test('entryHasFingerprint: matches claude-trail-hook bin', () => {
  assert.equal(
    entryHasFingerprint({
      hooks: [{ type: 'command', command: 'claude-trail-hook' }],
    }),
    true,
  );
});

test('entryHasFingerprint: ignores other tools', () => {
  assert.equal(
    entryHasFingerprint({
      hooks: [{ type: 'command', command: 'node ./tools/other-tool/hook.js' }],
    }),
    false,
  );
});

// — install planning —

test('planInstall: empty settings → 5 entries added', () => {
  const r = planInstall(null);
  assert.equal(r.changes.length, 5);
  assert.ok(r.changes.every((c) => c.action === 'added'));
  const hooks = r.settings.hooks!;
  assert.ok(hooks.PostToolUse);
  assert.equal(hooks.PostToolUse![0]!.matcher, 'Read|Edit|Write|Glob|Grep|Agent');
  assert.equal(hooks.SubagentStop![0]!.hooks[0]!.command, OUR_CMD);
});

test('planInstall: idempotent on second run', () => {
  const first = planInstall(null);
  const second = planInstall(first.settings);
  assert.ok(second.changes.every((c) => c.action === 'unchanged'));
  assert.deepEqual(first.settings, second.settings);
});

test('planInstall: preserves OTHER tools hooks', () => {
  const prev: Settings = {
    hooks: {
      PostToolUse: [
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'node ./tools/foo/hook.js' }],
        },
      ],
    },
  };
  const r = planInstall(prev);
  const arr = r.settings.hooks!.PostToolUse!;
  assert.equal(arr.length, 2);
  // Other tool entry is untouched (still last in array since we unshift).
  const fooEntry = arr.find((h) =>
    h.hooks.some((sh) => sh.command.includes('foo/hook.js')),
  );
  assert.ok(fooEntry, 'foo hook must survive');
  assert.equal(fooEntry!.matcher, 'Bash');
});

test('planInstall: updates matcher when our command exists with different matcher', () => {
  const prev: Settings = {
    hooks: {
      PostToolUse: [
        {
          matcher: 'Read|Edit',
          hooks: [{ type: 'command', command: OUR_CMD }],
        },
      ],
    },
  };
  const r = planInstall(prev);
  const change = r.changes.find((c) => c.event === 'PostToolUse');
  assert.equal(change!.action, 'matcher-updated');
  assert.equal(
    r.settings.hooks!.PostToolUse![0]!.matcher,
    'Read|Edit|Write|Glob|Grep|Agent',
  );
});

test('planInstall: partial existing — adds missing events only', () => {
  const prev: Settings = {
    hooks: {
      PostToolUse: [
        {
          matcher: 'Read|Edit|Write|Glob|Grep|Agent',
          hooks: [{ type: 'command', command: OUR_CMD }],
        },
      ],
      // SessionStart, SessionEnd, PreCompact, SubagentStop missing.
    },
  };
  const r = planInstall(prev);
  const added = r.changes.filter((c) => c.action === 'added').map((c) => c.event);
  assert.deepEqual(added.sort(), [
    'PreCompact',
    'SessionEnd',
    'SessionStart',
    'SubagentStop',
  ]);
  assert.ok(r.changes.find((c) => c.event === 'PostToolUse' && c.action === 'unchanged'));
});

// — remove planning —

test('planRemove: empty settings → no-op', () => {
  const r = planRemove(null);
  assert.equal(r.totalRemoved, 0);
  assert.deepEqual(r.settings, {});
});

test('planRemove: removes our hooks, leaves others', () => {
  const installed = planInstall(null).settings;
  // Inject another tool's hook alongside ours.
  installed.hooks!.PostToolUse!.push({
    matcher: 'Bash',
    hooks: [{ type: 'command', command: 'node ./tools/foo/hook.js' }],
  });
  const r = planRemove(installed);
  assert.ok(r.totalRemoved >= 5);
  // PostToolUse must still exist (foo hook remains).
  assert.equal(r.settings.hooks!.PostToolUse!.length, 1);
  assert.ok(
    r.settings.hooks!.PostToolUse![0]!.hooks[0]!.command.includes('foo/hook.js'),
  );
});

test('planRemove: drops empty hook arrays + empty hooks object', () => {
  const installed = planInstall(null).settings;
  const r = planRemove(installed);
  assert.equal(r.settings.hooks, undefined);
});

test('planRemove: ignores other tools entirely', () => {
  const prev: Settings = {
    hooks: {
      PostToolUse: [
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'node ./tools/foo/hook.js' }],
        },
      ],
    },
  };
  const r = planRemove(prev);
  assert.equal(r.totalRemoved, 0);
  assert.deepEqual(r.settings, prev);
});

test('planRemove: leaves non-hooks settings keys untouched', () => {
  const prev: Settings = {
    permissions: { allow: ['Skill(foo)'] },
    hooks: {
      SessionStart: [
        { hooks: [{ type: 'command', command: 'node $CLAUDE_PROJECT_DIR/dist/hook.js' }] },
      ],
    },
  };
  const r = planRemove(prev);
  assert.equal(r.totalRemoved, 1);
  assert.deepEqual(r.settings.permissions, { allow: ['Skill(foo)'] });
});

// — install/remove round trip —

test('install → remove round trip: returns to original state', () => {
  const original: Settings = {
    permissions: { allow: ['Skill(foo)'] },
    hooks: {
      PostToolUse: [
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'node ./tools/foo/hook.js' }],
        },
      ],
    },
  };
  const installed = planInstall(original).settings;
  const removed = planRemove(installed).settings;
  assert.deepEqual(removed, original);
});

// — InstallChange shape —

test('InstallChange: matcher field present only for PostToolUse', () => {
  const r = planInstall(null);
  const post = r.changes.find((c) => c.event === 'PostToolUse')!;
  const ses = r.changes.find((c) => c.event === 'SessionStart')!;
  assert.equal(post.matcher, 'Read|Edit|Write|Glob|Grep|Agent');
  assert.equal(ses.matcher, undefined);
});

// — wantedEntry produces correct hook structure —

test('install: SessionStart entry has no matcher field', () => {
  const r = planInstall(null);
  const entry = r.settings.hooks!.SessionStart![0]!;
  assert.equal(entry.matcher, undefined);
  assert.equal(entry.hooks[0]!.type, 'command');
});

// — Argument parsing —

import { parseInitArgs } from '../src/commands/init.js';

test('parseInitArgs: defaults', () => {
  const a = parseInitArgs([]);
  assert.deepEqual(a, { remove: false, purge: false, yes: false });
});

test('parseInitArgs: --remove --purge -y', () => {
  const a = parseInitArgs(['--remove', '--purge', '-y']);
  assert.deepEqual(a, { remove: true, purge: true, yes: true });
});

test('parseInitArgs: --yes equivalent to -y', () => {
  const a = parseInitArgs(['--yes']);
  assert.equal(a.yes, true);
});

// — Sanity helper to ensure HookEntry typing — narrow check on roundtrip
test('install: PostToolUse hook command matches expected env-driven path', () => {
  const r = planInstall(null);
  const cmd = r.settings.hooks!.PostToolUse![0]!.hooks[0]!.command;
  assert.equal(cmd, OUR_CMD);
  // Future-proof: nobody silently bakes in an absolute machine path.
  assert.ok(cmd.includes('$CLAUDE_PROJECT_DIR'));
  // Make TS happy on `HookEntry` import being used at compile time.
  const _typed: HookEntry = r.settings.hooks!.PostToolUse![0]!;
  assert.ok(_typed);
});
