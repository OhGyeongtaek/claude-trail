# claude-trail — 설계 문서

> Claude Code가 작업 중에 어떤 파일을 읽고/검색하고/수정하는지를
> 실시간 CLI 대시보드로 시각화하는 오픈소스 도구.

- **상태:** Draft v0.7 (2026-05-07)
- **저자:** 오경택
- **위치:** `tools/claude-trail/` (현재 repo 내부, 추후 별도 repo로 분리 가능)
- **라이선스:** MIT

---

## 1. 목적 (Goals)

1. **가시성 (Visibility):** Claude가 한 세션 동안 *어떤 파일과 상호작용했고
   언제 컨텍스트가 끊겼는지*(세션 시작/종료, `/compact`)를 시간순 이벤트 이력으로
   사용자가 실시간 한눈에 파악할 수 있다.
2. **저관여 (Low friction):** 한 번 설치하면 백그라운드에서 자동 수집.
   사용자는 `claude-trail watch`만 띄우면 된다.
3. **CLI 우선:** 별도 브라우저/Electron 없이 터미널에서 완결.
4. **오픈소스 재사용성:** 다른 프로젝트/사용자가 npm으로 받아 쓸 수 있는 형태.

> **목적의 정확한 범위:** 본 도구가 보여주는 것은 *호출/제어 이벤트의 이력*이지
> "현재 컨텍스트에 살아있는 파일 스냅샷"이 아니다. 후자는 transcript 파싱이
> 필요한 별개 기능 — v0.4 로드맵의 HTML export와 함께 검토.

## 2. 비목적 (Non-goals, v0.1)

- 웹/HTML 대시보드 — 추후 별도 패키지로.
- Claude의 *생각* 추적 (assistant 메시지 내용 분석). 본 도구는 **tool 호출**만 본다.
- 멀티 사용자/팀 단위 집계.
- 보안 감사용 변조 방지(append-only) 보장.

## 3. 핵심 시나리오

| # | 시나리오 | 사용자 행동 | 도구 출력 |
|---|---------|------------|----------|
| S1 | "지금 Claude가 뭘 보고 있지?" | 작업 중 다른 터미널에 `claude-trail watch` | 실시간 스트림 + 누적 통계 |
| S2 | "마크다운 문서 위주로만 보고 싶다" | `claude-trail watch --md` 또는 TUI에서 `f` | md/mdx/markdown만 노출 |
| S2b | "Read만 보고 싶다" (Edit/Write/Glob/Grep 노이즈 제거) | `claude-trail watch --tools Read` 또는 TUI에서 `t` | Read 이벤트만 노출 |
| S3 | "어디에 접근이 몰리지?" | 같은 watch 화면 | Top files 막대그래프 |
| S4 | "이 세션 끝나고 회고하고 싶다" | (v0.2) `claude-trail replay <session>` | 정적 타임라인 출력 |
| S5 | "Claude가 서브에이전트로 뭘 시키고 있지?" | 같은 watch 화면 | Task 호출 + subagent_type/description, 서브에이전트의 내부 tool 호출(들여쓰기), 종료 요약 |

## 4. 아키텍처

```
                           ┌────────────────────┐
                           │  Claude Code 세션  │
                           └─────────┬──────────┘
                                     │ tool 실행
                                     ▼
                       ┌──────────────────────────┐
                       │ PostToolUse hook (Claude) │
                       │ → claude-trail hook        │
                       └─────────────┬─────────────┘
                                     │ JSON via stdin
                                     ▼
                ┌──────────────────────────────────────┐
                │ .claude-trail/events.jsonl (append)  │
                └────────────┬─────────────────────────┘
                             │ tail -f (chokidar 없이 fs.watch)
                             ▼
                 ┌────────────────────────────┐
                 │ claude-trail watch (Ink TUI)│
                 └────────────────────────────┘
```

**3개 컴포넌트로 분리:**

1. **Hook 어댑터** (`src/hook.ts` → `dist/hook.js`)
   Claude의 PostToolUse hook이 stdin으로 JSON을 던지면, 의미 있는 필드만
   추출해서 events.jsonl에 한 줄 append. 런타임 의존성 없음(Node 표준 라이브러리만).
2. **이벤트 스토어** (`.claude-trail/events.jsonl`)
   프로젝트 루트의 append-only JSONL 파일. 단순 텍스트라 grep/jq로도 분석 가능.
3. **뷰어** (`src/commands/watch.ts` → `dist/commands/watch.js`)
   Ink로 만든 TUI. 파일을 tail하면서 실시간 렌더링.

**언어/빌드:** 전 코드 **TypeScript**(strict). `tsc`로 `dist/`에 빌드한 후
`bin/claude-trail.js`(얇은 shebang 래퍼)가 `dist/cli.js`를 require.
hook은 매 tool 호출마다 기동되므로 런타임 transpile(`tsx` 등) 금지 — 항상 빌드 산출물 호출.

## 5. 이벤트 스키마

events.jsonl의 한 줄 = 하나의 이벤트. **세 종류**:

**(a) Tool 이벤트** — 파일 상호작용:
```json
{
  "ts": "2026-05-07T05:32:18.421Z",
  "session": "fcfacf43-1956-495e-b62a-5804bd4ff301",
  "tool": "Read",
  "path": "src/components/Card.tsx",
  "ext": ".tsx",
  "meta": { "offset": 1, "limit": 200 }
}
```

**(b) Control 이벤트** — 세션/컨텍스트/서브에이전트 경계:
```json
{
  "ts": "2026-05-07T05:35:02.118Z",
  "session": "fcfacf43-1956-495e-b62a-5804bd4ff301",
  "tool": "_control",
  "event": "compact",
  "meta": { "trigger": "auto" }
}
```

**(c) Subagent 호출 이벤트** — Task tool 호출:
```json
{
  "ts": "2026-05-07T05:36:10.220Z",
  "session": "fcfacf43-1956-495e-b62a-5804bd4ff301",
  "tool": "Task",
  "meta": {
    "subagent_type": "Explore",
    "description": "Find OAuth callback handlers",
    "task_id": "t_05361022"
  }
}
```

추가로, **서브에이전트의 내부 tool 호출**은 일반 tool 이벤트와 같은 형태지만
서로 다른 `session` 값을 가지고, `meta.parent_task_id`로 부모 Task와 연결됨
(가능한 경우, §5.1.3 best-effort).

| 필드 | 타입 | 설명 |
|------|------|------|
| `ts` | ISO8601 (UTC, ms) | 이벤트 시각. 항상 `Z` 접미사. 표시 단계에서 로컬 변환 |
| `session` | string | Claude 세션 ID (서브에이전트는 자체 세션 ID) |
| `tool` | enum | `Read` / `Edit` / `Write` / `Glob` / `Grep` / `Task` / `_control` |
| `path` | string \| undefined | 파일 경로 (tool 이벤트). Task/`_control`에는 없음 |
| `ext` | string \| null \| undefined | 확장자. `path.extname(path).toLowerCase()`로 자동 도출. Glob/Grep은 `null`. Task/`_control`에는 없음 |
| `event` | enum \| undefined | `_control`에서만 사용: `session_start` / `session_end` / `compact` / `subagent_stop` |
| `meta` | object | 이벤트별 부가정보 (§5.1). 비어 있을 수 있음 |

**Why JSONL?** 시간순 append가 자연스럽고, 부분 읽기/스트리밍에 강하며,
표준 도구(`tail`, `jq`)와 호환. 한 라인 손상이 전체를 망치지 않음.

**Why `_control` prefix?** Tool 이름 enum 공간을 침범하지 않기 위해 `_` 접두사.
필터/카운터 로직이 control 이벤트를 자동으로 별도 처리하도록 분기점 역할.

### 5.1 Hook 입력 → 이벤트 매핑

claude-trail은 **5종 hook**을 등록함: `PostToolUse`, `SessionStart`, `SessionEnd`,
`PreCompact`, `SubagentStop`. 모두 같은 hook 진입점(`dist/hook.js`)이 받고,
`hook_event_name` 필드로 분기.

#### 5.1.1 PostToolUse → tool 이벤트

PostToolUse hook은 Claude Code로부터 stdin에 다음 형태의 JSON을 받음:

```json
{
  "session_id": "fcfacf43-1956-495e-b62a-5804bd4ff301",
  "transcript_path": "/Users/.../<session>.jsonl",
  "cwd": "/Users/me/projects/foo",
  "hook_event_name": "PostToolUse",
  "tool_name": "Read",
  "tool_input": { "file_path": "/abs/path/src/Card.tsx", "offset": 1, "limit": 200 },
  "tool_response": { "...": "..." }
}
```

각 tool 매핑 규칙:

| tool_name | path | meta | 비고 |
|-----------|------|------|------|
| `Read` | `tool_input.file_path` (상대경로 변환) | `{ offset, limit }` | `tool_response` 본문은 **즉시 폐기**. 라인 수도 보존 안 함 (§12) |
| `Edit` | `tool_input.file_path` | `{ replace_all }` | `old_string`/`new_string` 저장 안 함 |
| `Write` | `tool_input.file_path` | `{ bytes: content.length }` | `content` 본문 저장 안 함 |
| `Glob` | `tool_input.path \|\| "."` | `{ pattern }` | path는 검색 루트 |
| `Grep` | `tool_input.path \|\| "."` | `{ query: pattern, glob, type }` | 검색어는 사용자 의도 추적용으로 보존 (§12) |
| `Task` | (없음) | `{ subagent_type, description, task_id }` | `tool_input.prompt`(서브에이전트 프롬프트)는 **저장 안 함** — 길고 프라이버시 위험. 첫 80자 프리뷰만 `description`이 비어있을 때 fallback으로 사용 |

**경로 정규화:** `file_path`가 절대경로면 프로젝트 루트(§15) 기준 상대경로로 변환.
프로젝트 밖이면 절대경로 유지 + `meta.outside = true`.

**누락/비정상 페이로드:** 기대 필드가 없으면 hook은 조용히 exit 0
(`.claude-trail/hook.error.log`에 한 줄 기록, §13).

#### 5.1.2 SessionStart / SessionEnd / PreCompact → control 이벤트

Claude Code가 보내는 페이로드와 매핑:

| hook_event_name | 추가 필드 | → events.jsonl 라인 |
|-----------------|---------|--------------------|
| `SessionStart` | `source: "startup"\|"resume"\|"clear"` | `{tool:"_control", event:"session_start", meta:{source}}` |
| `SessionEnd` | `reason: "clear"\|"logout"\|"prompt_input_exit"\|"other"` | `{tool:"_control", event:"session_end", meta:{reason}}` |
| `PreCompact` | `trigger: "manual"\|"auto"`, `custom_instructions` | `{tool:"_control", event:"compact", meta:{trigger}}` (custom_instructions는 프라이버시상 미저장) |

**`/clear`의 표현:** Claude Code는 `/clear` 시 `SessionEnd(reason:"clear")` →
`SessionStart(source:"clear")` 시퀀스를 발화하는 것으로 가정. 첫 실측에서 다르면
이 매핑만 보정 (events.jsonl 스키마는 변경 없음).

**`UserPromptSubmit`은 v0.1 미포함.** 매 사용자 메시지마다 발화하면 events.jsonl이
빠르게 비대해짐 — 이벤트 가치 대비 비용 큼. v0.2에서 옵트인(`init --include-prompts`) 검토.

#### 5.1.3 SubagentStop + 서브에이전트 attribution

**Task 호출(부모 컨텍스트):**
- 부모 세션이 `Task`를 호출 → `PostToolUse(tool_name=Task)` 발화 → §5.1.1 매핑으로
  `{tool:"Task", session:<parent>, meta:{subagent_type, description, task_id}}` 한 줄.
- `task_id`는 hook이 즉석에서 생성(`t_` + ts ms를 base36). 후속 attribution용 키.

**서브에이전트 종료:**

| hook_event_name | 추가 필드 | → events.jsonl |
|-----------------|---------|---------------|
| `SubagentStop` | `stop_hook_active`, `subagent_session_id`(있다면) | `{tool:"_control", event:"subagent_stop", session:<subagent>, meta:{parent_task_id}}` |

**서브에이전트 내부 tool 호출 attribution (best-effort, v0.1):**

서브에이전트의 자체 tool 호출은 별도 `session_id`로 PostToolUse를 발화. 부모와의 연결은 두 단계:

1. **공식 필드가 있으면 사용:** Claude Code hook 페이로드에 `parent_session_id` 또는
   `agent_context` 같은 필드가 들어오면 그대로 `meta.parent_task_id` 매핑 (실측 후 확정).
2. **Fallback 휴리스틱 (watch 측에서):** 가장 최근 미완료 `Task` 이벤트 (= 아직
   해당 task_id의 `subagent_stop`이 안 옴) 중 동일 cwd인 것에 묶음. 동시 다중 서브에이전트는
   Task 호출과 첫 PostToolUse 시간차가 가장 작은 쌍을 매칭.
   - 휴리스틱은 watch에서만 적용. events.jsonl 자체는 raw 그대로 유지 → v0.2 정식 attribution
     로직이 같은 파일을 재해석할 수 있음.
3. **표시:** 매칭된 서브에이전트의 tool 이벤트는 Stream에서 한 단계 들여쓰기 + `[<subagent_type>]` 라벨.

**입력 크기 한계 + cwd 결정 우선순위:**
- stdin은 buffered 1-shot read (Claude가 `tool_response` 큰 본문도 보낼 수 있음).
  10 MB 초과 시 잘라내고 처리(어차피 본문은 폐기).
- 프로젝트 루트(§15)를 결정할 cwd는 다음 우선순위:
  1) stdin payload의 `cwd` → 2) `process.env.CLAUDE_PROJECT_DIR` (Claude Code 제공) →
  3) `process.cwd()`.
- Claude의 retry로 동일 tool 호출이 중복 송신되어도 **dedup하지 않음**(v0.1).
  관측 그대로 기록. v0.2에서 (session, ts ms) 키로 옵션 dedup 검토.

## 6. CLI 인터페이스

```
claude-trail <command> [options]

Commands:
  watch              실시간 TUI 대시보드 시작
  init               현재 프로젝트에 hook 설치 (.claude/settings.json)
  hook               (내부) PostToolUse hook의 stdin 어댑터
  replay <session>   (v0.2) 세션 정적 재생

Options for `watch`:
  --md               마크다운 파일만 (.md, .mdx, .markdown) — 확장자 필터
  --all              모든 파일 (기본) — 확장자 필터
  --tools <list>     콤마 구분 tool 화이트리스트. 예: --tools Read 또는 --tools Read,Edit
                     기본: all (Read,Edit,Write,Glob,Grep). control 이벤트는 항상 표시
  --ext <list>       (v0.2) 콤마 구분 확장자, 예: --ext .md,.mdx
  --session <id>     (v0.2) 특정 세션만
  --since <duration> (v0.2) 최근 N (예: 10m, 1h)
```

`--md`와 `--tools`는 *직교적*으로 적용 (AND 결합). 예) `--md --tools Read`는 "Read한 마크다운만".

### TUI 핫키

| 키 | 동작 |
|----|------|
| `f` | **확장자 필터** 사이클: all → md → all |
| `t` | **Tool 필터** 사이클: all → Read → Edit → Write → Glob → Grep → all |
| `q` / `Ctrl+C` | 종료 |
| `c` | 화면 카운터 리셋 (v0.2) |

## 7. TUI 화면 설계

```
┌─ claude-trail · live ───── filter: ext=all tools=Read ─────┐
│ session fcfacf43… · uptime 03:22                            │
│ Reads 32  Edits 4  Writes 1  Globs 2  Greps 7              │
├─────────────────────────────────────────────────────────────┤
│ Stream                                                      │
│  14:32:18  READ   src/components/cards/Card.tsx             │
│  14:32:11  GREP   "useState" in src/                        │
│ ─── 14:32:00  /compact (auto) ───────────────────────────── │
│  14:31:55  READ   gatsby-config.js                          │
│  14:31:40  TASK   ⮕ Explore: "Find OAuth handlers"          │
│  14:31:42    ↳ READ  src/auth/oauth.ts        [Explore]     │
│  14:31:45    ↳ GREP  "callback" in src/auth/  [Explore]     │
│  14:31:51    ✓ Explore done · 1.3s · 4 calls                │
│  14:31:52  EDIT   src/utils/animation/anim.ts               │
│ ─── 14:30:00  session start (clear) ────────────────────── │
│  …                                                          │
├─────────────────────────────────────────────────────────────┤
│ Top files                                                   │
│  ████████  src/components/cards/Card.tsx              8x    │
│  █████     gatsby-config.js                           5x    │
│  ███       packages/web/package.json                  3x    │
│  ██        src/index.ts                               2x    │
└─ q quit · f ext-filter · t tool-filter ─────────────────────┘
```

세 영역으로 구성:

1. **Header:** 활성 세션 ID(§9), 경과 시간, 필터 상태, tool별 카운터.
2. **Stream:** 최신 N개 이벤트 (N = 화면 높이 기반 동적, 기본 12).
3. **Top files:** 누적 호출 수 기준 상위 N개. 막대는 ASCII 블록(`█`).

**시간 표시 형식:** `HH:MM:SS` (24h, OS 로컬 타임존). 날짜는 표시 안 함 — 같은
세션 내 짧은 시간 범위가 일반적. 자정 넘김 가시성 부족은 v0.2의 replay에서 해결.

**터미널 크기 정책 (영역 우선순위):**
화면 높이 부족 시 잘라내는 순서: ① TopFiles → ② Stream(라인 수 축소) →
③ Header(요약 1줄로 축약). 최소 5줄에서도 동작.
폭 60 컬럼 미만이면 `claude-trail: terminal too narrow (need ≥60)` 메시지 후 exit 1.

색상은 Ink의 `<Text color>`로:
- `Read` → cyan, `Edit` → yellow, `Write` → magenta,
  `Glob`/`Grep` → green.
- 막대는 dim, 카운트는 bold.

**경로 표시 규칙 (Stream + Top files 공통):**
- 파일명만이 아니라 **프로젝트 루트 기준 상대경로 전체**를 표시.
  예) `Card.tsx` ❌ → `src/components/cards/Card.tsx` ✅
- 파일명(basename)은 **bold/밝은 색**, 디렉터리 부분은 **dim**으로 톤 다운 →
  긴 경로에서도 파일명이 한눈에 잡힘.
- 너비 초과 시: **가운데 말줄임**(좌측 디렉터리부터 축약).
  예) `src/components/cards/very/long/path/Card.tsx`
      → `src/components/…/long/path/Card.tsx`
  파일명(basename)은 절대 자르지 않음.
- Glob/Grep의 경우 `path` 컬럼은 검색 루트 + (Grep) 따옴표로 감싼 query.
  예) `GREP   "useState" in src/`

**Control 이벤트 표시:**
- Stream에서 일반 라인이 아니라 **가로 구분선** 형식으로 강조:
  - `─── HH:MM:SS  /compact (auto|manual) ─── (freed ~Nk tokens)` (토큰 수치는 v0.2)
  - `─── HH:MM:SS  session start (clear|resume|startup) ───`
  - `─── HH:MM:SS  session end (clear|logout|...) ───`
- 색상: dim white + bold 키워드(`/compact`, `session start`).
- Top files 카운터: control 이벤트는 카운트 영향 없음.
- `/clear`로 새 SessionStart가 발생하면 **현재 watch 화면의 누적 카운터에 자동 마커**를 두고
  사용자가 `c` 핫키(v0.2)로 리셋할 수 있는 시점을 시각적으로 안내.

**서브에이전트 표시:**
- Task 호출 라인: `TASK   ⮕ <subagent_type>: "<description>"` (magenta + bold).
- 서브에이전트의 내부 tool 호출(매칭된 경우): **2 spaces 들여쓰기 + `↳ ` 마커 + `[<subagent_type>]` 우측 라벨**. 매칭 안 되면 일반 라인으로 (다른 session_id로만 보임).
- `subagent_stop` 이벤트: `   ✓ <subagent_type> done · <duration> · <N> calls` (green + dim).
- 서브에이전트의 내부 tool은 **부모의 Top files 집계에 포함**(파일 접근 자체는 같은 코드베이스).
  단 v0.2의 `--exclude-subagents` 옵션으로 분리 가능 검토.
- Tool 필터(§8)가 `Task`만 활성이면 서브에이전트 호출만 모아서 볼 수 있음.

**Top files 집계 룰:**
- 카운트 대상: `Read` + `Edit` + `Write` 합산.
  `Glob`/`Grep`은 *Stream에만* 노출하고 파일 단위 집계에서 제외
  (검색은 "파일 접근"이 아니라 "탐색").
- 정렬: 호출 수 내림차순 → 동률 시 최근 접근이 위.
- 표시 N: 화면 높이에 따라 4–8개 동적.
- 필터 적용 시: 현재 필터에 부합하는 파일만 후보.

## 8. 필터 시스템

**두 개의 직교 차원 + 세 레이어로 구성:**

차원:
- **확장자 필터** (`f` 핫키, `--md`/`--all` 플래그) — `ext` 필드 기준
- **Tool 필터** (`t` 핫키, `--tools` 플래그) — `tool` 필드 기준

두 필터는 AND로 결합. 예) `f=md` + `t=Read` → "Read한 마크다운만".

레이어:
1. **수집 단계**: hook은 모든 이벤트를 무조건 기록. 필터링 안 함.
   (이유: 다른 필터로 같은 데이터를 재해석할 수 있어야 함.)
2. **CLI 플래그**: `watch --md --tools Read` 같은 시작 시점 필터.
3. **TUI 핫키**: 실행 중 동적 토글 (`f`, `t`).

**확장자 필터 프리셋:**
- `all`: 필터 없음.
- `md`: `.md`, `.mdx`, `.markdown`.
- 향후: `code` (.js/.ts/.jsx/...), `config` (json/yaml/toml), `docs` (md+txt+rst).

**Tool 필터:**
- `all`: 6종 모두 (`Read`,`Edit`,`Write`,`Glob`,`Grep`,`Task`).
- 단일 선택: `Read` / `Edit` / `Write` / `Glob` / `Grep` / `Task`.
- 멀티 선택은 CLI 플래그(`--tools Read,Edit`)에서만 v0.1 지원. TUI는 단일 사이클(v0.2에서 멀티).
- **Control 이벤트(`_control`)는 tool 필터의 영향을 받지 않음** — 컨텍스트 경계는 항상 보이는 것이 안전.
- **서브에이전트 내부 호출은 부모의 tool 종류에 따라 필터링됨** (예: `Task`만 켜면 호출 라인만, `Read`만 켜면 부모와 서브 모두의 Read만).

**필터는 표시(stream + top files)에만 영향.** 헤더 카운터는 `(필터 N / 전체 M)` 둘 다 노출.
필터 상태는 헤더에 `filter: ext=md tools=Read` 형식으로 한 줄 표시.

## 9. 다중 세션 처리 (v0.1)

한 프로젝트에서 여러 Claude Code 인스턴스가 동시에 돌면 events.jsonl에
세션이 섞여 들어옴. v0.1의 동작:

- **수집:** 모든 세션의 이벤트를 한 파일에 그대로 append.
- **표시:** 기본적으로 **모든 세션을 합쳐 표시**.
  Stream 라인 앞에 세션 short id (`fcfa`)를 색칠해 구분.
- **활성 세션:** "가장 최근 이벤트가 발생한 세션"을 헤더에 표시.
  5초 이상 idle하고 다른 세션이 활성이면 헤더 갱신.
- **단일 세션 격리는 v0.2:** `--session <id>` 플래그로.
- **세션 색상 매핑:** 세션 ID의 FNV-1a 32-bit 해시 → 8색 안전 팔레트
  (cyan/yellow/magenta/green/blue/red/white/gray) 인덱스. 같은 세션은
  watch 재시작에도 같은 색. tool 색(§7)과 충돌하지 않게 short id 배경에만 적용.

**근거:** v0.1 사용자는 보통 한 세션만 운용. 두 세션이 겹칠 때
섞임이 *보이는* 게 *없는 것보다* 낫다(혼동을 알아챌 수 있음).

## 10. 파일/패키지 구조

```
tools/claude-trail/
├─ package.json           # type: module, bin: claude-trail
├─ tsconfig.json          # strict, module: NodeNext, target: ES2022
├─ DESIGN.md              # ← 이 문서
├─ README.md              # 사용자용 (v0.2에서 작성)
├─ bin/
│  ├─ claude-trail.js     # 얇은 shebang 래퍼 (require '../dist/cli.js')
│  └─ claude-trail-hook.js # hook 전용 shebang 래퍼 (require '../dist/hook.js')
├─ src/                   # ── TypeScript 원본 ──
│  ├─ cli.ts              # 인자 파싱, 서브커맨드 디스패치 (watch/init만)
│  ├─ hook.ts             # PostToolUse hook stdin 어댑터 — Ink/React 미참조
│  ├─ types.ts            # 이벤트/페이로드 타입 정의 (§5, §5.1)
│  ├─ commands/
│  │  ├─ watch.tsx        # Ink TUI 부트스트랩 (JSX, lazy import 대상)
│  │  └─ init.ts          # .claude/settings.json 갱신
│  ├─ ui/
│  │  ├─ Dashboard.tsx
│  │  ├─ Stream.tsx
│  │  ├─ TopFiles.tsx
│  │  ├─ Header.tsx
│  │  ├─ ControlMarker.tsx # control 이벤트 가로 구분선 (§7)
│  │  └─ formatPath.ts    # 가운데 말줄임 + basename bold (§7)
│  └─ lib/
│     ├─ paths.ts         # 프로젝트 루트, 로그 경로 결정
│     ├─ events.ts        # JSONL tail/parse (§13.1)
│     ├─ tail.ts          # fs.watch + offset 추적 + inode 재바인딩
│     ├─ session-color.ts # 세션 ID → 색상 매핑 (§9)
│     ├─ subagent.ts      # Task ↔ subagent session attribution (§5.1.3)
│     └─ filters.ts       # 필터 프리셋 정의
└─ dist/                  # tsc 빌드 산출물 (gitignore, npm publish 대상)
```

**진입점 분리 근거:** hook은 5ms 목표(§11). 만약 `dist/cli.js` 한 진입점에서
서브커맨드 디스패치 후 `import('./commands/watch.js')`로 lazy load해도, top-level
`import` 트리에 React/Ink가 들어가면 cold start 비용을 부담. 따라서 **`hook` 명령은
별도 entry(`dist/hook.js`)로 빌드**하고, `cli.ts`는 watch/init만 담당. `bin`도 두 개.

**TypeScript 결정 사항:**
- `tsconfig.json`: `"strict": true`, `"module": "NodeNext"`, `"target": "ES2022"`,
  `"jsx": "react-jsx"` (Ink TUI용).
- 빌드 스크립트: `"build": "tsc"`, `"dev": "tsc --watch"`.
- `package.json` `bin`은 `bin/claude-trail.js`(JS shebang)를 가리킴 →
  내부에서 `dist/cli.js` 로드. 사용자가 npm install 시 별도 빌드 불필요.
- `files` 필드: `["bin", "dist"]`만 publish.
- 런타임 deps: `ink`, `react` (peer 아님).
- Dev deps: `typescript`, `@types/node`, `@types/react`, `ink-testing-library`.
- **JSX 사용:** `htm` 대신 `.tsx`로 직접 작성 (TS와 잘 어울림). 빌드 후 결과물 크기 차이 미미.

**프로젝트 루트의 추가물:**
- `.claude/settings.json` — hook 등록 (init이 생성/병합)
- `.claude-trail/events.jsonl` — 이벤트 로그 (자동 생성, gitignore)
- `.claude-trail/hook.error.log` — hook 자체 에러 (§13)
- `.gitignore` — `.claude-trail/` 추가

## 11. Hook 설치 + 매처 정책

`.claude/settings.json`:
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Read|Edit|Write|Glob|Grep|Task",
        "hooks": [
          { "type": "command", "command": "node ./tools/claude-trail/dist/hook.js" }
        ]
      }
    ],
    "SubagentStop": [
      { "hooks": [
          { "type": "command", "command": "node ./tools/claude-trail/dist/hook.js" }
      ] }
    ],
    "SessionStart": [
      { "hooks": [
          { "type": "command", "command": "node ./tools/claude-trail/dist/hook.js" }
      ] }
    ],
    "SessionEnd": [
      { "hooks": [
          { "type": "command", "command": "node ./tools/claude-trail/dist/hook.js" }
      ] }
    ],
    "PreCompact": [
      { "hooks": [
          { "type": "command", "command": "node ./tools/claude-trail/dist/hook.js" }
      ] }
    ]
  }
}
```

`SessionStart`/`SessionEnd`/`PreCompact`은 tool 매처가 없는 hook이라 `matcher` 필드 생략.

`claude-trail init`이 위 파일을 안전하게 생성/병합. 동작 룰:

- `.claude/settings.json`이 없으면 생성.
- `hooks.PostToolUse`가 없으면 위 객체 추가.
- `hooks.PostToolUse`가 있고, **이미 같은 `command`(claude-trail의 hook 명령)를 가진 항목**이
  있으면 idempotent — 변경 없음, exit 0 + "already installed" 메시지.
- matcher 문자열은 다르지만 같은 command가 등록된 경우 → matcher만 갱신(병합), 다른 hook과
  공존 가능.
- 다른 도구의 PostToolUse 항목들은 절대 건드리지 않음.
- 작성 전 사용자에게 변경될 부분을 diff로 보여주고 `y` 확인.

**매처 선정 근거 (v0.1):**
v0.1은 *"파일 상호작용 + 컨텍스트 경계"*를 좁게 정의.

| Hook / Tool | v0.1 포함? | 근거 |
|-------------|----------|------|
| `PostToolUse: Read`, `Edit`, `Write` | ✅ | 핵심 사용 사례 |
| `PostToolUse: Glob`, `Grep` | ✅ (Stream만) | 코드베이스 탐색 추적 가치 |
| `PostToolUse: Task` (subagent 호출) | ✅ | 서브에이전트 가시화의 핵심 (§5.1.3) |
| `SessionStart` | ✅ | 세션 시작 / `/clear` 후 경계 시각화 |
| `SessionEnd` | ✅ | 세션 종료 / `/clear` 직전 경계 |
| `PreCompact` | ✅ | `/compact`(manual/auto) 시점 명시 — 컨텍스트 흐름 이해의 핵심 |
| `SubagentStop` | ✅ | 서브에이전트 종료(duration, status) 표시 |
| `PostToolUse: Bash` | ❌ | 파일 I/O 여부 불투명, 출력 본문이 길어 프라이버시 위험. v0.3 옵트인 검토 |
| `PostToolUse: MultiEdit`, `NotebookEdit` | ❌ | v0.1 대상 외. v0.2에서 매핑 추가 |
| `PostToolUse: WebFetch`, `WebSearch` | ❌ | "파일 상호작용" 정의 밖 |
| `UserPromptSubmit` | ❌ | 너무 빈번. v0.2 옵트인 |
| `PreToolUse`, `Stop`, `Notification` | ❌ | 정보 가치 낮거나 중복 |

**Hook 동작:**
- stdin으로 JSON 입력 받음 (Claude Code 표준).
- 실패해도 항상 exit 0. 사용자의 작업을 절대 막지 않음.
- 5ms 내 종료 목표 (단순 append). 이를 위해 hook 진입점은 **React/Ink 트리 전혀 미참조**
  (§10 진입점 분리).
- **동시성:** `fs.appendFileSync(path, line + "\n")`는 POSIX `O_APPEND`로
  열려 한 번의 `write()`로 nl-terminated 라인을 보냄. 라인 길이가
  `PIPE_BUF`(macOS/Linux 일반 4 KB) 이하인 한 다중 hook 동시 append에서
  라인 섞임 없음.
- **라인 길이 상한:** 각 이벤트 라인은 최대 **1 KB**. 초과 시 긴 필드(query, path)를
  말줄임 + `meta.truncated = true`.

## 12. 보안/프라이버시 고려

- 이벤트는 *경로와 메타데이터*만 기록. **파일 내용은 절대 기록하지 않음.**
  - Read 본문, Grep 매칭 라인, Edit old/new_string, Write content **모두 폐기**.
  - 단, Grep query 자체는 `meta.query`에 저장 (사용자 의도 추적용).
  - Read의 line count도 v0.1에서는 저장 안 함 (불필요한 누설 가능).
- 로그는 프로젝트 로컬 (`.claude-trail/`). 외부 전송 없음.
- gitignore로 커밋 방지. README에 명시.
- `init` 시 사용자에게 "이 도구는 파일 경로/검색어를 로컬 디스크에 기록합니다" 한 줄 고지.

## 13. 에러 처리 / 복구

**Hook 측 (절대 실패하지 않음):**
- 모든 예외를 try/catch로 잡아 `.claude-trail/hook.error.log`에 한 줄 append 후 exit 0.
- error.log는 회전 없음 (v0.1). 사용자가 수동 점검.
- events.jsonl 디렉터리 생성 실패(권한) → error.log에만 기록, 조용히 exit 0.

**Watch 측 (적극 회복):**
- events.jsonl이 없으면 → "Waiting for first event…" 화면 + 디렉터리 polling.
- 손상된 라인(JSON parse 실패) → 해당 라인만 skip, 카운터 `parseErrors++`,
  헤더에 `(N parse errors)` 표시.
- 파일이 외부에서 삭제/회전 → fs.watch 재바인딩, 실패 시 polling fallback.
  사용자에게 한 줄 경고.
- watch 자체 크래시 → exit code 1 후 종료. v0.1에서 자동 재시작 안 함.

### 13.1 Tail 알고리즘 (lib/tail.ts)

events.jsonl을 실시간으로 따라잡기 위한 알고리즘:

1. **시작 시 prefill:** 파일을 끝에서부터 역방향으로 읽어 **마지막 1000라인까지만**
   메모리에 적재. 그보다 오래된 이벤트도 Top files 누적 카운트에는 포함시키되,
   Stream에는 표시하지 않음. 이 `lookback`은 v0.2에서 `--lookback N` 노출.
   - 100 MB 파일에서도 시작 1초 내. 카운트 패스는 streaming(라인 단위)으로 수행하여
     메모리 상한 ≈ "고유 path 수 × 평균 path 길이".
2. **현재 offset 유지:** prefill 후 `fs.statSync(path).size`를 시작 offset으로 저장.
3. **변경 감시:** `fs.watch(path)`의 `change` 이벤트 → `fs.statSync` size가
   저장 offset보다 크면 `fs.createReadStream({ start: offset, end: newSize-1 })`로
   증분만 읽음 → 라인 분리 → 파싱 → 화면 갱신 → offset = newSize.
4. **회전/삭제 감지:** `change` 이벤트에서 size가 *작아지면* truncate/회전.
   inode를 `fs.statSync().ino` 비교로 검증, 다르면 fs.watch 재바인딩 + offset 0부터.
5. **Polling fallback:** Windows 또는 fs.watch 미동작 시 200ms 간격 stat 폴링으로 자동 전환
   (`EVENTS_POLL_MS` 환경변수로 조정 가능).
6. **부분 라인 버퍼:** 마지막 청크가 `\n`으로 끝나지 않으면 다음 read까지 보류.
   1 KB 라인 상한(§11)이 깨진 라인이 들어오면 안전하게 drop + parseErrors++.

## 14. 테스팅 전략

| 레벨 | 대상 | 도구 |
|------|------|------|
| Unit | hook 매핑 (§5.1), filters, paths, formatPath (§7) | `node --test` (Node 내장) |
| Integration | 가짜 페이로드 stdin → hook → events.jsonl 검증 | 위와 동일 |
| Snapshot | Ink 컴포넌트 출력 (Stream, TopFiles, Header) | `ink-testing-library` |
| E2E (smoke) | `init` → 가짜 hook 호출 → `watch` 1회 렌더 | 셸 스크립트 |
| Type | 컴파일 자체가 타입 검증 | `tsc --noEmit` (CI) |

**핵심 negative tests:**
- hook이 *어떤 입력에도* exit 0인가 (잘못된 JSON, 빈 stdin, 누락 필드, 거대 페이로드).
- events.jsonl이 read-only일 때 hook이 작업을 막지 않는가.
- 손상된 라인이 섞인 events.jsonl에서 watch가 정상 라인을 정확히 표시하는가.

CI: GitHub Actions, Node 18/20/22 매트릭스. Windows 별도 잡(`windows-latest`).

## 15. 호환성 + 환경

**Node:** `engines.node = ">=18"` (Ink 5 / ESM 요건).

**OS:**
- macOS / Linux: 1차 지원. `fs.watch`(inotify/kqueue) 사용.
- Windows: 2차 지원. `fs.watch`가 ReadDirectoryChangesW 기반이라
  거동 다름 — polling fallback 자동 활성화 (`EVENTS_POLL_MS=200`).
- Windows 터미널의 ANSI/유니코드 호환은 Windows Terminal / VS Code 통합 터미널 기준.
  구형 cmd.exe는 지원 외.

**터미널:** truecolor 가정하지 않음. 16색 fallback.

**프로젝트 루트 결정 (`lib/paths.ts`):**
1. **시작 cwd 결정:** hook은 §5.1의 우선순위 (stdin `cwd` →
   `CLAUDE_PROJECT_DIR` → `process.cwd()`). watch는 `process.cwd()`만.
2. 시작 cwd에서 위로 거슬러 올라가며 첫 번째 `.claude/` 또는 `.git/` 디렉터리를 찾음.
3. 못 찾으면 시작 cwd 자체를 루트로.
4. events.jsonl 위치는 `<root>/.claude-trail/events.jsonl` 고정.

   → 동일 알고리즘으로 hook과 watch가 같은 루트로 수렴 (단, 사용자가 watch를 다른 cwd에서
   띄우면 다른 루트를 보게 됨 — 의도된 동작).

## 16. 향후 확장 (Roadmap)

| 버전 | 기능 |
|------|------|
| v0.1 | watch (live) + init + hook + md/all 필터 |
| v0.2 | replay, --ext 커스텀, 세션 셀렉터, 카운터 리셋, MultiEdit/Task 매핑 |
| v0.3 | 글로벌 설치 (`npm i -g`), `~/.claude-trail/` 통합, Bash 옵트인 매핑 |
| v0.4 | HTML export (정적 리포트), 세션 비교 |
| v1.0 | 별도 repo 분리, npm 정식 배포 |

## 17. 구현 단계 (마일스톤)

1. **M0 — TypeScript 부트스트랩**
   - `tsconfig.json`, `package.json` (build/dev 스크립트), `bin/claude-trail.js` 래퍼
   - `src/types.ts`: 이벤트/페이로드 타입 (§5, §5.1)
   - `dist/`까지 빌드 동작 확인
2. **M1 — 데이터 파이프라인**
   - `cli.ts` 골격 (watch/init 디스패치)
   - `hook.ts`: stdin → JSONL append — **별도 진입점**, React/Ink 미참조
     - `hook_event_name` 분기로 5종(`PostToolUse`/`SessionStart`/`SessionEnd`/`PreCompact`/`SubagentStop`) 처리 (§5.1)
     - Task 매핑: subagent_type, description, task_id 생성 (§5.1.3)
   - `lib/paths.ts`: 프로젝트 루트 결정 (§15)
   - 수동 검증:
     - `echo '{"hook_event_name":"PostToolUse","tool_name":"Read","tool_input":{"file_path":"a.ts"}}' | node dist/hook.js`
     - `echo '{"hook_event_name":"PostToolUse","tool_name":"Task","tool_input":{"subagent_type":"Explore","description":"..."}}' | node dist/hook.js`
     - `echo '{"hook_event_name":"PreCompact","trigger":"auto"}' | node dist/hook.js`
     - `echo '{"hook_event_name":"SubagentStop"}' | node dist/hook.js`
   - 5ms 타이밍 측정 (`time` 명령) 회귀 방지
3. **M2 — TUI 골격**
   - Ink + JSX(.tsx) 셋업
   - `lib/tail.ts`: prefill + fs.watch + offset/inode 추적 (§13.1)
   - `commands/watch.tsx`: events.jsonl tail
   - 헤더 + 스트림만 (top files 없이)
   - `ui/formatPath.ts`: 경로 표시 규칙 (§7) — basename 강조 + 가운데 말줄임
   - `ui/ControlMarker.tsx`: control 이벤트 가로 구분선 렌더 (§7)
   - `ui/SubagentBlock.tsx`: Task 호출 + 들여쓰기된 자식 라인 + done 마커 (§7)
   - `lib/subagent.ts`: best-effort attribution (§5.1.3) — 부모 task_id 매칭
   - `lib/session-color.ts`: FNV-1a → 8색 매핑 (§9)
4. **M3 — 누적 통계**
   - Top files 막대 그래프 (§7 룰, 경로 전체 표시)
   - Tool별 카운터
5. **M4 — 필터**
   - 확장자: `--md`, `--all` 플래그 + `f` 핫키 토글
   - Tool: `--tools <list>` 플래그 + `t` 핫키 사이클
   - 두 필터의 AND 결합, 헤더에 상태 표시
   - control 이벤트는 tool 필터 무시 (§8)
6. **M5 — 설치 명령**
   - `claude-trail init`
   - 기존 settings.json 안전 병합
7. **M6 — 문서화 + 배포 준비**
   - README, 스크린샷, 라이선스 명확화

각 마일스톤 끝에 사용자에게 확인 받음.

## 18. 미해결 결정사항

> 이 문서를 사용자가 검토할 때 확정해야 할 항목들.

- **Q1.** 이벤트 로그 보존 정책. 영구? 세션 단위 롤오버? 크기 제한?
  - 가설: v0.1은 무제한 append. v0.3에서 일자별 롤오버 + 100 MB 상한.
- **Q2.** Top files 카운트에서 Read만 vs Read+Edit+Write?
  - 잠정 결정: **Read+Edit+Write 합산** (§7). 사용 후 재검토.
- **Q3.** 한국어 UI 지원 (i18n)?
  - 가설: v0.1은 영문 라벨 고정. 오픈소스 대상 고려.
- **Q4.** Bash 매처 추가 시점/형태?
  - 가설: v0.3에서 `init --include-bash` 옵트인 플래그.
- **Q5.** Ink 5 / React 19 메이저 업그레이드 트래킹?
  - 가설: v1.0 전까지 보수적, v0.x에서는 업그레이드 따라감.
- **Q6.** prefill `lookback` 기본값 1000 라인이 적절한가?
  - 가설: v0.1 1000. 실측 후 v0.2에서 `--lookback` 노출 + 기본값 재조정.
- **Q7.** Hook 입력의 `cwd`가 프로젝트 루트인지 cwd인지 케이스가 다를 수 있음.
  - 가설: §15의 위로 거슬러 탐색이 흡수. 차이 발견 시 transcript_path 기반 fallback 추가.
- **Q8.** Init 시 사용자 확인(`y`) 없이 비대화 모드(`--yes`)가 필요한가?
  - 가설: v0.2에서 추가. v0.1은 항상 대화형.
- **Q9.** `/clear`가 실제로 `SessionEnd(reason:"clear")` + `SessionStart(source:"clear")`
  순서로 발화되는가? (가정 기반, 실측 필요)
  - 가설: 그렇게 동작. 다르면 §5.1.2의 매핑만 보정.
- **Q10.** `PreCompact`의 `custom_instructions` 저장 — 사용자 의도 추적 가치 있지만
  프라이버시 우려.
  - 잠정 결정: v0.1 미저장(§5.1.2). v0.2에서 옵트인 검토.
- **Q11.** Subagent attribution: Claude Code hook 페이로드에 `parent_session_id`
  같은 공식 필드가 있는가? (실측 필요)
  - 가설: 있으면 그대로 사용, 없으면 §5.1.3 fallback 휴리스틱.
- **Q12.** 동시에 여러 서브에이전트가 돌 때 휴리스틱이 잘못 매칭하면?
  - 가설: v0.1은 잘못 매칭될 수 있음을 README에 명시. v0.2에서 공식 필드 발견 시 정확.
- **Q13.** Task의 `prompt` 본문 저장 옵션 (`init --include-task-prompts`)?
  - 가설: v0.2 옵트인 + 1 KB cap.

---

## 다음 액션

이 문서가 OK면 M1(데이터 파이프라인)부터 구현 시작.
수정하고 싶은 부분 — 특히 §18의 미해결 항목 — 알려주시면 반영.
