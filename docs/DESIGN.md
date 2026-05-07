# claude-trail — 설계 문서

> Claude Code가 작업 중에 어떤 파일을 읽고/검색하고/수정하는지를
> 실시간 CLI 대시보드로 시각화하는 오픈소스 도구.

- **상태:** Draft v0.1 (2026-05-07)
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

1. **Hook 어댑터** (`src/hook.js`)
   Claude의 PostToolUse hook이 stdin으로 JSON을 던지면, 의미 있는 필드만
   추출해서 events.jsonl에 한 줄 append. 의존성 없음(Node 표준 라이브러리만).
2. **이벤트 스토어** (`.claude-trail/events.jsonl`)
   프로젝트 루트의 append-only JSONL 파일. 단순 텍스트라 grep/jq로도 분석 가능.
3. **뷰어** (`src/commands/watch.js`)
   Ink로 만든 TUI. 파일을 tail하면서 실시간 렌더링.

## 5. 이벤트 스키마

events.jsonl의 한 줄 = 하나의 tool 호출.

```json
{
  "ts": "2026-05-07T05:32:18.421Z",
  "session": "fcfacf43-1956-495e-b62a-5804bd4ff301",
  "tool": "Read",
  "path": "src/components/Card.jsx",
  "ext": ".jsx",
  "meta": {
    "lines": 240
  }
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `ts` | ISO8601 | 이벤트 시각 (hook 실행 시각, ms 단위) |
| `session` | string | Claude 세션 ID |
| `tool` | enum | `Read` / `Edit` / `Write` / `Glob` / `Grep` |
| `path` | string | 대상 파일 경로 (프로젝트 루트 기준 상대경로). Glob/Grep은 패턴 또는 검색 디렉터리 |
| `ext` | string | 확장자 (`.md`, `.jsx` 등). 필터링용. Glob/Grep은 `null` 가능 |
| `meta` | object | tool별 부가정보 (Grep의 query, Glob의 pattern, Read의 line range 등) |

**Why JSONL?** 시간순 append가 자연스럽고, 부분 읽기/스트리밍에 강하며,
표준 도구(`tail`, `jq`)와 호환. 한 라인 손상이 전체를 망치지 않음.

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
┌─ claude-trail · live ──────────── filter: all ──┐
│ session fcfacf43… · uptime 03:22                │
│ Reads 32  Edits 4  Writes 1  Globs 2  Greps 7  │
├─────────────────────────────────────────────────┤
│ Stream                                          │
│  14:32:18  READ   src/components/Card.jsx       │
│  14:32:11  GREP   "useState" in src/            │
│  14:31:55  READ   gatsby-config.js              │
│  14:31:40  EDIT   src/utils/anim.js             │
│  …                                              │
├─────────────────────────────────────────────────┤
│ Top files                                       │
│  ████████  src/components/Card.jsx        8x    │
│  █████     gatsby-config.js               5x    │
│  ███       package.json                   3x    │
│  ██        src/index.js                   2x    │
└─ q quit · f filter ─────────────────────────────┘
```

세 영역으로 구성:

1. **Header:** 세션 ID, 경과 시간, 필터 상태, tool별 카운터.
2. **Stream:** 최신 12개 이벤트. 시각 / tool / 경로(또는 패턴).
3. **Top files:** 누적 호출 수 기준 상위 N개. 막대는 ASCII 블록(`█`).

색상은 Ink의 `<Text color>`로:
- `Read` → cyan, `Edit` → yellow, `Write` → magenta,
  `Glob`/`Grep` → green.
- 막대는 dim, 카운트는 bold.

## 8. 필터 시스템

세 가지 레이어로 동작:

1. **수집 단계**: hook은 모든 이벤트를 무조건 기록. 필터링 안 함.
   (이유: 나중에 다른 필터로 같은 데이터 재해석 가능해야 함.)
2. **CLI 플래그**: `watch --md` 같은 시작 시점 필터.
3. **TUI 핫키**: 실행 중 동적 토글 (`f`).

**프리셋 정의:**
- `all`: 필터 없음.
- `md`: `.md`, `.mdx`, `.markdown`.
- 향후: `code` (.js/.ts/.jsx/...), `config` (json/yaml/toml), `docs` (md+txt+rst).

필터는 표시(stream + top files)에만 영향, 헤더의 카운터는 `(필터 적용 N / 전체 M)`
형식으로 둘 다 보여줌.

## 9. 파일/패키지 구조

```
tools/claude-trail/
├─ package.json           # type: module, bin: claude-trail
├─ DESIGN.md              # ← 이 문서
├─ README.md              # 사용자용 (v0.2에서 작성)
├─ bin/
│  └─ claude-trail.js     # 진입점 (shebang)
└─ src/
   ├─ cli.js              # 인자 파싱, 서브커맨드 디스패치
   ├─ hook.js             # PostToolUse hook stdin 어댑터
   ├─ commands/
   │  ├─ watch.js         # Ink TUI 부트스트랩
   │  └─ init.js          # .claude/settings.json 갱신
   ├─ ui/
   │  ├─ Dashboard.js     # Ink 컴포넌트 (htm 템플릿)
   │  ├─ Stream.js
   │  ├─ TopFiles.js
   │  └─ Header.js
   └─ lib/
      ├─ paths.js         # 프로젝트 루트, 로그 경로 결정
      ├─ events.js        # JSONL tail/parse
      └─ filters.js       # 필터 프리셋 정의
```

**프로젝트 루트의 추가물:**
- `.claude/settings.json` — hook 등록 (init 명령이 생성)
- `.claude-trail/events.jsonl` — 이벤트 로그 (자동 생성, gitignore)
- `.gitignore` — `.claude-trail/` 추가

## 10. Hook 설치 방식

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
            "command": "node ./tools/claude-trail/bin/claude-trail.js hook"
          }
        ]
      }
    ]
  }
}
```

`claude-trail init`이 위 파일을 안전하게 생성/병합. 이미 hooks가 있으면 추가만.

**Hook 동작:**
- stdin으로 JSON 입력 받음 (Claude Code 표준).
- 실패해도 항상 exit 0. 사용자의 작업을 절대 막지 않는다.
- 5ms 내 종료 목표 (단순 append).

## 11. 보안/프라이버시 고려

- 이벤트는 *경로와 메타데이터*만 기록. **파일 내용은 절대 기록하지 않음.**
  - Read의 결과 본문, Grep의 매칭 라인 등은 hook 단계에서 폐기.
  - 단, Grep query 자체는 `meta.query`에 저장 (사용자 의도 추적용).
- 로그는 프로젝트 로컬 (`.claude-trail/`). 외부 전송 없음.
- gitignore로 커밋 방지. README에 명시.

## 12. 향후 확장 (Roadmap)

| 버전 | 기능 |
|------|------|
| v0.1 | watch (live) + init + hook + md/all 필터 |
| v0.2 | replay, --ext 커스텀, 세션 셀렉터, 카운터 리셋 |
| v0.3 | 글로벌 설치 (`npm i -g`), `~/.claude-trail/` 통합 모드 |
| v0.4 | HTML export (정적 리포트), 세션 비교 |
| v1.0 | 별도 repo 분리, npm 정식 배포 |

## 13. 구현 단계 (마일스톤)

1. **M1 — 데이터 파이프라인** (가장 먼저)
   - `bin/claude-trail.js` + `cli.js` 골격
   - `hook.js`: stdin → JSONL append
   - `lib/paths.js`: 프로젝트 루트 결정
   - 수동 검증: `echo '{"tool_name":"Read","tool_input":{"file_path":"a.js"}}' | claude-trail hook`
2. **M2 — TUI 골격**
   - Ink + htm 셋업
   - `commands/watch.js`: events.jsonl tail
   - 헤더 + 스트림만 (top files 없이)
3. **M3 — 누적 통계**
   - Top files 막대 그래프
   - Tool별 카운터
4. **M4 — 필터**
   - `--md`, `--all` 플래그
   - `f` 핫키 토글
5. **M5 — 설치 명령**
   - `claude-trail init`
   - 기존 settings.json 안전 병합
6. **M6 — 문서화 + 배포 준비**
   - README, 스크린샷, 라이선스 명확화

각 마일스톤 끝에 사용자에게 확인 받음.

## 14. 미해결 결정사항

> 이 문서를 사용자가 검토할 때 확정해야 할 항목들.

- **Q1.** 이벤트 로그의 보존 정책. 영구? 세션 단위 롤오버? 크기 제한?
  - 가설: v0.1은 무제한 append. v0.3에서 일자별 롤오버.
- **Q2.** `Read`만 보고 싶은 사용자도 있을 텐데, tool 단위 필터도 v0.1에 넣을까?
  - 가설: v0.2로 미룸. 일단 표시 단계에서 색으로만 구분.
- **Q3.** Glob/Grep을 "파일 상호작용"으로 치는 게 맞는가?
  - 가설: 포함. "Claude가 코드베이스를 어떻게 탐색하는지" 보는 것도 가치 있음.
    Top files 집계에서는 제외하고 Stream에만 노출.
- **Q4.** Ink는 ESM-only고 React 18을 요구한다. 사용자의 Node 18+ 가정 OK?
  - 가설: OK. engines.node = ">=18".
- **Q5.** 한국어 UI 지원 (i18n)?
  - 가설: v0.1은 영문 라벨 고정. 오픈소스 대상 고려.

---

## 다음 액션

이 문서가 OK면 M1(데이터 파이프라인)부터 구현 시작.
수정하고 싶은 부분 — 특히 §14의 미해결 항목 — 알려주시면 반영.
