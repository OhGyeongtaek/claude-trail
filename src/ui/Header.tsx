// TUI header — session id, uptime, filter status, counters.
// Spec: docs/DESIGN.md §7.
//
// Layout uses Ink's flexbox + space-between so terminal width math is
// owned by Ink, not us. No ASCII box drawing here — that breaks under
// resize / East-Asian-wide characters.

import React from 'react';
import { Box, Text } from 'ink';
import type { Counters, SessionInfo } from './viewState.js';
import type { FilterState } from '../types.js';
import { sessionColor, shortSessionId } from '../lib/sessionColor.js';

export interface HeaderProps {
  session: string | null;
  uptimeSec: number;
  counters: Counters;
  filter: FilterState;
  width: number;
  /** Multi-session info from the reducer. Empty when no events seen yet. */
  sessions?: ReadonlyMap<string, SessionInfo>;
  /** Wall-clock used to compute per-session uptimes. */
  nowMs?: number;
}

const MAX_SESSIONS_SHOWN = 3;

export const Header: React.FC<HeaderProps> = ({
  session,
  uptimeSec,
  counters,
  filter,
  width,
  sessions,
  nowMs,
}) => {
  const ruleWidth = Math.max(0, width - 1);
  const recent = pickRecentSessions(sessions, MAX_SESSIONS_SHOWN);
  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between" width={width}>
        <Text bold>claude-trail · live</Text>
        <Text dimColor>{` filter: ${describeFilter(filter)}`}</Text>
      </Box>
      {recent.length > 0 ? (
        <Text>
          {recent.map((s, i) => {
            const upMs = (nowMs ?? Date.now()) - s.info.firstSeenMs;
            const up = formatDuration(Math.max(0, Math.floor(upMs / 1000)));
            return (
              <React.Fragment key={s.id}>
                {i > 0 ? <Text dimColor>{'  '}</Text> : null}
                <Text color={sessionColor(s.id)}>{`[${shortSessionId(s.id)}]`}</Text>
                <Text>{` ${up}`}</Text>
              </React.Fragment>
            );
          })}
          <Text dimColor>{` · uptime ${formatDuration(uptimeSec)}`}</Text>
        </Text>
      ) : (
        <Text>
          {session ? `session ${shortId(session)} · uptime ${formatDuration(uptimeSec)}` : 'no active session'}
        </Text>
      )}
      <Text>
        {`Reads ${counters.Read}  Edits ${counters.Edit}  Writes ${counters.Write}  Globs ${counters.Glob}  Greps ${counters.Grep}  Tasks ${counters.Task}`}
      </Text>
      <Text dimColor>{'─'.repeat(ruleWidth)}</Text>
    </Box>
  );
};

export function pickRecentSessions(
  sessions: ReadonlyMap<string, SessionInfo> | undefined,
  n: number,
): Array<{ id: string; info: SessionInfo }> {
  if (!sessions || sessions.size === 0) return [];
  return [...sessions.entries()]
    .map(([id, info]) => ({ id, info }))
    .sort((a, b) => b.info.lastSeenMs - a.info.lastSeenMs)
    .slice(0, n);
}

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
  const ext = f.extSet ? `ext=${[...f.extSet].sort().join(',')}` : `ext=${f.ext}`;
  const tools = f.tools === 'all' ? 'tools=all' : `tools=${[...f.tools].join(',')}`;
  return `${ext} ${tools}`;
}
