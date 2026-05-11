// `claude-trail prune` — remove old ephemeral session logs.

import { rmSync } from 'node:fs';
import { listEphemeralSessions } from '../lib/paths.js';

const DEFAULT_AGE_MS = 24 * 60 * 60 * 1000;

export function parsePruneArgs(argv: string[]): { olderThanMs: number } | { error: string } {
  let olderThanMs = DEFAULT_AGE_MS;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--older-than') {
      const v = argv[++i];
      if (!v) return { error: '--older-than requires a value (e.g. 24h)' };
      const ms = parseDuration(v);
      if (ms === null) return { error: `invalid duration: ${v}` };
      olderThanMs = ms;
    }
  }
  return { olderThanMs };
}

function parseDuration(s: string): number | null {
  const m = /^(\d+)(s|m|h|d)$/.exec(s);
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  const mult = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 's' | 'm' | 'h' | 'd'];
  return n * mult;
}

export async function runPrune(argv: string[]): Promise<number> {
  const parsed = parsePruneArgs(argv);
  if ('error' in parsed) {
    process.stderr.write(`claude-trail prune: ${parsed.error}\n`);
    return 2;
  }

  const cutoff = Date.now() - parsed.olderThanMs;
  const targets = listEphemeralSessions().filter((s) => s.mtimeMs < cutoff);

  for (const t of targets) {
    try {
      rmSync(t.path, { force: true });
      process.stdout.write(`removed ${t.path}\n`);
    } catch (err) {
      process.stderr.write(
        `failed to remove ${t.path}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
  return 0;
}
