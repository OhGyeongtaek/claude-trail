// Stable per-session color + short id derivation. Issue #1.
//
// FNV-1a 32-bit hash of the session id, modulo an 8-color palette tuned to
// avoid red/green ambiguity (CVD-friendly) and keep brightness even.

const PALETTE: ReadonlyArray<string> = [
  'cyan',
  'yellow',
  'magenta',
  'blue',
  'cyanBright',
  'yellowBright',
  'magentaBright',
  'blueBright',
];

export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function sessionColor(sessionId: string): string {
  const h = fnv1a32(sessionId);
  return PALETTE[h % PALETTE.length]!;
}

/** Stable 4-char prefix for inline session tagging. */
export function shortSessionId(sessionId: string): string {
  if (sessionId.length <= 4) return sessionId;
  return sessionId.slice(0, 4);
}

export const SESSION_PALETTE = PALETTE;
