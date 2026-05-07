# claude-trail — 설계 문서

> Claude Code가 작업 중에 어떤 파일을 읽고/검색하고/수정하는지를
> 실시간 CLI 대시보드로 시각화하는 오픈소스 도구.

- **상태:** Draft v0.3 (2026-05-07)
- **저자:** 오경택
- **위치:** `tools/claude-trail/` (현재 repo 내부, 추후 별도 repo로 분리 가능)
- **라이선스:** MIT

---

## 1. 목적 (Goals)

1. **가시성 (Visibility):** Claude가 한 세션 동안 *어떤 파일들과 상호작용했는지*를
   사용자가 실시간으로 한눈에 파악할 수 있다.
2. **저관여 (Low friction):** 한 번 설치하면 백그라운드에서 자동 수집.
   사용자는 `claude-trail watch`만 띄우면 된다.
3. **CLI 우선:** 별도 브라우저/Electron 없이 터미널에서 완결.
4. **오픈소스 재사용성:** 다른 프로젝트/사용자가 npm으로 받아 쓸 수 있는 형태.

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
| S3 | "어디에 접근이 몰리지?" | 같은 watch 화면 | Top files 막대그래프 |
| S4 | "이 세션 끝나고 회고하고 싶다" | (v0.2) `claude-trail replay <session>` | 정적 타임라인 출력 |

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

events.jsonl의 한 줄 = 하나의 tool 호출.

```json
{
  "ts": "2026-05-07T05:32:18.421Z",
  "session": "fcfacf43-1956-495e-b62a-5804bd4ff301",
  "tool": "Read",
  "path": "src/components/Card.jsx",
  "ext": ".jsx",
  "meta": {}
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `ts` | ISO8601 (UTC, ms) | 이벤트 시각. 항상 `Z` 접미사. 표시 단계에서 로컬 변환 |
| `session` | string | Claude 세션 ID |
| `tool` | enum | `Read` / `Edit` / `Write` / `Glob` / `Grep` |
| `path` | string | 대상 파일 경로 (프로젝트 루트 기준 상대경로). Glob/Grep은 검색 루트 |
| `ext` | string \| null | 확장자 (`.md`, `.jsx` 등). Glob/Grep은 `null` |
| `meta` | object | tool별 부가정보 (§5.1) |

**Why JSONL?** 시간순 append가 자연스럽고, 부분 읽기/스트리밍에 강하며,
표준 도구(`tail`, `jq`)와 호환. 한 라인 손상이 전체를 망치지 않음.

### 5.1 Hook 입력 → 이벤트 매핑

PostToolUse hook은 Claude Code로부터 stdin에 다음 형태의 JSON을 받음:

```json
{
  "session_id": "fcfacf43-1956-495e-b62a-5804bd4ff301",
  "transcript_path": "/Users/.../<session>.jsonl",
  "cwd": "/Users/me/projects/foo",
  "hook_event_name": "PostToolUse",
  "tool_name": "Read",
  "tool_input": { "file_path": "/abs/path/src/Card.jsx", "offset": 1, "limit": 200 },
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

**경로 정규화:** `file_path`가 절대경로면 프로젝트 루트(§15) 기준 상대경로로 변환.
프로젝트 밖이면 절대경로 유지 + `meta.outside = true`.

**누락/비정상 페이로드:** 기대 필드가 없으면 hook은 조용히 exit 0
(`.claude-trail/hook.error.log`에 한 줄 기록, §13).

## 6. CLI 인터페이스

```
claude-trail <command> [options]

Commands:
  watch              실시간 TUI 대시보드 시작
  init               현재 프로젝트에 hook 설치 (.claude/settings.json)
  hook               (내부) PostToolUse hook의 stdin 어댑터
  replay <session>   (v0.2) 세션 정적 재생

Options for `watch`:
  --md               마크다운 파일만 (.md, .mdx, .markdown)
  --all              모든 파일 (기본)
  --ext <list>       (v0.2) 콤마 구분 확장자, 예: --ext .md,.mdx
  --session <id>     (v0.2) 특정 세션만
  --since <duration> (v0.2) 최근 N (예: 10m, 1h)
```

### TUI 핫키

| 키 | 동작 |
|----|------|
| `f` | 필터 모드 사이클: all → md → all |
| `q` / `Ctrl+C` | 종료 |
| `c` | 화면 카운터 리셋 (v0.2) |

## 7. TUI 화면 설계

```
┌─ claude-trail · live ─────────────────────── filter: all ──┐
│ session fcfacf43… · uptime 03:22                            │
│ Reads 32  Edits 4  Writes 1  Globs 2  Greps 7              │
├─────────────────────────────────────────────────────────────┤
│ Stream                                                      │
│  14:32:18  READ   src/components/cards/Card.tsx             │
│  14:32:11  GREP   "useState" in src/                        │
│  14:31:55  READ   gatsby-config.js                          │
│  14:31:40  EDIT   src/utils/animation/anim.ts               │
│  …                                                          │
├─────────────────────────────────────────────────────────────┤
│ Top files                                                   │
│  ████████  src/components/cards/Card.tsx              8x    │
│  █████     gatsby-config.js                           5x    │
│  ███       packages/web/package.json                  3x    │
│  ██        src/index.ts                               2x    │
└─ q quit · f filter ─────────────────────────────────────────┘
```

세 영역으로 구성:

1. **Header:** 활성 세션 ID(§9), 경과 시간, 필터 상태, tool별 카운터.
2. **Stream:** 최신 N개 이벤트 (N = 화면 높이 기반 동적, 기본 12).
3. **Top files:** 누적 호출 수 기준 상위 N개. 막대는 ASCII 블록(`█`).

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

**Top files 집계 룰:**
- 카운트 대상: `Read` + `Edit` + `Write` 합산.
  `Glob`/`Grep`은 *Stream에만* 노출하고 파일 단위 집계에서 제외
  (검색은 "파일 접근"이 아니라 "탐색").
- 정렬: 호출 수 내림차순 → 동률 시 최근 접근이 위.
- 표시 N: 화면 높이에 따라 4–8개 동적.
- 필터 적용 시: 현재 필터에 부합하는 파일만 후보.

## 8. 필터 시스템

세 가지 레이어로 동작:

1. **수집 단계**: hook은 모든 이벤트를 무조건 기록. 필터링 안 함.
   (이유: 다른 필터로 같은 데이터를 재해석할 수 있어야 함.)
2. **CLI 플래그**: `watch --md` 같은 시작 시점 필터.
3. **TUI 핫키**: 실행 중 동적 토글 (`f`).

**프리셋 정의:**
- `all`: 필터 없음.
- `md`: `.md`, `.mdx`, `.markdown`.
- 향후: `code` (.js/.ts/.jsx/...), `config` (json/yaml/toml), `docs` (md+txt+rst).

필터는 표시(stream + top files)에만 영향. 헤더 카운터는 `(필터 N / 전체 M)` 둘 다 노출.

## 9. 다중 세션 처리 (v0.1)

한 프로젝트에서 여러 Claude Code 인스턴스가 동시에 돌면 events.jsonl에
세션이 섞여 들어옴. v0.1의 동작:

- **수집:** 모든 세션의 이벤트를 한 파일에 그대로 append.
- **표시:** 기본적으로 **모든 세션을 합쳐 표시**.
  Stream 라인 앞에 세션 short id (`fcfa`)를 색칠해 구분.
- **활성 세션:** "가장 최근 이벤트가 발생한 세션"을 헤더에 표시.
  5초 이상 idle하고 다른 세션이 활성이면 헤더 갱신.
- **단일 세션 격리는 v0.2:** `--session <id>` 플래그로.

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
│  └─ claude-trail.js     # 얇은 shebang 래퍼 (require '../dist/cli.js')
├─ src/                   # ── TypeScript 원본 ──
│  ├─ cli.ts              # 인자 파싱, 서브커맨드 디스패치
│  ├─ hook.ts             # PostToolUse hook stdin 어댑터
│  ├─ types.ts            # 이벤트/페이로드 타입 정의 (§5, §5.1)
│  ├─ commands/
│  │  ├─ watch.tsx        # Ink TUI 부트스트랩 (JSX)
│  │  └─ init.ts          # .claude/settings.json 갱신
│  ├─ ui/
│  │  ├─ Dashboard.tsx
│  │  ├─ Stream.tsx
│  │  ├─ TopFiles.tsx
│  │  ├─ Header.tsx
│  │  └─ formatPath.ts    # 가운데 말줄임 + basename bold (§7)
│  └─ lib/
│     ├─ paths.ts         # 프로젝트 루트, 로그 경로 결정
│     ├─ events.ts        # JSONL tail/parse
│     └─ filters.ts       # 필터 프리셋 정의
└─ dist/                  # tsc 빌드 산출물 (gitignore, npm publish 대상)
```

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
        "matcher": "Read|Edit|Write|Glob|Grep",
        "hooks": [
          {
            "type": "command",
            "command": "node ./tools/claude-trail/dist/cli.js hook"
          }
        ]
      }
    ]
  }
}
```

`claude-trail init`이 위 파일을 안전하게 생성/병합. 기존 hooks가 있으면 추가만.

**매처 선정 근거 (v0.1):**
v0.1은 *"Claude가 어떤 파일을 직접 다뤘는가"*를 좁게 정의.

| Tool | v0.1 포함? | 근거 |
|------|----------|------|
| `Read`, `Edit`, `Write` | ✅ | 핵심 사용 사례 |
| `Glob`, `Grep` | ✅ (Stream만) | 코드베이스 탐색 추적 가치 |
| `Bash` | ❌ | 파일 I/O 여부 불투명, 출력 본문이 길어 프라이버시 위험. v0.3 옵트인 검토 |
| `MultiEdit`, `NotebookEdit` | ❌ | v0.1 대상 외. v0.2에서 매핑 추가 |
| `Task` (subagent) | ❌ | subagent의 PostToolUse가 별도 라벨링 필요. v0.2 |
| `WebFetch`, `WebSearch` | ❌ | "파일 상호작용" 정의 밖 |

**Hook 동작:**
- stdin으로 JSON 입력 받음 (Claude Code 표준).
- 실패해도 항상 exit 0. 사용자의 작업을 절대 막지 않음.
- 5ms 내 종료 목표 (단순 append).
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

**프로젝트 루트 결정 (`lib/paths.js`):**
1. hook은 stdin의 `cwd`에서 시작, watch는 자기 cwd에서 시작.
2. 위로 거슬러 올라가며 첫 번째 `.claude/` 또는 `.git/` 디렉터리를 찾음.
3. 못 찾으면 시작 cwd 자체를 루트로.
4. events.jsonl 위치는 `<root>/.claude-trail/events.jsonl` 고정.

   → 동일 알고리즘으로 hook과 watch가 같은 루트로 수렴.

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
   - `cli.ts` 골격 (서브커맨드 디스패치)
   - `hook.ts`: stdin → JSONL append (§5.1 매핑)
   - `lib/paths.ts`: 프로젝트 루트 결정 (§15)
   - 수동 검증: `echo '{"hook_event_name":"PostToolUse","tool_name":"Read","tool_input":{"file_path":"a.ts"}}' | node dist/cli.js hook`
3. **M2 — TUI 골격**
   - Ink + JSX(.tsx) 셋업
   - `commands/watch.tsx`: events.jsonl tail
   - 헤더 + 스트림만 (top files 없이)
   - `ui/formatPath.ts`: 경로 표시 규칙 (§7) — basename 강조 + 가운데 말줄임
4. **M3 — 누적 통계**
   - Top files 막대 그래프 (§7 룰, 경로 전체 표시)
   - Tool별 카운터
5. **M4 — 필터**
   - `--md`, `--all` 플래그
   - `f` 핫키 토글
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

---

## 다음 액션

이 문서가 OK면 M1(데이터 파이프라인)부터 구현 시작.
수정하고 싶은 부분 — 특히 §18의 미해결 항목 — 알려주시면 반영.
