// lucille client: search, lists, tab page (transpose, diagrams, autoscroll, favourites).
// localStorage keys keep the "riff:" prefix from the project's first name, so old data keeps working.
(() => {
  const $ = s => document.querySelector(s);
  const ls = {
    get: (k, d) => { try { return JSON.parse(localStorage.getItem('riff:' + k)) ?? d; } catch { return d; } },
    set: (k, v) => localStorage.setItem('riff:' + k, JSON.stringify(v)),
    del: k => localStorage.removeItem('riff:' + k),
  };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const root = document.documentElement;
  const ic = n => `<svg class="i" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const RC = window.Chords, T = window.T || {};

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

  const setFs = n => { n = Math.max(10, Math.min(30, n)); root.style.setProperty('--fs', n + 'px'); ls.set('fs', n); };
  setFs(ls.get('fs', 15));

  const typing = () => /INPUT|TEXTAREA/.test(document.activeElement.tagName);
  addEventListener('keydown', e => {
    if (e.key === '/' && !typing()) { e.preventDefault(); $('#q').focus(); $('#q').select(); }
  });

  /* ---------- instant search ---------- */
  (() => {
    const q = $('#q'), box = $('#sg');
    let timer, ctl, items = [], sel = -1;
    const hide = () => { box.hidden = true; items = []; sel = -1; };
    const paint = () => [...box.children].forEach((el, i) => el.classList.toggle('sel', i === sel));
    const render = d => {
      items = [
        ...d.artists.map(a => ({ href: `/a/${a.au}`, html: `<span class="t">${esc(a.a)}</span><span class="a">${T.artist}</span>` })),
        ...d.songs.map(s => ({ href: `/search?q=${encodeURIComponent(s.s + ' ' + s.a)}`, html: `<span class="t">${esc(s.s)}</span><span class="a">${esc(s.a)}</span>` })),
      ];
      sel = -1;
      box.innerHTML = items.map(i => `<a href="${esc(i.href)}">${i.html}</a>`).join('');
      box.hidden = !items.length;
    };
    q.addEventListener('input', () => {
      clearTimeout(timer); ctl?.abort();
      const v = q.value.trim();
      if (v.length < 2) return hide();
      timer = setTimeout(async () => {
        ctl = new AbortController();
        try { render(await (await fetch('/api/suggest?q=' + encodeURIComponent(v), { signal: ctl.signal })).json()); } catch {}
      }, 180);
    });
    q.addEventListener('keydown', e => {
      if (box.hidden || !items.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = items.length + 1; // extra slot = back to the typed query
        sel = (sel + 1 + (e.key === 'ArrowDown' ? 1 : -1) + n) % n - 1;
        paint();
      } else if (e.key === 'Enter' && sel >= 0) { e.preventDefault(); location.href = items[sel].href; }
      else if (e.key === 'Escape') hide();
    });
    document.addEventListener('click', e => { if (!e.target.closest('form[role=search]')) hide(); });
  })();

  /* ---------- lists (home / favs) ---------- */
  const itemHtml = i => `<li><a href="/t/${esc(i.id)}"><span class="t">${esc(i.title)}</span><span class="a">${esc(i.artist)}</span><span class="m">${i.tr ? `${T.key} ${i.tr > 0 ? '+' : ''}${i.tr}` : ''}</span></a></li>`;
  const fill = (sel, items, empty) => { const el = $(sel); if (el) el.innerHTML = items.length ? items.map(itemHtml).join('') : `<li class="empty">${empty}</li>`; };
  if ($('#recent')) fill('#recent', ls.get('recent', []).slice(0, 5), T.noRecent);
  if ($('#favs')) fill('#favs', ls.get('favs', []), T.noFavs);

  // fetching through the service worker stores the page for offline use
  const warm = async ids => {
    let ok = 0;
    await Promise.all(ids.map(id => fetch('/t/' + id).then(r => r.ok && ok++).catch(() => {})));
    return ok;
  };

  /* ---------- data page ---------- */
  if ($('#exp')) {
    const msg = t => { $('#msg').textContent = t; };
    $('#exp').onclick = () => {
      const data = {};
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('riff:')) data[k] = JSON.parse(localStorage.getItem(k)); }
      const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(new Blob([JSON.stringify({ riff: 1, data }, null, 2)], { type: 'application/json' })),
        download: `riff-${new Date().toISOString().slice(0, 10)}.json`,
      });
      a.click(); URL.revokeObjectURL(a.href);
      msg(`${Object.keys(data).length} ${T.exported}`);
    };
    $('#imp').onchange = async e => {
      try {
        const { riff, data } = JSON.parse(await e.target.files[0].text());
        if (riff !== 1 || typeof data !== 'object') throw 0;
        let n = 0;
        for (const [k, v] of Object.entries(data)) {
          if (!k.startsWith('riff:')) continue;
          const key = k.slice(5);
          if (key === 'favs' || key === 'recent') {
            const cur = ls.get(key, []), ids = new Set(cur.map(x => x.id));
            ls.set(key, [...cur, ...v.filter(x => !ids.has(x.id))]);
          } else ls.set(key, v);
          n++;
        }
        msg(`${n} ${T.imported}`);
      } catch { msg(T.invalid); }
      e.target.value = '';
    };
    $('#off').onclick = async () => {
      const favs = ls.get('favs', []);
      msg(`${T.saving} ${favs.length} ${T.favsW}…`);
      msg(`${await warm(favs.map(f => f.id))}/${favs.length} ${T.offline}`);
    };
  }

  /* ---------- tab page ---------- */
  const tabEl = $('#tab');
  if (!tabEl) return;

  const id = tabEl.dataset.id;
  const info = { id, title: tabEl.dataset.title, artist: tabEl.dataset.artist };
  const trKey = 'tr:' + id;
  let tr = ls.get(trKey, 0);

  const upsert = (key, max) => {
    const cur = ls.get(key, []).filter(x => x.id !== id);
    ls.set(key, [{ ...info, tr }, ...cur].slice(0, max));
  };

  const flatKeys = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm']);
  const note = (n, by, flat) => (flat ? RC.FLAT : RC.SHARP)[(RC.pc(n) + by + 120) % 12];

  const chords = [...tabEl.querySelectorAll('.c')].map(el => {
    const orig = el.textContent, next = el.nextSibling;
    return { el, orig, next: next && next.nodeType === 3 ? next : null, nextOrig: next && next.nodeType === 3 ? next.data : '' };
  });
  const keyName = tabEl.dataset.key;
  const hasFlat = chords.some(c => /^[A-G]b/.test(c.orig) || /\/[A-G]b/.test(c.orig));
  const flatNames = () => hasFlat || flatKeys.has(keyName);
  const nameAt = (orig, shift) => {
    const m = RC.parse(orig);
    if (!m || shift % 12 === 0 || RC.pc(m.root) < 0) return orig;
    return note(m.root, shift, flatNames()) + m.qual + (m.bass ? '/' + note(m.bass, shift, flatNames()) : '');
  };

  const dgsEl = $('#dgs'), tip = document.body.appendChild(Object.assign(document.createElement('div'), { id: 'tip', hidden: true }));
  const alt = ls.get('alt', {});
  const vIdx = name => (alt[name] || 0) % Math.max(1, RC.count(name));
  const fig = (name, nav = true) => {
    const s = RC.svg(name, vIdx(name)), n = RC.count(name);
    if (!s) return '';
    const vo = nav && n > 1 ? `<div class="vo"><button data-v="-1" aria-label="‹">‹</button><span>${vIdx(name) + 1}/${n}</span><button data-v="1" aria-label="›">›</button></div>` : '';
    return `<figure data-n="${esc(name)}">${s}<figcaption>${esc(name)}</figcaption>${vo}</figure>`;
  };

  function drawStrip() {
    if (dgsEl.hidden) return;
    const seen = new Set(chords.map(c => c.el.textContent));
    dgsEl.innerHTML = [...seen].map(n => fig(n)).join('') || `<span class="mut">${T.noDg}</span>`;
  }

  function apply() {
    const shift = tr;
    for (const c of chords) {
      const txt = nameAt(c.orig, shift);
      c.el.textContent = txt;
      // keep lyrics aligned: absorb/restore the length difference in the following whitespace
      if (c.next) {
        const d = txt.length - c.orig.length;
        let rest = c.nextOrig;
        if (d > 0) { const sp = rest.match(/^ */)[0].length; rest = rest.slice(Math.min(d, Math.max(0, sp - 1))); }
        else if (d < 0 && /^ /.test(rest)) rest = ' '.repeat(-d) + rest;
        c.next.data = rest;
      }
    }
    $('#tv').textContent = (tr > 0 ? '+' : '') + tr;
    tr ? ls.set(trKey, tr) : ls.del(trKey);
    if (isFav()) saveFav(true);
    drawStrip(); tip.hidden = true;
  }

  /* favourites */
  const favBtn = $('#fav');
  const isFav = () => ls.get('favs', []).some(x => x.id === id);
  const paintFav = () => favBtn.classList.toggle('on', isFav());
  function saveFav(keep) {
    const cur = ls.get('favs', []), has = cur.some(x => x.id === id);
    if (keep) ls.set('favs', cur.map(x => x.id === id ? { ...x, tr } : x));
    else { ls.set('favs', has ? cur.filter(x => x.id !== id) : [{ ...info, tr }, ...cur]); if (!has) warm([id]); }
    paintFav();
  }

  /* autoscroll */
  let raf = 0, last = 0, acc = 0;
  const sp = $('#sp'), sc = $('#sc');
  sp.value = ls.get('sp', 3);
  const tick = t => {
    acc += (t - last) / 1000 * sp.value * 8; last = t;
    const px = Math.floor(acc); if (px) { scrollBy(0, px); acc -= px; }
    if (innerHeight + scrollY >= document.body.scrollHeight - 2) return stop();
    raf = requestAnimationFrame(tick);
  };
  const start = () => { last = performance.now(); acc = 0; sc.innerHTML = ic('pause'); $('#play').classList.add('on'); raf = requestAnimationFrame(tick); };
  const stop = () => { cancelAnimationFrame(raf); raf = 0; sc.innerHTML = ic('play'); $('#play').classList.remove('on'); };
  sp.oninput = () => ls.set('sp', +sp.value);
  addEventListener('wheel', () => raf && stop(), { passive: true });
  addEventListener('touchstart', () => raf && stop(), { passive: true });

  const toggleDg = () => {
    dgsEl.hidden = !dgsEl.hidden;
    $('#dg').classList.toggle('on', !dgsEl.hidden);
    ls.set('dg', !dgsEl.hidden);
    drawStrip();
  };

  const fs = () => parseInt(getComputedStyle(root).getPropertyValue('--fs'));
  const act = {
    tm: () => { tr = Math.max(-11, tr - 1); apply(); },
    tp: () => { tr = Math.min(11, tr + 1); apply(); },
    fm: () => setFs(fs() - 1), fp: () => setFs(fs() + 1),
    sc: () => raf ? stop() : start(),
    dg: toggleDg,
    pr: () => print(),
    rs: () => { tr = 0; apply(); },
  };
  document.addEventListener('click', e => { const a = e.target.closest('[data-a]'); if (a) act[a.dataset.a](); });
  favBtn.onclick = () => saveFav(false);
  addEventListener('keydown', e => {
    if (typing() || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = { ArrowLeft: 'tm', ArrowRight: 'tp', ' ': 'sc', d: 'dg', t: 'tb', '-': 'fm', '=': 'fp', '+': 'fp' }[e.key];
    if (k && act[k]) { e.preventDefault(); act[k](); } else if (e.key === 'f') saveFav(false);
  });

  /* chord diagram popover on hover / tap */
  const showTip = el => {
    const f = fig(el.textContent, false);
    if (!f) { tip.hidden = true; return; }
    tip.innerHTML = f; tip.hidden = false;
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.max(6, Math.min(innerWidth - w - 6, r.left + scrollX + r.width / 2 - w / 2)) + 'px';
    tip.style.top = (r.top - h - 6 < 100 ? r.bottom + scrollY + 6 : r.top + scrollY - h - 6) + 'px';
  };
  tabEl.addEventListener('mouseover', e => { if (e.target.classList.contains('c') && matchMedia('(hover:hover)').matches) showTip(e.target); });
  tabEl.addEventListener('mouseout', e => { if (e.target.classList.contains('c')) tip.hidden = true; });
  tabEl.addEventListener('click', e => { if (e.target.classList.contains('c')) { RC.play(e.target.textContent, vIdx(e.target.textContent)); showTip(e.target); } else tip.hidden = true; });
  document.addEventListener('click', e => {
    const f = e.target.closest('figure'); if (!f) return;
    const name = f.dataset.n, b = e.target.closest('[data-v]');
    if (b) {
      const n = RC.count(name);
      alt[name] = (vIdx(name) + +b.dataset.v + n) % n; ls.set('alt', alt);
      f.outerHTML = fig(name);
    }
    RC.play(name, vIdx(name));
  });

  /* ---------- ascii tab → staff ---------- */
  const nStaff = window.Staff.convert(tabEl);

  /* section jump bar + auto-hiding dock */
  {
    const secs = [...tabEl.querySelectorAll('.l.s')];
    const jump = $('#jump');
    if (jump && secs.length >= 3) {
      jump.innerHTML = secs.map((el, i) => `<button data-i="${i}">${el.textContent}</button>`).join('');
      jump.hidden = false;
      const btns = [...jump.children];
      jump.onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        const y = secs[+b.dataset.i].getBoundingClientRect().top + scrollY - 130;
        scrollTo({ top: y, behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'auto' : 'smooth' });
      };
      let cur = -1;
      const mark = () => {
        let k = 0;
        secs.forEach((el, i) => { if (el.getBoundingClientRect().top < 150) k = i; });
        if (k === cur) return; cur = k;
        btns.forEach((b, i) => b.classList.toggle('on', i === k));
        const on = btns[k], l = on.offsetLeft - 16;
        jump.scrollTo({ left: l, behavior: 'smooth' });
      };
      addEventListener('scroll', mark, { passive: true }); mark();
    }
    const dock = $('#bar');
    let ly = scrollY;
    addEventListener('scroll', () => {
      const y = scrollY, down = y > ly + 6, up = y < ly - 6;
      if (down && y > 240 && !raf) dock.classList.add('away');
      else if (up || y < 240 || raf || innerHeight + y >= document.documentElement.scrollHeight - 40) dock.classList.remove('away');
      if (down || up) ly = y;
    }, { passive: true });
    document.addEventListener('pointermove', e => { if (e.clientY > innerHeight - 90) dock.classList.remove('away'); });
  }

  const tb = $('#tb');
  if (nStaff && tb) {
    tb.hidden = false;
    const setTb = on => { tabEl.classList.toggle('gfx', on); tb.classList.toggle('on', on); ls.set('gfx', on); };
    act.tb = () => setTb(!tabEl.classList.contains('gfx'));
    setTb(ls.get('gfx', true));
  }

  if (ls.get('dg', true)) { dgsEl.hidden = false; $('#dg').classList.add('on'); }
  apply(); paintFav(); upsert('recent', 30);
})();
