import { t } from '../i18n';

export type HelpGroup = { title: string; items: { k: string; v: string }[] };

// 묶음 제목(CANVAS 등)은 영문 픽셀 라벨 그대로, 항목은 언어 파일의 help.desktop / help.touch
// 마우스·트랙패드 안내 (dc.html 안내를 바탕으로 이동·카테고리 전환 방식만 바꿈)
const DESKTOP: [string, string[]][] = [
  ['CANVAS', ['canvasPan', 'canvasTrackpad', 'canvasZoom', 'canvasFit']],
  ['CATEGORY', ['catSwitch', 'catTrackpad', 'catKeys', 'catOrder']],
  ['TEXT BOX', ['boxCreate', 'boxEdit', 'boxMove']],
  ['SELECT', ['selMulti', 'selDelete', 'selUndo']],
  ['LINK', ['linkTool', 'linkSel', 'linkShape']],
  ['DRAW · SAVE', ['draw', 'autosave', 'backup', 'clear']],
  ['SYNC', ['syncJoin', 'syncAdd', 'syncBackup']],
];

// 터치 기기용 제스처 안내
const TOUCH: [string, string[]][] = [
  ['CANVAS', ['canvasPan', 'canvasZoom', 'canvasFit']],
  ['CATEGORY', ['catSwitch', 'catButtons', 'catOrder']],
  ['TEXT BOX', ['boxCreate', 'boxEdit', 'boxMove']],
  ['SELECT', ['selTap', 'selMulti', 'selDelete']],
  ['LINK', ['linkTool', 'linkSel', 'unlink']],
  ['DRAW · SAVE', ['draw', 'autosave', 'backup', 'clear']],
  ['SYNC', ['syncJoin', 'syncAdd', 'syncBackup']],
];

export const HELP_IDS = { desktop: DESKTOP, touch: TOUCH };

export function helpGroups(touch: boolean): HelpGroup[] {
  const mode = touch ? 'touch' : 'desktop';
  return HELP_IDS[mode].map(([title, ids]) => ({
    title,
    items: ids.map(id => ({ k: t(`help.${mode}.${id}.0`), v: t(`help.${mode}.${id}.1`) })),
  }));
}
