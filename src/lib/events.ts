// HookPayload → TrailEvent mapper.
// Spec: docs/DESIGN.md §5, §5.1 (v1.0 — M0.5 measurements applied).

import type {
  HookPayload,
  PostToolUsePayload,
  SessionStartPayload,
  SessionEndPayload,
  PreCompactPayload,
  SubagentStopPayload,
  TrailEvent,
  FileEvent,
  TaskEvent,
  ControlEvent,
  FileToolName,
  ReadMeta,
  EditMeta,
  WriteMeta,
  GlobMeta,
  GrepMeta,
  TaskMeta,
} from '../types.js';
import { normalizePath, type PathContext } from './paths.js';

const FILE_TOOLS = new Set<string>(['Read', 'Edit', 'Write', 'Glob', 'Grep']);

/**
 * Map a hook payload to zero or one TrailEvent.
 * Returns null when the payload should be ignored (unknown tool, malformed input).
 *
 * Caller is responsible for:
 *   - dedup via (session, tool_use_id) — see §5.1.3
 *   - writing the line to events.jsonl
 */
export function mapPayload(payload: HookPayload, ctx: PathContext): TrailEvent | null {
  const ts = new Date().toISOString();
  switch (payload.hook_event_name) {
    case 'PostToolUse':
      return mapPostToolUse(payload, ts, ctx);
    case 'SessionStart':
      return mapSessionStart(payload, ts);
    case 'SessionEnd':
      return mapSessionEnd(payload, ts);
    case 'PreCompact':
      return mapPreCompact(payload, ts);
    case 'SubagentStop':
      return mapSubagentStop(payload, ts);
    default:
      return null;
  }
}

function mapPostToolUse(
  p: PostToolUsePayload,
  ts: string,
  ctx: PathContext,
): TrailEvent | null {
  const tool = p.tool_name;

  // Agent (Claude Code internal name) → Task (events.jsonl normalized name).
  if (tool === 'Agent') {
    return mapAgentCall(p, ts);
  }

  if (!FILE_TOOLS.has(tool)) return null;

  const input = p.tool_input ?? {};

  switch (tool) {
    case 'Read':
      return mapReadEditWrite(p, 'Read', input, ts, ctx);
    case 'Edit':
      return mapReadEditWrite(p, 'Edit', input, ts, ctx);
    case 'Write':
      return mapReadEditWrite(p, 'Write', input, ts, ctx);
    case 'Glob':
      return mapGlob(p, input, ts, ctx);
    case 'Grep':
      return mapGrep(p, input, ts, ctx);
    default:
      return null;
  }
}

function commonAgentFields(p: PostToolUsePayload): {
  agent_id?: string;
  agent_type?: string;
} {
  const out: { agent_id?: string; agent_type?: string } = {};
  if (p.agent_id) out.agent_id = p.agent_id;
  if (p.agent_type) out.agent_type = p.agent_type;
  return out;
}

function mapReadEditWrite(
  p: PostToolUsePayload,
  toolName: 'Read' | 'Edit' | 'Write',
  input: Record<string, unknown>,
  ts: string,
  ctx: PathContext,
): FileEvent | null {
  const filePath = strField(input, 'file_path');
  if (!filePath) return null;
  const norm = normalizePath(filePath, ctx);

  let meta: ReadMeta | EditMeta | WriteMeta;
  if (toolName === 'Read') {
    const m: ReadMeta = { tool_use_id: p.tool_use_id };
    const offset = numField(input, 'offset');
    const limit = numField(input, 'limit');
    if (offset !== undefined) m.offset = offset;
    if (limit !== undefined) m.limit = limit;
    const lines = readResponseLines(p.tool_response);
    if (lines !== undefined) m.lines = lines;
    meta = m;
  } else if (toolName === 'Edit') {
    const m: EditMeta = { tool_use_id: p.tool_use_id };
    const replaceAll = boolField(input, 'replace_all');
    if (replaceAll !== undefined) m.replace_all = replaceAll;
    meta = m;
  } else {
    const m: WriteMeta = { tool_use_id: p.tool_use_id };
    const content = strField(input, 'content');
    if (content !== undefined) m.bytes = Buffer.byteLength(content, 'utf8');
    meta = m;
  }

  attachCommon(meta, p);
  if (norm.outside) meta.outside = true;

  return {
    ts,
    session: p.session_id,
    tool: toolName,
    path: norm.path,
    ext: norm.ext,
    meta,
  };
}

function mapGlob(
  p: PostToolUsePayload,
  input: Record<string, unknown>,
  ts: string,
  ctx: PathContext,
): FileEvent | null {
  const pattern = strField(input, 'pattern') ?? '';
  if (!pattern) return null;
  const root = strField(input, 'path') ?? '.';
  const norm = normalizePath(root, ctx);
  const meta: GlobMeta = { tool_use_id: p.tool_use_id, pattern };
  attachCommon(meta, p);
  if (norm.outside) meta.outside = true;
  return {
    ts,
    session: p.session_id,
    tool: 'Glob',
    path: norm.path,
    ext: null,
    meta,
  };
}

function mapGrep(
  p: PostToolUsePayload,
  input: Record<string, unknown>,
  ts: string,
  ctx: PathContext,
): FileEvent | null {
  const query = strField(input, 'pattern') ?? strField(input, 'query');
  if (!query) return null;
  const root = strField(input, 'path') ?? '.';
  const norm = normalizePath(root, ctx);
  const meta: GrepMeta = { tool_use_id: p.tool_use_id, query };
  const glob = strField(input, 'glob');
  const type = strField(input, 'type');
  if (glob) meta.glob = glob;
  if (type) meta.type = type;
  attachCommon(meta, p);
  if (norm.outside) meta.outside = true;
  return {
    ts,
    session: p.session_id,
    tool: 'Grep',
    path: norm.path,
    ext: null,
    meta,
  };
}

function mapAgentCall(p: PostToolUsePayload, ts: string): TaskEvent | null {
  const input = p.tool_input ?? {};
  const subagent_type = strField(input, 'subagent_type') ?? '';
  const description = strField(input, 'description') ?? deriveDescription(input);

  // Agent payload's tool_response carries an `agentId` — prefer that as the
  // attribution key. Fall back to the (subagent's) PostToolUse `agent_id`.
  const agent_id =
    responseAgentId(p.tool_response) ?? p.agent_id ?? '';

  const meta: TaskMeta = {
    tool_use_id: p.tool_use_id,
    subagent_type,
    description,
    agent_id,
  };
  if (p.duration_ms !== undefined) meta.duration_ms = p.duration_ms;

  return {
    ts,
    session: p.session_id,
    tool: 'Task',
    meta,
  };
}

function mapSessionStart(p: SessionStartPayload, ts: string): ControlEvent {
  return {
    ts,
    session: p.session_id,
    tool: '_control',
    event: 'session_start',
    meta: p.model
      ? { source: p.source, model: p.model }
      : { source: p.source },
  };
}

function mapSessionEnd(p: SessionEndPayload, ts: string): ControlEvent {
  return {
    ts,
    session: p.session_id,
    tool: '_control',
    event: 'session_end',
    meta: { reason: p.reason },
  };
}

function mapPreCompact(p: PreCompactPayload, ts: string): ControlEvent {
  return {
    ts,
    session: p.session_id,
    tool: '_control',
    event: 'compact',
    meta: { trigger: p.trigger },
  };
}

function mapSubagentStop(p: SubagentStopPayload, ts: string): ControlEvent {
  const meta: ControlEvent['meta'] = {
    agent_id: p.agent_id ?? '',
    agent_type: p.agent_type ?? '',
  };
  if (p.agent_transcript_path) {
    (meta as { transcript_path?: string }).transcript_path = p.agent_transcript_path;
  }
  return {
    ts,
    session: p.session_id,
    tool: '_control',
    event: 'subagent_stop',
    meta,
  };
}

// — helpers —

function attachCommon(
  meta: ReadMeta | EditMeta | WriteMeta | GlobMeta | GrepMeta | TaskMeta,
  p: PostToolUsePayload,
): void {
  if (p.duration_ms !== undefined) meta.duration_ms = p.duration_ms;
  const a = commonAgentFields(p);
  if (a.agent_id) meta.agent_id = a.agent_id;
  if (a.agent_type) meta.agent_type = a.agent_type;
}

function strField(o: Record<string, unknown>, k: string): string | undefined {
  const v = o[k];
  return typeof v === 'string' ? v : undefined;
}
function numField(o: Record<string, unknown>, k: string): number | undefined {
  const v = o[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function boolField(o: Record<string, unknown>, k: string): boolean | undefined {
  const v = o[k];
  return typeof v === 'boolean' ? v : undefined;
}

function readResponseLines(resp: unknown): number | undefined {
  if (!resp || typeof resp !== 'object') return undefined;
  const file = (resp as { file?: unknown }).file;
  if (!file || typeof file !== 'object') return undefined;
  const total = (file as { totalLines?: unknown }).totalLines;
  return typeof total === 'number' ? total : undefined;
}

function responseAgentId(resp: unknown): string | undefined {
  if (!resp || typeof resp !== 'object') return undefined;
  const id = (resp as { agentId?: unknown }).agentId;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

function deriveDescription(input: Record<string, unknown>): string {
  const prompt = strField(input, 'prompt');
  if (!prompt) return '';
  const trimmed = prompt.replace(/\s+/g, ' ').trim();
  return trimmed.length > 80 ? trimmed.slice(0, 79) + '…' : trimmed;
}

/** Discriminator helper used by hook adapter for dedup keying. */
export function dedupKey(p: HookPayload): string | null {
  if (p.hook_event_name !== 'PostToolUse') return null;
  return `${p.session_id}:${p.tool_use_id}`;
}

/** Toolname normalization (Agent → Task in events.jsonl). */
export function normalizeToolName(toolName: string): string {
  return toolName === 'Agent' ? 'Task' : toolName;
}

/** Whether this tool name is captured by the v0.1 whitelist. */
export function isCapturedTool(toolName: string): boolean {
  return FILE_TOOLS.has(toolName) || toolName === 'Agent';
}

export const __for_test_only = { FILE_TOOLS };
