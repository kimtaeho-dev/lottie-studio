# lottie-studio

디자이너가 **프로덕션 애니메이션 에셋**을 만드는 작업대다. 코딩 에이전트가
Lottie JSON 을 직접 쓰고, 로컬 플레이어가 바로 렌더해준다.

미리보기 엔진은 Skia Skottie 지만 **우리 프로덕션 재생은 lottie-web 5.x SVG**
다. 두 엔진의 지원 범위가 겹치지 않아서, 미리보기에서 멀쩡한 씬이 프로덕션에서
깨질 수 있다. 이 레포의 스캐너와 비교 페이지는 그 간극을 막기 위한 것이다.

---

## 처음 여는 사람이 할 일

### 1. 설치

```bash
npm install
```

`postinstall` 이 `public/canvaskit.wasm` 을 만든다. 이 파일이 없으면 플레이어와
비교 페이지 둘 다 안 뜬다.

### 2. 플레이어 실행

```bash
npm run dev
```

<http://localhost:3030> 이 열린다. 왼쪽 사이드바에 프로젝트와 씬이 보인다.

### 3. 에이전트에게 씬을 시킨다

이 레포에는 `skills/text-to-lottie/` 스킬이 들어 있다. 코딩 에이전트에게 원하는
애니메이션을 말하면 스킬 규칙을 따라 씬을 만든다.

> 예: "제품 출시 로워서드를 만들어줘. 1920×1080, 60fps, 3초. 배경은 투명,
> 브랜드 컬러는 #2F6BFF. ease-in-out 타이밍으로."

어떤 프롬프트가 어떤 결과로 이어지는지 감이 안 오면
[`docs/EXAMPLES.md`](docs/EXAMPLES.md) 를 먼저 본다. 실제로 써서 만든 예시 씬
4개와, 그 씬을 만들 때 쓴 프롬프트 원문이 나란히 있다.

프롬프트를 잘 쓰는 요령:

- **근거를 준다.** SVG, 실제 수치, 스크린샷이 있으면 결과가 확연히 좋아진다.
- **모션 용어로 말한다.** ease-in, ease-out, 스태거, 오버슛 같은 말이 통한다.
- **카메라처럼 생각한다.** 푸시인, 팬, 줌 같은 카메라 무빙을 명시한다.
- **필요한 컨트롤을 요구한다.** 기본값은 배경색 정도만 노출된다. 속성 패널에서
  만지고 싶은 값이 있으면 슬롯으로 빼달라고 말한다.
- **FPS 와 길이를 못 박는다.**

씬은 `public/projects/<project>/<scene-N>/lottie.json` 에 저장되고, 에이전트가
파일을 고치면 플레이어가 실시간으로 갱신된다.

### 4. 호환성 스캐너를 돌린다

```bash
npm run check:lottie
```

BLOCK 이 하나라도 있으면 **실패(exit 1)** 다. 배포하면 안 된다. 각 항목의
이유와 대안은 [`skills/text-to-lottie/references/renderer-constraints.md`](skills/text-to-lottie/references/renderer-constraints.md)
에 있다.

WARN 은 통과시키지만, 두 렌더러가 다르게 그릴 수 있는 구간이라는 뜻이다.
다음 단계에서 반드시 눈으로 본다.

특정 씬만 보려면:

```bash
node scripts/check-lottie-web-compat.mjs public/projects/main-project/scene-1/lottie.json
```

### 5. 비교 페이지에서 두 렌더러를 나란히 본다

```
http://localhost:3030/compare.html?src=/projects/main-project/scene-1/lottie.json
```

왼쪽이 Skottie(미리보기), 오른쪽이 lottie-web SVG(프로덕션)다. 슬라이더로
프레임 **`0`**, **중간**, **`op - 1`** 을 고정하고 **양쪽 패널을 둘 다** 본다.
한쪽만 보는 건 확인이 아니다.

두 패널이 다르면 그 원인을 없앨 때까지 고친다.

> **텍스트가 있는 씬은 판정이 반대다.** 두 패널의 글자가 서로 **다르게** 보이면
> 폰트가 양쪽에 제대로 들어간 것이라 정상이다. **똑같이** 보이면 오히려
> `@font-face` 주입이 실패해 양쪽 다 시스템 폰트로 폴백했을 가능성이 크다.
> 페이지 하단의 진단 로그에서 폰트 로드 성공 여부를 확인한다.
> 애초에 네이티브 텍스트(`ty:5`)는 BLOCK 이므로 아웃라인으로 변환하는 게 정답이다.

### 6. 배경 정책을 확인한다

전면 구성이면 `bgColor` 슬롯을 가진 배경 레이어가 있어야 하고, 로고·아이콘·
로더·오버레이·로워서드는 투명이 기본이다. 비교 페이지의 체커보드로 알파를 본다.

---

## 명령어

| 명령 | 하는 일 |
| --- | --- |
| `npm install` | 의존성 설치 + `public/canvaskit.wasm` 생성 |
| `npm run dev` | 플레이어 dev 서버 (포트 3030) |
| `npm run check:lottie` | 모든 씬에 lottie-web 호환성 스캐너 실행 |
| `npm run check:motion` | 정지 프레임으로는 안 보이는 이징 스냅(재생 중 순간 튐) 검사, 브라우저 불필요 |
| `npm run check:text-slots` | 텍스트 슬롯 유니코드 테스트 |
| `npm run build` | 프로덕션 빌드 |
| `npm run preview` | 빌드 결과물 미리보기 |

---

## 씬 구조

```
public/projects/
  <project>/
    <scene-N>/
      lottie.json      필수. 이게 없으면 씬으로 안 잡힌다
      controls.json    선택. 속성 패널 라벨/범위
      <이미지 파일>     assets[].p 에 파일명만 적어 참조
      <폰트 파일>       .ttf/.otf/.ttc (작업 중 네이티브 텍스트용)
```

`scene-<N>` 의 뒤 숫자가 정렬 순서가 되고, 폴더 이름이 그대로 URL 세그먼트
(`/<project>/<scene>`)가 된다.

---

## 출고 전 체크리스트

1. JSON 이 파싱되는가
2. `npm run check:lottie` 가 BLOCK 0개로 통과하는가
3. `npm run check:motion` 이 통과하는가 (정지 프레임엔 안 보이는 이징 스냅 검사 — 브라우저 불필요)
4. `/compare.html` 에서 프레임 `0`, 중간, `op - 1` 을 **양쪽 패널** 모두 봤는가 (브라우저를 쓸 수 있을 때)
5. 두 패널의 차이 원인을 제거했는가
6. 배경 정책이 용도에 맞는가
7. 씬 용량이 150KB 이하인가 (이미지는 base64 인라인 대신 외부 파일)

---

## 문서

- [`skills/text-to-lottie/references/renderer-constraints.md`](skills/text-to-lottie/references/renderer-constraints.md)
  — BLOCK/WARN 목록, 각각의 이유와 대안, 안전 목록, 예산, 완료 조건
- [`skills/text-to-lottie/references/player-contract.md`](skills/text-to-lottie/references/player-contract.md)
  — 플레이어가 씬에 요구하는 계약(경로, 슬롯, 폰트, 텍스트)
- [`skills/text-to-lottie/SKILL.md`](skills/text-to-lottie/SKILL.md)
  — 에이전트가 따르는 스킬 규칙
- [`docs/UPSTREAM.md`](docs/UPSTREAM.md) — upstream 변경을 가져오는 절차

---

## 출처와 라이선스

이 프로젝트는 [`diffusionstudio/lottie`](https://github.com/diffusionstudio/lottie)
(MIT) 를 기반으로 한다. **GitHub 포크가 아니라 코드 반입(vendoring)** 이므로
upstream 변경은 자동으로 따라오지 않는다. 반입 시점의 커밋과 변경을 가져오는
절차는 [`docs/UPSTREAM.md`](docs/UPSTREAM.md) 를 본다.

`LICENSE` 의 MIT 원문과 저작권 고지는 라이선스 조건에 따라 그대로 유지한다.
