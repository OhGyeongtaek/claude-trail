// TUI header — session id, uptime, filter status, counters.
// Spec: docs/DESIGN.md §7.

import React from 'react';
import { Box, Text } from 'ink';
import type { Counters } from './viewState.js';
import type { FilterState } from '../types.js';

export interface HeaderProps {
  session: string | null;
  uptimeSec: number;
  counters: Counters;
  filter: FilterState;
  width: number;
}

export const Header: React.FC<HeaderProps> = ({
  session,
  uptimeSec,
  counters,
  filter,
  width,
}) => {
  const titleLine = pad(`┌─ claude-trail · live ─── filter: ${describeFilter(filter)} `, width, '─') + '┐';
  const sessionLine = `│ ${session ? `session ${shortId(session)}` : 'no active session'} · uptime ${formatDuration(uptimeSec)}`;
  const counterLine = `│ Reads ${counters.Read}  Edits ${counters.Edit}  Writes ${counters.Write}  Globs ${counters.Glob}  Greps ${counters.Grep}  Tasks ${counters.Task}`;
  const sep = pad('├', width, '─') + '┤';

  return (
    <Box flexDirection="column">
      <Text dimColor>{titleLine}</Text>
      <Text>{padRight(sessionLine, width) + '│'}</Text>
      <Text>{padRight(counterLine, width) + '│'}</Text>
      <Text dimColor>{sep}</Text>
    </Box>
  );
};

export function shortId(id: string): string {
  if (id.length <= 8) return id;
  return id.slice(0, 8) + '…';
}

export function formatDuration(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function describeFilter(f: FilterState): string {
  const ext = `ext=${f.ext}`;
  const tools = f.tools === 'all' ? 'tools=all' : `tools=${[...f.tools].join(',')}`;
  return `${ext} ${tools}`;
}

function padRight(s: string, width: number): string {
  if (s.length >= width) return s.slice(0, width);
  return s + ' '.repeat(width - s.length);
}

function pad(prefix: string, width: number, fill: string): string {
  if (prefix.length >= width) return prefix.slice(0, width);
  return prefix + fill.repeat(width - prefix.length);
}
