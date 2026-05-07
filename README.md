# claude-trail

> Live TUI dashboard for Claude Code — see what Claude reads, edits, and
> searches; when context is cleared or compacted; and what each
> subagent is doing — in real time, in a second terminal.

`claude-trail` answers one question:
**what is Claude actually doing right now?**

It registers a few [Claude Code hooks](https://docs.claude.com/en/docs/claude-code/hooks),
appends one JSON line per tool call to `.claude-trail/events.jsonl`, and
renders the stream as a live Ink TUI.

```
claude-trail · live                                                 filter: ext=all tools=all
session 156ec647 · uptime 03:22
Reads 32  Edits 4  Writes 1  Globs 2  Greps 7  Tasks 2
─────────────────────────────────────────────────────────────────────────────────────────────
14:32:18 R READ   src/components/cards/Card.tsx
14:32:11 g GREP   "useState" in src/
─── 14:32:00  /compact (auto) ──────────────────────────────────────────────────────────────
14:31:55 R READ   gatsby-config.js
14:31:40 T TASK  ⮕ Explore: "Find OAuth handlers"
14:31:46 R READ   ↳ src/auth/oauth.ts                                                [Explore]
14:31:51 g GREP   ↳ "callback" in src/auth/                                          [Explore]
─── 14:31:53  [Explore] done ───────────────────────────────────────────────────────────────
14:31:52 E EDIT   src/utils/animation/anim.ts
─────────────────────────────────────────────────────────────────────────────────────────────
Top files
████████████  src/components/cards/Card.tsx                                              10x
██████        gatsby-config.js                                                            5x
████          src/index.ts                                                                3x
─────────────────────────────────────────────────────────────────────────────────────────────
q quit · f ext-filter
```

**Status:** v0.1 — work in progress. Spec lives in [`docs/DESIGN.md`](./docs/DESIGN.md).

---

## What it captures

- **Tool calls**: `Read`, `Edit`, `Write`, `Glob`, `Grep`, `Task` (subagent invocations).
- **Context boundaries**: `SessionStart`, `SessionEnd`, `/compact` — rendered as horizontal dividers in the stream.
- **Subagents**: every `Task` call is shown; tool calls *inside* a subagent are indented and tagged with `[<agent_type>]` for clean attribution.

`Bash`, `WebFetch`, `WebSearch`, `MultiEdit`, `NotebookRead`, `NotebookEdit`,
and `UserPromptSubmit` are **out of scope for v0.1** (privacy or signal-vs-noise reasons — see [DESIGN.md §11](./docs/DESIGN.md)).

## Requirements

- **Node.js ≥ 18**
- **Claude Code** with hook support (any recent build)
- A **TTY** for `watch` and the `init` confirmation prompt (use `--yes` in scripts)

## Install (v0.1 — local mode)

`claude-trail` is not on npm yet. Until v0.3 (global install), run it from a clone:

```bash
git clone https://github.com/OhGyeongtaek/claude-trail.git ~/projects/claude-trail
cd ~/projects/claude-trail
npm install
npm run build
```

The build produces `dist/cli.js` and `dist/hook.js`. The `init` command registers a hook command of the form `node $CLAUDE_PROJECT_DIR/dist/hook.js`, so **you need to install claude-trail inside each project you want to observe** (or symlink it). A proper global install is on the v0.3 roadmap.

## Quick start

In any project where you want to observe Claude Code:

```bash
# 1. clone or symlink claude-trail into the project root (see Install above).

# 2. register the 5 hooks in .claude/settings.json
node /path/to/claude-trail/bin/claude-trail.js init

# 3. start the dashboard in one terminal
node /path/to/claude-trail/bin/claude-trail.js watch

# 4. start a NEW Claude Code session in another terminal
claude
```

> **⚠️ Hooks load at session start.** Any Claude Code session you had open *before* running `init` is still running with the old hook config — its tool calls won't be captured. Restart the session.

## Commands

### `claude-trail watch`

Opens the live dashboard.

| Flag | Default | Effect |
|------|---------|--------|
| `--all` | ✓ | Show every file extension |
| `--md` |   | Only `.md` / `.mdx` / `.markdown` |
| `--tools <list>` | all | Comma-separated whitelist of tools, e.g. `--tools Read,Edit` (control events always show). Valid: `Read`, `Edit`, `Write`, `Glob`, `Grep`, `Task` |

**Hotkeys**

| Key | Action |
|-----|--------|
| `f` | Cycle ext filter: `all` ↔ `md` |
| `q` / `Ctrl+C` | Quit |

The `t` hotkey for live tool-filter cycling, the `c` counter reset, and stream search/scrollback are scheduled for v0.2.

### `claude-trail init`

Registers 5 hooks in `<project>/.claude/settings.json`:

| Hook | Matcher |
|------|---------|
| `PostToolUse` | `Read\|Edit\|Write\|Glob\|Grep\|Agent` |
| `SubagentStop` | (none) |
| `SessionStart` | (none) |
| `SessionEnd` | (none) |
| `PreCompact` | (none) |

It shows a diff of planned changes and asks for confirmation. Other tools' hooks in the same file are preserved.

| Flag | Effect |
|------|--------|
| `--remove` | Remove only claude-trail's hook entries |
| `--purge`  | With `--remove`, also delete `.claude-trail/` |
| `--yes` / `-y` | Skip the y/N prompt (required for non-TTY use) |

`init` is idempotent: re-running on an already-configured project is a no-op.

### `claude-trail watch` is the only foreground command

The `hook` command exists but is invoked by Claude Code via `bin/claude-trail-hook.js` — you don't run it directly.

## Event log format

`<project>/.claude-trail/events.jsonl` — one JSON object per line. Three discriminated shapes (full schema in [DESIGN.md §5](./docs/DESIGN.md)):

```jsonc
// (a) File tool
{"ts":"2026-05-07T05:32:18.421Z","session":"156ec647-...","tool":"Read",
 "path":"src/components/Card.tsx","ext":".tsx",
 "meta":{"tool_use_id":"toolu_01K5","lines":157,"duration_ms":3}}

// (b) Subagent invocation (Claude Code's internal name `Agent` is normalized to `Task`)
{"ts":"...","session":"156ec647-...","tool":"Task",
 "meta":{"tool_use_id":"toolu_01J","subagent_type":"Explore",
         "description":"Find OAuth handlers","agent_id":"a7d9ed34b488363a3","duration_ms":5135}}

// (c) Control event
{"ts":"...","session":"156ec647-...","tool":"_control","event":"compact",
 "meta":{"trigger":"manual"}}
```

Plain JSONL, so standard tools just work:

```bash
# top 10 most-read files
jq -r 'select(.tool=="Read") | .path' .claude-trail/events.jsonl \
  | sort | uniq -c | sort -rn | head

# every grep query
jq -r 'select(.tool=="Grep") | .meta.query' .claude-trail/events.jsonl

# subagent invocations
jq 'select(.tool=="Task") | {type:.meta.subagent_type, desc:.meta.description}' \
  .claude-trail/events.jsonl
```

## Privacy

claude-trail records **paths, metadata, and intent only**. It never stores:

- File **contents** read by `Read` (only `lines` count)
- The **body written** by `Write` (only `bytes` count)
- `Edit`'s `old_string` / `new_string` — only the file path
- `Grep`'s **matched lines** — only the query and search root (search query *is* preserved as user-intent signal)
- `Task`'s `prompt` body and the subagent's `last_assistant_message` (potentially sensitive content)
- `PreCompact`'s `custom_instructions`

The log lives entirely on your machine at `<project>/.claude-trail/events.jsonl`. Nothing is sent over the network.

`init` does not modify your `.gitignore` — add `.claude-trail/` yourself if you want to.

## Architecture

```
Claude Code session
       │ tool call / lifecycle event
       ▼
5 hooks ─► claude-trail-hook (stdin adapter)
                  │ append one JSON line
                  ▼
       .claude-trail/events.jsonl
                  │ tail
                  ▼
       claude-trail watch (Ink TUI)
```

Three deliberately decoupled pieces:

1. **Hook adapter** (`dist/hook.js`) — small, no React/Ink imports, ~30 ms cold start. Always exits 0, never blocks Claude.
2. **Event store** — append-only JSONL. Survives crashes; one bad line doesn't poison the rest.
3. **Viewer** (`dist/cli.js` + Ink) — separate entry, lazy-loaded only by `watch`.

Full design rationale, M0.5 measurement results, and trade-offs: [`docs/DESIGN.md`](./docs/DESIGN.md).

## Performance

- Hook cold start: **~30 ms** (macOS). Budget: p95 ≤ 100 ms (DESIGN §1.1).
- `watch` first frame: < 1 s on a 100 MB log.
- Memory: stream is capped at 200 events; counters stay in a small Map.

## Limitations (v0.1)

- **Hooks are loaded at session start.** Run `init` *before* opening a Claude Code session.
- **Single active session in TUI.** The log records all sessions; the viewer focuses on the most recent one. Multi-session merge is v0.2.
- **No global install yet** — the `init` command writes a project-relative hook path. v0.3 ships `claude-trail-hook` as a global binary.
- **No matcher enforcement assumption.** Some `claude -p` headless invocations fire PostToolUse for tools outside our matcher; the hook adapter has its own whitelist as a safety net.
- **Subagent attribution requires Claude Code's `agent_id` field** (verified in M0.5). If a future Claude Code release changes the field name, attribution falls back to plain stream output until a new release ships.

## Roadmap

| Version | Scope |
|---------|-------|
| **v0.1** (current) | live `watch`, `init` / `init --remove`, file events, subagent attribution, `/compact` lifecycle |
| v0.2 | multi-session merge with FNV color coding, `t` hotkey for tool filter, stream search & scrollback, `replay <session>`, `--ext` custom list |
| v0.3 | global `npm i -g`, opt-in Bash matcher, daily log rotation, post-hoc redaction tool |
| v0.4 | static HTML export, session diff, "files alive in current context" snapshot |
| v1.0 | npm release, native (Go/Rust) hook for sub-millisecond cold start |

## Contributing

PRs welcome. Before non-trivial work, open an issue or check
[`docs/DESIGN.md` §17 (Milestones)](./docs/DESIGN.md) and §18 (open questions) so we can avoid duplicate effort.

Run the tests:

```bash
npm test            # node --test + tsx, ~90 unit tests
npm run build       # tsc strict
```

## License

[MIT](./LICENSE)
