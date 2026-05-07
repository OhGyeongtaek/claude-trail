// claude-trail hook adapter — stdin → events.jsonl.
// Spec: docs/DESIGN.md §5.1, §11, §13 (v1.0 — M0.5 measurements applied).
//
// This entry is loaded by every Claude Code hook invocation. Cold-start
// budget is hard (§1.1: p95 ≤ 100ms). DO NOT import React, Ink, or any
// of src/ui/** here. Keep this module's import graph minimal.
//
// Contract (§11):
//   - Read JSON from stdin.
//   - Write zero-or-one JSONL line to .claude-trail/events.jsonl.
//   - Always exit 0, even on error. User work must not be blocked.
//
// Capture mode: when env CLAUDE_TRAIL_CAPTURE_DIR is set, every raw stdin
// payload is appended to <dir>/payloads.jsonl alongside hook event name +
// timestamp. Used for fixture generation and field-shape verification.

import { appendFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { HookPayload } from './types.js';
import { mapPayload, dedupKey } from './lib/events.js';
import { resolveProjectRoot, eventsLogPath, trailDir } from './lib/paths.js';

const MAX_STDIN_BYTES = 10 * 1024 * 1024;
const MAX_LINE_BYTES = 1024;
const MAX_LOG_BYTES = 100 * 1024 * 1024; // §13 disk safety net

// In-process dedup cache. Hooks are short-lived processes so this only
// guards against same-process re-entry; cross-process dedup is v0.2.
const seenKeys = new Set<string>();

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > MAX_STDIN_BYTES) {
      chunks.push(chunk.subarray(0, chunk.length - (total - MAX_STDIN_BYTES)));
      break;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function captureRaw(payload: HookPayload): void {
  const captureDir = process.env['CLAUDE_TRAIL_CAPTURE_DIR'];
  if (!captureDir) return;
  try {
    mkdirSync(captureDir, { recursive: true });
    const line = JSON.stringify({
      captured_at: new Date().toISOString(),
      hook_event_name: payload.hook_event_name,
      env_pwd: process.env['PWD'] ?? null,
      env_claude_project_dir: process.env['CLAUDE_PROJECT_DIR'] ?? null,
      payload,
    });
    appendFileSync(join(captureDir, 'payloads.jsonl'), line + '\n');
  } catch {
    // Capture is best-effort.
  }
}

function isUnderSizeLimit(path: string): boolean {
  try {
    return statSync(path).size < MAX_LOG_BYTES;
  } catch {
    return true; // missing = empty
  }
}

function writeEventLine(projectRoot: string, line: string): void {
  const dir = trailDir(projectRoot);
  const file = eventsLogPath(projectRoot);
  if (!isUnderSizeLimit(file)) return;

  // Drop overly large single lines (§11 1KB cap, but allow some slack).
  if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES * 4) return;

  mkdirSync(dir, { recursive: true });
  appendFileSync(file, line + '\n');
}

async function main(): Promise<void> {
  if (process.stdin.isTTY) return;

  let raw = '';
  try {
    raw = await readStdin();
  } catch {
    return;
  }
  if (!raw.trim()) return;

  let payload: HookPayload;
  try {
    payload = JSON.parse(raw) as HookPayload;
  } catch {
    return;
  }

  captureRaw(payload);

  const key = dedupKey(payload);
  if (key !== null) {
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
  }

  const projectRoot = resolveProjectRoot(payload.cwd);
  let event;
  try {
    event = mapPayload(payload, { projectRoot });
  } catch {
    return;
  }
  if (!event) return;

  let line: string;
  try {
    line = JSON.stringify(event);
  } catch {
    return;
  }

  try {
    writeEventLine(projectRoot, line);
  } catch {
    // §13: never block user work on disk failure.
  }
}

main().then(
  () => process.exit(0),
  () => process.exit(0),
);
