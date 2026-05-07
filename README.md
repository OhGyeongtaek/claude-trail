# claude-trail

> Live TUI dashboard that visualizes which files Claude Code reads, edits, and searches.

`claude-trail` answers one simple question:
**what is Claude actually looking at right now?**

When Claude Code works on a non-trivial task, it reads dozens of files,
greps the codebase, edits a few, and writes a report. From the user's seat,
all of this happens behind the scenes. `claude-trail` taps into Claude
Code's `PostToolUse` hook and renders the file traffic as a live terminal
dashboard.

```
┌─ claude-trail · live ─────────── filter: all ──┐
│ session fcfacf43… · uptime 03:22               │
│ Reads 32  Edits 4  Writes 1  Globs 2  Greps 7  │
├────────────────────────────────────────────────┤
│ Stream                                         │
│  14:32:18  READ   src/components/Card.jsx      │
│  14:32:11  GREP   "useState" in src/           │
│  14:31:55  READ   gatsby-config.js             │
│  14:31:40  EDIT   src/utils/anim.js            │
├────────────────────────────────────────────────┤
│ Top files                                      │
│  ████████  src/components/Card.jsx       8x    │
│  █████     gatsby-config.js              5x    │
│  ███       package.json                  3x    │
└─ q quit · f filter ────────────────────────────┘
```

**Status:** v0.1 — work in progress. See [`docs/DESIGN.md`](./docs/DESIGN.md)
for the design spec.

---

## Features

- **Live TUI** rendered with [Ink](https://github.com/vadimdemedes/ink). No browser.
- **Per-tool tracking**: `Read`, `Edit`, `MultiEdit`, `Write`, `NotebookEdit`,
  `NotebookRead`, `Glob`, `Grep`.
- **Top files** ASCII bar chart by access frequency.
- **Filter presets**: all files (default) or markdown only (`--md`).
- **Live filter toggle**: hotkey `f` cycles modes without restart.
- **Privacy-first**: paths and metadata only — file *contents* are never recorded.
- **Project-local log** (`.claude-trail/events.jsonl`) — easy to grep, jq,
  or feed into other tools.

## Requirements

- Node.js ≥ 18
- Claude Code (any version supporting `PostToolUse` hooks)
- An interactive TTY (the `watch` command refuses to run when piped)

## Install

> Not yet on npm. The current install path is project-local until v0.3.

```bash
git clone https://github.com/<you>/claude-trail ~/projects/claude-trail
cd ~/projects/claude-trail
npm install
npm link        # makes `claude-trail` available on PATH
```

## Quick start

In the project you want to observe:

```bash
# 1. one-time setup — adds a PostToolUse hook to .claude/settings.json
claude-trail init

# 2. start the dashboard in a second terminal
claude-trail watch
```

Then use Claude Code as normal in another terminal. Events stream into the
dashboard in real time.

## Commands

### `claude-trail watch`

Opens the live dashboard.

| Flag | Default | Effect |
|------|---------|--------|
| `--all` | ✓ | Show every file |
| `--md` | | Show only `.md`, `.mdx`, `.markdown` |
| `--session <id>` | | Filter to a specific Claude session |
| `--all-sessions` | | Show all sessions interleaved |

**Hotkeys**

| Key | Action |
|-----|--------|
| `f` | Cycle filter: `all` → `md` → `all` |
| `q` / `Ctrl+C` | Quit |

### `claude-trail init`

Registers a `PostToolUse` hook in the current project's
`.claude/settings.json`. Safe to run multiple times — existing hooks are
preserved and only the `claude-trail` entry is added or updated.

The generated hook entry uses `$CLAUDE_PROJECT_DIR` so it survives Claude
running from any subdirectory:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "^(Read|Edit|MultiEdit|Write|NotebookEdit|NotebookRead|Glob|Grep)$",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/...\" hook"
          }
        ]
      }
    ]
  }
}
```

### `claude-trail hook` *(internal)*

The stdin adapter Claude Code calls. You usually don't run this directly.
Reads one tool-call JSON object from stdin, extracts the path/metadata,
and appends one line to `.claude-trail/events.jsonl`. Always exits 0,
never writes to stderr.

## Event log format

`.claude-trail/events.jsonl` — one JSON object per line:

```json
{
  "ts": "2026-05-07T05:32:18.421Z",
  "session": "fcfacf43-...",
  "tool": "Read",
  "path": "src/components/Card.jsx",
  "ext": ".jsx",
  "meta": { "offset": 0, "limit": 200 }
}
```

Because it's plain JSONL, you can analyze sessions with standard tools:

```bash
# top 10 most-read files
jq -r 'select(.tool=="Read") | .path' .claude-trail/events.jsonl | \
  sort | uniq -c | sort -rn | head

# all grep queries Claude ran
jq -r 'select(.tool=="Grep") | .meta.query' .claude-trail/events.jsonl
```

## Privacy

claude-trail records **paths and metadata only**. It never stores:

- File contents read by `Read`
- Content written by `Write` (only the byte length)
- Lines matched by `Grep` (only the query string)
- Edit diffs (only the file path and a count)

The event log lives entirely on your machine in
`<project>/.claude-trail/events.jsonl`. Nothing is sent over the network.

Add `.claude-trail/` to your `.gitignore` to keep logs out of commits.

## Architecture

```
Claude Code session
       │ tool call
       ▼
PostToolUse hook (Claude) ──► claude-trail hook (stdin adapter)
                                       │
                                       ▼
                       .claude-trail/events.jsonl (append)
                                       │
                                       ▼
                            claude-trail watch (Ink TUI)
```

Three components, intentionally decoupled:

1. **Hook adapter** — tiny, no dependencies. Always exits 0.
2. **Event store** — append-only JSONL. Standard-tool friendly.
3. **Viewer** — Ink-based TUI that tails the log.

Full design rationale, alternatives considered, and verification notes:
- [`docs/DESIGN.md`](./docs/DESIGN.md)
- [`docs/DESIGN-VERIFICATION.md`](./docs/DESIGN-VERIFICATION.md)

## Roadmap

| Version | Scope |
|---------|-------|
| v0.1 | `watch` (live), `init`, `hook`, `--md`/`--all` filter |
| v0.2 | `replay <session>`, custom `--ext` list, per-tool filters |
| v0.3 | Global npm install, daemon mode (avoid Node startup overhead) |
| v0.4 | HTML export, session diffing |
| v1.0 | Stable API, npm release |

## Contributing

Issues and PRs welcome. Before opening a feature PR, check
[`docs/DESIGN.md` §12 (Roadmap)](./docs/DESIGN.md) and
[`docs/DESIGN-VERIFICATION.md` §E (Watch List)](./docs/DESIGN-VERIFICATION.md)
to see whether the idea is already on the map.

For non-trivial design changes, open an issue first so we can discuss
the approach before code.

## License

[MIT](./LICENSE)
