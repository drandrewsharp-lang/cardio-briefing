# Cardio Briefing

Static PWA for a daily cardiology literature briefing (audio + written digest), served by GitHub Pages.
No build step: `index.html`, `app.js`, `style.css`, `sw.js`, `manifest.json`, `icons/`.

Data: `data/editions.json` (index) and `data/YYYY-MM-DD/{edition.json,briefing.mp3}`, published by `publish.py`
in the (private, local) tooling folder. Content is summaries of published abstracts; not indexed (`noindex`).
