// JSONL tail watcher — prefill + incremental fs.watch + inode rebinding.
// Spec: docs/DESIGN.md §13.1.
//
// Lifecycle:
//   1. On start: read existing file once, replay last `lookback` lines
//      to onPrefill. Set offset = file.size.
//   2. fs.watch the file → on 'change', stat() → read [offset, size) →
//      buffer + emit complete lines.
//   3. If size < offset: truncate/rotation. Reset to 0.
//   4. If watch unavailable or `polling: true`: stat-poll every
//      `pollIntervalMs`.
//   5. If file missing at start: poll until it exists, then prefill.

import {
  createReadStream,
  promises as fsp,
  statSync,
  watch as fsWatch,
  type FSWatcher,
  type StatsBase,
} from 'node:fs';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { TrailEvent } from '../types.js';

const DEFAULT_LOOKBACK = 1000;
const DEFAULT_POLL_MS = 200;
const MAX_LINE_BYTES = 4096;
const READ_HIGH_WATERMARK = 64 * 1024;

export interface TailOptions {
  path: string;
  lookback?: number;
  pollIntervalMs?: number;
  onEvent: (e: TrailEvent) => void;
  onPrefill?: (events: TrailEvent[]) => void;
  onError?: (msg: string) => void;
  polling?: boolean;
}

export interface TailHandle {
  stop(): void;
  stats: TailStats;
}

export interface TailStats {
  parseErrors: number;
  oversizeDropped: number;
}

interface State {
  offset: number;
  inode: number;
  partial: string;
  watcher: FSWatcher | null;
  pollTimer: NodeJS.Timeout | null;
  stopped: boolean;
}

export function startTail(opts: TailOptions): TailHandle {
  const lookback = opts.lookback ?? DEFAULT_LOOKBACK;
  const pollMs = opts.pollIntervalMs ?? DEFAULT_POLL_MS;
  const stats: TailStats = { parseErrors: 0, oversizeDropped: 0 };
  const state: State = {
    offset: 0,
    inode: -1,
    partial: '',
    watcher: null,
    pollTimer: null,
    stopped: false,
  };

  const ensureDir = (): void => {
    try {
      mkdirSync(dirname(opts.path), { recursive: true });
    } catch {
      /* ignore */
    }
  };
  ensureDir();

  const handleNewBytes = async (
    fromOffset: number,
    toOffset: number,
  ): Promise<void> => {
    if (toOffset <= fromOffset) return;
    await new Promise<void>((resolve) => {
      const stream = createReadStream(opts.path, {
        start: fromOffset,
        end: toOffset - 1,
        encoding: 'utf8',
        highWaterMark: READ_HIGH_WATERMARK,
      });
      stream.on('data', (chunk: string | Buffer) => {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        ingest(text, stats, state, opts);
      });
      stream.on('error', () => {
        opts.onError?.('read-stream error');
        resolve();
      });
      stream.on('end', resolve);
    });
  };

  const refresh = async (): Promise<void> => {
    if (state.stopped) return;
    let st: StatsBase<number> | null = null;
    try {
      st = statSync(opts.path);
    } catch {
      return; // file missing — wait for next tick
    }

    // Inode change → rebind, reset offset
    if (state.inode !== -1 && st.ino !== state.inode) {
      state.offset = 0;
      state.partial = '';
      state.inode = st.ino;
      rebindWatcher(opts.path, state, refresh, opts.onError);
    }
    if (state.inode === -1) state.inode = st.ino;

    if (st.size < state.offset) {
      // truncate or rotation we missed
      state.offset = 0;
      state.partial = '';
    }
    if (st.size > state.offset) {
      const from = state.offset;
      state.offset = st.size;
      try {
        await handleNewBytes(from, st.size);
      } catch (err) {
        opts.onError?.(String(err));
      }
    }
  };

  const initialize = async (): Promise<void> => {
    try {
      await fsp.access(opts.path);
    } catch {
      // File doesn't exist yet — leave offset=0 and let polling discover it.
      opts.onPrefill?.([]);
      armWatchers(opts.path, state, refresh, opts.onError, opts.polling, pollMs);
      return;
    }

    const initial = await prefillFromEnd(opts.path, lookback, stats, opts);
    opts.onPrefill?.(initial.events);
    state.offset = initial.size;
    state.partial = '';
    try {
      state.inode = statSync(opts.path).ino;
    } catch {
      state.inode = -1;
    }
    armWatchers(opts.path, state, refresh, opts.onError, opts.polling, pollMs);
  };

  initialize().catch((err) => opts.onError?.(String(err)));

  return {
    stop(): void {
      state.stopped = true;
      if (state.watcher) {
        try {
          state.watcher.close();
        } catch {
          /* ignore */
        }
        state.watcher = null;
      }
      if (state.pollTimer) {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
      }
    },
    stats,
  };
}

function armWatchers(
  path: string,
  state: State,
  refresh: () => Promise<void>,
  onError: ((m: string) => void) | undefined,
  forcePolling: boolean | undefined,
  pollMs: number,
): void {
  if (state.stopped) return;
  if (!forcePolling) {
    rebindWatcher(path, state, refresh, onError);
  }
  // Polling backstop: catches missed fs.watch events on macOS / Windows.
  state.pollTimer = setInterval(() => {
    refresh().catch((e) => onError?.(String(e)));
  }, pollMs);
  // Trigger one immediate refresh in case the file already grew.
  refresh().catch((e) => onError?.(String(e)));
}

function rebindWatcher(
  path: string,
  state: State,
  refresh: () => Promise<void>,
  onError: ((m: string) => void) | undefined,
): void {
  if (state.watcher) {
    try {
      state.watcher.close();
    } catch {
      /* ignore */
    }
    state.watcher = null;
  }
  try {
    state.watcher = fsWatch(path, () => {
      refresh().catch((e) => onError?.(String(e)));
    });
    state.watcher.on('error', (e) => onError?.(String(e)));
  } catch (e) {
    onError?.(String(e));
    state.watcher = null;
  }
}

function ingest(
  chunk: string,
  stats: TailStats,
  state: State,
  opts: TailOptions,
): void {
  const combined = state.partial + chunk;
  const lines = combined.split('\n');
  state.partial = lines.pop() ?? '';
  for (const line of lines) {
    if (line.length === 0) continue;
    if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
      stats.oversizeDropped++;
      continue;
    }
    const event = parseLine(line);
    if (!event) {
      stats.parseErrors++;
      continue;
    }
    opts.onEvent(event);
  }
}

function parseLine(line: string): TrailEvent | null {
  try {
    const parsed = JSON.parse(line) as TrailEvent;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof (parsed as { tool?: unknown }).tool !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

interface PrefillResult {
  events: TrailEvent[];
  size: number;
}

async function prefillFromEnd(
  path: string,
  lookback: number,
  stats: TailStats,
  opts: TailOptions,
): Promise<PrefillResult> {
  // Simple v0.1 strategy: read whole file, split, take last N parsed events.
  // §13.1 mentions "100 MB in <1s"; for sizes that large we currently skip
  // older events and prefill 0 — TopFiles aggregation will be M3.
  const SAFE_FULL_READ = 8 * 1024 * 1024; // 8 MB
  let stat: StatsBase<number>;
  try {
    stat = await fsp.stat(path);
  } catch {
    return { events: [], size: 0 };
  }
  if (stat.size === 0) return { events: [], size: 0 };
  if (stat.size > SAFE_FULL_READ) {
    return { events: [], size: stat.size };
  }
  let buf: string;
  try {
    buf = await fsp.readFile(path, 'utf8');
  } catch {
    return { events: [], size: stat.size };
  }
  const lines = buf.split('\n');
  const lastN = lines.slice(-1 - lookback);
  const events: TrailEvent[] = [];
  for (const line of lastN) {
    if (!line) continue;
    if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
      stats.oversizeDropped++;
      continue;
    }
    const e = parseLine(line);
    if (!e) {
      stats.parseErrors++;
      continue;
    }
    events.push(e);
  }
  void opts;
  return { events, size: stat.size };
}
