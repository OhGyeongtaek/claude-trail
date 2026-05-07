# Roadmap

Version-by-version scope for `claude-trail`. The version table is kept here so the README stays focused on usage.

| Version | Status | Scope |
|---------|--------|-------|
| v0.1 | ✅ shipped | live `watch`, `init` / `init --remove`, file events, subagent attribution, `/compact` lifecycle |
| v0.2 | ✅ shipped | multi-session merge with FNV-1a color coding, `t` hotkey for tool filter, stream search (`/`) + scrollback (`↑`/`↓`/`PgUp`/`PgDn`), `replay <session>`, `--ext` custom list, `--since <duration>` |
| **v0.3** | 🚧 in progress | global `npm i -g @ohgyeongtaek/claude-trail` (this release), opt-in Bash matcher, daily log rotation, post-hoc redaction tool, per-session counters, `c` counter reset, `space` pause hotkey for `watch` |
| v0.4 | planned | static HTML export, session diff, "files alive in current context" snapshot |
| v1.0 | planned | npm release polish, native (Go/Rust) hook for sub-millisecond cold start |

For implementation status of in-progress items see GitHub issues. Design rationale lives in [`docs/DESIGN.md`](./docs/DESIGN.md) §17 (Milestones) and §18 (open questions).
