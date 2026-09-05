# Upstream

이 레포는 [`diffusionstudio/lottie`](https://github.com/diffusionstudio/lottie) (MIT)의
코드를 **반입(vendoring)** 한 것이다. GitHub 포크가 아니므로 upstream의 변경은
자동으로 따라오지 않고, 아래 절차로 **수동** 반영한다.

## 반입 시점

| 항목 | 값 |
| --- | --- |
| upstream 리모트 | `https://github.com/diffusionstudio/lottie.git` |
| 반입 커밋 | `3c72912fad543897f90045ed4d355813837927fc` (`3c72912`) |
| 커밋 날짜 | 2026-07-25 |
| 반입 날짜 | 2026-09-05 |
| 라이선스 | MIT (`LICENSE` 원문 그대로 유지) |

## 우리가 손댄 곳

upstream 변경을 가져올 때 충돌이 날 가능성이 높은 파일이다. 나머지는 반입
당시와 동일하다.

| 파일 | 우리 변경 |
| --- | --- |
| `README.md` | 팀 기준으로 전면 재작성 |
| `package.json` | `check:lottie` 스크립트 추가 |
| `skills/text-to-lottie/SKILL.md` | 레퍼런스 라우팅·Verification·텍스트 규칙 |
| `skills/text-to-lottie/references/player-contract.md` | 네이티브 텍스트 주의 |
| `skills/text-to-lottie/references/recipe-typography.md` | 아웃라인 출고 권장 |
| `skills/text-to-lottie/evals/output-rubric.md` | 아웃라인 기준으로 교체 |
| `skills/text-to-lottie/evals/reference-loading-prompts.json` | 기대 동작 교체 |

우리가 새로 만든 파일(upstream 에 없으므로 절대 충돌하지 않는다):

- `scripts/check-lottie-web-compat.mjs`
- `public/compare.html`
- `skills/text-to-lottie/references/renderer-constraints.md`
- `docs/UPSTREAM.md`

## upstream 변경 가져오기

포크가 아니라서 `git pull upstream main` 같은 건 쓸 수 없다. 히스토리가 이어져
있지 않기 때문이다. 대신 필요한 커밋만 골라 적용한다.

### 0. 리모트가 등록돼 있는지 확인

```bash
git remote -v | grep upstream || \
  git remote add upstream https://github.com/diffusionstudio/lottie.git
```

### 1. 가져오고, 반입 이후 무엇이 바뀌었는지 본다

```bash
git fetch upstream

# 반입 시점 이후의 upstream 커밋 목록
git log --oneline 3c72912..upstream/main

# 파일 단위로 무엇이 바뀌었는지
git diff --stat 3c72912..upstream/main
```

### 2. 우리 변경과 겹치는지 확인한다

위의 "우리가 손댄 곳" 표에 있는 파일이 diff 에 등장하면 수동 병합이 필요하다.
특히 `skills/text-to-lottie/` 아래는 우리가 정책을 뒤집어 놓은 곳이라
**upstream 쪽을 그대로 받으면 안 된다**. upstream 이 네이티브 텍스트를 다시
권장하는 문구를 넣었다면 그건 버리고, 그 외의 개선만 취한다.

### 3. 필요한 커밋만 골라 적용한다

```bash
git checkout -b chore/upstream-<short-hash>

# 커밋 단위로 가져올 때
git cherry-pick <upstream-commit>

# 파일 단위로 가져올 때 (우리가 안 건드린 파일이면 이쪽이 간단하다)
git checkout upstream/main -- <path>
```

충돌이 나면 우리 정책이 이긴다. 판단 기준은
`skills/text-to-lottie/references/renderer-constraints.md` 다.

### 4. 검증

```bash
npm install          # 의존성이 바뀌었을 수 있다
npm run check:lottie # BLOCK 0개
npx vite build       # 번들이 되는지
```

그리고 `/compare.html` 을 열어 플레이어와 비교 페이지가 여전히 뜨는지 본다.
upstream 이 `scripts/copy-canvaskit.mjs`, `vite-plugins/scenes.ts`,
`src/lib/scene.ts` 를 건드렸다면 비교 페이지가 영향을 받는다. 비교 페이지는
`/__scenes`(dev) 와 `/scenes.json`(빌드)의 `{ projects: [...] }` 모양,
그리고 `/canvaskit.wasm` 경로에 의존한다.

### 5. 기준점을 갱신한다

병합이 끝나면 이 문서 위쪽 표의 **반입 커밋**과 **반입 날짜**를 새 해시로
바꾼다. 이걸 빠뜨리면 다음 사람이 어디서부터 봐야 할지 알 수 없다.
