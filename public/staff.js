// Turns ASCII tab blocks (e|--5h7--|) inside #tab into SVG staves. window.Staff.convert(tabEl) → number of staves.
(() => {
  const LABEL = /^\s*[A-Ga-g][#b]?\s*/;
  const IS_TAB = /^\s*[A-Ga-g][#b]?\s*[|:][-\dhpbrsxHPBRSX/\\~^()<>.*|:=]{5,}/;
  const CW = 9, GAP = 15, PAD = 16, TOP = 14;

  const lineOf = row => row.textContent.replace(LABEL, '').trim().split(/\s/)[0];

  // one string row → svg markup: fret numbers, dead notes and the technique marks between them
  function drawRow(l, y, w, drawBars) {
    const cx = x => PAD + x * CW + CW / 2;
    const edge = n => PAD + n * CW; // left edge of column n
    const notes = [], marks = [];
    let out = '';

    for (let x = 0; x < l.length; x++) {
      const ch = l[x];
      if (ch === '|') {
        if (drawBars) out += `<line x1="${cx(x)}" x2="${cx(x)}" y1="${TOP}" y2="${TOP + w}" class="bl"/>`;
      } else if (/\d/.test(ch)) {
        let e = x;
        while (/\d/.test(l[e + 1] || '')) e++;
        const mid = PAD + (x + e + 1) / 2 * CW, width = (e - x + 1) * CW;
        out += `<rect x="${mid - width / 2 - 1}" y="${y - 7}" width="${width + 2}" height="14" rx="3" class="bk"/><text x="${mid}" y="${y + 4}" class="fr">${l.slice(x, e + 1)}</text>`;
        notes.push({ s: x, e, mid });
        x = e;
      } else if (/x/i.test(ch)) {
        out += `<rect x="${cx(x) - 5}" y="${y - 7}" width="10" height="14" rx="3" class="bk"/><text x="${cx(x)}" y="${y + 4}" class="dd">×</text>`;
      } else if (/[hpbr/\\~^s]/i.test(ch)) {
        const c = ch.toLowerCase();
        marks.push({ x, ch: c === 's' ? '/' : c });
      }
    }

    for (const t of marks) {
      const prev = [...notes].reverse().find(n => n.e < t.x), next = notes.find(n => n.s > t.x);
      const before = prev && t.x - prev.e <= 2 ? prev : null, after = next && next.s - t.x <= 2 ? next : null;

      if (t.ch === 'h' || t.ch === 'p') {
        if (before && after) {
          const m = (before.mid + after.mid) / 2;
          out += `<path d="M${before.mid} ${y - 8} Q${m} ${y - 19} ${after.mid} ${y - 8}" class="sl"/><text x="${m}" y="${y - 14}" class="tq">${t.ch}</text>`;
        } else out += `<text x="${cx(t.x)}" y="${y - 8}" class="tq">${t.ch}</text>`;
      } else if (t.ch === '/' || t.ch === '\\') {
        const up = t.ch === '/';
        const x1 = before ? edge(before.e + 1) + 1 : cx(t.x) - 7, x2 = after ? edge(after.s) - 1 : cx(t.x) + 7;
        out += `<line x1="${x1}" x2="${x2}" y1="${y + (up ? 5 : -5)}" y2="${y + (up ? -5 : 5)}" class="sd"/>`;
      } else if (t.ch === 'b' || t.ch === '^') {
        const x0 = before ? edge(before.e + 1) + 1 : cx(t.x) - 3;
        out += `<path d="M${x0} ${y - 4} Q${x0 + 8} ${y - 4} ${x0 + 8} ${y - 15}" class="bd"/><path d="M${x0 + 5} ${y - 13}L${x0 + 8} ${y - 18}L${x0 + 11} ${y - 13}z" class="ah"/>`;
      } else if (t.ch === 'r') {
        const x0 = cx(t.x) + 6;
        out += `<path d="M${x0} ${y - 15} Q${x0} ${y - 4} ${x0 + 8} ${y - 4}" class="bd"/><path d="M${x0 - 3} ${y - 8}L${x0} ${y - 3}L${x0 + 3} ${y - 8}z" class="ah"/>`;
      } else if (t.ch === '~') {
        let e = t.x;
        while (l[e + 1] === '~') e++;
        const len = (e - t.x + 1) * CW + 4, seg = Math.max(2, Math.round(len / 4)), half = len / seg / 2;
        let d = `M${edge(t.x) + 1} ${y - 9}`;
        for (let q = 0; q < seg; q++) d += ` q${half / 2} ${q % 2 ? 3 : -3} ${half} 0 t${half} 0`;
        out += `<path d="${d}" class="vb"/>`;
      }
    }
    return out;
  }

  function build(rows) {
    const lines = rows.map(lineOf);
    const names = rows.map(r => r.textContent.trim()[0]);
    const n = lines.length, cols = Math.max(...lines.map(l => l.length));
    const width = PAD + cols * CW + 6, height = TOP + (n - 1) * GAP + 14, span = (n - 1) * GAP;

    let svg = '';
    for (let i = 0; i < n; i++) {
      const y = TOP + i * GAP;
      svg += `<line x1="${PAD - 4}" x2="${PAD + cols * CW}" y1="${y}" y2="${y}" class="st"/><text x="${PAD - 8}" y="${y + 3.5}" class="nm">${names[i]}</text>`;
    }
    lines.forEach((l, i) => { svg += drawRow(l, TOP + i * GAP, span, i === 0); });

    const box = document.createElement('div');
    box.className = 'stf';
    box.innerHTML = `<svg viewBox="0 0 ${width} ${height}" style="width:${width * 1.25}px" role="img" aria-label="tab">${svg}</svg>`;
    return box;
  }

  function convert(tabEl) {
    const kids = [...tabEl.children];
    const isRow = el => el.classList.contains('ly') && IS_TAB.test(el.textContent);
    let count = 0;
    for (let i = 0; i < kids.length;) {
      if (!isRow(kids[i])) { i++; continue; }
      let j = i;
      while (j < kids.length && isRow(kids[j])) j++;
      const run = kids.slice(i, j);
      // staves have 6 strings (4 for bass); a trailing run shorter than 4 stays as text
      for (let k = 0; k + 4 <= run.length; k += 6) {
        const group = run.slice(k, k + 6);
        group[0].before(build(group));
        group.forEach(r => r.classList.add('raw'));
        count++;
      }
      i = j;
    }
    return count;
  }

  window.Staff = { convert };
})();
