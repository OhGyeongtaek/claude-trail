// Pure view-state reducer — turns a stream of TrailEvents into
// (counters, recent display list, top-files map). Keeps absorption
// policy for /compact byproducts in one place so it's unit-testable.
//
// Spec: docs/DESIGN.md §7 (absorption rules), §8 (filters).

import type { TrailEvent, FileToolName, FilterState } from '../types.js';

export interface Counters {
  Read: number;
  Edit: number;
  Write: number;
  Glob: number;
  Grep: number;
  Task: number;
}

export interface ViewState {
  /** Display-eligible events in arrival order, capped at `streamCap`. */
  events: TrailEvent[];
  /** Cumulative tool-call counters (post-filter, post-absorption). */
  counters: Counters;
  /** path → count, accumulated from Read/Edit/Write only. */
  topFiles: Map<string, number>;
  /** Pending /compact absorption window per session. */
  pendingCompact: Map<string, { tsMs: number }>;
  /** Stream cap (matches TUI height-derived value). */
  streamCap: number;
  /** Active filter state. */
  filter: FilterState;
}

const DEFAULT_STREAM_CAP = 200;
// /compact byproducts (SubagentStop + SessionStart source:"compact") arrive
// within milliseconds of PreCompact in our captures. 30s is a generous slack
// to absorb them without swallowing unrelated events.
const COMPACT_ABSORB_MS = 30_000;

export function initialState(filter: FilterState, streamCap = DEFAULT_STREAM_CAP): ViewState {
  return {
    events: [],
    counters: { Read: 0, Edit: 0, Write: 0, Glob: 0, Grep: 0, Task: 0 },
    topFiles: new Map(),
    pendingCompact: new Map(),
    streamCap,
    filter,
  };
}

/**
 * Apply one event. Returns a new state — caller is responsible for replacing
 * its useState/useReducer slot. State maps are mutated in place for speed
 * but the wrapper object is fresh, so React equality checks still trigger.
 */
export function step(prev: ViewState, e: TrailEvent): ViewState {
  // Absorption pass first: /compact byproducts get dropped from `events`
  // (and counters), but PreCompact itself stays.
  const absorbed = isAbsorbed(e, prev.pendingCompact);
  if (absorbed) {
    return { ...prev };
  }

  // Track PreCompact open-window so subsequent byproducts can be absorbed.
  if (e.tool === '_control' && e.event === 'compact') {
    const ts = parseTs(e.ts);
    prev.pendingCompact.set(e.session, { tsMs: ts });
  }

  // Filter check — control events always pass.
  if (!matchesFilter(e, prev.filter)) {
    return { ...prev };
  }

  // Counters (no control events).
  if (e.tool !== '_control') {
    incCounter(prev.counters, e.tool);
  }
  if (e.tool === 'Read' || e.tool === 'Edit' || e.tool === 'Write') {
    bumpTopFile(prev.topFiles, e.path);
  }

  // Stream window.
  prev.events.push(e);
  if (prev.events.length > prev.streamCap) {
    prev.events.splice(0, prev.events.length - prev.streamCap);
  }

  // Garbage-collect old compact windows.
  pruneCompactWindows(prev.pendingCompact, parseTs(e.ts));

  return { ...prev };
}

// — Absorption —

export function isAbsorbed(
  e: TrailEvent,
  pending: Map<string, { tsMs: number }>,
): boolean {
  if (e.tool !== '_control') return false;
  const win = pending.get(e.session);
  if (!win) return false;
  const tsMs = parseTs(e.ts);
  if (tsMs - win.tsMs > COMPACT_ABSORB_MS) {
    pending.delete(e.session);
    return false;
  }
  if (e.event === 'subagent_stop') {
    const agentType = (e.meta as { agent_type?: string }).agent_type ?? '';
    if (agentType === '') return true;
    return false;
  }
  if (e.event === 'session_start') {
    const source = (e.meta as { source?: string }).source;
    if (source === 'compact') {
      pending.delete(e.session); // window closes after compact restart
      return true;
    }
    return false;
  }
  return false;
}

// — Tool filter presets (issue #2, hotkey `t`) —

/**
 * Cycle order for the `t` hotkey. First entry is the "no filter" baseline so
 * the cycle wraps back to `all` after one full pass.
 * Spec: docs/DESIGN.md §6.
 */
export const TOOL_PRESETS: ReadonlyArray<FilterState['tools']> = [
  'all',
  new Set<FileToolName | 'Task'>(['Read', 'Edit', 'Write']),
  new Set<FileToolName | 'Task'>(['Read']),
  new Set<FileToolName | 'Task'>(['Task']),
];

export function nextToolPreset(current: FilterState['tools']): FilterState['tools'] {
  const i = TOOL_PRESETS.findIndex((p) => sameToolPreset(p, current));
  const next = i < 0 ? 0 : (i + 1) % TOOL_PRESETS.length;
  return TOOL_PRESETS[next]!;
}

function sameToolPreset(a: FilterState['tools'], b: FilterState['tools']): boolean {
  if (a === 'all' || b === 'all') return a === b;
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

// — Filters —

export function matchesFilter(e: TrailEvent, f: FilterState): boolean {
  if (e.tool === '_control') return true;
  if (f.ext === 'md' && e.tool !== 'Task') {
    if (e.ext !== '.md' && e.ext !== '.mdx' && e.ext !== '.markdown') {
      return false;
    }
  }
  if (f.tools !== 'all') {
    if (!f.tools.has(e.tool as FileToolName | 'Task')) return false;
  }
  return true;
}

// — Helpers —

function incCounter(c: Counters, k: keyof Counters): void {
  c[k] = c[k] + 1;
}

function bumpTopFile(map: Map<string, number>, path: string): void {
  map.set(path, (map.get(path) ?? 0) + 1);
}

function parseTs(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function pruneCompactWindows(
  map: Map<string, { tsMs: number }>,
  nowMs: number,
): void {
  for (const [k, v] of map) {
    if (nowMs - v.tsMs > COMPACT_ABSORB_MS) map.delete(k);
  }
}

/** Top-N files derived from topFiles map. */
export function topFilesList(
  map: Map<string, number>,
  n: number,
): Array<{ path: string; count: number }> {
  return [...map.entries()]
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}
