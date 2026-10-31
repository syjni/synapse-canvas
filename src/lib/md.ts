import { rgba } from './color';

// dc.html의 md() 그대로 — HTML 이스케이프 후 변환(XSS 방지) 순서 유지
export function md(src: string, ac: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inl = (s: string) => esc(s)
    .replace(/`([^`]+)`/g, `<code style="background:${rgba(ac, .16)};color:${ac};padding:0 4px;font-family:GalmuriMono11,monospace">$1</code>`)
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#fff">$1</strong>')
    .replace(/~~(.+?)~~/g, '<s style="opacity:.55">$1</s>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/(^|\s)_([^_]+)_/g, '$1<em>$2</em>');
  const out: string[] = []; let list: string | null = null, code: string[] | null = null;
  const close = () => { if (list) { out.push(list === 'ol' ? '</ol>' : '</ul>'); list = null; } };
  const open = (t: string) => { if (list !== t) { close(); out.push(t === 'ol' ? '<ol style="margin:0 0 6px;padding-left:20px">' : `<ul style="margin:0 0 6px;padding-left:${t === 'chk' ? 0 : 16}px;list-style:${t === 'chk' ? 'none' : 'square'}">`); list = t; } };
  for (const line of src.split('\n')) {
    if (code !== null) {
      if (/^```/.test(line)) { out.push(`<pre style="margin:0 0 6px;padding:7px 9px;background:rgba(0,0,0,.45);border:1px dashed ${rgba(ac, .4)};color:${ac};font-family:GalmuriMono11,monospace;font-size:11px;white-space:pre-wrap">${esc(code.join('\n'))}</pre>`); code = null; }
      else code.push(line);
      continue;
    }
    if (/^```/.test(line)) { close(); code = []; continue; }
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,3})\s+(.*)/))) {
      close(); const lv = m[1].length;
      const st = lv === 1 ? `font-size:18px;color:#fff;text-shadow:0 0 10px ${rgba(ac, .7)}` : lv === 2 ? 'font-size:15px;color:#F2F2FA' : `font-size:13px;color:${ac};letter-spacing:.04em`;
      out.push(`<div style="${st};margin:0 0 6px;line-height:1.3">${inl(m[2])}</div>`);
    } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { close(); out.push(`<div style="border-top:1px dashed ${rgba(ac, .5)};margin:8px 0"></div>`); }
    else if ((m = line.match(/^>\s?(.*)/))) { close(); out.push(`<div style="border-left:2px solid ${ac};padding:2px 0 2px 9px;margin:0 0 6px;color:rgba(233,234,247,.75)">${inl(m[1])}</div>`); }
    else if ((m = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)/))) {
      open('chk'); const on = m[1] !== ' ';
      out.push(`<li style="display:flex;gap:7px;align-items:baseline"><span style="color:${ac};flex:none">${on ? '■' : '□'}</span><span style="${on ? 'opacity:.55;text-decoration:line-through' : ''}">${inl(m[2])}</span></li>`);
    }
    else if ((m = line.match(/^\s*[-*]\s+(.*)/))) { open('ul'); out.push(`<li>${inl(m[1])}</li>`); }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { open('ol'); out.push(`<li>${inl(m[1])}</li>`); }
    else if (!line.trim()) { close(); out.push('<div style="height:6px"></div>'); }
    else { close(); out.push(`<div style="margin:0 0 4px">${inl(line)}</div>`); }
  }
  if (code !== null) out.push(`<pre style="margin:0;white-space:pre-wrap;color:${ac}">${esc((code as string[]).join('\n'))}</pre>`);
  close();
  return out.join('');
}
