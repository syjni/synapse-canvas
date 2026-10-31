export type HelpGroup = { title: string; items: { k: string; v: string }[] };

// 마우스·트랙패드 안내 (dc.html 안내를 바탕으로 이동·카테고리 전환 방식만 바꿈)
export const HELP_DESKTOP: HelpGroup[] = [
  { title: 'CANVAS', items: [{ k: '화면 이동', v: '빈 곳 드래그 · Space/가운데 버튼 + 드래그' }, { k: '트랙패드', v: '두 손가락으로 어느 방향이든' }, { k: '확대·축소', v: 'Ctrl/⌘ + 휠 · 두 손가락 오므리기' }, { k: '전체 보기', v: '하단 버튼' }] },
  { title: 'CATEGORY', items: [{ k: '전환', v: '우클릭한 채 좌우로 끌기' }, { k: '트랙패드', v: 'Space + 두 손가락 좌우' }, { k: '키보드 · 버튼', v: '[ ] · 탭 · PREV/NEXT' }, { k: '순서 · 이름', v: '탭 드래그 · 더블클릭' }] },
  { title: 'TEXT BOX', items: [{ k: '생성', v: '빈 곳 더블클릭 · T' }, { k: '편집', v: '더블클릭 · Enter' }, { k: '이동 · 크기', v: '상단 손잡이 · 우하단' }] },
  { title: 'SELECT', items: [{ k: '다중 선택', v: 'Shift + 클릭' }, { k: '삭제', v: 'Delete' }, { k: '실행 취소', v: 'Ctrl/⌘ + Z' }] },
  { title: 'LINK', items: [{ k: '연결 도구', v: 'C → 상자 두 개 클릭' }, { k: '선택 연결', v: 'Shift 2개 → 연결 버튼' }, { k: '선 모양', v: '뉴런 곡선 · 회로(우회 직각)' }] },
  { title: 'DRAW · SAVE', items: [{ k: '그리기', v: 'P → 드래그' }, { k: '자동 저장', v: '이 기기에 저장' }, { k: '백업', v: 'EXPORT · IMPORT (JSON)' }, { k: '카테고리 비우기', v: '설정 맨 아래 · Ctrl/⌘+Z로 복구' }] },
];

// 터치 기기용 제스처 안내
export const HELP_TOUCH: HelpGroup[] = [
  { title: 'CANVAS', items: [{ k: '화면 이동', v: '한 손가락으로 빈 곳 끌기' }, { k: '확대·축소', v: '두 손가락 벌리기·모으기' }, { k: '전체 보기', v: '하단 ⛶ 버튼' }] },
  { title: 'CATEGORY', items: [{ k: '전환', v: '화면 좌우 가장자리에서 밀기' }, { k: '버튼', v: '상단 탭 · ‹ › 버튼' }, { k: '이름 · 순서', v: '탭 두 번 탭 → 이름 · ◂ ▸' }] },
  { title: 'TEXT BOX', items: [{ k: '생성', v: '빈 곳 두 번 탭 · T 도구 후 탭' }, { k: '편집', v: '상자 두 번 탭' }, { k: '이동 · 크기', v: '상단 손잡이 · 우하단 끌기' }] },
  { title: 'SELECT', items: [{ k: '선택', v: '상자 탭' }, { k: '다중 선택', v: '상자 길게 누르기' }, { k: '삭제 · 취소', v: '속성의 삭제 · UNDO 버튼' }] },
  { title: 'LINK', items: [{ k: '연결 도구', v: 'LINK → 상자 두 개 탭' }, { k: '선택 연결', v: '길게 눌러 2개 → 연결 버튼' }, { k: '연결 해제', v: '속성의 연결 목록 ✕' }] },
  { title: 'DRAW · SAVE', items: [{ k: '그리기', v: 'DRAW → 끌기 · 펜슬은 언제나' }, { k: '자동 저장', v: '이 기기에 저장' }, { k: '백업', v: 'EXPORT · IMPORT (JSON)' }, { k: '카테고리 비우기', v: '설정 맨 아래 · UNDO로 복구' }] },
];
