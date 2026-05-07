// TUI header — session id, uptime, filter status, counters.
// Spec: docs/DESIGN.md §7.
//
// Layout uses Ink's flexbox + space-between so terminal width math is
// owned by Ink, not us. No ASCII box drawing here — that breaks under
// resize / East-Asian-wide characters.

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
  const ruleWidth = Math.max(0, width - 1);
  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between" width={width}>
        <Text bold>claude-trail · live</Text>
        <Text dimColor>{` filter: ${describeFilter(filter)}`}</Text>
      </Box>
      <Text>
        {session ? `session ${shortId(session)} · uptime ${formatDuration(uptimeSec)}` : 'no active session'}
      </Text>
      <Text>
        {`Reads ${counters.Read}  Edits ${counters.Edit}  Writes ${counters.Write}  Globs ${counters.Glob}  Greps ${counters.Grep}  Tasks ${counters.Task}`}
      </Text>
      <Text dimColor>{'─'.repeat(ruleWidth)}</Text>
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
