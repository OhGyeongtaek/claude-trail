// .claude/settings.json safe-merge installer + uninstaller.
// Spec: docs/DESIGN.md §11.
//
// All operations are pure on the JSON object — read/write happens in
// commands/init.ts. This module is unit-testable without filesystem.

const HOOK_COMMAND = 'claude-trail-hook';
const POST_TOOL_USE_MATCHER = 'Read|Edit|Write|Glob|Grep|Agent';

const HOOK_EVENTS = [
  'PostToolUse',
  'SubagentStop',
  'SessionStart',
  'SessionEnd',
  'PreCompact',
] as const;
type HookEventName = (typeof HOOK_EVENTS)[number];

/** Substrings that identify a claude-trail hook command for safe removal. */
const FINGERPRINTS = ['dist/hook.js', 'claude-trail-hook'];

export interface SingleHook {
  type: 'command';
  command: string;
  timeout?: number;
}

export interface HookEntry {
  matcher?: string;
  hooks: SingleHook[];
}

export interface SettingsHooks {
  PostToolUse?: HookEntry[];
  SubagentStop?: HookEntry[];
  SessionStart?: HookEntry[];
  SessionEnd?: HookEntry[];
  PreCompact?: HookEntry[];
  [k: string]: HookEntry[] | undefined;
}

export interface Settings {
  hooks?: SettingsHooks;
  [k: string]: unknown;
}

export interface InstallChange {
  event: HookEventName;
  action: 'added' | 'matcher-updated' | 'unchanged';
  matcher?: string;
  command: string;
}

export interface InstallResult {
  settings: Settings;
  changes: InstallChange[];
}

/**
 * Merge our 5 hooks into the given settings object.
 * - Adds entries for any event we don't already register.
 * - Updates matcher only if our command exists with a different matcher.
 * - Leaves other tools' hooks untouched.
 */
export function planInstall(prev: Settings | null | undefined): InstallResult {
  const settings: Settings = clone(prev ?? {});
  if (!settings.hooks) settings.hooks = {};
  const hooks = settings.hooks;
  const changes: InstallChange[] = [];

  for (const event of HOOK_EVENTS) {
    const want = wantedEntry(event);
    const arr: HookEntry[] = hooks[event] ?? [];
    const existingIdx = arr.findIndex((h) => entryHasFingerprint(h));

    if (existingIdx === -1) {
      arr.unshift(want);
      const change: InstallChange = {
        event,
        action: 'added',
        command: HOOK_COMMAND,
      };
      if (want.matcher) change.matcher = want.matcher;
      changes.push(change);
    } else {
      const existing = arr[existingIdx]!;
      const sameMatcher = (existing.matcher ?? '') === (want.matcher ?? '');
      if (sameMatcher) {
        const change: InstallChange = {
          event,
          action: 'unchanged',
          command: HOOK_COMMAND,
        };
        if (want.matcher) change.matcher = want.matcher;
        changes.push(change);
      } else {
        if (want.matcher) {
          existing.matcher = want.matcher;
        } else {
          delete existing.matcher;
        }
        const change: InstallChange = {
          event,
          action: 'matcher-updated',
          command: HOOK_COMMAND,
        };
        if (want.matcher) change.matcher = want.matcher;
        changes.push(change);
      }
    }
    hooks[event] = arr;
  }

  return { settings, changes };
}

export interface RemoveChange {
  event: HookEventName;
  removed: number;
}

export interface RemoveResult {
  settings: Settings;
  changes: RemoveChange[];
  totalRemoved: number;
}

/**
 * Remove every claude-trail hook from settings.
 * - Deletes entries whose command contains a known fingerprint.
 * - Drops the event key entirely when its hooks array becomes empty.
 * - Drops the `hooks` object when empty.
 */
export function planRemove(prev: Settings | null | undefined): RemoveResult {
  const settings: Settings = clone(prev ?? {});
  const changes: RemoveChange[] = [];
  let totalRemoved = 0;
  const hooks = settings.hooks;
  if (!hooks) {
    return { settings, changes, totalRemoved };
  }

  for (const event of HOOK_EVENTS) {
    const arr = hooks[event];
    if (!arr || arr.length === 0) continue;
    const before = arr.length;
    const filtered = arr.filter((h) => !entryHasFingerprint(h));
    const removed = before - filtered.length;
    if (removed > 0) {
      changes.push({ event, removed });
      totalRemoved += removed;
    }
    if (filtered.length === 0) {
      delete hooks[event];
    } else {
      hooks[event] = filtered;
    }
  }

  if (Object.keys(hooks).length === 0) {
    delete settings.hooks;
  }

  return { settings, changes, totalRemoved };
}

/** True if the entry contains any claude-trail-fingerprinted command. */
export function entryHasFingerprint(entry: HookEntry): boolean {
  if (!entry || !Array.isArray(entry.hooks)) return false;
  return entry.hooks.some((h) =>
    typeof h?.command === 'string' && FINGERPRINTS.some((f) => h.command.includes(f)),
  );
}

function wantedEntry(event: HookEventName): HookEntry {
  const hook: SingleHook = { type: 'command', command: HOOK_COMMAND };
  if (event === 'PostToolUse') {
    return { matcher: POST_TOOL_USE_MATCHER, hooks: [hook] };
  }
  return { hooks: [hook] };
}

function clone<T>(o: T): T {
  return JSON.parse(JSON.stringify(o)) as T;
}

export const __exports_for_test = {
  HOOK_COMMAND,
  POST_TOOL_USE_MATCHER,
  HOOK_EVENTS,
  FINGERPRINTS,
};
