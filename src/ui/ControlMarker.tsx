// Horizontal-divider rendering for control events.
// Spec: docs/DESIGN.md §7.

import React from 'react';
import { Text } from 'ink';
import type { ControlEvent } from '../types.js';
import { formatLocalTime } from './formatTime.js';

export interface ControlMarkerProps {
  event: ControlEvent;
  width: number;
  tag?: { short: string; color: string } | null;
}

export const ControlMarker: React.FC<ControlMarkerProps> = ({ event, width, tag }) => {
  const ts = formatLocalTime(event.ts);
  const label = describeControl(event);
  const inner = ` ${ts}  ${label} `;
  const tagW = tag ? tag.short.length + 3 : 0;
  const tailLen = Math.max(0, width - 4 - inner.length - tagW);
  const left = '─── ';
  const right = ' ' + '─'.repeat(tailLen);
  return (
    <Text dimColor>
      {tag ? <Text color={tag.color}>{`[${tag.short}] `}</Text> : null}
      {left}
      <Text bold>{inner}</Text>
      {right}
    </Text>
  );
};

function describeControl(e: ControlEvent): string {
  switch (e.event) {
    case 'session_start': {
      const source = (e.meta as { source: string }).source;
      return `session start (${source})`;
    }
    case 'session_end': {
      const reason = (e.meta as { reason: string }).reason;
      return `session end (${reason})`;
    }
    case 'compact': {
      const trigger = (e.meta as { trigger: string }).trigger;
      return `/compact (${trigger})`;
    }
    case 'subagent_stop': {
      const agentType = (e.meta as { agent_type?: string }).agent_type ?? '';
      return agentType === ''
        ? `subagent done`
        : `[${agentType}] done`;
    }
    default:
      return `(unknown control)`;
  }
}
