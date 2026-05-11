// Pure helpers for `claude-trail replay` — argument parsing + event
// filtering. Kept React-free so unit tests don't pull Ink into tsx.
// Issue #3.

import type { TrailEvent } from '../types.js';
import { promises as fsp } from 'node:fs';

const HHMMSS = /^(\d{1,2}):(\d{2}):(\d{2})$/;

export interface ReplayArgs {
  sessionId: string;
  from?: string;
  to?: string;
  ephemeral?: boolean;
}

export function parseReplayArgs(argv: string[]): ReplayArgs | { error: string } {
  let sessionId: string | undefined;
  let from: string | undefined;
  let to: string | undefined;
  let ephemeral = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--from') {
      from = argv[++i];
    } else if (a === '--to') {
      to = argv[++i];
    } else if (a === '--ephemeral') {
      ephemeral = true;
    } else if (!a.startsWith('-') && !sessionId) {
      sessionId = a;
    }
  }
  if (!sessionId) {
    return { error: 'usage: claude-trail replay <session_id> [--ephemeral] [--from HH:MM:SS] [--to HH:MM:SS]' };
  }
  if (from !== undefined && !HHMMSS.test(from)) {
    return { error: `invalid --from "${from}" (expected HH:MM:SS)` };
  }
  if (to !== undefined && !HHMMSS.test(to)) {
    return { error: `invalid --to "${to}" (expected HH:MM:SS)` };
  }
  const out: ReplayArgs = { sessionId };
  if (from !== undefined) out.from = from;
  if (to !== undefined) out.to = to;
  if (ephemeral) out.ephemeral = true;
  return out;
}

export function filterSession(events: TrailEvent[], sessionId: string): TrailEvent[] {
  return events.filter((e) => e.session === sessionId);
}

/** Apply HH:MM:SS bounds against each event's local-clock time-of-day. */
export function filterTimeSlice(
  events: TrailEvent[],
  from?: string,
  to?: string,
): TrailEvent[] {
  if (!from && !to) return events;
  const fromN = from ? hmsToSeconds(from) : -Infinity;
  const toN = to ? hmsToSeconds(to) : Infinity;
  return events.filter((e) => {
    const d = new Date(e.ts);
    if (Number.isNaN(d.getTime())) return true;
    const sec = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
    return sec >= fromN && sec <= toN;
  });
}

function hmsToSeconds(t: string): number {
  const m = HHMMSS.exec(t);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

export async function loadEvents(path: string): Promise<TrailEvent[]> {
  let buf: string;
  try {
    buf = await fsp.readFile(path, 'utf8');
  } catch {
    return [];
  }
  const out: TrailEvent[] = [];
  for (const line of buf.split('\n')) {
    if (!line) continue;
    try {
      const e = JSON.parse(line) as TrailEvent;
      if (e && typeof (e as { tool?: unknown }).tool === 'string') out.push(e);
    } catch {
      /* skip */
    }
  }
  return out;
}
