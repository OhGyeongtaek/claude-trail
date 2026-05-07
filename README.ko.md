# claude-trail

**Languages:** [English](./README.md) · **한국어** · [日本語](./README.ja.md)

> Claude Code를 위한 실시간 TUI 대시보드 — Claude가 읽고, 수정하고, 검색하는 것과 컨텍스트가 언제 정리되거나 압축되는지, 각 서브에이전트가 무엇을 하고 있는지 실시간으로 다른 터미널에서 확인할 수 있습니다.

`claude-trail`은 하나의 질문에 답합니다:
**Claude가 지금 정확히 무엇을 하고 있는가?**

몇 개의 [Claude Code 후크](https://docs.claude.com/en/docs/claude-code/hooks)를 등록한 후 도구 호출마다 하나의 JSON 라인을 `.claude-trail/events.jsonl`에 추가하고, 이 스트림을 실시간 Ink TUI로 렌더링합니다.

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

> `[xxxx]` 태그와 세션별 가동시간 라인은 2개 이상의 세션이 표시될 때만 나타납니다. 단일 세션 뷰는 간결하게 유지됩니다.

**상태:** v0.2 — 로드맵은 아래를 참고하세요. 명세는 [`docs/DESIGN.md`](./docs/DESIGN.md)에 있습니다.

---

## 수집 대상

- **도구 호출**: `Read`, `Edit`, `Write`, `Glob`, `Grep`, `Task` (서브에이전트 호출).
- **컨텍스트 경계**: `SessionStart`, `SessionEnd`, `/compact` — 스트림에 가로 구분선으로 렌더링됩니다.
- **서브에이전트**: 모든 `Task` 호출이 표시되고, 서브에이전트 내부의 도구 호출은 들여쓰기되며 깔끔한 귀속을 위해 `[<agent_type>]`로 태그됩니다.

`Bash`, `WebFetch`, `WebSearch`, `MultiEdit`, `NotebookRead`, `NotebookEdit`,
그리고 `UserPromptSubmit`은 **범위 밖입니다** (프라이버시 또는 신호 대 노이즈 비율의 이유 — [DESIGN.md §11](./docs/DESIGN.md) 참고).

## 요구사항

- **Node.js ≥ 18**
- **Claude Code** (후크 지원이 있는 최근 빌드)
- `watch`와 `init` 확인 프롬프트를 위한 **TTY** (스크립트에서는 `--yes` 사용)

## 설치 (로컬 모드)

`claude-trail`은 아직 npm에 없습니다. v0.3 (전역 설치)까지는 클론에서 실행하세요:

```bash
git clone https://github.com/OhGyeongtaek/claude-trail.git ~/projects/claude-trail
cd ~/projects/claude-trail
npm install
npm run build
```

빌드 결과 `dist/cli.js`와 `dist/hook.js`가 생성됩니다. `init` 명령은 `node $CLAUDE_PROJECT_DIR/dist/hook.js` 형태의 후크 명령을 등록하므로 **Claude Code를 관찰하려는 각 프로젝트 내에 claude-trail을 설치해야 합니다** (또는 심링크). 적절한 전역 설치는 v0.3 로드맵에 있습니다.

## 빠른 시작

Claude Code를 관찰하려는 모든 프로젝트에서:

```bash
# 1. 프로젝트 루트에 claude-trail을 클론하거나 심링크합니다 (위의 설치 참고).

# 2. .claude/settings.json에 5개 후크를 등록합니다
node /path/to/claude-trail/bin/claude-trail.js init

# 3. 한 터미널에서 대시보드를 시작합니다
node /path/to/claude-trail/bin/claude-trail.js watch

# 4. 다른 터미널에서 새로운 Claude Code 세션을 시작합니다
claude
```

> **⚠️ 후크는 세션 시작 시 로드됩니다.** `init`을 실행하기 전에 열어둔 Claude Code 세션은 여전히 기존 후크 설정으로 실행 중입니다 — 도구 호출이 캡처되지 않습니다. 세션을 다시 시작하세요.

## 명령어

### `claude-trail watch`

실시간 대시보드를 엽니다.

| 플래그 | 기본값 | 효과 |
|------|---------|--------|
| `--all` | ✓ | 모든 파일 확장자 표시 |
| `--md` |   | `.md` / `.mdx` / `.markdown`만 |
| `--ext <list>` |   | 명시적 쉼표로 구분된 확장자 화이트리스트. 예: `--ext .ts,.tsx,.md` (각 항목은 `.`으로 시작해야 함); `--md`보다 우선합니다 |
| `--tools <list>` | all | 쉼표로 구분된 도구 화이트리스트. 예: `--tools Read,Edit` (제어 이벤트는 항상 표시). 유효한 값: `Read`, `Edit`, `Write`, `Glob`, `Grep`, `Task` |
| `--since <duration>` |   | 컷오프보다 오래된 프리필 이벤트를 버립니다. 형식 `<N><unit>` (단위: `s`, `m`, `h`, 또는 `d`). 예: `--since 30m` |

**핫키** (대화형 TTY가 필요합니다 — 표준 입력이 파이프될 때는 비활성화됨)

| 키 | 작업 |
|-----|--------|
| `f` | 확장자 필터 순환: `all` ↔ `md` |
| `t` | 도구 필터 순환: `all` → `Read,Edit,Write` → `Read` → `Task` → `all` |
| `/` | 인라인 검색 입력을 엽니다. 부분 문자열(대소문자 구분 안 함) 필터가 렌더링된 스트림에 적용됩니다. `Enter`로 확정, `Esc`로 지웁니다 |
| `↑` / `↓` / `PgUp` / `PgDn` | 스트림을 스크롤합니다. 실시간 모드를 일시 중지하며 스크롤할 때 `Esc`를 누르거나 맨 아래로 돌아갈 때까지 `PAUSED — N new events` 표시자가 나타납니다 |
| `Esc` | 실시간 모드 재개 (검색 쿼리 및 스크롤 앵커 지웁니다) |
| `q` / `Ctrl+C` | 종료 |

### `claude-trail replay <session_id>`

완료된 세션을 `events.jsonl`에서 재생합니다. 실시간 워크스루가 아닌 정적 재생 방식입니다.
라이브 감시자에 영향 없이 Claude가 한 작업을 회고할 때 유용합니다.

| 플래그 | 효과 |
|------|--------|
| `--from HH:MM:SS` | 이 로컬 시간 이상의 이벤트만 |
| `--to HH:MM:SS` | 이 로컬 시간 이하의 이벤트만 |

**재생 제어** (TTY 필요)

| 키 | 작업 |
|-----|--------|
| `space` | 일시 중지 / 재개 |
| `→` / `←` | 한 이벤트 앞으로 / 뒤로 (자동 일시 중지) |
| `+` / `-` | 속도: `0.25× → 0.5× → 1× → 2× → 4× → 8×` 순환 |
| `q` / `Ctrl+C` | 종료 |

```bash
# 최근 세션 id를 찾아 재생합니다
SID=$(tail -n 200 .claude-trail/events.jsonl | jq -r .session | sort -u | head -1)
node /path/to/claude-trail/bin/claude-trail.js replay "$SID"
```

TTY가 아닌 호출은 `requires a TTY`로 종료됩니다. 알 수 없는 세션 id는 `no events found`로 종료됩니다.

### `claude-trail init`

`<project>/.claude/settings.json`에 5개 후크를 등록합니다:

| 후크 | 매처 |
|------|---------|
| `PostToolUse` | `Read\|Edit\|Write\|Glob\|Grep\|Agent` |
| `SubagentStop` | (없음) |
| `SessionStart` | (없음) |
| `SessionEnd` | (없음) |
| `PreCompact` | (없음) |

변경할 내용을 diff 형식으로 보여주고 확인을 요청합니다. 동일 파일의 다른 도구 후크는 보존됩니다.

| 플래그 | 효과 |
|------|--------|
| `--remove` | claude-trail의 후크 항목만 제거 |
| `--purge`  | `--remove`와 함께, `.claude-trail/`도 삭제 |
| `--yes` / `-y` | y/N 프롬프트 건너뛰기 (TTY가 아닌 사용에 필요) |

`init`은 멱등성을 가집니다: 이미 구성된 프로젝트에서 재실행하면 아무 작업도 하지 않습니다.

### 후크 호출 방식

`hook` 명령은 Claude Code가 `.claude/settings.json`의 후크 시스템을 통해 자동으로 호출합니다 — 사용자가 직접 실행하면 안 됩니다. `init` 중에 `bin/claude-trail-hook.js`를 참조하는 후크 명령으로 등록됩니다.

## 이벤트 로그 포맷

`<project>/.claude-trail/events.jsonl` — 라인당 하나의 JSON 객체. 3가지 구별되는 형태 (전체 스키마는 [DESIGN.md §5](./docs/DESIGN.md)에 있습니다):

```jsonc
// (a) 파일 도구
{"ts":"2026-05-07T05:32:18.421Z","session":"156ec647-...","tool":"Read",
 "path":"src/components/Card.tsx","ext":".tsx",
 "meta":{"tool_use_id":"toolu_01K5","lines":157,"duration_ms":3}}

// (b) 서브에이전트 호출 (Claude Code의 내부 이름 `Agent`는 `Task`로 정규화됨)
{"ts":"...","session":"156ec647-...","tool":"Task",
 "meta":{"tool_use_id":"toolu_01J","subagent_type":"Explore",
         "description":"Find OAuth handlers","agent_id":"a7d9ed34b488363a3","duration_ms":5135}}

// (c) 제어 이벤트
{"ts":"...","session":"156ec647-...","tool":"_control","event":"compact",
 "meta":{"trigger":"manual"}}
```

순수 JSONL이므로 표준 도구도 잘 작동합니다:

```bash
# 가장 많이 읽은 상위 10개 파일
jq -r 'select(.tool=="Read") | .path' .claude-trail/events.jsonl \
  | sort | uniq -c | sort -rn | head

# 모든 grep 쿼리
jq -r 'select(.tool=="Grep") | .meta.query' .claude-trail/events.jsonl

# 서브에이전트 호출
jq 'select(.tool=="Task") | {type:.meta.subagent_type, desc:.meta.description}' \
  .claude-trail/events.jsonl
```

## 프라이버시

claude-trail은 **경로, 메타데이터, 의도만** 기록합니다. 다음은 절대 저장하지 않습니다:

- `Read`로 읽은 파일 **내용** (라인 수만 기록)
- `Write`로 쓴 **본문** (바이트 수만 기록)
- `Edit`의 `old_string` / `new_string` — 파일 경로만 기록
- `Grep`의 **매칭된 라인** — 쿼리와 검색 루트만 기록 (검색 쿼리 *는* 사용자 의도 신호로 보존됨)
- `Task`의 `prompt` 본문과 서브에이전트의 `last_assistant_message` (잠재적으로 민감한 내용)
- `PreCompact`의 `custom_instructions`

로그는 당신 머신의 `<project>/.claude-trail/events.jsonl`에만 존재합니다. 네트워크로 전송되는 것이 없습니다.

`init`은 `.gitignore`를 수정하지 않습니다 — 원하면 `.claude-trail/`을 직접 추가하세요.

## 아키텍처

```
Claude Code 세션
       │ 도구 호출 / 라이프사이클 이벤트
       ▼
5개 후크 ─► claude-trail-hook (stdin 어댑터)
                  │ 하나의 JSON 라인 추가
                  ▼
       .claude-trail/events.jsonl
                  │ tail
                  ▼
       claude-trail watch (Ink TUI)
```

의도적으로 분리된 3가지 컴포넌트:

1. **후크 어댑터** (`dist/hook.js`) — 작음, React/Ink 임포트 없음, ~30 ms 콜드 스타트. 항상 종료 코드 0, Claude를 차단하지 않습니다.
2. **이벤트 저장소** — 추가 전용 JSONL. 충돌로부터 살아남으며, 하나의 잘못된 라인도 나머지를 손상시키지 않습니다.
3. **뷰어** (`dist/cli.js` + Ink) — 별도의 진입점이며, `watch`에서만 지연 로드됩니다.

전체 설계 이유, M0.5 측정 결과, 트레이드오프: [`docs/DESIGN.md`](./docs/DESIGN.md).

## 성능

- 후크 콜드 스타트: **~30 ms** (macOS). 예산: p95 ≤ 100 ms (DESIGN §1.1).
- `watch` 첫 프레임: 100 MB 로그에서 < 1 초.
- 메모리: 스트림은 1000 이벤트로 한정됨 (의미 있는 스크롤백을 지원하도록 v0.2에서 200으로부터 상향 조정); 카운터는 작은 Map에 유지됩니다.

## 한계

- **후크는 세션 시작 시 로드됨** — `init`은 Claude Code를 열기 전에 실행해야 합니다. 기존 세션은 캡처되지 않습니다.
- **카운터는 세션 간에 집계됨** — 헤더 합계 (Reads / Edits / Writes / …)는 모든 표시된 세션의 합입니다. 세션별 카운터는 v0.3 계획입니다.
- **프로젝트 범위 설치만 가능** — `init`은 프로젝트 상대 후크 경로를 씁니다. 전역 설치는 v0.3 계획입니다.
- **도구 매처 격차** — 일부 헤드리스 `claude -p` 호출은 선언된 매처 범위 밖의 도구에서 PostToolUse를 발화할 수 있습니다. 후크 어댑터는 안전망으로 자체 화이트리스트를 포함합니다.
- **서브에이전트 귀속은 `agent_id` 필드에 의존** — M0.5에서 검증됨. 향후 Claude Code 릴리스가 이 필드를 변경하면, 귀속은 수정이 출시될 때까지 평문 스트림 출력으로 폴백됩니다.

## 로드맵

| 버전 | 범위 |
|---------|-------|
| v0.1 | live `watch`, `init` / `init --remove`, 파일 이벤트, 서브에이전트 귀속, `/compact` 라이프사이클 |
| **v0.2** (현재) | ✅ FNV-1a 색상 코딩을 사용한 다중 세션 병합, ✅ 도구 필터용 `t` 핫키, ✅ 스트림 검색 (`/`) + 스크롤백 (`↑`/`↓`/`PgUp`/`PgDn`), ✅ `replay <session>`, ✅ `--ext` 커스텀 리스트, ✅ `--since <duration>` |
| v0.3 | 전역 `npm i -g`, 옵트인 Bash 매처, 일일 로그 로테이션, 사후 편집 도구, 세션별 카운터, `c` 카운터 리셋, `watch`용 `space` 일시 중지 핫키 |
| v0.4 | 정적 HTML 내보내기, 세션 비교, "현재 컨텍스트에서 살아있는 파일" 스냅샷 |
| v1.0 | npm 릴리스, 네이티브 (Go/Rust) 후크로 서브 밀리초 콜드 스타트 |

## 기여

PR 환영합니다. 사소하지 않은 작업 전에 [`docs/DESIGN.md` §17 (마일스톤)](./docs/DESIGN.md)과 §18 (미해결 질문)을 확인하고 이슈를 열어 중복 작업을 피해 주세요.

테스트를 실행합니다:

```bash
npm test            # node --test + tsx (v0.2 기준 124개 테스트)
npm run build       # tsc strict
```

## 라이선스

[MIT](./LICENSE)
