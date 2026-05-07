// `claude-trail watch` — bootstraps the Ink dashboard.
// Spec: docs/DESIGN.md §6, §7.

import React from 'react';
import { render } from 'ink';
import { Dashboard } from '../ui/Dashboard.js';
import { resolveProjectRoot, eventsLogPath } from '../lib/paths.js';
import type { FilterState, FileToolName } from '../types.js';

export interface WatchOptions {
  ext: 'all' | 'md';
  tools: ReadonlySet<FileToolName | 'Task'> | 'all';
}


export interface WatchArgsRaw {
  md?: boolean;
  all?: boolean;
  tools?: string;
  /** Raw `--ext` value (e.g. ".ts,.tsx"). Issue #4. */
  ext?: string;
  /** Raw `--since` value (e.g. "30m"). Issue #4. */
  since?: string;
}

export function parseWatchArgs(argv: string[]): WatchArgsRaw {
  const out: WatchArgsRaw = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--md') out.md = true;
    else if (a === '--all') out.all = true;
    else if (a === '--tools') {
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        out.tools = next;
        i++;
      }
    } else if (a === '--ext') {
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        out.ext = next;
        i++;
      }
    } else if (a === '--since') {
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        out.since = next;
        i++;
      }
    }
  }
  return out;
}

/**
 * Parse `--since <N><unit>` (s/m/h/d) into milliseconds.
 * Returns null on invalid input.
 */
export function parseDuration(s: string): number | null {
  const m = /^(\d+)(s|m|h|d)$/.exec(s);
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  const mult = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 's' | 'm' | 'h' | 'd'];
  return n * mult;
}

/**
 * Parse `--ext .ts,.tsx` into a Set of normalized extensions.
 * Each entry must start with `.`; invalid entries are dropped silently.
 * Returns null when no valid extension was found (caller should ignore the flag).
 */
export function parseExtList(s: string): ReadonlySet<string> | null {
  const out = new Set<string>();
  for (const raw of s.split(',').map((x) => x.trim()).filter(Boolean)) {
    if (!raw.startsWith('.')) continue;
    out.add(raw.toLowerCase());
  }
  return out.size > 0 ? out : null;
}

export function buildFilterState(raw: WatchArgsRaw): FilterState {
  // --ext takes precedence over --md.
  let extSet: ReadonlySet<string> | undefined;
  if (raw.ext) {
    const parsed = parseExtList(raw.ext);
    if (parsed) extSet = parsed;
  }
  const ext: 'all' | 'md' = !extSet && raw.md ? 'md' : 'all';
  let tools: FilterState['tools'] = 'all';
  if (raw.tools) {
    const allowed = new Set<FileToolName | 'Task'>();
    for (const t of raw.tools.split(',').map((s) => s.trim()).filter(Boolean)) {
      if (
        t === 'Read' ||
        t === 'Edit' ||
        t === 'Write' ||
        t === 'Glob' ||
        t === 'Grep' ||
        t === 'Task'
      ) {
        allowed.add(t);
      }
    }
    if (allowed.size > 0) tools = allowed;
  }
  return extSet ? { ext, tools, extSet } : { ext, tools };
}

export async function runWatch(argv: string[]): Promise<number> {
  const raw = parseWatchArgs(argv);
  const filter = buildFilterState(raw);
  const projectRoot = resolveProjectRoot();
  const eventsPath = eventsLogPath(projectRoot);

  let sinceCutoffMs: number | undefined;
  if (raw.since) {
    const dur = parseDuration(raw.since);
    if (dur === null) {
      process.stderr.write(
        `claude-trail: invalid --since "${raw.since}" (expected e.g. 30m, 1h, 2d)\n`,
      );
      return 2;
    }
    sinceCutoffMs = Date.now() - dur;
  }

  const app = render(
    sinceCutoffMs !== undefined ? (
      <Dashboard
        eventsPath={eventsPath}
        initialFilter={filter}
        sinceCutoffMs={sinceCutoffMs}
      />
    ) : (
      <Dashboard eventsPath={eventsPath} initialFilter={filter} />
    ),
    { exitOnCtrlC: false },
  );

  await app.waitUntilExit();
  return 0;
}
