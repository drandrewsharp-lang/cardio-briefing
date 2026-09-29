/* Cardio Briefing - static PWA. No framework, no build step. */
'use strict';

const SPEEDS = [1, 1.25, 1.5, 1.75, 2];
const DEFAULT_SPEED = 1.5;
const LS_SPEED = 'cb.speed';
const posKey = (d) => 'cb.pos.' + d;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const $ = (id) => document.getElementById(id);
const audio = $('audio');
const scrub = $('scrub');
let index = null;        // data/editions.json
let current = null;      // {meta, ed}
let scrubbing = false;
let lastSave = 0;
let pendingSeek = null;

/* ---------- helpers ---------- */
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) {
    if (k == null || k === false) continue;
    e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return e;
}
function safeUrl(u) {
  try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; }
}
function fmtDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : (s || '');
}
function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  sec = Math.round(sec);
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
function splitLabel(label) {
  const i = (label || '').indexOf(': ');
  return i < 0 ? [label || '', ''] : [label.slice(0, i), label.slice(i + 2)];
}
async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}
function speedLabel(v) { return String(v).replace(/^(\d)$/, '$1') + '×'; }

/* ---------- speed ---------- */
function getSpeed() {
  const v = parseFloat(localStorage.getItem(LS_SPEED));
  return SPEEDS.includes(v) ? v : DEFAULT_SPEED;
}
function applySpeed() {
  const r = getSpeed();
  audio.preservesPitch = true;
  audio.webkitPreservesPitch = true;
  audio.mozPreservesPitch = true;
  audio.defaultPlaybackRate = r;
  if (audio.playbackRate !== r) audio.playbackRate = r;
  updateTimes();
  updatePositionState();
}
function setSpeed(v) {
  localStorage.setItem(LS_SPEED, String(v));
  applySpeed();
  renderSpeed();
}
function renderSpeed() {
  const box = $('speed');
  const cur = getSpeed();
  box.replaceChildren(...SPEEDS.map((v) => h('button', {
    type: 'button', role: 'radio', 'aria-checked': String(v === cur), 'data-speed': v,
    onclick: () => setSpeed(v),
  }, speedLabel(v))));
}

/* ---------- player ---------- */
function duration() {
  if (isFinite(audio.duration) && audio.duration > 0) return audio.duration;
  return (current && current.meta.duration_s) || 0;
}
function updateTimes() {
  const d = duration();
  const t = scrubbing ? (scrub.value / 1000) * d : audio.currentTime;
  $('cur').textContent = fmtTime(t);
  $('left').textContent = '-' + fmtTime(d - t);
  if (!scrubbing) {
    scrub.value = d ? Math.round((t / d) * 1000) : 0;
  }
  scrub.style.setProperty('--p', (scrub.value / 10) + '%');
  const r = getSpeed();
  const note = $('audio-note');
  if (d) {
    const remaining = (d - t) / r;
    note.textContent = t > 1
      ? `${fmtTime(remaining)} left at ${speedLabel(r)}`
      : `${fmtTime(d)} audio · ${fmtTime(d / r)} at ${speedLabel(r)}`;
  }
  $('mini-time').textContent = `${fmtTime(t)} / ${fmtTime(d)} · ${speedLabel(r)}`;
}
function setPlayingUI(on) {
  $('play').classList.toggle('playing', on);
  $('mini-play').classList.toggle('playing', on);
  $('play').setAttribute('aria-label', on ? 'Pause' : 'Play');
  $('mini-play').setAttribute('aria-label', on ? 'Pause' : 'Play');
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = on ? 'playing' : 'paused';
}
function togglePlay() {
  if (audio.paused) {
    applySpeed();
    audio.play().catch((e) => { $('audio-note').textContent = 'Could not start playback: ' + e.message; });
  } else audio.pause();
}
function skip(sec) {
  const d = duration();
  let t = audio.currentTime + sec;
  if (d) t = Math.min(t, d - 0.5);
  audio.currentTime = Math.max(0, t);
  updateTimes();
  updatePositionState();
}
function savePos(force) {
  if (!current) return;
  const now = Date.now();
  if (!force && now - lastSave < 2000) return;
  lastSave = now;
  const t = audio.currentTime;
  const d = duration();
  try {
    if (d && t > d - 5) localStorage.removeItem(posKey(current.meta.date));
    else if (t > 1) localStorage.setItem(posKey(current.meta.date), t.toFixed(1));
  } catch { /* storage full or private mode */ }
}
function updatePositionState() {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  const d = audio.duration;
  if (!isFinite(d) || d <= 0) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: d, playbackRate: audio.playbackRate || getSpeed(), position: Math.min(audio.currentTime, d),
    });
  } catch { /* ignore */ }
}
function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  const set = (a, f) => { try { ms.setActionHandler(a, f); } catch { /* unsupported action */ } };
  set('play', () => { applySpeed(); audio.play(); });
  set('pause', () => audio.pause());
  set('stop', () => audio.pause());
  set('seekbackward', (d) => skip(-(d && d.seekOffset ? d.seekOffset : 15)));
  set('seekforward', (d) => skip(d && d.seekOffset ? d.seekOffset : 30));
  set('seekto', (d) => {
    if (d.fastSeek && 'fastSeek' in audio) audio.fastSeek(d.seekTime);
    else audio.currentTime = d.seekTime;
    updatePositionState();
  });
}
function setMediaMetadata() {
  if (!('mediaSession' in navigator) || !current || typeof MediaMetadata === 'undefined') return;
  const abs = (p) => new URL(p, location.href).href;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: current.ed.label || current.meta.label,
    artist: 'Cardio Briefing',
    album: `${current.meta.n_papers} papers`,
    artwork: [
      { src: abs('icons/icon-192.png'), sizes: '192x192', type: 'image/png' },
      { src: abs('icons/icon-512.png'), sizes: '512x512', type: 'image/png' },
    ],
  });
}
function bindPlayer() {
  $('play').addEventListener('click', togglePlay);
  $('mini-play').addEventListener('click', togglePlay);
  $('back').addEventListener('click', () => skip(-15));
  $('fwd').addEventListener('click', () => skip(30));
  $('mini-info').addEventListener('click', () => $('player').scrollIntoView({ behavior: 'smooth', block: 'center' }));

  scrub.addEventListener('input', () => { scrubbing = true; updateTimes(); });
  scrub.addEventListener('change', () => {
    const d = duration();
    if (d) audio.currentTime = (scrub.value / 1000) * d;
    scrubbing = false;
    updateTimes(); updatePositionState(); savePos(true);
  });

  audio.addEventListener('loadedmetadata', () => {
    applySpeed();
    if (pendingSeek != null && pendingSeek < audio.duration - 5) audio.currentTime = pendingSeek;
    pendingSeek = null;
    updateTimes(); updatePositionState();
  });
  audio.addEventListener('play', () => { applySpeed(); setPlayingUI(true); setMediaMetadata(); });
  audio.addEventListener('playing', () => { applySpeed(); $('audio-note').classList.remove('err'); updateTimes(); });
  audio.addEventListener('pause', () => { setPlayingUI(false); savePos(true); });
  audio.addEventListener('waiting', () => { $('audio-note').textContent = 'Loading audio…'; });
  audio.addEventListener('timeupdate', () => { if (!scrubbing) updateTimes(); savePos(false); });
  audio.addEventListener('ratechange', () => {
    // Some browsers (notably iOS Safari) reset the rate on source changes; keep the chosen speed.
    if (audio.playbackRate !== getSpeed() && !audio.paused) audio.playbackRate = getSpeed();
    updatePositionState(); updateTimes();
  });
  audio.addEventListener('seeked', updatePositionState);
  audio.addEventListener('ended', () => {
    if (current) localStorage.removeItem(posKey(current.meta.date));
    setPlayingUI(false);
  });
  audio.addEventListener('error', () => {
    $('audio-note').textContent = navigator.onLine ? 'Audio could not be loaded.' : 'Offline: audio needs a connection.';
  });
  window.addEventListener('pagehide', () => savePos(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') savePos(true);
    else refreshIndex();
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea') ) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    if (e.code === 'ArrowLeft') skip(-15);
    if (e.code === 'ArrowRight') skip(30);
  });
  setupMediaSession();

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([en]) => {
      $('mini').hidden = en.isIntersecting || $('player').hidden;
    }, { threshold: 0 }).observe($('player'));
  }
}

/* ---------- rendering ---------- */
function renderHeader(meta, ed) {
  const [d, j] = splitLabel(ed.label || meta.label);
  const isLatest = index && index.editions[0] && index.editions[0].date === meta.date;
  const nI = ed.n_interventional ?? ed.papers.filter((p) => p.category === 'interventional').length;
  const nG = ed.n_general ?? ed.papers.filter((p) => p.category === 'general').length;
  const n = ed.n_papers ?? ed.papers.length;
  const w = ed.window || {};
  $('edition').replaceChildren(h('div', { class: 'ed-head' },
    h('p', { class: 'ed-kicker' }, isLatest ? 'Latest edition' : 'Past edition'),
    h('h1', { class: 'ed-title' }, d, j ? h('span', { class: 'journals' }, j) : null),
    h('p', { class: 'ed-meta' },
      `${n} paper${n === 1 ? '' : 's'} · ${nI} interventional · ${nG} general`,
      w.start && w.end ? ` · window ${fmtDate(w.start)} to ${fmtDate(w.end)}` : ''),
  ));
  document.title = `${d} · Cardio Briefing`;
}

function paperLinks(p) {
  const links = [];
  const main = safeUrl(p.link);
  if (main) links.push(h('a', { href: main, target: '_blank', rel: 'noopener' }, 'Open paper ↗'));
  const pm = safeUrl(p.pubmed_link);
  if (pm) links.push(h('a', { href: pm, target: '_blank', rel: 'noopener' }, 'PubMed'));
  for (const a of p.also_in || []) {
    const u = safeUrl(a.link);
    if (u) links.push(h('a', { href: u, target: '_blank', rel: 'noopener' }, `Also in ${a.journal}`));
  }
  return links.length ? h('div', { class: 'links' }, links) : null;
}

function renderDigest(ed) {
  const byRank = (a, b) => (a.rank ?? 99) - (b.rank ?? 99);
  const interv = ed.papers.filter((p) => p.category === 'interventional').sort(byRank);
  const gen = ed.papers.filter((p) => p.category === 'general').sort(byRank);
  const out = [];

  out.push(h('h2', {}, `Interventional cardiology (${interv.length})`));
  if (!interv.length) out.push(h('p', { class: 'card gsum' }, 'No new interventional papers in this edition.'));
  interv.forEach((p, i) => {
    const url = safeUrl(p.link);
    out.push(h('article', { class: 'card paper' },
      h('h3', {}, h('span', { class: 'num' }, `${i + 1}.`),
        url ? h('a', { href: url, target: '_blank', rel: 'noopener' }, p.title) : p.title),
      h('p', { class: 'src' }, h('b', {}, p.journal), ' · ', fmtDate(p.date),
        p.study_type ? h('span', { class: 'type' }, p.study_type) : null),
      p.summary
        ? h('p', { class: 'sum' }, p.summary)
        : h('p', { class: 'sum na' }, 'Abstract not available; title only.'),
      paperLinks(p),
    ));
  });

  out.push(h('h2', {}, 'General cardiology: summary'));
  out.push(h('div', { class: 'card gsum' }, h('p', {}, ed.general_summary || 'No general cardiology summary.')));

  out.push(h('h2', {}, `General cardiology: papers (${gen.length})`));
  if (gen.length) {
    out.push(h('ul', { class: 'card glist' }, gen.map((p) => {
      const url = safeUrl(p.link);
      return h('li', {}, h('div', { class: 'g' },
        url ? h('a', { class: 't', href: url, target: '_blank', rel: 'noopener' }, p.title) : h('span', { class: 't' }, p.title),
        h('div', { class: 'src' }, h('b', {}, p.journal), ' · ', fmtDate(p.date),
          p.abstract_available === false ? ' · abstract not available' : '',
          (p.also_in || []).length ? h('span', { class: 'also' }, ' · also in ' + p.also_in.map((a) => a.journal).join(', ')) : null),
        p.summary ? h('details', {}, h('summary', {}, 'Summary'), h('p', {}, p.summary)) : null,
      ));
    })));
  }
  $('digest').replaceChildren(...out);
}

function renderPast() {
  const list = $('past-list');
  if (!index || !index.editions.length) { list.replaceChildren(h('li', {}, 'No editions yet.')); return; }
  list.replaceChildren(...index.editions.map((e) => {
    const [d, j] = splitLabel(e.label);
    return h('li', {}, h('a', {
      href: '#' + e.date, 'aria-current': String(!!current && current.meta.date === e.date),
      'aria-label': e.label,
    }, h('span', { class: 'd' }, d), j ? h('span', { class: 'j' }, j) : null,
      h('span', { class: 'n' }, `${e.n_papers} papers` + (e.duration_s ? ` · ${Math.round(e.duration_s / 60)} min audio` : ''))));
  }));
}

async function openEdition(date, { scroll = false } = {}) {
  const meta = index.editions.find((e) => e.date === date);
  if (!meta) return;
  if (current && current.meta.date === date) { renderPast(); return; }
  let ed;
  try {
    ed = await getJSON(`data/${date}/edition.json`);
  } catch (e) {
    $('edition').replaceChildren(h('div', { class: 'error' }, `Could not load the ${fmtDate(date)} edition (${e.message}).`));
    return;
  }
  if (current) { savePos(true); audio.pause(); }
  current = { meta, ed };
  renderHeader(meta, ed);
  renderDigest(ed);
  renderPast();

  const player = $('player');
  if (meta.audio === false) {
    player.hidden = true;
    audio.removeAttribute('src');
  } else {
    player.hidden = false;
    const saved = parseFloat(localStorage.getItem(posKey(date)));
    pendingSeek = isFinite(saved) ? saved : null;
    audio.src = meta.audio_url || `data/${date}/briefing.mp3`;
    audio.load();
    applySpeed();
    setPlayingUI(false);
    $('mini-title').textContent = splitLabel(meta.label)[0];
    setMediaMetadata();
    updateTimes();
    if (pendingSeek) {
      scrub.value = duration() ? Math.round((pendingSeek / duration()) * 1000) : 0;
      $('cur').textContent = fmtTime(pendingSeek);
      $('audio-note').textContent = `Resume from ${fmtTime(pendingSeek)}`;
    }
  }
  if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function route(scroll) {
  const m = /^#(\d{4}-\d{2}-\d{2})$/.exec(location.hash);
  const want = m && index.editions.some((e) => e.date === m[1]) ? m[1] : (index.editions[0] || {}).date;
  if (want) openEdition(want, { scroll });
}

async function loadIndex() {
  const idx = await getJSON('data/editions.json');
  idx.editions = (idx.editions || []).slice().sort((a, b) => b.date.localeCompare(a.date));
  return idx;
}

async function refreshIndex() {
  try {
    const idx = await loadIndex();
    const oldLatest = index && index.editions[0] && index.editions[0].date;
    index = idx;
    renderPast();
    // New edition arrived while the app sat in the background: show it if we are on "latest" and idle.
    if (idx.editions[0] && idx.editions[0].date !== oldLatest && !location.hash && audio.paused) route(true);
  } catch { /* offline: keep what we have */ }
}

async function init() {
  renderSpeed();
  bindPlayer();
  try {
    index = await loadIndex();
  } catch (e) {
    $('edition').replaceChildren(h('div', { class: 'error' }, 'Could not load editions. ', e.message));
    return;
  }
  renderPast();
  if (!index.editions.length) {
    $('edition').replaceChildren(h('div', { class: 'error' }, 'No editions published yet.'));
    return;
  }
  route(false);
  window.addEventListener('hashchange', () => route(true));
  document.querySelector('.topbar-link').addEventListener('click', (e) => {
    e.preventDefault();
    $('past').scrollIntoView({ behavior: 'smooth' });
  });
  document.querySelector('.brand').addEventListener('click', (e) => {
    e.preventDefault();
    if (location.hash) history.pushState(null, '', location.pathname);
    route(true);
  });
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
init();
