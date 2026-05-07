# 다음 세션 시작 가이드

> v0.1 끝난 상태에서 새 Claude Code 세션을 열어 v0.2 작업을 시작할 때
> 어떤 프롬프트를 던지면 컨텍스트가 빨리 잡히는지 정리해 둠.

## 1. 세션 시작하자마자 던질 한 줄 (권장)

```
이슈 #N 작업해줘. docs/DESIGN.md와 docs/NEXT-SESSION.md 먼저 읽고, 이슈 본문의 Tasks/Acceptance 따라서 진행해.
```

`#N`만 바꿔서 같은 패턴으로 5개 이슈 모두 사용 가능. Claude가 자동으로:
1. `gh issue view N` 으로 이슈 본문 확인
2. `docs/DESIGN.md`의 관련 섹션 (이슈 References에 명시) 읽음
3. 이 파일에서 코딩 컨벤션/명령어 확인
4. TaskCreate로 Tasks 항목 분해 후 작업

## 2. 이슈별 권장 프롬프트

### #1 Multi-session merge + FNV 색상
```
이슈 #1 시작. lib/session-color.ts 만들고 Stream/Header에 적용해. 기존 viewState는 이미 session 별로 키잉되어 있으니 reducer 변경은 최소화.
```

### #2 Tool filter 핫키 `t`
```
이슈 #2 시작. Dashboard.tsx에 t 키 핸들러 추가, viewState.ts에 cycleTools action. 기존 buildFilterState의 preset 정의 재사용.
```

### #3 `replay <session>` 명령
```
이슈 #3 시작. commands/replay.tsx 새로 만들고 Dashboard 셸 재사용. 라이브 tail 의존 제거하고 static 이벤트 배열을 useReducer에 흘려.
```

### #4 `--ext <list>` / `--since <duration>`
```
이슈 #4 시작. parseWatchArgs 확장 + matchesFilter에서 명시 확장자 Set 처리. tail.ts의 prefill에서 --since 적용.
```

### #5 스트림 검색 + 스크롤백
```
이슈 #5 시작. Stream에 live/paused/searching 상태 머신 도입. 가장 트리키하니 먼저 reducer + 단위 테스트로 상태 전이 검증한 뒤 UI 작업.
```

## 3. Claude가 자주 빠뜨리지 않도록 첫 메시지에 추가하면 좋은 컨텍스트

(상황에 따라 골라서 첫 프롬프트에 덧붙이세요)

- **테스트 우선:** "유닛 테스트부터 작성하고, 그다음 구현."
- **Hook cold start 임계:** "hook.ts 수정 시 React/Ink import 절대 추가 금지 (cold start 30ms 임계 유지)."
- **DESIGN.md 동기화:** "구현 끝나면 §17 마일스톤과 §18 Q-항목 갱신."
- **푸시 정책:** "마일스톤 한 단위 끝날 때마다 커밋 + 푸시."
- **Privacy 가드:** "이벤트에 file content / prompt 본문 / last_assistant_message / custom_instructions 절대 포함 금지."

## 4. 빠른 sanity 체크 명령어

새 세션이 컨텍스트 잘 잡았는지 확인용:

```bash
# 빌드/테스트가 깨끗한 상태에서 출발하는지
npm run build && npm test
# 96/96 pass면 정상

# 마지막 마일스톤 커밋 확인
git log --oneline -10

# 미해결 이슈 확인
gh issue list --label v0.2 --state open
```

## 5. 알아두면 좋은 파일 위치

| 영역 | 파일 |
|---|---|
| 설계 명세 | `docs/DESIGN.md` (§5 스키마, §11 hook 정책, §17 마일스톤, §18 Q-list) |
| 이벤트 매퍼 | `src/lib/events.ts` |
| Tail 워처 | `src/lib/tail.ts` |
| viewState reducer | `src/ui/viewState.ts` |
| Dashboard | `src/ui/Dashboard.tsx` |
| init 명령 | `src/commands/init.ts` + `src/lib/installer.ts` |
| 실측 fixture | `tests/fixtures/captured-payloads.jsonl` (M0.5) |
| 통합 테스트 패턴 | `tests/filter.integration.test.ts` (spawn + headless watch) |

## 6. 새 세션에서 hook이 발화되게 하려면

이 repo에서 `claude` 띄우면 `.claude/settings.json`의 5종 hook이 자동 등록됩니다 (M5에서 push됨). **단, 항상 새 세션이어야 함** — 이미 떠있는 세션은 hook 설정이 시작 시점에 frozen.

```bash
# claude-trail 동작을 dogfooding하려면:
node ./bin/claude-trail.js watch        # 터미널 A (라이브 보기)
claude                                   # 터미널 B (새 세션, 작업)
```

## 7. v0.1 마감 시점 스냅샷 (2026-05-07)

- 푸시된 커밋: 9건 (마지막: `364c391` M4)
- 단위 + 통합 테스트: 96/96 통과
- E2E smoke: init 4 시나리오, mapper 14 페이로드 replay, watch 라이브 갱신
- Hook cold start: ~30 ms (macOS, p95 ≤ 100 ms 임계 내)
- Open 이슈: #1–#5 (모두 v0.2 라벨)
