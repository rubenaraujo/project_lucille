// lucille — minimal, fast, dark chord viewer for personal use. Zero dependencies (Node 18+).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(ROOT, '.cache');
const PORT = +process.env.PORT || 4477;
const HOST = process.env.HOST || '127.0.0.1';
const TTL_SEARCH = 24 * 3600e3;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

fs.mkdirSync(CACHE_DIR, { recursive: true });

/* ---------- upstream + cache ---------- */
const mem = new Map();
const inflight = new Map();

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dec = s => s.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

async function cached(key, ttl, load) {
  const file = path.join(CACHE_DIR, Buffer.from(key).toString('base64url').slice(0, 180) + '.json');
  const fresh = e => e && Date.now() - e.t < ttl;
  let e = mem.get(key);
  if (!e) { try { e = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {} }
  if (fresh(e)) { mem.set(key, e); return e.v; }
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const v = await load();
      e = { t: Date.now(), v };
      mem.set(key, e);
      fs.writeFile(file, JSON.stringify(e), () => {});
      return v;
    } catch (err) {
      if (e) return e.v; // stale beats nothing
      throw err;
    } finally { inflight.delete(key); }
  })();
  inflight.set(key, p);
  return p;
}

async function ugStore(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw Object.assign(new Error(`Ultimate Guitar answered ${r.status}`), { status: r.status === 404 ? 404 : 502 });
  const m = (await r.text()).match(/class="js-store" data-content="([^"]*)"/);
  if (!m) throw Object.assign(new Error('Unexpected Ultimate Guitar response format'), { status: 502 });
  return JSON.parse(dec(m[1])).store.page.data;
}

const KEEP = new Set(['Chords', 'Tabs', 'Ukulele Chords', 'Bass Tabs']);
const slug = u => (String(u || '').match(/\/artist\/([\w-]+)/) || [])[1] || '';
const ok = r => KEEP.has(r.type) && /\/tab\//.test(r.tab_url || '');
const slim = r => ({
  au: slug(r.artist_url), artist: r.artist_name, song: r.song_name, type: r.type, v: r.version,
  votes: +r.votes || 0, rating: Math.round((r.rating || 0) * 10) / 10,
  url: new URL(r.tab_url).pathname.replace(/^\/tab\//, ''),
});

const search = (q, page) => cached(`s:${q.toLowerCase()}:${page}`, TTL_SEARCH, async () => {
  const d = await ugStore(`https://www.ultimate-guitar.com/search.php?search_type=title&page=${page}&value=${encodeURIComponent(q)}`);
  return {
    pages: d.pagination?.total || 1,
    results: (d.results || []).filter(ok).map(slim),
  };
});

const FILTERS = { chords: 'Chords', tabs: 'Tabs', ukulele: 'Ukulele Chords', bass: 'Bass Tabs' };
const artist = (slg, pg, f) => cached(`a:${slg}:${f}:${pg}`, 7 * TTL_SEARCH, async () => {
  const d = await ugStore(`https://www.ultimate-guitar.com/artist/${slg}?filter=${f}&sort=hits${pg > 1 ? `&page=${pg}` : ''}`);
  const songs = new Map();
  for (const r of (d.other_tabs || []).filter(ok)) {
    if (r.type !== FILTERS[f]) continue;
    const k = r.song_id || r.song_name.toLowerCase();
    const e = songs.get(k) || { song: r.song_name, items: [] };
    e.items.push(slim(r));
    songs.set(k, e);
  }
  const list = [...songs.values()].map(e => {
    e.items.sort((a, b) => b.votes - a.votes);
    return { song: e.song, best: e.items[0], n: e.items.length };
  });
  return { name: d.artist?.name || slg, pages: d.pagination?.pages?.length || 1, songs: list };
});

const suggest = async q => {
  const { results } = await search(q, 1);
  const best = new Map(), artists = new Map();
  for (const r of results) {
    const k = (r.artist + '|' + r.song).toLowerCase();
    const cur = best.get(k);
    if (!cur || (r.type === 'Chords') > (cur.type === 'Chords') || (r.type === cur.type && r.votes > cur.votes)) best.set(k, r);
    if (r.au && !artists.has(r.au)) artists.set(r.au, r.artist);
  }
  return {
    artists: [...artists].slice(0, 2).map(([au, a]) => ({ au, a })),
    songs: [...best.values()].sort((a, b) => b.votes - a.votes).slice(0, 7).map(r => ({ s: r.song, a: r.artist, u: r.url })),
  };
};

const tab = id => cached(`t2:${id}`, 365 * 24 * 3600e3, async () => {
  const d = await ugStore(`https://tabs.ultimate-guitar.com/tab/${id}`);
  const t = d.tab, tv = d.tab_view, meta = tv.meta && typeof tv.meta === 'object' ? tv.meta : {};
  return {
    au: slug(t.artist_url), artist: t.artist_name, song: t.song_name, type: t.type, v: t.version, rating: Math.round(t.rating * 10) / 10, votes: t.votes,
    content: tv.wiki_tab.content,
    strum: (tv.strummings || []).map(p => ({ part: p.part, bpm: p.bpm, trip: !!p.is_triplet, m: (p.measures || []).map(x => x.measure) })).filter(p => p.m.length),
    capo: meta.capo || 0, tuning: meta.tuning?.value || '', tonality: meta.tonality || t.tonality_name || '',
    difficulty: tv.ug_difficulty || '',
    versions: (tv.versions || []).filter(ok).map(slim),
  };
});

/* ---------- rendering ---------- */
function renderTab(src) {
  const s = esc(src.replace(/\r\n?/g, '\n')).replace(/\[\/?tab\]/g, '');
  return s.split('\n').map(line => {
    const sec = line.match(/^\[([^\]]{1,40})\]$/);
    if (sec) return `<span class="l s"><span class="sec">${sec[1]}</span></span>`;
    if (line.includes('[ch]')) return `<span class="l k">${line.replace(/\[ch\]([^[]*?)\[\/ch\]/g, '<b class="c">$1</b>')}</span>`;
    return line.trim() ? `<span class="l ly">${line}</span>` : '<span class="l e"></span>';
  }).join('');
}

/* ---------- i18n (default en, cookie "lang") ---------- */
const DICT = {
  en: {
    home: 'lucille, home', tagline: 'Chords and tabs. No ads, no noise.', phHome: 'Search artist or song', phHead: 'Search', phField: 'Artist or song', search: 'Search',
    strum: 'Strumming', favs: 'Favorites', data: 'Data', recent: 'Recent', results: n => `${n} results`, none: 'No results.', prev: '← Previous', next: 'Next →',
    versions: n => `${n} versions`, chords: 'Chords', tabs: 'Tabs', ukulele: 'Ukulele', bass: 'Bass', nothing: 'Nothing here.',
    dataLead: 'Favorites, recents, transpositions and settings live only in this browser. Export for a backup or to move to another device.',
    exp: 'Export JSON', imp: 'Import JSON', off: 'Save favorites offline',
    key: 'Key', tuning: 'Tuning', others: 'Other versions', favTitle: 'Favorite (f)', fav: 'Favorite', controls: 'Controls',
    tm: 'Transpose down (←)', tp: 'Transpose up (→)', fm: 'Smaller text (−)', fp: 'Larger text (+)', sc: 'Auto-scroll (space)', speed: 'Speed',
    sections: 'Sections', best: 'top', dg: 'Diagrams (d)', tb: 'Graphic tab / plain text (t)', pdf: 'Print or save as PDF', pdfT: 'PDF', rs: 'Reset key', rsT: 'Reset', lblKey: 'Key',
    badUrl: 'Invalid address.', notFound: 'Not found.', tabNotFound: 'Tab not found.', upstream: m => `Could not reach Ultimate Guitar (${m}). Try again.`, home2: '← home', err: 'error',
    tFavs: 'favorites', tData: 'data', other: 'EN → PT', switch: 'Português', code: 'PT',
  },
  pt: {
    home: 'lucille, início', tagline: 'Acordes e tabs. Sem anúncios, sem ruído.', phHome: 'Pesquisar artista ou música', phHead: 'Pesquisar', phField: 'Artista ou música', search: 'Pesquisar',
    strum: 'Ritmo', favs: 'Favoritos', data: 'Dados', recent: 'Recentes', results: n => `${n} resultados`, none: 'Sem resultados.', prev: '← Anterior', next: 'Seguinte →',
    versions: n => `${n} versões`, chords: 'Acordes', tabs: 'Tabs', ukulele: 'Ukulele', bass: 'Baixo', nothing: 'Nada aqui.',
    dataLead: 'Favoritos, recentes, transposições e definições vivem só neste browser. Exporta para backup ou para levar para outro dispositivo.',
    exp: 'Exportar JSON', imp: 'Importar JSON', off: 'Guardar favoritos offline',
    key: 'Tom', tuning: 'Afinação', others: 'Outras versões', favTitle: 'Favorito (f)', fav: 'Favorito', controls: 'Controlos',
    tm: 'Descer tom (←)', tp: 'Subir tom (→)', fm: 'Letra mais pequena (−)', fp: 'Letra maior (+)', sc: 'Auto-scroll (espaço)', speed: 'Velocidade',
    sections: 'Secções', best: 'top', dg: 'Diagramas (d)', tb: 'Tab gráfica / texto (t)', pdf: 'Imprimir ou guardar PDF', pdfT: 'PDF', rs: 'Repor tom', rsT: 'Repor', lblKey: 'Tom',
    badUrl: 'Endereço inválido.', notFound: 'Não encontrado.', tabNotFound: 'Tab não encontrada.', upstream: m => `Falha ao contactar o Ultimate Guitar (${m}). Tenta de novo.`, home2: '← início', err: 'erro',
    tFavs: 'favoritos', tData: 'dados', switch: 'English', code: 'EN',
  },
};
// client-side strings, shipped to the browser as window.T
const CLIENT = {
  en: { artist: 'artist', noRecent: 'Nothing yet.', noFavs: 'No favorites. Open a tab and press ☆.', key: 'key', exported: 'entries exported.', imported: 'entries imported.', invalid: 'Invalid file.',
    saving: 'Saving', favsW: 'favorites', offline: 'available offline.', noDg: 'No diagrams available.', },
  pt: { artist: 'artista', noRecent: 'Ainda nada.', noFavs: 'Sem favoritos. Abre uma tab e carrega em ☆.', key: 'tom', exported: 'entradas exportadas.', imported: 'entradas importadas.', invalid: 'Ficheiro inválido.',
    saving: 'A guardar', favsW: 'favoritos', offline: 'disponíveis offline.', noDg: 'Sem diagramas disponíveis.', },
};
let L = 'en'; // language of the request being rendered; set synchronously by R() before each render
const tx = k => DICT[L][k];

const ico = (n, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const SPRITE = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></symbol>
<symbol id="i-star" viewBox="0 0 24 24"><path d="M12 3.6l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/></symbol>
<symbol id="i-swap" viewBox="0 0 24 24"><path d="M7 20V5m0 0L3.5 8.5M7 5l3.5 3.5M17 4v15m0 0l-3.5-3.5M17 19l3.5-3.5"/></symbol>
<symbol id="i-minus" viewBox="0 0 24 24"><path d="M6 12h12"/></symbol>
<symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"/></symbol>
<symbol id="i-play" viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/></symbol>
<symbol id="i-pause" viewBox="0 0 24 24"><path d="M7.5 5h3.2v14H7.5zM13.3 5h3.2v14h-3.2z" fill="currentColor" stroke="none"/></symbol>
<symbol id="i-grid" viewBox="0 0 24 24"><path d="M7 3.5v17M12 3.5v17M17 3.5v17M4 8h16M4 14h16"/><circle cx="12" cy="11" r="1.6" fill="currentColor" stroke="none"/></symbol>
<symbol id="i-print" viewBox="0 0 24 24"><path d="M7 9V4h10v5M7 17H5.5A1.5 1.5 0 014 15.5V11a2 2 0 012-2h12a2 2 0 012 2v4.5a1.5 1.5 0 01-1.5 1.5H17M7 14h10v6H7z"/></symbol>
<symbol id="i-staff" viewBox="0 0 24 24"><path d="M3 6h18M3 10h18M3 14h18M3 18h18"/><circle cx="9" cy="10" r="1.7" fill="currentColor" stroke="none"/><circle cx="15" cy="14" r="1.7" fill="currentColor" stroke="none"/></symbol>
<symbol id="i-reset" viewBox="0 0 24 24"><path d="M4 12a8 8 0 102.6-5.9M4 4.5V8h3.5"/></symbol>
</defs></svg>`;

const searchForm = (q = '', ph = tx('phField')) =>
  `<form action="/search" role="search" class="field">${ico('search')}<input id="q" name="q" type="search" placeholder="${ph}" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(q)}" aria-label="${tx('search')}"><kbd>/</kbd><div id="sg" hidden></div></form>`;

const page = (title, body, { q = '', cls = '' } = {}) => `<!doctype html>
<html lang="${L}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="lucille"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><meta name="theme-color" content="#0d0d0f">
<title>${esc(title)}</title>
<link rel="icon" href="/icon-192.png" type="image/png">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="preload" href="/fonts/geist-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/instrument-serif-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/s.css"></head>
<body class="${cls}">${SPRITE}
<header><a class="logo" href="/" aria-label="${tx('home')}"><i class="mark"></i>lucille<i>.</i></a>${cls === 'is-home' ? '' : searchForm(q, tx('phHead'))}
<nav class="hnav"><a class="nav" href="/favs" title="${tx('favs')}" aria-label="${tx('favs')}">${ico('star')}</a><a class="nav" href="/data" title="${tx('data')}" aria-label="${tx('data')}">${ico('swap')}</a><a class="nav lang" href="/lang/${tx('code').toLowerCase()}" title="${tx('switch')}" aria-label="${tx('switch')}">${tx('code')}</a></nav></header>
<main>${body}</main>
<script>window.T=${JSON.stringify(CLIENT[L])}</script>
<script src="/chords.js"></script><script src="/staff.js"></script><script src="/app.js"></script></body></html>`;

const fmt = n => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.0', '') + 'k' : String(n);
const meta = r => `<span class="m">${r.rating ? `<b>${ico('star', 'f')}${r.rating.toFixed(1)}</b>` : ''}<span>${fmt(r.votes)}</span></span>`;
const row = (r, title, sub, { href = '/t/' + r.url, p = 0, top = false } = {}) => `<li${p ? ` style="--p:${p.toFixed(2)}"` : ''}><a href="${esc(href)}"><span class="t">${esc(title)}${r.v > 1 ? `<i>v${r.v}</i>` : ''}${top ? `<em class="top">${tx('best')}</em>` : ''}</span><span class="a">${esc(sub)}</span>${meta(r)}</a></li>`;

const homeHtml = () => `<section class="home"><h1><i class="mark"></i>lucille<i>.</i></h1><p class="lead">${tx('tagline')}</p>${searchForm('', tx('phHome'))}
<section><h2>${tx('recent')}</h2><ul id="recent" class="list"></ul></section></section>`;

const favsHtml = () => `<h1>${tx('favs')}</h1><ul id="favs" class="list" style="margin-top:28px"></ul>`;

function searchHtml(q, p, data) {
  const rows = data.results;
  const groups = {};
  for (const r of rows) (groups[r.type] ||= []).push(r);
  const typeOrder = ['Chords', 'Tabs', 'Ukulele Chords', 'Bass Tabs'].filter(t => groups[t]);
  let h = `<h1>${esc(q)}</h1><p class="lead">${rows.length ? tx('results')(rows.length) : tx('none')}</p>`;
  for (const t of typeOrder) h += `<h3>${esc(t)}</h3><ul class="list">${(g => g.map((r, i) => row(r, r.song, r.artist, { p: g[0].votes ? Math.max(.04, r.votes / g[0].votes) : 0, top: i === 0 && g.length > 1 && r.votes > 0 })).join(''))(groups[t].sort((a, b) => b.votes - a.votes))}</ul>`;
  if (data.pages > 1) {
    const u = n => `/search?q=${encodeURIComponent(q)}&page=${n}`;
    h += `<nav class="pager">${p > 1 ? `<a href="${u(p - 1)}">${tx('prev')}</a>` : '<span></span>'}<span class="mut">${p} / ${data.pages}</span>${p < data.pages ? `<a href="${u(p + 1)}">${tx('next')}</a>` : '<span></span>'}</nav>`;
  }
  return h;
}

function artistHtml(slg, pg, f, d) {
  const li = s => row({ ...s.best, v: 0 }, s.song, s.n > 1 ? tx('versions')(s.n) : s.best.type, s.n > 1 ? { href: '/search?q=' + encodeURIComponent(`${s.song} ${d.name}`) } : undefined);
  const u = (n, ff = f) => `/a/${esc(slg)}?f=${ff}${n > 1 ? `&page=${n}` : ''}`;
  const tabs = Object.keys(FILTERS).map(k => `<a href="${u(1, k)}" class="${k === f ? 'on' : ''}">${tx(k)}</a>`).join('');
  return `<h1>${esc(d.name)}</h1><nav class="tabs">${tabs}</nav><ul class="list">${d.songs.map(li).join('') || `<li class="empty">${tx('nothing')}</li>`}</ul>` +
    (d.pages > 1 ? `<nav class="pager">${pg > 1 ? `<a href="${u(pg - 1)}">${tx('prev')}</a>` : '<span></span>'}<span class="mut">${pg} / ${d.pages}</span>${pg < d.pages ? `<a href="${u(pg + 1)}">${tx('next')}</a>` : '<span></span>'}</nav>` : '');
}

const dataHtml = () => `<h1>${tx('data')}</h1><p class="lead">${tx('dataLead')}</p>
<div class="actions"><button class="btn" id="exp">${tx('exp')}</button><label class="btn">${tx('imp')}<input id="imp" type="file" accept="application/json" hidden></label><button class="btn" id="off">${tx('off')}</button></div>
<p id="msg" class="mut"></p>`;

// UG codes: hundreds 0 down / 1 up / 2 rest; units 1 normal / 2 accent / 3 muted
function strumHtml(list) {
  const cell = n => {
    const dir = Math.floor(n / 100), k = n % 100;
    if (dir === 2) return '<i class="r">·</i>';
    return `<i class="${dir ? 'u' : 'd'}${k === 2 ? ' a' : ''}${k === 3 ? ' x' : ''}">${k === 3 ? '×' : dir ? '↑' : '↓'}</i>`;
  };
  const blocks = list.map(p => {
    const size = p.trip ? 12 : 8, bars = [], seen = new Set();
    for (let i = 0; i + size <= p.m.length; i += size) {
      const b = p.m.slice(i, i + size), k = b.join();
      if (!seen.has(k)) { seen.add(k); bars.push(b); }
    }
    if (!bars.length) return '';
    const head = size === 8 ? '<div class="cnt">' + ['1', '&', '2', '&', '3', '&', '4', '&'].map(c => `<i>${c}</i>`).join('') + '</div>' : '';
    return `<div class="strum"><div class="sh"><b>${esc(p.part)}</b>${p.bpm ? `<span>${p.bpm} bpm</span>` : ''}</div>${head}${bars.slice(0, 4).map(b => `<div class="sb">${b.map(cell).join('')}</div>`).join('')}</div>`;
  }).join('');
  return blocks ? `<details class="strums" open><summary>${tx('strum')}</summary><div class="sw">${blocks}</div></details>` : '';
}

function tabHtml(id, t) {
  const chips = [t.type, t.tonality && `${tx('key')} ${t.tonality}`, t.capo ? `Capo ${t.capo}` : '', t.tuning && t.tuning !== 'E A D G B E' ? `${tx('tuning')} ${t.tuning}` : '', t.difficulty && t.difficulty[0].toUpperCase() + t.difficulty.slice(1)].filter(Boolean);
  const others = t.versions.filter(v => v.url !== id).sort((a, b) => b.votes - a.votes).slice(0, 12);
  const btn = (a, label, icon, extra = '') => `<button data-a="${a}" aria-label="${label}" title="${label}"${extra}>${icon}</button>`;
  return `<article>
<div class="head"><div><h1>${esc(t.song)}</h1><div class="sub"><a class="artist" href="${t.au ? `/a/${esc(t.au)}` : `/search?q=${encodeURIComponent(t.artist)}`}">${esc(t.artist)}</a>${chips.map(c => `<span class="chip">${esc(c)}</span>`).join('')}</div></div>
<button id="fav" title="${tx('favTitle')}" aria-label="${tx('fav')}">${ico('star')}</button></div>
<div id="dgs" hidden></div>${strumHtml(t.strum || [])}
<nav id="jump" class="jump" hidden aria-label="${tx('sections')}"></nav>
<pre id="tab" data-id="${esc(id)}" data-title="${esc(t.song)}" data-artist="${esc(t.artist)}" data-key="${esc(t.tonality)}">${renderTab(t.content)}</pre>
${others.length ? `<h3>${tx('others')}</h3><ul class="list">${others.map(r => row(r, r.song, r.type)).join('')}</ul>` : ''}
</article>
<div class="dock" id="bar" role="toolbar" aria-label="${tx('controls')}">
<div class="grp"><span class="lbl">${tx('lblKey')}</span>${btn('tm', tx('tm'), ico('minus'))}<output id="tv" aria-live="polite">0</output>${btn('tp', tx('tp'), ico('plus'))}</div>
<div class="grp">${btn('fm', tx('fm'), '<span class="fsm">A</span>')}${btn('fp', tx('fp'), '<span class="flg">A</span>')}</div>
<div class="grp play" id="play">${btn('sc', tx('sc'), ico('play'), ' id="sc"')}<input id="sp" type="range" min="1" max="12" value="3" aria-label="${tx('speed')}"></div>
<button data-a="tb" id="tb" hidden aria-label="${tx('tb')}" title="${tx('tb')}">${ico('staff')}</button>
<button data-a="dg" id="dg" aria-label="${tx('dg')}" title="${tx('dg')}">${ico('grid')}</button>
<button data-a="pr" aria-label="${tx('pdf')}" title="${tx('pdfT')}">${ico('print')}</button>
<button data-a="rs" aria-label="${tx('rs')}" title="${tx('rsT')}">${ico('reset')}</button>
</div>`;
}

/* ---------- http ---------- */
const STATIC = {
  '/s.css': 'text/css', '/app.js': 'text/javascript', '/chords.js': 'text/javascript', '/staff.js': 'text/javascript', '/sw.js': 'text/javascript',
  '/manifest.webmanifest': 'application/manifest+json', '/icon.svg': 'image/svg+xml', '/logo.svg': 'image/svg+xml', '/icon-192.png': 'image/png', '/icon-512.png': 'image/png', '/apple-touch-icon.png': 'image/png',
};
const fontFile = p => /^\/fonts\/[\w.-]+\.woff2$/.test(p) && path.join(ROOT, 'public', p);
const send = (res, code, body, type = 'text/html; charset=utf-8', extra = {}) => {
  res.writeHead(code, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(body);
};
const errPage = (res, code, msg) => send(res, code, page(tx('err'), `<p class="err">${esc(msg)}</p><p><a href="/">${tx('home2')}</a></p>`));
const langOf = req => /(?:^|;\s*)lang=(pt|en)\b/.exec(req.headers.cookie || '')?.[1] || 'en';

http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    const lang = langOf(req);
    const R = f => (L = lang, f());
    const E = (code, k, ...a) => R(() => { const m = tx(k); return errPage(res, code, typeof m === 'function' ? m(...a) : m); });
    if (p.startsWith('/lang/')) {
      const v = p.slice(6) === 'pt' ? 'pt' : 'en';
      const back = /^https?:\/\/[^/]+(\/[^?#]*(?:\?[^#]*)?)/.exec(req.headers.referer || '')?.[1] || '/';
      return res.writeHead(302, { 'Set-Cookie': `lang=${v}; Path=/; Max-Age=31536000; SameSite=Lax`, Location: back }).end();
    }
    if (STATIC[p]) return send(res, 200, fs.readFileSync(path.join(ROOT, 'public', p)), STATIC[p] + '; charset=utf-8', { 'Cache-Control': 'no-cache' });
    const ff = fontFile(p);
    if (ff && fs.existsSync(ff)) return send(res, 200, fs.readFileSync(ff), 'font/woff2', { 'Cache-Control': 'public, max-age=31536000, immutable' });
    if (p === '/') return send(res, 200, R(() => page('lucille', homeHtml(), { cls: 'is-home' })));
    if (p === '/data') return send(res, 200, R(() => page(`${tx('tData')} · lucille`, dataHtml())));
    if (p === '/api/suggest') {
      const q = (u.searchParams.get('q') || '').trim().slice(0, 100);
      if (q.length < 2) return send(res, 200, '{"artists":[],"songs":[]}', 'application/json');
      return send(res, 200, JSON.stringify(await suggest(q)), 'application/json', { 'Cache-Control': 'private, max-age=600' });
    }
    if (p.startsWith('/a/')) {
      const slg = p.slice(3);
      if (!/^[\w-]+$/.test(slg)) return E(400, 'badUrl');
      const pg = Math.max(1, Math.min(50, +u.searchParams.get('page') || 1));
      const f = FILTERS[u.searchParams.get('f')] ? u.searchParams.get('f') : 'chords';
      const d = await artist(slg, pg, f);
      return send(res, 200, R(() => page(`${d.name} · lucille`, artistHtml(slg, pg, f, d))));
    }
    if (p === '/favs') return send(res, 200, R(() => page(`${tx('tFavs')} · lucille`, favsHtml())));
    if (p === '/search') {
      const q = (u.searchParams.get('q') || '').trim().slice(0, 100);
      if (!q) return res.writeHead(302, { Location: '/' }).end();
      const pg = Math.max(1, Math.min(50, +u.searchParams.get('page') || 1));
      const data = await search(q, pg);
      return send(res, 200, R(() => page(`${q} · lucille`, searchHtml(q, pg, data), { q })));
    }
    if (p.startsWith('/t/')) {
      const id = decodeURIComponent(p.slice(3));
      if (!/^[\w.%-]+(\/[\w.%-]+)?$/.test(id) || id.includes('..')) return E(400, 'badUrl');
      const t = await tab(id);
      return send(res, 200, R(() => page(`${t.song} – ${t.artist} · lucille`, tabHtml(id, t))), 'text/html; charset=utf-8', { 'Cache-Control': 'private, max-age=300' });
    }
    E(404, 'notFound');
  } catch (e) {
    console.error(req.url, e.message);
    (L = langOf(req), e.status === 404 ? errPage(res, 404, tx('tabNotFound')) : errPage(res, e.status || 502, tx('upstream')(e.message)));
  }
}).listen(PORT, HOST, () => {
  console.log(`lucille → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  if (HOST === '0.0.0.0') for (const l of Object.values(os.networkInterfaces()).flat()) if (l.family === 'IPv4' && !l.internal) console.log(`network → http://${l.address}:${PORT}`);
});
