# claude-trail

**Languages:** [English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md)

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
[156e] 03:22:14  [7d8a] 00:08:01 · uptime 03:22
Reads 32  Edits 4  Writes 1  Globs 2  Greps 7  Tasks 2
─────────────────────────────────────────────────────────────────────────────────────────────
[156e] 14:32:18 R READ   src/components/cards/Card.tsx
[156e] 14:32:11 g GREP   "useState" in src/
[7d8a] ─── 14:32:05  session start (startup)  ──────────────────────────────────────────────
─── 14:32:00  /compact (auto) ──────────────────────────────────────────────────────────────
[156e] 14:31:55 R READ   gatsby-config.js
[156e] 14:31:40 T TASK  ⮕ Explore: "Find OAuth handlers"
[156e] 14:31:46 R READ   ↳ src/auth/oauth.ts                                        [Explore]
[156e] 14:31:51 g GREP   ↳ "callback" in src/auth/                                  [Explore]
─── 14:31:53  [Explore] done ───────────────────────────────────────────────────────────────
[156e] 14:31:52 E EDIT   src/utils/animation/anim.ts
─────────────────────────────────────────────────────────────────────────────────────────────
Top files
████████████  src/components/cards/Card.tsx                                              10x
██████        gatsby-config.js                                                            5x
████          src/index.ts                                                                3x
─────────────────────────────────────────────────────────────────────────────────────────────
q quit · f ext · t tools · / search · ↑/PgUp scroll · Esc resume
```

> The `[xxxx]` tag and per-session uptime line only appear when ≥2 sessions
> are visible. Single-session view stays clean.

**Status:** v0.3 — global install via npm. See [`ROADMAP.md`](./ROADMAP.md) for the version-by-version scope. Spec lives in [`docs/DESIGN.md`](./docs/DESIGN.md).

---

## What it captures

The dashboard shows:

- **Tool calls**: `Read`, `Edit`, `Write`, `Glob`, `Grep`, `Task` (subagent invocations)
- **Context boundaries**: `SessionStart`, `SessionEnd`, `/compact` — rendered as horizontal dividers in the stream
- **Subagent tools**: tool calls *inside* a subagent are indented and tagged with `[<agent_type>]` for clean attribution

`Bash`, `WebFetch`, `WebSearch`, `MultiEdit`, `NotebookRead`, `NotebookEdit`, and `UserPromptSubmit` are intentionally excluded for privacy or signal-vs-noise reasons (see [DESIGN.md §11](./docs/DESIGN.md)).

## Requirements

- **Node.js ≥ 18**
- **Claude Code** with hook support (any recent build)
- A **TTY** (terminal) for interactive `watch` mode and the `init` confirmation prompt (use `--yes` in scripts to bypass)

## Install

Install once, globally, from npm:

```bash
npm install -g claude-trail
```

This adds two binaries to your `PATH`:
- `claude-trail` — the CLI (`watch` / `replay` / `init`)
- `claude-trail-hook` — the hook adapter that Claude Code invokes (you don't run this directly)

### Install from source

If you want to hack on it, clone and link:

```bash
git clone https://github.com/OhGyeongtaek/claude-trail.git
cd claude-trail
npm install
npm run build
npm link    # makes `claude-trail` and `claude-trail-hook` available globally
```

Use `npm unlink -g claude-trail` to remove the link.

## Quick start

In any project where you want to observe Claude Code:

```bash
# 1. Register the 5 hooks in .claude/settings.json.
claude-trail init

# 2. Start the dashboard in one terminal.
claude-trail watch

# 3. Start a new Claude Code session in another terminal.
claude
```

> **⚠️ Hooks load at session start.** Any Claude Code session you had open *before* running `init` is still running with the old hook config — its tool calls won't be captured. Restart the session.

## Commands

### `claude-trail watch`

Opens the live TUI dashboard in the terminal.

| Flag | Default | Effect |
|------|---------|--------|
| `--all` | ✓ | Show every file extension |
| `--md` |   | Only `.md` / `.mdx` / `.markdown` |
| `--ext <list>` |   | Explicit comma-separated extension whitelist, e.g. `--ext .ts,.tsx,.md` (each entry must start with `.`); takes precedence over `--md` |
| `--tools <list>` | all | Comma-separated whitelist of tools, e.g. `--tools Read,Edit` (control events always show). Valid: `Read`, `Edit`, `Write`, `Glob`, `Grep`, `Task` |
| `--since <duration>` |   | Drop prefill events older than the cutoff. Format `<N><unit>` where unit is `s`, `m`, `h`, or `d`. Example: `--since 30m` |

**Hotkeys** (require an interactive TTY — disabled when stdin is piped)

| Key | Action |
|-----|--------|
| `f` | Cycle ext filter: `all` ↔ `md` |
| `t` | Cycle tool filter: `all` → `Read,Edit,Write` → `Read` → `Task` → `all` |
| `/` | Open inline search input. Substring (case-insensitive) filter applied to the rendered stream. `Enter` commits, `Esc` clears |
| `↑` / `↓` / `PgUp` / `PgDn` | Scroll the stream. Pauses live tail and shows `PAUSED — N new events` indicator until you scroll back to the bottom or press `Esc` |
| `Esc` | Resume live mode (clears search query and scroll anchor) |
| `q` / `Ctrl+C` | Quit |

### `claude-trail replay <session_id>`

Replays a finished session from `events.jsonl` in a non-interactive walkthrough.
Useful for reviewing what Claude did after the session ended, without needing the
live watcher to remain active.

| Flag | Effect |
|------|--------|
| `--from HH:MM:SS` | Only events at or after this local time-of-day |
| `--to HH:MM:SS` | Only events at or before this local time-of-day |

**Playback controls** (TTY required)

| Key | Action |
|-----|--------|
| `space` | Pause / resume |
| `→` / `←` | Step one event forward / back (auto-pauses) |
| `+` / `-` | Speed: cycles `0.25× → 0.5× → 1× → 2× → 4× → 8×` |
| `q` / `Ctrl+C` | Quit |

```bash
# Find a recent session id and replay it
SID=$(tail -n 200 .claude-trail/events.jsonl | jq -r .session | sort -u | head -1)
claude-trail replay "$SID"
```

Non-TTY invocations exit with `requires a TTY`. Unknown session ids exit
with `no events found`.

### `claude-trail init`

Registers 5 hooks to `.claude/settings.json`:

| Hook | Matcher |
|------|---------|
| `PostToolUse` | `Read|Edit|Write|Glob|Grep|Agent` |
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

### How hooks are invoked

The `hook` command (internal) is invoked by Claude Code via the hooks system in `.claude/settings.json` — you don't run it directly. It's registered during `init` as a command referencing `bin/claude-trail-hook.js`.

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

1. **Hook adapter** (`claude-trail-hook` binary, `dist/hook.js`) — small, no React/Ink imports, ~30 ms cold start. Always exits 0, never blocks Claude.
2. **Event store** — append-only JSONL. Survives crashes; one bad line doesn't poison the rest.
3. **Viewer** (`dist/cli.js` + Ink) — separate entry, lazy-loaded only by `watch`.

Full design rationale, M0.5 measurement results, and trade-offs: [`docs/DESIGN.md`](./docs/DESIGN.md).

## Performance

- Hook cold start: **~30 ms** (macOS). Budget: p95 ≤ 100 ms (DESIGN §1.1).
- `watch` first frame: < 1 s on a 100 MB log.
- Memory: stream is capped at 1000 events (raised from 200 in v0.2 to support
  meaningful scrollback); counters stay in a small Map.

## Limitations

- **Hooks load at session start** — `init` must run before opening Claude Code. Existing sessions will not be captured.
- **Counters aggregate across sessions** — header totals (Reads / Edits / Writes / …) sum all visible sessions. Per-session counters are planned for v0.3.
- **Tool matcher gaps** — some headless `claude -p` invocations fire PostToolUse for tools outside the declared matcher; the hook adapter has its own whitelist as safety.
- **Subagent attribution relies on `agent_id`** — verified as stable in M0.5. If a future Claude Code release changes this field, attribution falls back to plain stream output until we release a fix.

## Roadmap

See [`ROADMAP.md`](./ROADMAP.md) for the version-by-version scope.

## Contributing

PRs welcome. Before non-trivial work, open an issue or check
[`docs/DESIGN.md` §17 (Milestones)](./docs/DESIGN.md) and §18 (open questions) so we can avoid duplicate effort.

Run the tests:

```bash
npm test            # node --test + tsx (124 tests as of v0.2)
npm run build       # tsc strict
```

## License

[MIT](./LICENSE)
