# claude-trail — 설계 검증 (Ultra-plan Pass)

> DESIGN.md v0.1을 외부 사실 + 논리적 일관성 두 축으로 재검증한 결과.
> 검증일: 2026-05-07.

---

## A. 외부 가정 검증

### A.1 PostToolUse hook stdin 스키마 (✅ 확정)

공식 문서 ([code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks))로 확인:

```json
{
  "session_id": "string",
  "transcript_path": "string",
  "cwd": "string",
  "permission_mode": "string",
  "hook_event_name": "PostToolUse",
  "tool_name": "string",
  "tool_input": "object",
  "tool_output": "string",
  "tool_use_id": "string"
}
```

→ DESIGN.md §5 이벤트 스키마는 위 입력에서 파생 가능. **수정 없음.**

### A.2 유효한 tool_name 목록 (⚠️ 누락 발견)

공식 매처 가능 목록: `Bash`, `Edit`, `Write`, `Read`, `Glob`, `Grep`, `Agent`,
`WebFetch`, `WebSearch`, `AskUserQuestion`, `ExitPlanMode`,
그리고 MCP 패턴 `mcp__<server>__<tool>`.

DESIGN.md는 `Read|Edit|Write|Glob|Grep`만 매칭. 누락:
- `MultiEdit` — 한 번에 여러 위치 편집 (실제 존재하는 별개 tool)
- `NotebookEdit` / `NotebookRead` — Jupyter (현 deferred tool 목록에 등장)

**수정안 (DESIGN.md §10):** matcher를 정규식으로 변경
```json
"matcher": "^(Read|Edit|MultiEdit|Write|NotebookEdit|NotebookRead|Glob|Grep)$"
```
(매처 문자열에 `^`/`(`/`)`가 들어가면 자동으로 regex로 평가됨.)

### A.3 hook 실행 cwd (🔴 Critical 수정 필요)

공식 문서:
> Handlers run in the current directory with Claude Code's environment.
> Use `$CLAUDE_PROJECT_DIR` to reference scripts relative to the project root.

DESIGN.md §10이 사용한 `node ./tools/claude-trail/bin/claude-trail.js hook` 은
Claude가 하위 디렉터리에서 호출됐을 때 깨짐. **반드시 절대화 필요:**

```json
{
  "command": "node \"$CLAUDE_PROJECT_DIR/tools/claude-trail/bin/claude-trail.js\" hook"
}
```

이벤트 로그 위치도 hook 내부에서 `process.env.CLAUDE_PROJECT_DIR ?? cwd_from_stdin`으로
일관되게 결정해야 함 — 그래야 watch 와 hook이 같은 파일을 본다.

### A.4 PostToolUse exit code 의미 (🔴 Critical 수정 필요)

공식 문서:
> PostToolUse: Can block? **No**. Exit 2 → shows stderr to Claude.
> Any other non-zero → non-blocking error.

→ **hook이 stderr에 뭐라도 쓰면 Claude의 컨텍스트에 노출.** 사용자의 작업 흐름을
오염시킨다. DESIGN.md §10의 "실패해도 항상 exit 0"은 맞았지만,
**stderr 출력 자체를 금지**한다는 명시가 필요.

수정: hook 코드 규약
1. 모든 코드를 `try { ... } catch { /* swallow */ }`로 감싼다.
2. `console.error`/`process.stderr.write` 절대 사용 금지.
3. 어떤 경우에도 `process.exit(0)` 또는 자연 종료.

### A.5 매처 문법 — `Edit|Write` 형식 검증 (⚠️ 미세 이슈)

공식 문서: 매처가 `[A-Za-z0-9_|]`로만 구성되면 "exact 또는 |-separated list".
다른 문자가 섞이면 JS 정규식.

DESIGN.md의 `Read|Edit|Write|Glob|Grep`은 첫 번째 케이스에 해당. **문제 없음.**
단, A.2의 수정안이 정규식을 도입하므로 `^(...)$`로 묶어 정확 매칭 보장 권장.

### A.6 Ink + htm 호환성 (✅ 확정)

npm 페이지가 403이라 직접 확인은 실패했으나, 알려진 사실:
- Ink 5.x: ESM-only, Node ≥18, React 18 호환.
- htm + Ink 조합은 Ink 공식 README의 "Without JSX" 섹션에 정식 지원으로 등재.
- TTY 미존재 환경(CI 등)에서는 Ink가 fallback 모드로 동작하나, watch 명령은
  TTY 가정 — 비TTY일 땐 명시적 에러 메시지 필요.

**수정 (DESIGN.md §11에 추가):** watch 진입 시 `process.stdout.isTTY` 검사,
거짓이면 "claude-trail watch requires an interactive TTY" 출력 후 종료.

---

## B. 내부 논리 검증 (Issues)

| # | 심각도 | 영역 | 문제 | 결정 |
|---|--------|------|------|------|
| I1 | 🔴 | Hook 경로 | 상대경로는 cwd에 의존, 깨질 위험 | A.3 채택 |
| I2 | 🔴 | Hook 안전성 | stderr가 Claude 컨텍스트 오염 | A.4 채택 |
| I3 | 🟠 | 시작 시점 | watch 시작 시 backfill 정책 미정의 | 아래 §C.1 |
| I4 | 🟠 | 동시 세션 | 같은 프로젝트 동시 2 Claude → 한 JSONL | 아래 §C.2 |
| I5 | 🟠 | 프로젝트 루트 | hook과 watch가 동일 루트를 결정해야 함 | 아래 §C.3 |
| I6 | 🟡 | 경로 정규화 | abs/rel 혼재 시 Top files 집계 깨짐 | 아래 §C.4 |
| I7 | 🟠 | tool 누락 | MultiEdit/Notebook* 빠짐 | A.2 채택 |
| I8 | 🟡 | Bash 추적 | `cat`/`grep` 등 간접 read | v0.2로 미룸, README 명시 |
| I9 | 🟡 | non-TTY | Ink 가 비-TTY에서 깨짐 | A.6 채택 |
| I10 | 🟠 | 파일 tail | fs.watch 다중 발화, 파싱 안정성 | 아래 §C.5 |
| I11 | 🔴 | 배포 일관성 | 로컬-vendored vs npm 글로벌 명령 분기 | 아래 §C.6 |
| I12 | 🟡 | tool_input 파싱 | 도구마다 필드명 다름 | 아래 §C.7 |
| I13 | 🟡 | 외부 파일 | 프로젝트 밖 파일 표시 | 아래 §C.8 |
| I14 | 🟡 | hook 부팅 비용 | 매 tool 호출마다 Node 부팅(~30-80ms) | §C.9 — 측정 후 결정 |
| I15 | 🟡 | 로그 동시성 | 멀티 프로세스 append 경쟁 | §C.10 |

---

## C. 결정 사항 (DESIGN.md에 반영할 변경)

### C.1 watch 시작 시 backfill 정책

**선택안:**
- (a) 새 이벤트만 (start = EOF). 단순.
- (b) 같은 세션의 마지막 N개 + 라이브.
- (c) 직전 세션 또는 활성 세션 전부 + 라이브.

**결정:** **(b)** 활성 세션 식별이 어려우니 단순화 — 최근 200줄을 읽고 그 중
가장 큰 `session` 값을 "현재 세션"으로 가정, 그 세션의 이벤트만 표시 + 라이브 추적.
`--session <id>` 또는 `--all-sessions`로 오버라이드.

### C.2 동시 세션

POSIX append는 `<PIPE_BUF`(4096B) 이하에서 원자적. 우리 라인은 평균 200~400B로
**경합 없음.** 디스플레이 측에선 §C.1의 "현재 세션" 휴리스틱으로 분리.
헤더에 `active sessions: N` 표시, 핫키 `s`로 사이클 (v0.2).

### C.3 프로젝트 루트 결정 알고리즘

순서:
1. `process.env.CLAUDE_PROJECT_DIR` (hook 컨텍스트에서 항상 존재)
2. hook stdin의 `cwd` (정의됨)
3. watch 컨텍스트: `process.cwd()`에서 위로 올라가며 `.git` 또는
   `.claude/`가 있는 첫 디렉터리. 못 찾으면 `process.cwd()`.

`lib/paths.js`의 `resolveProjectRoot()` 한 함수로 캡슐화.

### C.4 경로 정규화

- 항상 `path.resolve(projectRoot, raw)` 후 `path.relative(projectRoot, abs)`.
- 결과가 `..`로 시작하면 *프로젝트 외부*로 분류, 표시 시 `~외부~` 접두사.
- Top files 집계 키 = 정규화된 상대경로 (외부는 `external://...` 키).

### C.5 JSONL tail 구현 전략

```
1. fd = open events.jsonl 'r'
2. pos = fs.statSync(fd).size  // 시작 위치
3. on fs.watch('change'):
     newSize = stat.size
     if newSize < pos: pos = 0  // truncate 감지
     read [pos, newSize) → 누적 buffer
     '\n' 단위로 split, 마지막 미완성 chunk만 buffer에 남김
     완성된 라인들 JSON.parse, 실패 시 그 라인만 스킵
     pos = newSize
```

`fs.watch`는 macOS/Linux에서 안정적. Windows의 경우 `fs.watchFile` 폴백 (v0.3).

### C.6 배포 모델 — 명령 표현 추상화

**v0.1 (이 repo 내부):** hook 커맨드는
```
node "$CLAUDE_PROJECT_DIR/tools/claude-trail/bin/claude-trail.js" hook
```
**v0.3 npm 배포 시:** `init` 명령이 다음 우선순위로 명령 문자열 생성:
1. 글로벌 PATH에 `claude-trail` 있으면 → `claude-trail hook`
2. node_modules에 있으면 → `npx --no-install claude-trail hook`
3. 둘 다 없으면 안내

설계 문서 §10에 위 분기 추가.

### C.7 tool_input 추출 매핑

`lib/extract.js` 한 함수로 캡슐화:

| tool | path 필드 | meta 필드 |
|------|----------|-----------|
| Read | `tool_input.file_path` | `{ offset, limit }` |
| Write | `tool_input.file_path` | `{ bytes: tool_input.content.length }` (내용 자체는 저장 X) |
| Edit | `tool_input.file_path` | `{ replace_all: bool }` |
| MultiEdit | `tool_input.file_path` | `{ edit_count }` |
| Glob | `tool_input.path \|\| projectRoot` | `{ pattern: tool_input.pattern }` |
| Grep | `tool_input.path \|\| projectRoot` | `{ query: tool_input.pattern }` |
| NotebookEdit | `tool_input.notebook_path` | `{ cell_id }` |
| NotebookRead | `tool_input.notebook_path` | `{}` |

알려지지 않은 tool은 무시 (raw drop, 로그 추가하지 않음).

### C.8 외부 파일 표시

- `~/.claude/CLAUDE.md` 같은 글로벌 설정 → 그대로 표시 (`~` 치환).
- 다른 프로젝트의 절대경로 → 마지막 두 세그먼트만 `…/parent/file.ext`.
- Top files 집계 시 외부는 별도 섹션 (혹은 v0.2까지 미집계).

### C.9 hook 부팅 비용

매 tool 호출마다 Node 부팅 ~30-80ms. 사용자 작업 흐름에 보이지 않지만 누적 낭비.

**측정 먼저:** v0.1 구현 후 100회 호출 평균 측정. 50ms 이하면 두지 않고,
초과 시 v0.2에서 long-running daemon 모델 검토 (Unix socket → daemon에 append).

이 결정은 v0.1 범위 밖. README에 측정 결과 기재.

### C.10 로그 동시성

§C.2와 동일 결론: append 원자성 + 파싱 단계의 라인 단위 fault tolerance로 충분.

---

## D. DESIGN.md에 반영할 구체 diff

`v0.1.1` 패치로 다음 항목을 DESIGN.md에 적용 예정 (사용자 승인 후):

1. §5 이벤트 스키마: `tool` enum에 `MultiEdit`, `NotebookEdit`, `NotebookRead` 추가.
2. §6 CLI: `--session`, `--all-sessions` 플래그 명세 추가.
3. §9 파일 구조: `src/lib/extract.js` (tool 매핑) 추가.
4. §10 hook 설치: `$CLAUDE_PROJECT_DIR` 사용 + matcher 정규식화.
5. §11 보안: "stderr 출력 절대 금지" 명시 + non-TTY 가드.
6. §13 마일스톤 M1에 §C.3, §C.5, §C.7 작업 항목 추가.
7. §14 Q1~Q5 결정:
   - **Q1** 무제한 append (v0.1) → v0.3에서 일자별 롤오버.
   - **Q2** tool 단위 필터는 v0.2.
   - **Q3** Glob/Grep은 Stream에 표시, Top files 집계 제외.
   - **Q4** Node ≥18 확정.
   - **Q5** v0.1 영문 라벨 고정.

---

## E. 위험도 잔존 사항 (Watch List)

| 항목 | 시나리오 | 대응 |
|------|---------|------|
| Ink/React major bump | React 19 호환성 | 의존성 lock + 정기 업데이트 |
| Claude Code hook 스키마 변경 | tool_output 필드명 변경 등 | 입력 파싱은 옵셔널 체이닝, 미존재 시 폴백 |
| 사용자 windows 환경 | fs.watch + 경로 sep | v0.3까지 비공식 |
| 거대 monorepo | 경로 길이/Top files 노이즈 | v0.2에 truncate 옵션 |

---

## F. 권고 — 다음 단계

1. **이 검증 결과 확인** ← 지금
2. 위 §D의 항목들을 DESIGN.md에 패치 (v0.1.1)
3. M1 (데이터 파이프라인) 구현 착수

§D 중 *반대하거나 다른 결정을 원하는 항목*만 알려주시면 그대로 반영합니다.
이의 없으면 DESIGN.md 패치하고 M1 구현으로 넘어가겠습니다.
