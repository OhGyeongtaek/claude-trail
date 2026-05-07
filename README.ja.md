# claude-trail

**Languages:** [English](./README.md) · [한국어](./README.ko.md) · **日本語**

> Claude Codeのライブ TUI ダッシュボード — Claude が何を読み、編集、検索しているかをリアルタイムで監視し、コンテキストがいつクリアまたはコンパクト化されているか、各サブエージェントが何をしているかを別のターミナルで表示する。

`claude-trail` は1つの質問に答える：
**Claude は今、実際に何をしているのか？**

これは数個の [Claude Code フック](https://docs.claude.com/en/docs/claude-code/hooks) を登録し、ツール呼び出しごとに1行の JSON を `.claude-trail/events.jsonl に追加し、ストリームをライブ Ink TUI としてレンダリングする。

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

> `[xxxx]` タグとセッションごとのアップタイム行は、2つ以上のセッションが表示されている場合にのみ表示される。シングルセッションビューはクリーンなままである。

**ステータス：** v0.2 — 以下のロードマップを参照する。仕様は [`docs/DESIGN.md`](./docs/DESIGN.md) にある。

---

## キャプチャ対象

ダッシュボードが表示する内容：

- **ツール呼び出し**: `Read`、`Edit`、`Write`、`Glob`、`Grep`、`Task`（サブエージェント呼び出し）
- **コンテキスト境界**: `SessionStart`、`SessionEnd`、`/compact` — ストリーム内で水平線として表示される
- **サブエージェントツール**: サブエージェント内のツール呼び出しはインデント表示され、`[<agent_type>]` でタグ付けされて、帰属関係が明確になる

`Bash`、`WebFetch`、`WebSearch`、`MultiEdit`、`NotebookRead`、`NotebookEdit`、および `UserPromptSubmit` は **対象外** である（プライバシーまたはシグナルとノイズの理由 — [DESIGN.md §11](./docs/DESIGN.md) を参照）。

## 要件

- **Node.js ≥ 18**
- **Claude Code** フック対応（任意の最新ビルド）
- `watch` と `init` 確認プロンプト用の **TTY**（スクリプトでは `--yes` を使用してください）

## インストール（ローカルモード）

`claude-trail` はまだ npm に公開されていない。v0.3（グローバルインストール）まで、クローンから実行する：

```bash
git clone https://github.com/OhGyeongtaek/claude-trail.git ~/projects/claude-trail
cd ~/projects/claude-trail
npm install
npm run build
```

ビルドは `dist/cli.js` と `dist/hook.js` を生成する。`init` コマンドは `node $CLAUDE_PROJECT_DIR/dist/hook.js` 形式のフックコマンドを登録するため、**観察したい各プロジェクト内に claude-trail をインストール**（またはシンボリックリンク）する必要がある。適切なグローバルインストールは v0.3 ロードマップに登録されている。

## クイックスタート

Claude Code を観察したい任意のプロジェクトで以下を実行する：

```bash
# 1. claude-trail をプロジェクトルートにクローンまたはシンボリックリンク（上記のインストールを参照）。

# 2. .claude/settings.json に5つのフックを登録
node /path/to/claude-trail/bin/claude-trail.js init

# 3. 1つのターミナルでダッシュボードを開始
node /path/to/claude-trail/bin/claude-trail.js watch

# 4. 別のターミナルで新しい Claude Code セッションを開始
claude
```

> **⚠️ フックはセッション開始時に読み込まれる。** `init` を実行する前に開いていた Claude Code セッションは依然として古いフック設定で実行されており、ツール呼び出しがキャプチャされない。そのため、セッションを再起動する必要がある。

## コマンド

### `claude-trail watch`

ライブダッシュボードを開く。

| フラグ | デフォルト | 効果 |
|------|---------|--------|
| `--all` | ✓ | すべてのファイル拡張子を表示 |
| `--md` |   | `.md` / `.mdx` / `.markdown` のみ |
| `--ext <list>` |   | カンマ区切り拡張子の明示的なホワイトリスト（例：`--ext .ts,.tsx,.md`）。各エントリは `.` で始まる必要がある。`--md` より優先される |
| `--tools <list>` | all | ツールのカンマ区切りホワイトリスト（例：`--tools Read,Edit`）（制御イベントは常に表示）。有効な値：`Read`、`Edit`、`Write`、`Glob`、`Grep`、`Task` |
| `--since <duration>` |   | カットオフより古いプリフィル済みイベントを削除する。形式 `<N><unit>`（単位は `s`、`m`、`h`、`d`）。例：`--since 30m` |

**ホットキー**（インタラクティブ TTY が必要 — stdin がパイプされている場合は無効）

| キー | 動作 |
|-----|--------|
| `f` | 拡張子フィルターを切り替え：`all` ↔ `md` |
| `t` | ツールフィルターを切り替え：`all` → `Read,Edit,Write` → `Read` → `Task` → `all` |
| `/` | インライン検索入力を開く。部分文字列（大文字小文字を区別しない）フィルターがレンダリングされたストリームに適用される。`Enter` で確定、`Esc` でクリア |
| `↑` / `↓` / `PgUp` / `PgDn` | ストリームをスクロール。ライブテイルを一時停止し、スクロールバック下部に戻るか `Esc` を押すまで `PAUSED — N new events` インジケーターを表示 |
| `Esc` | ライブモードを再開（検索クエリとスクロール位置をクリア） |
| `q` / `Ctrl+C` | 終了 |

### `claude-trail replay <session_id>`

`events.jsonl` から終了したセッションを非ライブウォークスルー形式で再生する。
ライブウォッチャーに触れずに、Claude が何をしたかを後から確認するのに便利である。

| フラグ | 効果 |
|------|--------|
| `--from HH:MM:SS` | この時刻以降のイベントを表示 |
| `--to HH:MM:SS` | この時刻までのイベントを表示 |

**再生コントロール**（TTY 必須）

| キー | 動作 |
|-----|--------|
| `space` | 一時停止 / 再開 |
| `→` / `←` | 1つのイベントを前へ / 後ろへステップ（自動一時停止） |
| `+` / `-` | スピードを切り替え：`0.25× → 0.5× → 1× → 2× → 4× → 8×` |
| `q` / `Ctrl+C` | 終了 |

```bash
# 最近のセッション ID を見つけて再生
SID=$(tail -n 200 .claude-trail/events.jsonl | jq -r .session | sort -u | head -1)
node /path/to/claude-trail/bin/claude-trail.js replay "$SID"
```

非 TTY 呼び出しは `requires a TTY` で終了し、不明なセッション ID は `no events found` で終了する。

### `claude-trail init`

`<project>/.claude/settings.json` に5つのフックを登録する：

| フック | マッチャー |
|------|---------|
| `PostToolUse` | `Read|Edit|Write|Glob|Grep|Agent` |
| `SubagentStop` | なし |
| `SessionStart` | なし |
| `SessionEnd` | なし |
| `PreCompact` | なし |

計画された変更の差分を表示し、確認を求める。同じファイル内の他のツールのフックは保持される。

| フラグ | 効果 |
|------|--------|
| `--remove` | claude-trail のフックエントリのみ削除 |
| `--purge`  | `--remove` で、`.claude-trail/` も削除 |
| `--yes` / `-y` | y/N プロンプトをスキップ（非 TTY 使用時に必須） |

`init` はべき等性がある：すでに設定済みのプロジェクトで再実行しても no-op である。

### フックの呼び出し方法

`hook` コマンド（内部用）は Claude Code から `.claude/settings.json` のフックシステム経由で呼び出される — 直接実行することはない。`init` 実行中に `bin/claude-trail-hook.js` を参照するコマンドとして登録される。

## イベントログ形式

`<project>/.claude-trail/events.jsonl` — 1行につき1つの JSON オブジェクト。3つの判別された形状（完全なスキーマは [DESIGN.md §5](./docs/DESIGN.md) を参照）：

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

プレーン JSONL なので、標準ツールが機能する：

```bash
# 最も読まれるファイル トップ 10
jq -r 'select(.tool=="Read") | .path' .claude-trail/events.jsonl \
  | sort | uniq -c | sort -rn | head

# すべての grep クエリ
jq -r 'select(.tool=="Grep") | .meta.query' .claude-trail/events.jsonl

# サブエージェント呼び出し
jq 'select(.tool=="Task") | {type:.meta.subagent_type, desc:.meta.description}' \
  .claude-trail/events.jsonl
```

## プライバシー

claude-trail は **パス、メタデータ、意図のみ** を記録する。以下は決して保存されない：

- `Read` で読み取られたファイル **コンテンツ**（行数のみ）
- `Write` で書き込まれた **本体**（バイト数のみ）
- `Edit` の `old_string` / `new_string` — ファイルパスのみ
- `Grep` の **マッチした行** — クエリと検索ルートのみ（検索クエリ **は** ユーザー意図シグナルとして保持）
- `Task` の `prompt` 本体とサブエージェントの `last_assistant_message`（潜在的に機密コンテンツ）
- `PreCompact` の `custom_instructions`

ログはマシン上の `<project>/.claude-trail/events.jsonl` に完全に存在する。ネットワークを介して何も送信されない。

`init` は `.gitignore` を変更しない — 必要に応じて `.claude-trail/` を自分で追加する。

## アーキテクチャ

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

意図的に3つの疎結合な部品：

1. **フックアダプター**（`dist/hook.js`）— 小さく、React/Ink インポートなし、約 30 ms コールドスタート。常に 0 で終了し、Claude をブロックしない
2. **イベントストア** — 追記専用 JSONL。クラッシュからの復旧が可能。1つの不正な行が他を汚染しない
3. **ビューアー**（`dist/cli.js` + Ink）— 別エントリ、`watch` でのみ遅延ロード

完全な設計根拠、M0.5 測定結果、およびトレードオフ：[`docs/DESIGN.md`](./docs/DESIGN.md)。

## パフォーマンス

- フックコールドスタート：**約 30 ms**（macOS）。予算：p95 ≤ 100 ms（DESIGN §1.1）。
- `watch` 最初のフレーム：100 MB ログで 1 秒未満。
- メモリ：ストリーム上限は 1000 イベント（スクロールバックをサポートするため v0.2 で 200 から引き上げ）。カウンターは小さい Map に保持される。

## 制限事項

- **フックはセッション開始時に読み込まれる。** Claude Code セッションを開く *前に* `init` を実行する。
- **セッション間で集計カウンター。** ヘッダーカウンター（Reads / Edits / Writes / …）は表示されているすべてのセッションで集計される。セッションごとのカウンターは v0.3 の候補である
- **グローバルインストールなし** — `init` コマンドはプロジェクト相対フックパスを書き込む。v0.3 は `claude-trail-hook` をグローバルバイナリとして配信する
- **マッチャー実装の仮定なし。** 一部の `claude -p` ヘッドレス呼び出しはマッチャー外のツール用に PostToolUse を発火させる。フックアダプターは安全ネットとして独自のホワイトリストを持つ
- **サブエージェント帰属関係には Claude Code の `agent_id` フィールドが必要**（M0.5 で検証）。将来の Claude Code リリースがフィールド名を変更する場合、帰属関係は新しいリリースが配信されるまで、プレーンストリーム出力にフォールバックする

## ロードマップ

| バージョン | スコープ |
|---------|-------|
| v0.1 | ライブ `watch`、`init`/`init --remove`、ファイルイベント、サブエージェント帰属関係、`/compact` ライフサイクル |
| **v0.2**（現在） | ✅ FNV-1a カラーコーディング付きマルチセッションマージ、✅ ツールフィルター用 `t` ホットキー、✅ ストリーム検索（`/`）+ スクロールバック（`↑`/`↓`/`PgUp`/`PgDn`）、✅ `replay <session>`、✅ `--ext` カスタムリスト、✅ `--since <duration>` |
| v0.3 | グローバル `npm i -g`、オプトイン Bash マッチャー、日次ログローテーション、事後削除ツール、セッションごとのカウンター、`c` カウンターリセット、`watch` 用 `space` 一時停止ホットキー |
| v0.4 | 静的 HTML エクスポート、セッション差分、「現在のコンテキストに保存されているファイル」スナップショット |
| v1.0 | npm リリース、ネイティブ（Go/Rust）フック（サブミリ秒コールドスタート） |

## コントリビュート

PR を歓迎する。非自明な作業の前に、イシューを開くか、[`docs/DESIGN.md` §17（マイルストーン）](./docs/DESIGN.md)と §18（オープン質問）を確認して、重複した努力を避けることができる。

テストを実行してください：

```bash
npm test            # node --test + tsx (v0.2 時点で 124 テスト)
npm run build       # tsc strict
```

## ライセンス

[MIT](./LICENSE)
