// TopFiles — top-N files by Read/Edit/Write count, ASCII bar chart.
// Spec: docs/DESIGN.md §7.

import React from 'react';
import { Box, Text } from 'ink';
import { topFilesList } from './viewState.js';
import { ellipsizePath, splitPath } from './formatPath.js';

const BAR_CHAR = '█';
const BAR_MAX = 12; // max bar cells; matches mockup density

export interface TopFilesProps {
  topFiles: Map<string, number>;
  /** Visible rows budget (excluding our 1-line title). */
  rows: number;
  width: number;
}

export const TopFiles: React.FC<TopFilesProps> = ({ topFiles, rows, width }) => {
  if (rows <= 1) return null;
  const list = topFilesList(topFiles, Math.max(1, rows - 1));
  if (list.length === 0) return null;

  const max = list[0]!.count;
  const countWidth = Math.max(3, `${max}x`.length);
  const fixed = BAR_MAX + 2 + 2 + countWidth;
  const pathWidth = Math.max(20, width - fixed);

  return (
    <Box flexDirection="column" width={width}>
      <Text bold>Top files</Text>
      {list.map((row, i) => (
        <FileRow
          key={i}
          path={row.path}
          count={row.count}
          max={max}
          pathWidth={pathWidth}
          countWidth={countWidth}
          rowWidth={width}
        />
      ))}
    </Box>
  );
};

interface FileRowProps {
  path: string;
  count: number;
  max: number;
  pathWidth: number;
  countWidth: number;
  rowWidth: number;
}

const FileRow: React.FC<FileRowProps> = ({
  path,
  count,
  max,
  pathWidth,
  countWidth,
  rowWidth,
}) => {
  const bar = makeBar(count, max);
  const ellipsized = ellipsizePath(path, pathWidth);
  const segments = splitPath(ellipsized);

  return (
    <Box width={rowWidth} justifyContent="space-between">
      <Box>
        <Text dimColor>{bar.padEnd(BAR_MAX, ' ')}</Text>
        <Text>{'  '}</Text>
        <Text dimColor>{segments.dir}</Text>
        <Text bold>{segments.base}</Text>
      </Box>
      <Text bold>{`${count}x`.padStart(countWidth)}</Text>
    </Box>
  );
};

export function makeBar(count: number, max: number, width = BAR_MAX): string {
  if (max <= 0 || count <= 0 || width <= 0) return '';
  const filled = Math.max(1, Math.round((count / max) * width));
  return BAR_CHAR.repeat(Math.min(width, filled));
}
