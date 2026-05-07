// Stream — chronological event lines with control markers + subagent indent.
// Spec: docs/DESIGN.md §7.

import React from 'react';
import { Box, Text } from 'ink';
import type { TrailEvent, FileEvent, TaskEvent, ControlEvent } from '../types.js';
import { ControlMarker } from './ControlMarker.js';
import { formatLocalTime } from './formatTime.js';
import { ellipsizePath, splitPath } from './formatPath.js';

export interface StreamProps {
  events: TrailEvent[];
  width: number;
  height: number;
}

export const Stream: React.FC<StreamProps> = ({ events, width, height }) => {
  // Show the most recent `height` events.
  const visible = events.slice(-Math.max(1, height));
  return (
    <Box flexDirection="column">
      {visible.map((e, i) => (
        <EventLine key={i} event={e} width={width} />
      ))}
    </Box>
  );
};

const EventLine: React.FC<{ event: TrailEvent; width: number }> = ({ event, width }) => {
  if (event.tool === '_control') {
    return <ControlMarker event={event as ControlEvent} width={width} />;
  }
  if (event.tool === 'Task') {
    return <TaskLine event={event as TaskEvent} width={width} />;
  }
  return <FileLine event={event as FileEvent} width={width} />;
};

interface ToolGlyph {
  marker: string;
  label: string;
  color: string;
}

const TOOL_GLYPHS: Record<string, ToolGlyph> = {
  Read: { marker: 'R', label: 'READ ', color: 'cyan' },
  Edit: { marker: 'E', label: 'EDIT ', color: 'yellow' },
  Write: { marker: 'W', label: 'WRITE', color: 'magenta' },
  Glob: { marker: 'G', label: 'GLOB ', color: 'green' },
  Grep: { marker: 'g', label: 'GREP ', color: 'green' },
};

const FileLine: React.FC<{ event: FileEvent; width: number }> = ({ event, width }) => {
  const ts = formatLocalTime(event.ts);
  const glyph = TOOL_GLYPHS[event.tool] ?? { marker: '?', label: event.tool.padEnd(5), color: 'white' };
  const isSubagent = !!(event.meta as { agent_id?: string }).agent_id;
  const indent = isSubagent ? '  ↳ ' : '  ';
  const fixedPrefixWidth = ts.length + 1 + 1 + 1 + glyph.label.length + 1 + indent.length;
  const remaining = Math.max(20, width - fixedPrefixWidth - subagentLabelWidth(event));
  const pathDisplay = makePathDisplay(event, remaining);
  const tail = subagentLabel(event);

  return (
    <Text>
      <Text dimColor>{ts} </Text>
      <Text color={glyph.color}>{glyph.marker} </Text>
      <Text color={glyph.color} bold>
        {glyph.label}
      </Text>
      <Text>{indent}</Text>
      <PathDisplay segments={pathDisplay} />
      {tail ? <Text dimColor>{` ${tail}`}</Text> : null}
    </Text>
  );
};

const PathDisplay: React.FC<{ segments: { dir: string; base: string } }> = ({
  segments,
}) => (
  <>
    <Text dimColor>{segments.dir}</Text>
    <Text bold>{segments.base}</Text>
  </>
);

function makePathDisplay(
  event: FileEvent,
  width: number,
): { dir: string; base: string } {
  if (event.tool === 'Grep') {
    const meta = event.meta as { query: string };
    const display = `"${meta.query}" in ${event.path}`;
    return { dir: '', base: ellipsizePath(display, width) };
  }
  if (event.tool === 'Glob') {
    const meta = event.meta as { pattern: string };
    const display = `${meta.pattern} in ${event.path}`;
    return { dir: '', base: ellipsizePath(display, width) };
  }
  const ellipsized = ellipsizePath(event.path, width);
  return splitPath(ellipsized);
}

function subagentLabel(e: FileEvent | TaskEvent): string {
  const meta = e.meta as { agent_type?: string };
  if (!meta.agent_type) return '';
  return `[${meta.agent_type}]`;
}

function subagentLabelWidth(e: FileEvent | TaskEvent): number {
  const lbl = subagentLabel(e);
  return lbl ? lbl.length + 1 : 0;
}

const TaskLine: React.FC<{ event: TaskEvent; width: number }> = ({ event, width }) => {
  const ts = formatLocalTime(event.ts);
  const meta = event.meta;
  const text = `⮕ ${meta.subagent_type}: "${truncate(meta.description, Math.max(20, width - 30))}"`;
  return (
    <Text>
      <Text dimColor>{ts} </Text>
      <Text color="blueBright" bold>
        T TASK
      </Text>
      <Text>{'  '}</Text>
      <Text color="blueBright" bold>
        {text}
      </Text>
    </Text>
  );
};

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(1, max - 1)) + '…';
}
