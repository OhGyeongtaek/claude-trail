// Path formatting for Stream + TopFiles display.
// Spec: docs/DESIGN.md §7.
//
// Pure string helpers — no Ink/React imports so the function can be unit-tested
// directly without rendering a TUI.

export interface PathSegments {
  /** Directory portion (with trailing slash if non-empty). May be empty. */
  dir: string;
  /** File name. Never empty unless input was empty. */
  base: string;
}

/**
 * Split a normalized relative/absolute path into directory + basename
 * for two-tone rendering ({dim dir}{bold base}).
 *
 *   "src/components/Card.tsx" → { dir: "src/components/", base: "Card.tsx" }
 *   "package.json"            → { dir: "", base: "package.json" }
 *   "."                       → { dir: "", base: "." }
 *   "/abs/path/x.ts"          → { dir: "/abs/path/", base: "x.ts" }
 */
export function splitPath(path: string): PathSegments {
  if (!path) return { dir: '', base: '' };
  if (path === '.') return { dir: '', base: '.' };
  const idx = path.lastIndexOf('/');
  if (idx === -1) return { dir: '', base: path };
  return { dir: path.slice(0, idx + 1), base: path.slice(idx + 1) };
}

/**
 * Truncate a path to fit `maxWidth` characters using middle-ellipsis on the
 * directory portion. Basename is never shortened — if `base` alone exceeds
 * `maxWidth`, returns it unchanged (caller decides what to do).
 *
 *   ("src/components/cards/very/long/path/Card.tsx", 38)
 *   → "src/components/…/long/path/Card.tsx"
 *
 *   ("Card.tsx", 4) → "Card.tsx"  (basename preserved)
 */
export function ellipsizePath(path: string, maxWidth: number): string {
  if (path.length <= maxWidth) return path;
  const { dir, base } = splitPath(path);
  if (!dir) return path;
  if (base.length >= maxWidth) return path;

  const overflow = path.length - maxWidth;
  const dirSegments = dir.replace(/\/$/, '').split('/');
  if (dirSegments.length < 2) return path;

  // Walk inward from the middle, dropping segments until length fits.
  // Replace dropped middle range with "…/".
  let leftIdx = 0;
  let rightIdx = dirSegments.length - 1;
  let trimmed = overflow + 2; // +2 to make room for "…/"
  while (trimmed > 0 && leftIdx < rightIdx - 1) {
    if (leftIdx + 1 <= dirSegments.length - 1 - rightIdx) {
      const dropped = dirSegments[leftIdx + 1] ?? '';
      trimmed -= dropped.length + 1;
      leftIdx++;
    } else {
      const dropped = dirSegments[rightIdx - 1] ?? '';
      trimmed -= dropped.length + 1;
      rightIdx--;
    }
  }
  if (leftIdx >= rightIdx - 1) {
    // Couldn't trim enough — fall back to a hard truncation of the dir.
    const keepDir = Math.max(0, maxWidth - base.length - 2);
    const trimmedDir = dir.slice(0, keepDir).replace(/\/$/, '');
    return `${trimmedDir}…/${base}`;
  }
  const left = dirSegments.slice(0, leftIdx + 1).join('/');
  const right = dirSegments.slice(rightIdx).join('/');
  return `${left}/…/${right}/${base}`;
}
