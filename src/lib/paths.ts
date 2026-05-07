// Path resolution — project root + absolute→relative normalization.
// Spec: docs/DESIGN.md §5.1.3, §15.

import { isAbsolute, relative, extname } from 'node:path';

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
