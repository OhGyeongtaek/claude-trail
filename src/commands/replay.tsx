// `claude-trail replay <session_id>` — non-live walkthrough of a finished
// session. Reads events.jsonl, filters by session, plays back with
// adjustable speed. Spec: docs/DESIGN.md §6, issue #3.

import React, { useEffect, useState } from 'react';
import { Box, Text, render, useApp, useInput, useStdout } from 'ink';
import type { TrailEvent } from '../types.js';
import { resolveProjectRoot, eventsLogPath } from '../lib/paths.js';
import { Stream } from '../ui/Stream.js';
import {
  parseReplayArgs,
  filterSession,
  filterTimeSlice,
  loadEvents,
} from './replayArgs.js';

const SPEEDS: ReadonlyArray<number> = [0.25, 0.5, 1, 2, 4, 8];
const BASE_INTERVAL_MS = 400;

export async function runReplay(argv: string[]): Promise<number> {
  const parsed = parseReplayArgs(argv);
  if ('error' in parsed) {
    process.stderr.write(`claude-trail replay: ${parsed.error}\n`);
    return 2;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write('claude-trail replay: requires a TTY\n');
    return 2;
  }

  const projectRoot = resolveProjectRoot();
  const path = eventsLogPath(projectRoot);
  const all = await loadEvents(path);
  const sessionEvents = filterTimeSlice(
    filterSession(all, parsed.sessionId),
    parsed.from,
    parsed.to,
  );

  if (sessionEvents.length === 0) {
    process.stderr.write(
      `claude-trail replay: no events found for session "${parsed.sessionId}"\n`,
    );
    return 1;
  }

  const app = render(<Replay events={sessionEvents} sessionId={parsed.sessionId} />, {
    exitOnCtrlC: false,
  });
  await app.waitUntilExit();
  return 0;
}

const Replay: React.FC<{ events: TrailEvent[]; sessionId: string }> = ({
  events,
  sessionId,
}) => {
  const total = events.length;
  const [index, setIndex] = useState<number>(1);
  const [playing, setPlaying] = useState<boolean>(true);
  const [speedIdx, setSpeedIdx] = useState<number>(SPEEDS.indexOf(1));
  const { exit } = useApp();
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 100;
  const rows = stdout?.rows ?? 24;
  const streamHeight = Math.max(3, rows - 5);

  useEffect(() => {
    if (!playing) return;
    if (index >= total) return;
    const interval = BASE_INTERVAL_MS / SPEEDS[speedIdx]!;
    const t = setTimeout(() => setIndex((i) => Math.min(total, i + 1)), interval);
    return () => clearTimeout(t);
  }, [playing, index, speedIdx, total]);

  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit();
    } else if (input === ' ') {
      setPlaying((p) => !p);
    } else if (key.rightArrow) {
      setPlaying(false);
      setIndex((i) => Math.min(total, i + 1));
    } else if (key.leftArrow) {
      setPlaying(false);
      setIndex((i) => Math.max(1, i - 1));
    } else if (input === '+' || input === '=') {
      setSpeedIdx((i) => Math.min(SPEEDS.length - 1, i + 1));
    } else if (input === '-' || input === '_') {
      setSpeedIdx((i) => Math.max(0, i - 1));
    }
  });

  const visible = events.slice(0, index);
  const speed = SPEEDS[speedIdx]!;
  const ruleWidth = Math.max(0, cols - 1);
  const done = index >= total;

  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between" width={cols}>
        <Text bold>{`claude-trail · replay ${shortId(sessionId)}`}</Text>
        <Text dimColor>{`${index}/${total}  ${speed}×  ${playing && !done ? '▶' : done ? '■' : '⏸'}`}</Text>
      </Box>
      <Text dimColor>{'─'.repeat(ruleWidth)}</Text>
      <Stream events={visible} width={cols} height={streamHeight} />
      <Text dimColor>{'─'.repeat(ruleWidth)}</Text>
      <Text dimColor>q quit · space pause · ←/→ step · +/- speed</Text>
    </Box>
  );
};

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) + '…' : id;
}
