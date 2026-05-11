// Path resolution — project root + absolute→relative normalization.
// Spec: docs/DESIGN.md §5.1.3, §15.

import { isAbsolute, relative, extname, join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { readdirSync, statSync } from 'node:fs';

export interface PathContext {
  /** Effective project root used for relative-path conversion. */
  projectRoot: string;
}

/**
 * Resolve project root from hook payload + env, in the priority order
 * defined in §5.1.3:
 *   1) payload.cwd
 *   2) process.env.CLAUDE_PROJECT_DIR
 *   3) process.cwd()
 */
export function resolveProjectRoot(payloadCwd?: string): string {
  if (payloadCwd && isAbsolute(payloadCwd)) return payloadCwd;
  const envDir = process.env['CLAUDE_PROJECT_DIR'];
  if (envDir && isAbsolute(envDir)) return envDir;
  return process.cwd();
}

export interface NormalizedPath {
  /** Path relative to project root, or absolute if outside. */
  path: string;
  /** Lowercase extension (`.tsx`, `.md`, …). null when missing. */
  ext: string | null;
  /** True when the input was outside the project root. */
  outside: boolean;
}

/**
 * Normalize a file path relative to the project root.
 * - Absolute path inside root → relative path (no leading `./`).
 * - Absolute path outside root → kept absolute, `outside: true`.
 * - Relative path → returned as-is, joined-against-root for outside check.
 */
export function normalizePath(input: string, ctx: PathContext): NormalizedPath {
  const ext = extractExt(input);
  if (!isAbsolute(input)) {
    return { path: input, ext, outside: false };
  }
  const rel = relative(ctx.projectRoot, input);
  const isOutside = rel.startsWith('..') || isAbsolute(rel);
  if (isOutside) {
    return { path: input, ext, outside: true };
  }
  return { path: rel === '' ? '.' : rel, ext, outside: false };
}

function extractExt(p: string): string | null {
  const e = extname(p).toLowerCase();
  return e === '' ? null : e;
}

/** Path to events.jsonl under project root. */
export function eventsLogPath(projectRoot: string): string {
  return `${projectRoot}/.claude-trail/events.jsonl`;
}

/** Path to hook.error.log — used by §13 error fallback. */
export function hookErrorLogPath(projectRoot: string): string {
  return `${projectRoot}/.claude-trail/hook.error.log`;
}

/** Directory holding both event log and error log. */
export function trailDir(projectRoot: string): string {
  return `${projectRoot}/.claude-trail`;
}

// -----------------------------------------------------------------------------
// Ephemeral (per-session, auto-discarded) mode — installed via `init --ephemeral`.
// Data lives outside the project tree and is keyed by Claude session id so a new
// session starts with an empty trail. See docs/DESIGN.md §5.1.4.
// -----------------------------------------------------------------------------

/**
 * Strict session-id validator. Used before any path join to prevent traversal.
 * Claude session ids are UUIDs in practice; we accept the broader set of safe
 * filename chars but reject path separators, dots, and oversize input.
 */
export function isValidSessionId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

/**
 * Root directory for ephemeral trails. Prefers XDG_RUNTIME_DIR (per-user,
 * tmpfs on Linux) and falls back to the OS temp dir.
 */
export function ephemeralRoot(): string {
  const xdg = process.env['XDG_RUNTIME_DIR'];
  if (xdg && isAbsolute(xdg)) return join(xdg, 'claude-trail');
  return join(tmpdir(), 'claude-trail');
}

/** Path to the events log for a single ephemeral session. Throws on bad id. */
export function sessionEventsLogPath(sessionId: string): string {
  if (!isValidSessionId(sessionId)) {
    throw new Error(`invalid session id: ${String(sessionId).slice(0, 32)}`);
  }
  return join(ephemeralRoot(), `${sessionId}.jsonl`);
}

export interface EphemeralSessionInfo {
  sessionId: string;
  path: string;
  mtimeMs: number;
}

/** List ephemeral sessions, newest first. Silently returns [] if dir missing. */
export function listEphemeralSessions(): EphemeralSessionInfo[] {
  const dir = ephemeralRoot();
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: EphemeralSessionInfo[] = [];
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue;
    const sessionId = name.slice(0, -'.jsonl'.length);
    if (!isValidSessionId(sessionId)) continue;
    const path = join(dir, name);
    try {
      out.push({ sessionId, path, mtimeMs: statSync(path).mtimeMs });
    } catch {
      // skip
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}

/** Most-recently-modified ephemeral session, or null. */
export function latestEphemeralSession(): EphemeralSessionInfo | null {
  const list = listEphemeralSessions();
  return list[0] ?? null;
}

/** Path to the user-level (global) settings file. */
export function globalSettingsPath(): string {
  return join(homedir(), '.claude', 'settings.json');
}
