import React from 'react';
import { rgba } from '../lib/color';
import { tableSizeAt, TABLE_PICK_COLS, TABLE_PICK_ROWS, type TableSize } from '../lib/input';

// 표 크기 고르기 (프레젠테이션 앱의 표 삽입처럼): 칸 위로 움직이면 왼쪽 위부터 채워지고, 클릭하거나 끌어서 놓으면 그 크기로 넣는다.
// 터치는 누른 채 끌어서 뗀다. 격자 밖에서 놓으면 넣지 않는다. 맨 윗줄은 표의 머리글 줄이다.
export function TablePicker({ color, label, touch, onPick }: { color: string; label: string; touch: boolean; onPick: (size: TableSize) => void }) {
  const [size, setSize] = React.useState<TableSize | null>(null);
  const grid = React.useRef<HTMLDivElement>(null);
  const pressed = React.useRef(false);
  const at = (e: React.PointerEvent) => tableSizeAt(e.clientX, e.clientY, grid.current!.getBoundingClientRect());
  const rows = Array.from({ length: TABLE_PICK_ROWS * TABLE_PICK_COLS }, (_, i) => {
    const col = i % TABLE_PICK_COLS, row = Math.floor(i / TABLE_PICK_COLS);
    const on = !!size && col < size.cols && row < size.rows;
    return <div key={i} style={{ height: touch ? 30 : 20, boxSizing: 'border-box', border: `1px solid ${on ? color : 'rgba(217,218,240,.2)'}`, background: on ? rgba(color, row === 0 ? 0.55 : 0.28) : 'transparent', pointerEvents: 'none' }} />;
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div data-table-picker="1" ref={grid}
        onPointerDown={e => {
          // 편집 칸의 포커스·선택을 유지한다 (커서 자리에 넣어야 하므로)
          e.preventDefault(); e.stopPropagation();
          if (e.button !== 0) return;
          pressed.current = true;
          try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 캡처를 못 해도 격자 안에서는 동작 */ }
          setSize(at(e));
        }}
        onPointerMove={e => setSize(at(e))}
        onPointerUp={e => { if (!pressed.current) return; pressed.current = false; const s = at(e); if (s) onPick(s); else setSize(null); }}
        onPointerCancel={() => { pressed.current = false; setSize(null); }}
        onPointerLeave={() => { if (!pressed.current) setSize(null); }}
        style={{ display: 'grid', gridTemplateColumns: `repeat(${TABLE_PICK_COLS},1fr)`, gap: 2, cursor: 'pointer', touchAction: 'none' }}>
        {rows}
      </div>
      <div data-table-picker-label="1" style={{ fontSize: 11, color: size ? color : 'rgba(217,218,240,.6)', textAlign: 'center' }}>{size ? `${label} ${size.cols} × ${size.rows}` : label}</div>
    </div>
  );
}
