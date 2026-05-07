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
    }
  }
  return out;
}

export function buildFilterState(raw: WatchArgsRaw): FilterState {
  const ext: 'all' | 'md' = raw.md ? 'md' : 'all';
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
  return { ext, tools };
}

export async function runWatch(argv: string[]): Promise<number> {
  const raw = parseWatchArgs(argv);
  const filter = buildFilterState(raw);
  const projectRoot = resolveProjectRoot();
  const eventsPath = eventsLogPath(projectRoot);

  const app = render(
    <Dashboard eventsPath={eventsPath} initialFilter={filter} />,
    { exitOnCtrlC: false },
  );

  await app.waitUntilExit();
  return 0;
}
