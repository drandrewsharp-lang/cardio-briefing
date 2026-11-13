# Cardio Briefing

Static PWA for a daily cardiology literature briefing (audio + written digest), served by GitHub Pages.
No build step: `index.html`, `app.js`, `style.css`, `sw.js`, `manifest.json`, `icons/`.

Data: `data/editions.json` (index) and `data/YYYY-MM-DD/{edition.json,briefing.mp3}`, published by `publish.py`
in the (private, local) tooling folder. Content is summaries of published abstracts; not indexed (`noindex`).
The digest names the journal on every paper. Interventional papers get a ~150-word summary plus a ~100-word critique
with linked sources; general cardiology papers get a ~75-word summary plus one line on why it matters (older editions
keep their original format). `playlist.html` ("Play several days") plays ticked editions back to back, oldest first.

Security: strict Content-Security-Policy (meta tag in `index.html`: only same-origin scripts, styles, images, audio, data and
worker; no inline code, no external origins), `no-referrer`, DOM built with `textContent` only, and paper links limited to
`https://` with `rel="noopener noreferrer"`. Keep all JS in `app.js`/`sw.js` and all CSS in `style.css`.
