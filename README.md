# lucille

A small, fast, dark chord and tab viewer for personal use. Inspired by [freetar](https://github.com/kmille/freetar). It reads public pages from Ultimate Guitar, strips the noise and shows them in a clean reader.

No dependencies, no build step, no framework. Node 18+ only.

## Run

```sh
npm start        # http://localhost:4477
npm run lan      # same, but reachable from other devices on your network
```

Environment variables: `PORT` (default `4477`) and `HOST` (default `127.0.0.1`).

`npm run lan` has no authentication. Anyone on the same network can use it, so avoid public Wi-Fi.

## Features

- Search with instant suggestions, artist pages, a language toggle (EN/PT).
- Chord sheets with transposition, chord diagrams (several voicings per chord) and chord audio on click.
- ASCII tabs drawn as staves, including hammer-ons, pull-offs, slides, bends and vibrato. Press `t` to switch back to plain text.
- Strumming patterns, a section jump bar, auto-scroll, adjustable text size, print/PDF.
- Favorites and recents, stored in the browser only. Export/import as JSON on the Data page.
- Installable as a PWA. Favorites can be saved for offline use.

Shortcuts: `/` search, `←` `→` transpose, `d` diagrams, `t` staff/text, `f` favorite, `space` auto-scroll, `-` `+` text size.

## How it works

```
server.js          scraping, cache, HTML views, i18n strings, routes
public/app.js      client logic (search, lists, tab page controls)
public/chords.js   chord parsing, diagram shapes, Karplus-Strong audio
public/staff.js    ASCII tab → SVG staff
public/s.css       the whole design system (colors are CSS variables at the top)
public/sw.js       service worker (network first, cache as offline fallback)
.cache/            JSON cache of upstream responses (safe to delete)
```

- Ultimate Guitar embeds its page data as JSON in a `js-store` element. `server.js` fetches the page, parses that JSON and renders its own HTML.
- Cache: memory plus `.cache/`. Searches live 24 h, artist pages 7 days, tabs one year. If upstream fails, a stale entry is served. Bump the `t2:` prefix in `tab()` when the stored tab shape changes.
- Strumming codes are decoded from UG's numeric format (hundreds: down/up/rest, units: normal/accent/muted). This was inferred from sample data, not documented.
- The service worker cache name (`V` in `sw.js`) must be bumped whenever static files change, otherwise installed copies keep serving old ones.
- User data lives in `localStorage` under `riff:*` keys. The prefix comes from the project's first name and is kept so old exports and data still work.

## Offline and HTTPS

Service workers only run on `localhost` or HTTPS. Over plain HTTP on a phone you can add the site to the home screen, but offline caching will not work. For that, serve it over HTTPS (for example with Tailscale).

## Notes

- Personal use only. Content belongs to Ultimate Guitar and its authors; do not host this publicly.
- Upstream markup can change at any time. If search or tabs break, `ugStore()` in `server.js` is the place to look first.
- Fonts (Geist, Geist Mono, Instrument Serif) are self-hosted under `public/fonts`.
