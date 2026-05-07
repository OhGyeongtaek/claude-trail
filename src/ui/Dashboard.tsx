// Top-level Ink dashboard. Wires Header + Stream against the view-state
// reducer driven by lib/tail.ts. Spec: docs/DESIGN.md §7.

import React, { useEffect, useReducer, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import type { TrailEvent, FilterState } from '../types.js';
import {
  initialState,
  step,
  type ViewState,
} from './viewState.js';
import { Header } from './Header.js';
import { Stream } from './Stream.js';
import { startTail, type TailHandle, type TailStats } from '../lib/tail.js';

export interface DashboardProps {
  eventsPath: string;
  initialFilter: FilterState;
  /** For tests — lets caller seed events without fs.watch. */
  testHarness?: {
    onReady: (push: (e: TrailEvent) => void) => void;
  };
}

type Action =
  | { type: 'add'; event: TrailEvent }
  | { type: 'addPrefill'; events: TrailEvent[] }
  | { type: 'cycleExt' };

function reducer(state: ViewState, action: Action): ViewState {
  switch (action.type) {
    case 'add':
      return step(state, action.event);
    case 'addPrefill': {
      let next = state;
      for (const e of action.events) next = step(next, e);
      return next;
    }
    case 'cycleExt': {
      const next: FilterState = {
        ...state.filter,
        ext: state.filter.ext === 'all' ? 'md' : 'all',
      };
      return { ...state, filter: next };
    }
  }
}

export const Dashboard: React.FC<DashboardProps> = ({
  eventsPath,
  initialFilter,
  testHarness,
}) => {
  const [state, dispatch] = useReducer(reducer, initialState(initialFilter));
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [startedAt] = useState<number>(Date.now());
  const [now, setNow] = useState<number>(Date.now());
  const [tailErrors, setTailErrors] = useState<number>(0);
  const [tailStats, setTailStats] = useState<TailStats>({
    parseErrors: 0,
    oversizeDropped: 0,
  });
  const { exit } = useApp();
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 100;
  const rows = stdout?.rows ?? 24;

  // Width policy (§7): minimum 60 columns.
  const tooNarrow = cols < 60;

  // Tail wiring.
  useEffect(() => {
    if (testHarness) {
      testHarness.onReady((e) => {
        dispatch({ type: 'add', event: e });
        if (e.tool !== '_control') setActiveSession(e.session);
        else if (e.event === 'session_start') setActiveSession(e.session);
      });
      return () => {};
    }
    let tail: TailHandle | null = null;
    try {
      tail = startTail({
        path: eventsPath,
        onPrefill: (events) => {
          dispatch({ type: 'addPrefill', events });
          const last = events[events.length - 1];
          if (last) setActiveSession(last.session);
        },
        onEvent: (e) => {
          dispatch({ type: 'add', event: e });
          if (e.tool === '_control' && e.event === 'session_start') {
            setActiveSession(e.session);
          } else if (e.tool !== '_control') {
            setActiveSession(e.session);
          }
        },
        onError: () => setTailErrors((c) => c + 1),
      });
    } catch {
      setTailErrors((c) => c + 1);
    }
    const statsTimer = setInterval(() => {
      if (tail) setTailStats({ ...tail.stats });
    }, 1000);
    return () => {
      clearInterval(statsTimer);
      if (tail) tail.stop();
    };
  }, [eventsPath, testHarness]);

  // Uptime tick.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useInput(
    (input, key) => {
      if (input === 'q' || (key.ctrl && input === 'c')) {
        exit();
      } else if (input === 'f') {
        dispatch({ type: 'cycleExt' });
      }
    },
    { isActive: !!process.stdin.isTTY },
  );

  if (tooNarrow) {
    return <Text>claude-trail: terminal too narrow (need ≥60 cols)</Text>;
  }

  // Reserve rows: header(4) + footer(1) + slack(1) = 6 → stream gets rows-6.
  const streamHeight = Math.max(3, rows - 6);
  const uptimeSec = Math.floor((now - startedAt) / 1000);

  return (
    <Box flexDirection="column">
      <Header
        session={activeSession}
        uptimeSec={uptimeSec}
        counters={state.counters}
        filter={state.filter}
        width={cols}
      />
      <Stream events={state.events} width={cols} height={streamHeight} />
      <Footer
        width={cols}
        errors={tailErrors}
        parseErrors={tailStats.parseErrors}
        oversize={tailStats.oversizeDropped}
      />
    </Box>
  );
};

const Footer: React.FC<{
  width: number;
  errors: number;
  parseErrors: number;
  oversize: number;
}> = ({ width, errors, parseErrors, oversize }) => {
  const left = ' q quit · f ext-filter ';
  const right =
    errors + parseErrors + oversize > 0
      ? `errs:${errors} parse:${parseErrors} drop:${oversize}`
      : '';
  const hint = `└${left}${'─'.repeat(Math.max(0, width - left.length - right.length - 2))}${right}─┘`;
  return <Text dimColor>{hint}</Text>;
};
