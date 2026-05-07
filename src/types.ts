// claude-trail event schema — events.jsonl line types.
// One JSONL line = one event. Discriminator: `tool`.
// Spec: docs/DESIGN.md §5, §5.1 (v1.0 — M0.5 measurements applied).

export type FileToolName = 'Read' | 'Edit' | 'Write' | 'Glob' | 'Grep';

export type ControlEventName =
  | 'session_start'
  | 'session_end'
  | 'compact'
  | 'subagent_stop';

interface BaseEvent {
  ts: string;
  session: string;
}

export interface FileEvent extends BaseEvent {
  tool: FileToolName;
  path: string;
  ext: string | null;
  meta: ReadMeta | EditMeta | WriteMeta | GlobMeta | GrepMeta;
}

export interface TaskEvent extends BaseEvent {
  tool: 'Task';
  meta: TaskMeta;
}

export interface ControlEvent extends BaseEvent {
  tool: '_control';
  event: ControlEventName;
  meta: ControlMeta;
}

export type TrailEvent = FileEvent | TaskEvent | ControlEvent;

// Per-tool meta payloads (§5.1.1).
// Common fields on every tool event:
//   tool_use_id  — Claude Code's idempotency key (dedup, §5.1.3)
//   duration_ms  — observed in M0.5 (server-side execution time)
//   outside      — true when path resolves outside project root
//   agent_id     — present only when this call originated from a subagent
//   agent_type   — paired with agent_id
//   lines        — Read only: file totalLines snapshot

interface CommonToolMeta {
  tool_use_id: string;
  duration_ms?: number;
  outside?: boolean;
  agent_id?: string;
  agent_type?: string;
}

export interface ReadMeta extends CommonToolMeta {
  offset?: number;
  limit?: number;
  lines?: number;
}

export interface EditMeta extends CommonToolMeta {
  replace_all?: boolean;
}

export interface WriteMeta extends CommonToolMeta {
  bytes?: number;
}

export interface GlobMeta extends CommonToolMeta {
  pattern: string;
}

export interface GrepMeta extends CommonToolMeta {
  query: string;
  glob?: string;
  type?: string;
}

export interface TaskMeta extends CommonToolMeta {
  subagent_type: string;
  description: string;
  agent_id: string;
}

// Control event meta — discriminated by ControlEvent.event (§5.1.2, §5.1.3).

export type ControlMeta =
  | SessionStartMeta
  | SessionEndMeta
  | CompactMeta
  | SubagentStopMeta;

export interface SessionStartMeta {
  source: 'startup' | 'resume' | 'clear' | 'compact';
  model?: string;
}

export interface SessionEndMeta {
  reason: 'clear' | 'logout' | 'prompt_input_exit' | 'other';
}

export interface CompactMeta {
  trigger: 'manual' | 'auto';
}

export interface SubagentStopMeta {
  agent_id: string;
  agent_type: string;
  transcript_path?: string;
}

// Hook stdin payload shapes (Claude Code → claude-trail-hook).
// Fields confirmed against M0.5 captures (.claude-trail/capture/payloads.jsonl).

export type HookEventName =
  | 'PostToolUse'
  | 'SessionStart'
  | 'SessionEnd'
  | 'PreCompact'
  | 'SubagentStop';

interface BaseHookPayload {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: HookEventName;
}

export interface PostToolUsePayload extends BaseHookPayload {
  hook_event_name: 'PostToolUse';
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response?: unknown;
  tool_use_id: string;
  permission_mode?: string;
  duration_ms?: number;
  agent_id?: string;
  agent_type?: string;
}

export interface SessionStartPayload extends BaseHookPayload {
  hook_event_name: 'SessionStart';
  source: 'startup' | 'resume' | 'clear' | 'compact';
  model?: string;
}

export interface SessionEndPayload extends BaseHookPayload {
  hook_event_name: 'SessionEnd';
  reason: 'clear' | 'logout' | 'prompt_input_exit' | 'other';
}

export interface PreCompactPayload extends BaseHookPayload {
  hook_event_name: 'PreCompact';
  trigger: 'manual' | 'auto';
  custom_instructions?: string | null;
}

export interface SubagentStopPayload extends BaseHookPayload {
  hook_event_name: 'SubagentStop';
  agent_id: string;
  agent_type: string;
  agent_transcript_path?: string;
  last_assistant_message?: string;
  stop_hook_active?: boolean;
  permission_mode?: string;
}

export type HookPayload =
  | PostToolUsePayload
  | SessionStartPayload
  | SessionEndPayload
  | PreCompactPayload
  | SubagentStopPayload;

// Filter spec (§8) — used by both CLI args and TUI hotkey state.

export interface FilterState {
  ext: 'all' | 'md';
  tools: ReadonlySet<FileToolName | 'Task'> | 'all';
}
