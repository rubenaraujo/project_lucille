// Music helpers + chord diagrams (guitar, standard tuning). Exposed as window.Chords.
(() => {
  const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const pc = n => { const i = SHARP.indexOf(n); return i >= 0 ? i : FLAT.indexOf(n); };
  const PARSE = /^([A-G][#b]?)(.*?)(?:\/([A-G][#b]?))?$/;

  const QUALITY = { '': '', maj: '', m: 'm', min: 'm', '-': 'm', 7: '7', m7: 'm7', min7: 'm7', maj7: 'maj7', M7: 'maj7',
    sus: 'sus4', sus4: 'sus4', sus2: 'sus2', dim: 'dim', 5: '5', add9: 'add9' };
  const quality = q => QUALITY[q];

  // frets low E → high e; -1 muted, 0 open
  const x = -1;
  const OPEN = {
    'C|': [x, 3, 2, 0, 1, 0], 'D|': [x, x, 0, 2, 3, 2], 'E|': [0, 2, 2, 1, 0, 0], 'G|': [3, 2, 0, 0, 0, 3], 'A|': [x, 0, 2, 2, 2, 0],
    'A|m': [x, 0, 2, 2, 1, 0], 'D|m': [x, x, 0, 2, 3, 1], 'E|m': [0, 2, 2, 0, 0, 0],
    'A|7': [x, 0, 2, 0, 2, 0], 'B|7': [x, 2, 1, 2, 0, 2], 'C|7': [x, 3, 2, 3, 1, 0], 'D|7': [x, x, 0, 2, 1, 2], 'E|7': [0, 2, 0, 1, 0, 0], 'G|7': [3, 2, 0, 0, 0, 1],
    'A|m7': [x, 0, 2, 0, 1, 0], 'D|m7': [x, x, 0, 2, 1, 1], 'E|m7': [0, 2, 0, 0, 0, 0],
    'C|maj7': [x, 3, 2, 0, 0, 0], 'D|maj7': [x, x, 0, 2, 2, 2], 'F|maj7': [x, x, 3, 2, 1, 0], 'G|maj7': [3, 2, 0, 0, 0, 2], 'A|maj7': [x, 0, 2, 1, 2, 0], 'E|maj7': [0, 2, 1, 1, 0, 0],
    'A|sus2': [x, 0, 2, 2, 0, 0], 'A|sus4': [x, 0, 2, 2, 3, 0], 'D|sus2': [x, x, 0, 2, 3, 0], 'D|sus4': [x, x, 0, 2, 3, 3], 'E|sus4': [0, 2, 2, 2, 0, 0],
    'C|add9': [x, 3, 2, 0, 3, 0], 'G|add9': [3, 0, 0, 2, 0, 3],
  };
  // movable barre shapes, root on 6th (E) or 5th (A) string
  const E_SHAPE = { '': [0, 2, 2, 1, 0, 0], m: [0, 2, 2, 0, 0, 0], 7: [0, 2, 0, 1, 0, 0], m7: [0, 2, 0, 0, 0, 0], maj7: [0, 2, 1, 1, 0, 0], sus4: [0, 2, 2, 2, 0, 0], 5: [0, 2, 2, x, x, x] };
  const A_SHAPE = { '': [x, 0, 2, 2, 2, 0], m: [x, 0, 2, 2, 1, 0], 7: [x, 0, 2, 0, 2, 0], m7: [x, 0, 2, 0, 1, 0], maj7: [x, 0, 2, 1, 2, 0], sus4: [x, 0, 2, 2, 3, 0], sus2: [x, 0, 2, 2, 0, 0], dim: [x, 0, 1, 2, 1, x], 5: [x, 0, 2, 2, x, x], add9: [x, 0, 2, 4, 2, 0] };

  // returns { frets, open } or null when we have no shape
  function shape(root, qual) {
    const r = pc(root), q = quality(qual);
    if (r < 0 || q === undefined) return null;
    const o = OPEN[SHARP[r] + '|' + q];
    if (o) return { frets: o, open: true };
    const fe = (r - 4 + 12) % 12, fa = (r - 9 + 12) % 12;
    const useE = E_SHAPE[q] && (!A_SHAPE[q] || fe <= fa);
    const t = useE ? E_SHAPE[q] : A_SHAPE[q];
    if (!t) return null;
    const f = useE ? fe : fa;
    return { frets: t.map(v => (v > 0 || (v === 0 && f > 0)) && v >= 0 ? v + f : v), open: false };
  }

  function parse(name) {
    const m = name.match(PARSE);
    return m ? { root: m[1], qual: m[2], bass: m[3] } : null;
  }

  const D_SHAPE = { '': [x, x, 0, 2, 3, 2], m: [x, x, 0, 2, 3, 1], 7: [x, x, 0, 2, 1, 2], m7: [x, x, 0, 2, 1, 1], maj7: [x, x, 0, 2, 2, 2], sus4: [x, x, 0, 2, 3, 3], sus2: [x, x, 0, 2, 3, 0] };
  // every playable voicing we know: the default first, then the rest from low to high on the neck
  function voicings(name) {
    const c = parse(name), q = c && quality(c.qual), r = c && pc(c.root);
    if (!c || r < 0 || q === undefined) return [];
    const first = shape(c.root, c.qual), seen = new Set(), out = [];
    const add = f => { const k = f.join(); if (!seen.has(k) && Math.max(...f) <= 15) { seen.add(k); out.push(f); } };
    if (first) add(first.frets);
    const rest = [];
    for (const [T, s0] of [[E_SHAPE, 4], [A_SHAPE, 9], [D_SHAPE, 2]]) {
      const t = T[q]; if (!t) continue;
      const f = (r - s0 + 12) % 12;
      for (const f0 of f === 0 ? [0, 12] : [f]) rest.push(t.map(v => (v < 0 ? v : v + f0)));
    }
    const low = f => Math.min(...f.filter(v => v >= 0));
    rest.sort((a, b) => low(a) - low(b)).forEach(add);
    return out;
  }

  function svg(name, idx = 0) {
    const c = parse(name);
    const vs = voicings(name);
    if (!vs.length) return '';
    const fr = vs[idx % vs.length], played = fr.filter(v => v > 0);
    const min = played.length ? Math.min(...played) : 1, max = played.length ? Math.max(...played) : 1;
    const base = max <= 4 ? 1 : min;
    const W = 64, H = 84, L = 12, T = 22, sx = 8, sy = 12;
    let o = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${name}">`;
    for (let i = 0; i < 6; i++) o += `<line x1="${L + i * sx}" y1="${T}" x2="${L + i * sx}" y2="${T + 4 * sy}"/>`;
    for (let j = 0; j <= 4; j++) o += `<line x1="${L}" y1="${T + j * sy}" x2="${L + 5 * sx}" y2="${T + j * sy}" class="${j === 0 && base === 1 ? 'nut' : ''}"/>`;
    if (base > 1) o += `<text x="${L + 5 * sx + 4}" y="${T + sy - 3}" class="fn">${base}</text>`;
    const pos = v => v - base + 1;
    const lowest = played.length ? min : 0;
    const bar = !fr.includes(0) && lowest > 0 && fr.filter(v => v === lowest).length >= 2;
    let bs = -1, be = -1;
    if (bar) { bs = fr.indexOf(lowest); be = fr.lastIndexOf(lowest); o += `<rect x="${L + bs * sx - 3}" y="${T + (pos(lowest) - 0.5) * sy - 3.5}" width="${(be - bs) * sx + 6}" height="7" rx="3.5" class="d"/>`; }
    fr.forEach((v, i) => {
      const cx = L + i * sx;
      if (v < 0) o += `<text x="${cx}" y="${T - 7}" class="m">×</text>`;
      else if (v === 0) o += `<circle cx="${cx}" cy="${T - 9}" r="2.6" class="oc"/>`;
      else if (!(bar && v === lowest && i >= bs && i <= be)) o += `<circle cx="${cx}" cy="${T + (pos(v) - 0.5) * sy}" r="3.6" class="d"/>`;
    });
    return o + '</svg>';
  }

  // How many of the given chords (name → count) have an easy open shape
  const easy = new Set(Object.keys(OPEN));
  function easyScore(counts, shift) {
    let s = 0, tot = 0;
    for (const [name, n] of counts) {
      const c = parse(name), q = c && quality(c.qual);
      tot += n;
      if (!c || pc(c.root) < 0 || q === undefined) continue;
      if (easy.has(SHARP[(pc(c.root) + shift + 120) % 12] + '|' + q)) s += n;
    }
    return { s, tot };
  }

  // Karplus-Strong plucked strings, strummed low → high
  let ctx;
  const OPEN_MIDI = [40, 45, 50, 55, 59, 64];
  function play(name, idx = 0) {
    const vs = voicings(name);
    if (!vs.length) return false;
    const sh = { frets: vs[idx % vs.length] };
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const sr = ctx.sampleRate, out = ctx.createGain();
    out.gain.value = 0.22; out.connect(ctx.destination);
    let k = 0;
    sh.frets.forEach((f, i) => {
      if (f < 0) return;
      const freq = 440 * 2 ** ((OPEN_MIDI[i] + f - 69) / 12), n = Math.round(sr / freq), len = Math.floor(sr * 2.2);
      const buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0), ring = new Float32Array(n);
      for (let j = 0; j < n; j++) ring[j] = Math.random() * 2 - 1;
      for (let j = 0, p = 0; j < len; j++) {
        d[j] = ring[p];
        const q = (p + 1) % n;
        ring[p] = (ring[p] + ring[q]) * 0.4975;
        p = q;
      }
      const src = ctx.createBufferSource(); src.buffer = buf; src.connect(out);
      src.start(ctx.currentTime + k++ * 0.035);
    });
    return true;
  }

  window.Chords = { SHARP, FLAT, pc, parse, svg, easyScore, play, count: n => voicings(n).length };
})();
