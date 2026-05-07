// docs/DESIGN.md §8 — filter integration: seeds events.jsonl,
// runs `claude-trail watch` headlessly, asserts which events render.
//
// Why integration: parseWatchArgs and matchesFilter are covered by
// unit tests, but only an end-to-end run verifies that the wired
// pipeline (cli → watch → Dashboard → reducer → Stream) actually
// applies the filter to the stream view.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(new URL('../', import.meta.url).pathname);
const CLI = join(REPO, 'bin', 'claude-trail.js');

const FIXTURE_LINES = [
  // SessionStart — control event, always passes filters
  {
    ts: '2026-05-07T16:30:00.000Z',
    session: 'demo',
    tool: '_control',
    event: 'session_start',
    meta: { source: 'startup' },
  },
  // 1× Read .ts
  {
    ts: '2026-05-07T16:30:01.000Z',
    session: 'demo',
    tool: 'Read',
    path: 'src/types.ts',
    ext: '.ts',
    meta: { tool_use_id: 'r1' },
  },
  // 1× Read .md
  {
    ts: '2026-05-07T16:30:02.000Z',
    session: 'demo',
    tool: 'Read',
    path: 'README.md',
    ext: '.md',
    meta: { tool_use_id: 'r2' },
  },
  // 1× Edit .ts
  {
    ts: '2026-05-07T16:30:03.000Z',
    session: 'demo',
    tool: 'Edit',
    path: 'src/cli.ts',
    ext: '.ts',
    meta: { tool_use_id: 'e1' },
  },
  // 1× Grep
  {
    ts: '2026-05-07T16:30:04.000Z',
    session: 'demo',
    tool: 'Grep',
    path: 'src/',
    ext: null,
    meta: { tool_use_id: 'g1', query: 'FileEvent' },
  },
  // 1× Task
  {
    ts: '2026-05-07T16:30:05.000Z',
    session: 'demo',
    tool: 'Task',
    meta: {
      tool_use_id: 't1',
      subagent_type: 'Explore',
      description: 'Find OAuth handlers',
      agent_id: 'a1',
    },
  },
];

interface RunResult {
  text: string;
}

async function runWatch(
  args: string[],
  projectRoot: string,
): Promise<RunResult> {
  return new Promise((resolveP, rejectP) => {
    const child = spawn('node', [CLI, 'watch', ...args], {
      cwd: projectRoot,
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        COLUMNS: '120',
        LINES: '30',
        CLAUDE_PROJECT_DIR: projectRoot,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stdout += `[stderr] ${d.toString()}`));
    setTimeout(() => child.kill('SIGTERM'), 1500);
    child.on('close', () => {
      const ansi = /\x1B\[[0-9;?]*[A-Za-z]/g;
      resolveP({ text: stdout.replace(ansi, '') });
    });
    child.on('error', rejectP);
  });
}

function lastFrame(text: string): string {
  const lines = text.split('\n');
  let start = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]?.includes('claude-trail · live')) {
      start = i;
      break;
    }
  }
  return lines.slice(start).join('\n');
}

async function makeProject(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'ct-filter-'));
  await fsp.mkdir(join(dir, '.claude-trail'), { recursive: true });
  const lines = FIXTURE_LINES.map((e) => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(join(dir, '.claude-trail', 'events.jsonl'), lines, 'utf8');
  return dir;
}

// — default: no filter →  all events ----------------------------------

test('integration: default filter shows every event', async () => {
  const dir = await makeProject();
  try {
    const { text } = await runWatch([], dir);
    const frame = lastFrame(text);
    assert.match(frame, /session start/);
    assert.match(frame, /src\/types\.ts/);
    assert.match(frame, /README\.md/);
    assert.match(frame, /src\/cli\.ts/);
    assert.match(frame, /GREP\s+"FileEvent"/);
    assert.match(frame, /TASK.*Explore/);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

// — --md: only markdown file events; control + Task pass too -----------

test('integration: --md drops .ts files but keeps .md, control, and Task', async () => {
  const dir = await makeProject();
  try {
    const { text } = await runWatch(['--md'], dir);
    const frame = lastFrame(text);
    // .md file kept
    assert.match(frame, /README\.md/);
    // .ts files dropped
    assert.doesNotMatch(frame, /src\/types\.ts/);
    assert.doesNotMatch(frame, /src\/cli\.ts/);
    // control events always pass
    assert.match(frame, /session start/);
    // Task is exempt from ext filter (per matchesFilter)
    assert.match(frame, /TASK.*Explore/);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

// — --tools Read: only Read + control --------------------------------

test('integration: --tools Read keeps only Read events (control passes)', async () => {
  const dir = await makeProject();
  try {
    const { text } = await runWatch(['--tools', 'Read'], dir);
    const frame = lastFrame(text);
    // Two Read paths present
    assert.match(frame, /src\/types\.ts/);
    assert.match(frame, /README\.md/);
    // Edit / Grep / Task suppressed
    assert.doesNotMatch(frame, /EDIT\s+src\/cli\.ts/);
    assert.doesNotMatch(frame, /GREP\s+"FileEvent"/);
    assert.doesNotMatch(frame, /TASK.*Explore/);
    // Control still visible
    assert.match(frame, /session start/);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

// — --tools Read,Task: Read + Task + control --------------------------

test('integration: --tools Read,Task keeps both, drops Edit/Grep', async () => {
  const dir = await makeProject();
  try {
    const { text } = await runWatch(['--tools', 'Read,Task'], dir);
    const frame = lastFrame(text);
    assert.match(frame, /src\/types\.ts/);
    assert.match(frame, /TASK.*Explore/);
    assert.doesNotMatch(frame, /EDIT\s+src\/cli\.ts/);
    assert.doesNotMatch(frame, /GREP\s+"FileEvent"/);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

// — --md combined with --tools Read: AND semantics --------------------

test('integration: --md --tools Read keeps only Read .md (intersection)', async () => {
  const dir = await makeProject();
  try {
    const { text } = await runWatch(['--md', '--tools', 'Read'], dir);
    const frame = lastFrame(text);
    // The only file matching BOTH is README.md
    assert.match(frame, /README\.md/);
    assert.doesNotMatch(frame, /src\/types\.ts/);  // Read but .ts
    assert.doesNotMatch(frame, /src\/cli\.ts/);    // Edit + .ts
    assert.doesNotMatch(frame, /GREP/);            // not Read
    // Task is exempt from ext, but tools filter excludes it
    assert.doesNotMatch(frame, /TASK.*Explore/);
    // Control passes both
    assert.match(frame, /session start/);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

// — header reflects active filter --------------------------------------

test('integration: header shows the active filter spec', async () => {
  const dir = await makeProject();
  try {
    const { text } = await runWatch(['--md', '--tools', 'Read,Edit'], dir);
    const frame = lastFrame(text);
    assert.match(frame, /ext=md/);
    assert.match(frame, /tools=Read,Edit/);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
