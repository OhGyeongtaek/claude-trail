// docs/DESIGN.md §5, §5.1 — HookPayload → TrailEvent mapper.
// Uses real M0.5 captures as fixtures (tests/fixtures/captured-payloads.jsonl).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  mapPayload,
  dedupKey,
  normalizeToolName,
  isCapturedTool,
} from '../src/lib/events.js';
import type {
  HookPayload,
  PostToolUsePayload,
  SessionStartPayload,
  SessionEndPayload,
  PreCompactPayload,
  SubagentStopPayload,
  FileEvent,
  TaskEvent,
  ControlEvent,
} from '../src/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, 'fixtures', 'captured-payloads.jsonl');

interface CaptureLine {
  captured_at: string;
  hook_event_name: string;
  payload: HookPayload;
}

function loadFixtures(): CaptureLine[] {
  return readFileSync(fixturePath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as CaptureLine);
}

const PROJECT_ROOT = '/Users/ogyeongtaeg/projects/claude-trail';
const ctx = { projectRoot: PROJECT_ROOT };

// — toolname normalization —

test('normalizeToolName: Agent → Task', () => {
  assert.equal(normalizeToolName('Agent'), 'Task');
});

test('normalizeToolName: passthrough for file tools', () => {
  for (const t of ['Read', 'Edit', 'Write', 'Glob', 'Grep']) {
    assert.equal(normalizeToolName(t), t);
  }
});

test('isCapturedTool: whitelist', () => {
  for (const t of ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Agent']) {
    assert.equal(isCapturedTool(t), true);
  }
  for (const t of ['Bash', 'WebFetch', 'NotebookEdit']) {
    assert.equal(isCapturedTool(t), false);
  }
});

// — dedup —

test('dedupKey: PostToolUse → "session:tool_use_id"', () => {
  const p: PostToolUsePayload = {
    session_id: 'sess-1',
    transcript_path: '/tmp/x',
    cwd: PROJECT_ROOT,
    hook_event_name: 'PostToolUse',
    tool_name: 'Read',
    tool_input: { file_path: '/tmp/foo.ts' },
    tool_use_id: 'toolu_AAAA',
  };
  assert.equal(dedupKey(p), 'sess-1:toolu_AAAA');
});

test('dedupKey: non-PostToolUse → null', () => {
  const p: SessionStartPayload = {
    session_id: 's',
    transcript_path: '/tmp/x',
    cwd: PROJECT_ROOT,
    hook_event_name: 'SessionStart',
    source: 'startup',
  };
  assert.equal(dedupKey(p), null);
});

// — Read mapping —

test('PostToolUse Read: relative path + lines + tool_use_id', () => {
  const p: PostToolUsePayload = {
    session_id: 'sess-1',
    transcript_path: '/tmp/x',
    cwd: PROJECT_ROOT,
    hook_event_name: 'PostToolUse',
    tool_name: 'Read',
    tool_input: {
      file_path: `${PROJECT_ROOT}/src/types.ts`,
      offset: 1,
      limit: 200,
    },
    tool_response: { type: 'text', file: { totalLines: 157 } },
    tool_use_id: 'toolu_R1',
    duration_ms: 3,
  };
  const e = mapPayload(p, ctx) as FileEvent;
  assert.equal(e.tool, 'Read');
  assert.equal(e.path, 'src/types.ts');
  assert.equal(e.ext, '.ts');
  assert.equal(e.session, 'sess-1');
  assert.equal(e.meta.tool_use_id, 'toolu_R1');
  assert.equal((e.meta as { offset?: number }).offset, 1);
  assert.equal((e.meta as { lines?: number }).lines, 157);
  assert.equal(e.meta.duration_ms, 3);
});

test('PostToolUse Read: absolute path outside root → outside flag', () => {
  const p: PostToolUsePayload = {
    session_id: 's',
    transcript_path: '/tmp/x',
    cwd: PROJECT_ROOT,
    hook_event_name: 'PostToolUse',
    tool_name: 'Read',
    tool_input: { file_path: '/etc/hosts' },
    tool_use_id: 'toolu_R2',
  };
  const e = mapPayload(p, ctx) as FileEvent;
  assert.equal(e.path, '/etc/hosts');
  assert.equal(e.meta.outside, true);
});

// — Edit / Write —

test('PostToolUse Edit: replace_all in meta', () => {
  const p: PostToolUsePayload = {
    session_id: 's',
    transcript_path: '/tmp/x',
    cwd: PROJECT_ROOT,
    hook_event_name: 'PostToolUse',
    tool_name: 'Edit',
    tool_input: {
      file_path: `${PROJECT_ROOT}/src/cli.ts`,
      old_string: 'OLD',
      new_string: 'NEW',
      replace_all: true,
    },
    tool_use_id: 'toolu_E1',
  };
  const e = mapPayload(p, ctx) as FileEvent;
  assert.equal(e.tool, 'Edit');
  assert.equal((e.meta as { replace_all?: boolean }).replace_all, true);
  assert.ok(!('old_string' in e.meta));
  assert.ok(!('new_string' in e.meta));
});

test('PostToolUse Write: content body dropped, bytes counted', () => {
  const content = 'hello world';
  const p: PostToolUsePayload = {
    session_id: 's',
    transcript_path: '/tmp/x',
    cwd: PROJECT_ROOT,
    hook_event_name: 'PostToolUse',
    tool_name: 'Write',
    tool_input: { file_path: `${PROJECT_ROOT}/x.txt`, content },
    tool_use_id: 'toolu_W1',
  };
  const e = mapPayload(p, ctx) as FileEvent;
  assert.equal((e.meta as { bytes?: number }).bytes, content.length);
  assert.ok(!('content' in e.meta));
});

// — Glob / Grep —

test('PostToolUse Grep: query + glob preserved (intent), ext null', () => {
  const p: PostToolUsePayload = {
    session_id: 's',
    transcript_path: '/tmp/x',
    cwd: PROJECT_ROOT,
    hook_event_name: 'PostToolUse',
    tool_name: 'Grep',
    tool_input: { pattern: 'useState', path: 'src/', glob: '*.tsx', type: 'tsx' },
    tool_use_id: 'toolu_G1',
  };
  const e = mapPayload(p, ctx) as FileEvent;
  assert.equal(e.tool, 'Grep');
  assert.equal(e.path, 'src/');
  assert.equal(e.ext, null);
  assert.equal((e.meta as { query?: string }).query, 'useState');
  assert.equal((e.meta as { glob?: string }).glob, '*.tsx');
});

// — Agent (Task) —

test('PostToolUse Agent → tool:Task with subagent metadata', () => {
  const p: PostToolUsePayload = {
    session_id: 's',
    transcript_path: '/tmp/x',
    cwd: PROJECT_ROOT,
    hook_event_name: 'PostToolUse',
    tool_name: 'Agent',
    tool_input: {
      description: 'Find OAuth handlers',
      prompt: 'long prompt body...',
      subagent_type: 'Explore',
    },
    tool_response: { agentId: 'a7d9ed34b488363a3' },
    tool_use_id: 'toolu_T1',
    duration_ms: 5135,
  };
  const e = mapPayload(p, ctx) as TaskEvent;
  assert.equal(e.tool, 'Task');
  assert.equal(e.meta.subagent_type, 'Explore');
  assert.equal(e.meta.description, 'Find OAuth handlers');
  assert.equal(e.meta.agent_id, 'a7d9ed34b488363a3');
  assert.equal(e.meta.tool_use_id, 'toolu_T1');
  assert.equal(e.meta.duration_ms, 5135);
  // Prompt body should never leak into events.
  const json = JSON.stringify(e);
  assert.ok(!json.includes('long prompt body'));
});

test('Agent without explicit description: derives from prompt prefix (≤80 chars)', () => {
  const p: PostToolUsePayload = {
    session_id: 's',
    transcript_path: '/tmp/x',
    cwd: PROJECT_ROOT,
    hook_event_name: 'PostToolUse',
    tool_name: 'Agent',
    tool_input: {
      prompt: 'A '.repeat(100),
      subagent_type: 'Explore',
    },
    tool_response: { agentId: 'aid' },
    tool_use_id: 'toolu_T2',
  };
  const e = mapPayload(p, ctx) as TaskEvent;
  assert.ok(e.meta.description.length <= 80);
});

// — Subagent inner tool call gets agent_id/agent_type —

test('PostToolUse Read by subagent: agent_id/agent_type attached to meta', () => {
  const p: PostToolUsePayload = {
    session_id: 'parent-sess',
    transcript_path: '/tmp/x',
    cwd: PROJECT_ROOT,
    hook_event_name: 'PostToolUse',
    tool_name: 'Read',
    tool_input: { file_path: `${PROJECT_ROOT}/src/types.ts` },
    tool_use_id: 'toolu_inner',
    agent_id: 'a7d9ed34b488363a3',
    agent_type: 'Explore',
  };
  const e = mapPayload(p, ctx) as FileEvent;
  assert.equal(e.session, 'parent-sess');
  assert.equal(e.meta.agent_id, 'a7d9ed34b488363a3');
  assert.equal(e.meta.agent_type, 'Explore');
});

// — control events —

test('SessionStart source=compact accepted (M0.5 finding)', () => {
  const p: SessionStartPayload = {
    session_id: 's',
    transcript_path: '/tmp/x',
    cwd: PROJECT_ROOT,
    hook_event_name: 'SessionStart',
    source: 'compact',
    model: 'claude-opus-4-7[1m]',
  };
  const e = mapPayload(p, ctx) as ControlEvent;
  assert.equal(e.tool, '_control');
  assert.equal(e.event, 'session_start');
  assert.equal((e.meta as { source: string }).source, 'compact');
  assert.equal((e.meta as { model?: string }).model, 'claude-opus-4-7[1m]');
});

test('SessionEnd reason=other (headless exit)', () => {
  const p: SessionEndPayload = {
    session_id: 's',
    transcript_path: '/tmp/x',
    cwd: PROJECT_ROOT,
    hook_event_name: 'SessionEnd',
    reason: 'other',
  };
  const e = mapPayload(p, ctx) as ControlEvent;
  assert.equal(e.event, 'session_end');
  assert.equal((e.meta as { reason: string }).reason, 'other');
});

test('PreCompact trigger preserved, custom_instructions never stored', () => {
  const p: PreCompactPayload = {
    session_id: 's',
    transcript_path: '/tmp/x',
    cwd: PROJECT_ROOT,
    hook_event_name: 'PreCompact',
    trigger: 'manual',
    custom_instructions: 'this should never be stored',
  };
  const e = mapPayload(p, ctx) as ControlEvent;
  assert.equal(e.event, 'compact');
  assert.equal((e.meta as { trigger: string }).trigger, 'manual');
  const json = JSON.stringify(e);
  assert.ok(!json.includes('this should never be stored'));
});

test('SubagentStop with agent_type:"" (compact byproduct) still records', () => {
  const p: SubagentStopPayload = {
    session_id: 's',
    transcript_path: '/tmp/x',
    cwd: PROJECT_ROOT,
    hook_event_name: 'SubagentStop',
    agent_id: 'a1ad0f0c800fcd826',
    agent_type: '',
    last_assistant_message: 'huge summary body',
  };
  const e = mapPayload(p, ctx) as ControlEvent;
  assert.equal(e.event, 'subagent_stop');
  assert.equal((e.meta as { agent_type: string }).agent_type, '');
  // last_assistant_message must never be stored (privacy).
  const json = JSON.stringify(e);
  assert.ok(!json.includes('huge summary body'));
});

// — fixture-driven smoke: every captured payload either maps to a TrailEvent
//   or returns null (never throws) —

test('fixture: every captured payload is mapped or skipped without throwing', () => {
  const fixtures = loadFixtures();
  let mapped = 0;
  let skipped = 0;
  for (const f of fixtures) {
    const e = mapPayload(f.payload, ctx);
    if (e === null) {
      skipped++;
    } else {
      mapped++;
      // Sanity: serializable, never includes giant captured bodies.
      const json = JSON.stringify(e);
      assert.ok(json.length < 4096, `event too large for ${f.hook_event_name}`);
    }
  }
  assert.ok(mapped > 0, 'at least one fixture should map');
  assert.equal(mapped + skipped, fixtures.length);
});

test('fixture: PostToolUse Read content body never leaks into mapped event', () => {
  const fixtures = loadFixtures();
  const reads = fixtures.filter(
    (f) =>
      f.hook_event_name === 'PostToolUse' &&
      (f.payload as PostToolUsePayload).tool_name === 'Read',
  );
  assert.ok(reads.length > 0, 'fixture should contain at least one Read');
  for (const f of reads) {
    const e = mapPayload(f.payload, ctx) as FileEvent;
    const json = JSON.stringify(e);
    // Real fixture file content includes "claude-trail event schema"
    // (from src/types.ts) — make sure that string is dropped.
    assert.ok(
      !json.includes('claude-trail event schema'),
      'Read tool_response.content must be dropped',
    );
  }
});

test('fixture: Agent payload normalized to tool=Task, agentId pulled from response', () => {
  const fixtures = loadFixtures();
  const agentCalls = fixtures.filter(
    (f) =>
      f.hook_event_name === 'PostToolUse' &&
      (f.payload as PostToolUsePayload).tool_name === 'Agent',
  );
  assert.ok(agentCalls.length > 0, 'fixture should include an Agent call');
  for (const f of agentCalls) {
    const e = mapPayload(f.payload, ctx) as TaskEvent;
    assert.equal(e.tool, 'Task');
    assert.ok(e.meta.agent_id.length > 0, 'agent_id required');
    assert.ok(e.meta.subagent_type.length > 0, 'subagent_type required');
  }
});
