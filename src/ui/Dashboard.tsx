// Top-level Ink dashboard. Wires Header + Stream against the view-state
// reducer driven by lib/tail.ts. Spec: docs/DESIGN.md §7.

import React, { useEffect, useReducer, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import type { TrailEvent, FilterState } from '../types.js';
import {
  initialState,
  step,
  filterBySearch,
  type ViewState,
} from './viewState.js';
import { Header } from './Header.js';
import { Stream } from './Stream.js';
import { TopFiles } from './TopFiles.js';
import { startTail, type TailHandle, type TailStats } from '../lib/tail.js';
import { nextToolPreset } from './viewState.js';

export interface DashboardProps {
  eventsPath: string;
  initialFilter: FilterState;
  /** Drop prefill events older than this epoch-ms. Issue #4. */
  sinceCutoffMs?: number;
  /** For tests — lets caller seed events without fs.watch. */
  testHarness?: {
    onReady: (push: (e: TrailEvent) => void) => void;
  };
}

type Action =
  | { type: 'add'; event: TrailEvent }
  | { type: 'addPrefill'; events: TrailEvent[] }
  | { type: 'cycleExt' }
  | { type: 'cycleTools' };

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
    case 'cycleTools': {
      const next: FilterState = {
        ...state.filter,
        tools: nextToolPreset(state.filter.tools),
      };
      return { ...state, filter: next };
    }
  }
}

export const Dashboard: React.FC<DashboardProps> = ({
  eventsPath,
  initialFilter,
  sinceCutoffMs,
  testHarness,
}) => {
  const [state, dispatch] = useReducer(reducer, initialState(initialFilter));
  const [activeSession, setActiveSession] = useState<string | null>(null);
  // Scrollback / search state machine (issue #5).
  // mode === 'live': follow tail.
  // mode === 'paused': scrollAnchor is set to state.totalSeen at pause time;
  //   pendingNew = state.totalSeen - scrollAnchor.
  // mode === 'searching': inline search input active. Filter applies in
  //   live + paused modes once searchQuery is non-empty.
  const [mode, setMode] = useState<'live' | 'paused' | 'searching'>('live');
  const [scrollAnchor, setScrollAnchor] = useState<number | null>(null);
  const [scrollExtra, setScrollExtra] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [startedAt] = useState<number>(Date.now());
  const [now, setNow] = useState<number>(Date.now());
  const [tailErrors, setTailErrors] = useState<number>(0);
  const [tailStats, setTailStats] = useState<TailStats>({
    parseErrors: 0,
    oversizeDropped: 0,
  });
  const { exit } = useApp();
  const { stdout } = useStdout();
  // Env first — shells keep COLUMNS/LINES current on resize, and Ink
  // defaults to 80 cols when stdout isn't a TTY which can mask the real
  // value in piped/test scenarios.
  const cols = pickInt(process.env['COLUMNS'], stdout?.columns, 100);
  const rows = pickInt(process.env['LINES'], stdout?.rows, 24);

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
          const filtered = sinceCutoffMs !== undefined
            ? events.filter((e) => {
                const ms = Date.parse(e.ts);
                return Number.isFinite(ms) && ms >= sinceCutoffMs;
              })
            : events;
          dispatch({ type: 'addPrefill', events: filtered });
          const last = filtered[filtered.length - 1];
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
  }, [eventsPath, testHarness, sinceCutoffMs]);

  // Uptime tick.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const pageSize = Math.max(1, Math.floor(rows / 2));

  const enterPaused = (extraDelta: number): void => {
    setMode('paused');
    setScrollAnchor((cur) => (cur === null ? state.totalSeen : cur));
    setScrollExtra((x) => x + extraDelta);
  };
  const resumeLive = (): void => {
    setMode('live');
    setScrollAnchor(null);
    setScrollExtra(0);
  };

  useInput(
    (input, key) => {
      // Search input mode owns most keystrokes.
      if (mode === 'searching') {
        if (key.escape) {
          setSearchQuery('');
          setMode(scrollAnchor === null ? 'live' : 'paused');
          return;
        }
        if (key.return) {
          // Commit query — keep filter, exit input mode.
          setMode(scrollAnchor === null ? 'live' : 'paused');
          return;
        }
        if (key.backspace || key.delete) {
          setSearchQuery((q) => q.slice(0, -1));
          return;
        }
        if (input && !key.ctrl && !key.meta && input.length === 1) {
          setSearchQuery((q) => q + input);
          return;
        }
        return;
      }
      // Non-search modes.
      if (input === 'q' || (key.ctrl && input === 'c')) {
        exit();
      } else if (key.escape) {
        if (searchQuery) setSearchQuery('');
        if (mode === 'paused') resumeLive();
      } else if (input === '/') {
        setMode('searching');
      } else if (input === 'f') {
        dispatch({ type: 'cycleExt' });
      } else if (input === 't') {
        dispatch({ type: 'cycleTools' });
      } else if (key.pageUp) {
        enterPaused(pageSize);
      } else if (key.upArrow) {
        enterPaused(1);
      } else if (key.pageDown || key.downArrow) {
        // Scroll toward newest.
        const step = key.pageDown ? pageSize : 1;
        if (mode === 'paused') {
          if (scrollExtra > 0) {
            setScrollExtra((x) => Math.max(0, x - step));
          } else {
            // At anchor; downArrow / PgDn through pendingNew → resume live.
            resumeLive();
          }
        }
      }
    },
    { isActive: !!process.stdin.isTTY },
  );

  if (tooNarrow) {
    return <Text>claude-trail: terminal too narrow (need ≥60 cols)</Text>;
  }

  // Row budget allocation (§7 priority: Header → Stream → TopFiles).
  // Reserved: header(4) + 2 separators + footer(1) + slack(1) = 8.
  // TopFiles gets ~1/3, Stream gets remainder. TopFiles disappears
  // first when window shrinks below ~12 rows.
  const showStatusBar = mode !== 'live' || searchQuery.length > 0;
  const reserved = 8 + (showStatusBar ? 1 : 0);
  const flexRows = Math.max(3, rows - reserved);
  const showTopFiles = state.topFiles.size > 0 && flexRows >= 8;
  const topFilesHeight = showTopFiles ? Math.min(8, Math.floor(flexRows / 3)) : 0;
  const streamHeight = flexRows - topFilesHeight;

  // Apply search filter, then derive scrollback window.
  const filteredEvents = filterBySearch(state.events, searchQuery);
  const pendingNew = scrollAnchor !== null
    ? Math.max(0, state.totalSeen - scrollAnchor)
    : 0;
  // Window end: in live mode end = filteredEvents.length. In paused mode the
  // end backs up by pendingNew + scrollExtra so the user keeps the same view
  // as new events arrive. Search is applied to the (capped) events buffer
  // first; pendingNew is measured pre-filter, so values may slightly under-
  // shoot in heavy-filter cases — acceptable for a status indicator.
  const endIdx = mode === 'paused'
    ? Math.max(0, filteredEvents.length - pendingNew - scrollExtra)
    : filteredEvents.length;
  const startIdx = Math.max(0, endIdx - streamHeight);
  const visibleEvents = filteredEvents.slice(startIdx, endIdx);
  const uptimeSec = Math.floor((now - startedAt) / 1000);
  const ruleWidth = Math.max(0, cols - 1);

  return (
    <Box flexDirection="column">
      <Header
        session={activeSession}
        uptimeSec={uptimeSec}
        counters={state.counters}
        filter={state.filter}
        width={cols}
        sessions={state.sessions}
        nowMs={now}
      />
      <Stream events={visibleEvents} width={cols} height={streamHeight} />
      {showStatusBar ? (
        <StatusBar
          width={cols}
          mode={mode}
          searchQuery={searchQuery}
          pendingNew={pendingNew}
        />
      ) : null}
      {showTopFiles ? (
        <>
          <Text dimColor>{'─'.repeat(ruleWidth)}</Text>
          <TopFiles topFiles={state.topFiles} rows={topFilesHeight} width={cols} />
        </>
      ) : null}
      <Text dimColor>{'─'.repeat(ruleWidth)}</Text>
      <Footer
        width={cols}
        errors={tailErrors}
        parseErrors={tailStats.parseErrors}
        oversize={tailStats.oversizeDropped}
      />
    </Box>
  );
};

function pickInt(...values: Array<number | string | undefined>): number {
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.floor(v);
    if (typeof v === 'string') {
      const n = Number.parseInt(v, 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return 0;
}

const StatusBar: React.FC<{
  width: number;
  mode: 'live' | 'paused' | 'searching';
  searchQuery: string;
  pendingNew: number;
}> = ({ width, mode, searchQuery, pendingNew }) => {
  let left = '';
  if (mode === 'searching') {
    left = `/${searchQuery}_`;
  } else if (mode === 'paused') {
    left = `PAUSED — ${pendingNew} new event${pendingNew === 1 ? '' : 's'}`;
    if (searchQuery) left += `  /${searchQuery}`;
  } else if (searchQuery) {
    left = `/${searchQuery}`;
  }
  return (
    <Box width={width}>
      <Text color={mode === 'paused' ? 'yellow' : 'cyan'}>{left}</Text>
    </Box>
  );
};

const Footer: React.FC<{
  width: number;
  errors: number;
  parseErrors: number;
  oversize: number;
}> = ({ width, errors, parseErrors, oversize }) => {
  const showStats = errors + parseErrors + oversize > 0;
  return (
    <Box justifyContent="space-between" width={width}>
      <Text dimColor>q quit · f ext · t tools · / search · ↑/PgUp scroll · Esc resume</Text>
      {showStats ? (
        <Text dimColor>{`errs:${errors} parse:${parseErrors} drop:${oversize}`}</Text>
      ) : (
        <Text> </Text>
      )}
    </Box>
  );
};
