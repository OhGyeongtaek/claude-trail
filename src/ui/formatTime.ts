// Tiny ISO → local HH:MM:SS helper.
// Spec: docs/DESIGN.md §7.

export function formatLocalTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--:--';
  const h = pad2(d.getHours());
  const m = pad2(d.getMinutes());
  const s = pad2(d.getSeconds());
  return `${h}:${m}:${s}`;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}
