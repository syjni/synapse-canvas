# Handoff: Synapse Canvas — 사이버틱 마인드맵 / 무한 캔버스

## Overview
검은 배경 위에 글 상자·사진 상자를 자유롭게 배치하고, 상자끼리 **뉴런처럼 이어** 생각을 정리하는 로컬 웹앱입니다.
카테고리(탭)별로 독립된 캔버스를 가지며, 데이터는 브라우저 로컬에 자동 저장되고 JSON으로 백업/복원합니다.
분위기 키워드: 사이버틱, 뉴런/시냅스, 은은한 노이즈·그레인, 뿌연 dreamy 글로우, 픽셀 폰트.

## About the Design Files
이 폴더의 `Synapse Canvas.dc.html`은 **HTML로 만든 디자인 레퍼런스(동작하는 프로토타입)** 입니다. 그대로 배포할 프로덕션 코드가 아닙니다.
과제는 이 디자인을 **목표 환경에서 다시 구현**하는 것입니다. 기존 코드베이스가 없다면 **Vite + React + TypeScript** 단일 페이지 앱을 권장합니다(로컬 `npm run dev`로 실행). 상태 관리는 React state 또는 Zustand, 스타일은 CSS Modules/Tailwind 등 자유.

- 파일은 독자 런타임(`support.js`, `<x-dc>`, `<sc-for>`, `<sc-if>`, `{{ }}` 템플릿)을 쓰는 형식입니다. 템플릿 = JSX와 거의 같은 마크업, `class Component` = React 클래스 컴포넌트의 로직(`renderVals()`가 템플릿에 값을 공급)으로 읽으면 됩니다.
- **로직(라우팅 알고리즘, Markdown 렌더러, OKLCH 변환, 줌/팬 수학)은 거의 그대로 이식 가능**합니다. 파일 하단 `<script data-dc-script>` 블록 참고.
- 브라우저에서 바로 열어 동작을 확인하려면 `Synapse Canvas.dc.html`과 `support.js`를 같은 폴더에 두고 로컬 서버로 여세요 (예: `npx serve .`).

## Fidelity
**High-fidelity.** 색, 타이포, 간격, 글로우, 인터랙션 모두 최종안입니다. 픽셀 단위로 재현해 주세요.

---

## Layout (단일 화면, 풀스크린)
`position:fixed; inset:0; background:#050509; overflow:hidden` 루트 위에 레이어가 아래 순서로 쌓입니다 (아래 → 위):

1. **Haze 2개** — 원형 블롭, `filter: blur(90px / 100px)`, opacity .20 / .18.
   - 좌상단: 62vw 정사각, left -18vw, top -24vw, 색 = 강조색1(상자)
   - 우하단: 55vw 정사각, right -20vw, bottom -26vw, 색 = 강조색2(연결선)
2. **도트 그리드** (토글 가능) — `radial-gradient(rgba(220,222,255,.10) 1px, transparent 1.2px)`, 셀 크기 = `28 × zoom × 0.85` px, 위치는 pan과 동기화.
3. **World 레이어** — `transform: translate(pan.x, pan.y) scale(zoom × 0.85)`, origin 0 0. 안에 SVG 연결선 레이어 + 상자들.
4. **노이즈 캔버스** — 화면 해상도 1:1 `<canvas>`, 140ms마다 재생성. 픽셀마다 40% 확률로 알파 0–110, RGB = (v·0.9+20, v·0.9+20, 255)(푸른빛). CSS: `opacity: grain/100; filter: blur(0.6px); mix-blend-mode: screen`.
5. **스캔라인** — `repeating-linear-gradient(0deg, rgba(0,0,0,.22) 0 1px, transparent 1px 3px)`
6. **비네트** — `radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,.75) 100%)`
7. **UI 크롬** (모두 `zoom: .85` — 전체 UI를 85%로 축소한 상태가 최종안)

### UI 크롬
- **상단 바** (높이 52px, padding 0 18px, gap 18px, 배경 투명)
  - 로고: 8×8 정사각(강조색1, glow 10px) + `SYNAPSE` 11px, letter-spacing .18em, 강조색1
  - 카테고리 탭 (가로 스크롤, 스크롤바 숨김): padding 7px 12px, 번호(9px GalmuriMono9, opacity .7) + 이름(12px). 활성: 배경 강조색1, 글자 #05060B, glow `0 0 16px rgba(accent,.5)`. 비활성: 투명, 1px `rgba(217,218,240,.16)` 테두리.
  - 우측: 저장 상태(6px 원 + `SAVED HH:MM` / `SAVING…` / 오류 시 `STORAGE FULL — 백업 권장` #FF9C8F), `EXPORT ↓`, `IMPORT ↑` 버튼(11px, padding 7px 11px, 1px rgba(217,218,240,.25) 테두리, hover 시 #D9DAF0).
- **좌측 툴바** (left 14px, 세로 중앙): 버튼 58×50, 글리프 15px + 라벨 8.5px. 배경 rgba(6,7,13,.9), 테두리 rgba(accent,.38), glow `0 0 24px rgba(accent,.14)`. 활성 도구 = 배경 강조색1 + 글자 #05060B.
  - ↖ SELECT(V) · ✥ PAN(H/Space) · T TEXT(T) · ▣ IMAGE(I) · ✎ DRAW(P) · ⟜ LINK(C) · ↶ UNDO(Ctrl/⌘Z) · ⚙ SET
- **설정 패널** (left 84px, top 66px, 폭 300px) — 아래 "Settings" 참고.
- **속성 패널** (right 14px, top 66px, 폭 260px, 선택 시에만) — 아래 "Properties" 참고.
- **하단 바** (가운데, bottom 16px): `‹ PREV` | `01/06  Mind` | `NEXT ›` | `−` `100%` `+` | `⛶ 전체 보기` | `? 안내`. 화면 폭 < 1000px이면 마지막 두 버튼은 아이콘만.
- **카테고리 전환 플래시**: 화면 중앙에 `02 / 06`(11px, letter-spacing .3em, 강조색) + 이름(44px Galmuri11, glow) — 700ms 표시 후 .6s 페이드.
- **안내(MANUAL) 모달**: 반투명 오버레이 rgba(3,3,6,.7), 카드 max 720px, 6개 그룹 그리드(minmax 200px).

---

## Box (상자) 컴포넌트
- 기본 크기: 텍스트 220×110 (새로 만들 때), 최소 120×60. 사진: 폭 280, 높이 = 비율 유지(90–420) + 18.
- 배경 `rgba(7,8,14,.86)`, `backdrop-filter: blur(2px)`, 1px 테두리 `rgba(accent, .5)` → 호버/선택 시 `rgba(accent, 1)`.
- 모서리: 기본 0 (옵션 soft = 6px).
- 그림자: 기본 `0 0 12px rgba(accent,.16)` / 호버·선택 `0 0 20px rgba(accent,.5), 0 0 60px rgba(accent,.18), inset 0 0 14px rgba(accent,.16)`.
- **호버 확대**: `transform: scale(1.035)`, `transition: transform .2s cubic-bezier(.2,.9,.3,1.3)` (살짝 튕김). 드래그·편집 중엔 확대 안 함.
- **헤더 (손잡이)** 높이 18px: `TXT-01` / `IMG-02` · `::::` · 상태(`SEL` / `EDIT_` / `LINK…`). GalmuriMono9 9px, letter-spacing .12em.
  - 평소 opacity .45, 아래 경계선 투명 → 호버/선택/편집 시 opacity 1, 경계선 rgba(accent,.4).
  - **헤더 채우기 (상자별 설정)**: `box.head`가 팔레트 hex면 헤더 배경을 그 색으로 채우고 글자 #05060B, 항상 opacity 1. null이면 투명.
- 선택 시 좌상/우상/좌하 모서리에 6px L자 틱(강조색).
- 우하단 12×12 리사이즈 핸들 (135° 삼각, 강조색).
- 본문: Galmuri11 12.5px / line-height 1.55 / #E3E4F2 / `text-shadow: 0 0 8px rgba(accent,.6)`, padding 10px 12px, 넘치면 내부 스크롤. 빈 상자는 `빈 상자 — 더블클릭해서 작성`(opacity .35).
- 편집 모드: textarea, 배경 rgba(0,0,0,.35), GalmuriMono11 12px, caret = 강조색.

### Markdown 지원 (파일 내 `md()` 함수)
`# / ## / ###` 제목, `**볼드**`, `*기울임*`/`_기울임_`, `~~취소선~~`, `\`코드\``, ```코드 블록```, `- 목록`, `1. 번호`, `- [ ] / - [x]` 체크(□/■), `> 인용`, `---` 구분선. 각 요소 스타일은 함수 안에 인라인으로 정확히 정의되어 있으니 그대로 옮기세요. **HTML 이스케이프 후 변환**(XSS 방지) 순서를 유지하세요.

## 연결선 (Edges)
SVG 하나에 그림. 두 가지 스타일 (`edgeStyle`):
- **neuron (기본)**: 두 상자의 마주보는 변 중앙을 잇는 3차 베지어(`curve()`). 가로 간격이 더 크면 좌우 변, 아니면 상하 변. 컨트롤 포인트 = 거리의 50%.
  - 글로우 패스: stroke-width 5(hot 8), opacity .25(hot .5), `feGaussianBlur stdDeviation 4`
  - 코어: 1.2px(hot 1.8), opacity .85(hot 1)
  - 수상돌기: 같은 곡선을 ±22px 비튼 점선(`1 5`), 0.7px, opacity .3
  - 끝점: 출발 원 r 2.5, 도착 원 r 3.5 (강조색2)
  - hot = 양 끝 상자 중 하나가 호버/선택됨
- **circuit**: 다른 상자를 피해 가는 직각 경로 (`route()` = 12px 격자 A*, 방향 전환 비용 5, 상자 패딩 12px). 결과 캐시 필수. 끝점은 6px 사각형.
- **신호 펄스** (설정 토글, 기본 ON): 흰 원 r 2.6 + 강조색 글로우가 선을 따라 이동. 주기 `2.6 + (i%4)·0.6`초, 시작 지연 `-i·0.8`초 (SVG `animateMotion` 또는 동등 구현).
- LINK 도구로 첫 상자를 고른 뒤엔 마우스까지 점선 프리뷰(4 4).

## 펜 그리기
DRAW 도구로 드래그 → 2px 이상 움직일 때만 점 추가 → 2차 곡선 스무딩(`smooth()`). 코어 + 폭+5 글로우(opacity .18). 색/굵기(1–14px)는 설정에서.

---

## Interactions & Behavior
**캔버스**
- 빈 곳 더블클릭(SELECT 도구) 또는 TEXT 도구 클릭 → 그 위치에 새 글 상자 + 즉시 편집.
- 팬: PAN 도구 / Space+드래그 / 마우스 가운데 버튼 / 휠·트랙패드 스크롤. Shift+휠 = 가로 이동.
- 줌: Ctrl/⌘ + 휠 (커서 기준, `z × exp(-deltaY·0.01)`), 범위 20%–300%. 하단 +/− = ×1.2.
- 전체 보기: 모든 상자·그림 범위 + 40px 여백을 화면(좌 80, 상 60, 우 30/선택 시 250, 하 70 제외)에 맞춤, 최대 120%.
- 처음 로드·창 크기 변경 시 사용자가 직접 이동/줌하기 전까지 자동 fit.
- 표시 줌(%) = 내부 zoom. 실제 렌더 배율은 zoom × 0.85 (전역 85% 스케일).

**카테고리 전환**
- 빈 캔버스를 좌우로 180px 이상 드래그(수평 성분이 수직의 1.5배 초과) → 이전/다음. 드래그 중 화면이 dx×0.35만큼 밀리고 opacity 감소, 중앙에 `NEXT → IDEAS` + 진행 바(180px).
- 트랙패드 수평 스와이프: deltaX 누적 260 초과 시 전환, 700ms 쿨다운.
- 탭 클릭 / PREV·NEXT 버튼. 마지막→처음 순환.
- 탭 더블클릭 = 이름 변경(Enter/Esc/blur로 종료), 탭 드래그 = 순서 변경.
- 카테고리마다 view(pan/zoom) 별도 저장.

**상자**
- 클릭 = 선택, Shift+클릭 = 다중 선택 토글. 빈 곳 클릭 = 선택 해제.
- **선택된 텍스트 상자를 다시 더블클릭 / Enter = 편집.** Esc 또는 Ctrl/⌘+Enter = 편집 종료.
- 헤더 드래그 = 이동(선택된 상자 모두 함께). 3px 이상 움직여야 드래그 시작.
- 우하단 핸들 = 크기 조절.
- Delete/Backspace = 선택 삭제(연결선도 함께).
- Ctrl/⌘+Z = 실행 취소 (히스토리 최대 100). 텍스트 입력은 편집 시작 시점에 1회 스냅샷.

**연결**
- LINK 도구(C): 첫 상자 클릭 → 두 번째 상자 클릭. 같은 쌍 중복 연결 불가. Esc 취소. 상단에 안내 배지(점선 테두리, 강조색2).
- 또는 Shift로 상자 2개 선택 → 속성 패널의 `⟜ 두 상자 연결`.
- 속성 패널의 연결 목록에서 ✕ = 연결 해제.

**사진**
- IMAGE 도구(I) → 파일 선택 → 긴 변 1200px로 축소, JPEG 0.85 dataURL로 저장, 화면 중앙에 배치.

**단축키 요약**: V 선택 · H 팬 · T 글 · I 사진 · P 펜 · C 연결 · Space 임시 팬 · Enter 편집 · Esc 취소 · Delete 삭제 · Ctrl/⌘Z 취소. 입력 필드 포커스 중엔 무시.

## Settings 패널
1. **강조색 1 — 상자**: 팔레트 8색 그리드(높이 26px, 선택 = 1px 흰 outline, offset 3px + glow).
2. **연결선 색을 상자와 동일하게** 토글 (34×16 스위치). ON이면 강조색 2 영역 opacity .35.
3. **강조색 2 — 연결선**: 팔레트 8색.
4. **펜 색상**(화이트 #ECECF6 + 팔레트 8 = 9색), **펜 굵기** 슬라이더 1–14.
5. **노이즈 / 그레인** 슬라이더 0–45 (기본 22).
6. **신호 펄스 (뉴런 발화)** 토글.

강조색은 앱 전체에서 **최대 2개**만 사용 (상자/UI = 1, 연결선 = 2).

## Properties 패널 (선택 시)
- 제목: `PROPERTIES` + `TEXT` / `IMAGE` / `N SELECTED`
- 단일 선택: X/Y/W/H 4칸 그리드
- **헤더 채우기**: ∅(없음, 점선 테두리) + 팔레트 8색. 다중 선택 시 일괄 적용, 값이 섞였으면 `혼합`.
- 텍스트 단일: Markdown 서식 버튼 10개 (B, I, S, H1, H2, •, 1., ☐, ❝, <>) — 선택 영역을 감싸거나 줄 앞에 접두어 삽입. 편집 중이 아니면 편집 모드로 진입 후 적용.
- 연결 목록 / 연결 버튼
- `편집 ENTER`(편집 중이면 `편집 완료`) · `삭제 DEL`(#FF9C8F)

---

## State Management
```ts
type Box = { id: string; type: 'text' | 'image'; x: number; y: number; w: number; h: number;
             text?: string; src?: string /* dataURL */; head?: string | null /* 헤더 채우기 hex */ };
type Link = { id: string; a: string; b: string };
type Stroke = { id: string; color: string; width: number; pts: [number, number][] };
type Category = { id: string; name: string; boxes: Box[]; links: Link[]; strokes: Stroke[];
                  view: { x: number; y: number; z: number } | null };
type Data = { cats: Category[]; active: string };
type Prefs = { nodeColor: string; edgeColor: string; linked: boolean; penColor: string;
               penWidth: number; grain: number; pulse: boolean };
// UI (비영속): tool, sel[], editing, hover, connectFrom, settingsOpen, helpOpen, renaming, swipe, liveStroke, space, panning
```
- **저장**: `{ data, prefs }`를 localStorage 키 `synapse-canvas-v1`에 500ms 디바운스 저장. 실패(용량 초과) 시 상태 표시를 오류로. 로컬 앱이라면 IndexedDB 또는 로컬 파일 저장으로 바꿔도 좋습니다(사진이 dataURL이라 용량이 큼).
- **EXPORT**: `{ app:'synapse-canvas', version:1, exportedAt, data, prefs }` → `synapse-backup-YYYYMMDD.json` 다운로드.
- **IMPORT**: JSON 검증(`data.cats` 비어있지 않은 배열) → 확인창 → 교체(실행 취소 가능). 실패 시 `올바른 백업 파일이 아닙니다.`
- 초기 데이터: 카테고리 `Mind`, `Ideas`, `Schedule`, `Custom 1`, `Custom 2`, `Custom 3` (예시 상자는 파일의 `seed()` 참고). **카테고리 이름은 영어.**

## Design Tokens
**배경 / 중립**
- 페이지 #050509 · 패널 rgba(6,7,13,.9–.97) · 패널 셀 #07080E · 상자 rgba(7,8,14,.86)
- 본문 글자 #D9DAF0 · 상자 글자 #E3E4F2 · 강조 글자 #E9EAF7 / #EDEEFA · 제목 #FFFFFF
- 보조 글자 rgba(217,218,240,.6 / .45 / .35) · 구분선 rgba(217,218,240,.12–.25), 점선 .15
- 강조 위 글자 #05060B · 위험 #FF9C8F · 선택 영역 #5B7BE6

**강조 팔레트** — OKLCH(L 0.76, C 0.13), 색상만 균등 분배 (빨강→보라). 파일의 `oklchHex()`로 생성.
| 이름 | Hue | Hex |
|---|---|---|
| Red (레드) | 22 | `#F98E8B` |
| Orange (오렌지) | 55 | `#F0995B` |
| Yellow (옐로) | 95 | `#CBB042` |
| Green (그린) | 150 | `#6FC884` |
| Cyan (시안) | 200 | `#00C9D1` |
| Blue (블루) | 250 | `#6DB6FF` |
| Indigo (인디고) | 280 | `#A1A7FF` |
| Violet (바이올렛) | 315 | `#D097EA` |

기본값: 강조색1(상자) = Blue `#6DB6FF`, 강조색2(연결선) = Indigo `#A1A7FF`, 동일화 OFF.

**강조색 파생**: line = rgba(accent,.38) · glowSoft = rgba(accent,.14) · glow = rgba(accent,.6)

**타이포** — [Galmuri](https://github.com/quiple/galmuri) 픽셀 폰트 (OFL), CDN `https://cdn.jsdelivr.net/npm/galmuri@latest/dist/galmuri.css`. 로컬 앱이면 npm `galmuri` 패키지로 번들 권장.
- Galmuri11: 상자 본문 12.5px, 플래시 제목 44px
- GalmuriMono11: UI 전반 11–12px
- GalmuriMono9: 라벨·태그·번호 8.5–10px, letter-spacing .1–.3em
- Markdown 제목: H1 18px #fff + glow · H2 15px #F2F2FA · H3 13px 강조색

**간격**: 패널 padding 14px, 섹션 gap 16px, 내부 gap 8px, 스와치 gap 6px(헤더 채우기 4px)
**모서리**: 0 (전부 각진 형태). 옵션 soft = 상자 6px, circuit 선 꺾임 8px.
**글로우**: 위 상자/선 항목 참고. 강조 정사각 도트는 `box-shadow: 0 0 10px accent`.

## Assets
- 이미지·아이콘 파일 없음. 툴바 아이콘은 유니코드 글리프(↖ ✥ T ▣ ✎ ⟜ ↶ ⚙ ⛶).
- 폰트: Galmuri (위 링크).

## Files
- `Synapse Canvas.dc.html` — **최종 디자인 + 전체 동작 레퍼런스** (이것을 기준으로 구현)
- `support.js` — 위 파일을 브라우저에서 열기 위한 런타임 (구현 대상 아님)
- `reference/Synapse Mindmap.dc.html` — 초기 탐색안(노드형 마인드맵). 분위기 참고용, 구현 대상 아님

## Suggested prompt for Claude Code
> 이 폴더의 README.md와 `Synapse Canvas.dc.html`을 읽고, 같은 디자인과 동작을 가진 로컬 웹앱을 Vite + React + TypeScript로 만들어줘. 픽셀 폰트·색·글로우·노이즈를 그대로 재현하고, 데이터는 로컬에 자동 저장 + JSON 백업/복원. `npm run dev`로 실행되게.
