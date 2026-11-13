/* Cardio Briefing - "Play several days" page. Tick editions, play their audio back to back (oldest first).
 * Same security rules as app.js: DOM built with createElement/textContent only (never innerHTML), audio only from
 * this app's own data/<YYYY-MM-DD>/briefing.mp3, no external origins. */
'use strict';

const SPEEDS = [1, 1.1, 1.2, 1.3, 1.4, 1.5];
const DEFAULT_SPEED = 1.2;
const LS_SPEED = 'cb.speed.v2';       // shared with the main page (v2: default reset to 1.2x once)
const LS_SEL = 'cb.pl.selected';
const LS_HEARD = 'cb.heard';          // dates played to the end (shared with the main page)
const posKey = (d) => { const m = meta(d); return 'cb.pos.' + d + (m && m.audio_bytes ? '.' + m.audio_bytes : ''); };  // same as main page
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
  'November', 'December'];

const $ = (id) => document.getElementById(id);
const audio = $('audio');
const scrub = $('scrub');
let editions = [];          // newest first, only valid dates
let selected = new Set();
let current = null;         // date currently loaded in the player
let scrubbing = false;
let lastSave = 0;
let pendingSeek = null;
let wantPlay = false;       // true while the queue should keep going (survives track changes)

function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) { if (typeof v === 'function') e.addEventListener(k.slice(2), v); }
    else if (k === 'style' || k === 'srcdoc' || k === 'href' || k === 'src') continue;   // never set from data here
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) {
    if (k == null || k === false) continue;
    e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return e;
}
function load(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch { return fallback; }
}
function store(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ } }
function heardSet() { const a = load(LS_HEARD, []); return new Set(Array.isArray(a) ? a.filter((d) => DATE_RE.test(d)) : []); }
function markHeard(d) { const s = heardSet(); s.add(d); store(LS_HEARD, [...s].sort().slice(-400)); }
function longDate(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return d;
  const dt = new Date(+m[1], +m[2] - 1, +m[3]);
  return `${DAYS[dt.getDay()]} ${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}`;
}
function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  sec = Math.round(sec);
  const hr = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return hr ? `${hr}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
function fmtMin(sec) { const m = Math.max(1, Math.round(sec / 60)); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; }
function speedLabel(v) { return Number(v).toFixed(1) + '×'; }
function audioUrl(d) {
  if (!DATE_RE.test(d)) return null;
  const m = meta(d);
  return `data/${d}/briefing.mp3` + (m && m.audio_bytes ? `?v=${m.audio_bytes}` : '');   // cache-bust regenerated audio
}
function meta(d) { return editions.find((e) => e.date === d); }

/* ---------- speed (discrete 1.0-1.5 steps, remembered) ---------- */
function getSpeed() {
  const v = parseFloat(localStorage.getItem(LS_SPEED));
  if (!isFinite(v)) return DEFAULT_SPEED;
  return SPEEDS.reduce((best, s) => (Math.abs(s - v) < Math.abs(best - v) ? s : best), SPEEDS[0]);
}
function applySpeed() {
  const r = getSpeed();
  audio.preservesPitch = true; audio.webkitPreservesPitch = true;
  audio.defaultPlaybackRate = r;
  if (audio.playbackRate !== r) audio.playbackRate = r;
}
function renderSpeed() {
  const cur = getSpeed();
  $('speed').replaceChildren(...SPEEDS.map((v) => h('button', {
    type: 'button', role: 'radio', 'aria-checked': String(v === cur),
    onclick: () => { try { localStorage.setItem(LS_SPEED, String(v)); } catch { /* */ } applySpeed(); renderSpeed(); updateBar(); updateTimes(); },
  }, speedLabel(v))));
}

/* ---------- queue: the ticked days in date order; works off the live selection ---------- */
function queue() { return editions.filter((e) => e.audio !== false && selected.has(e.date)).map((e) => e.date).sort(); }
function nextDate(after) { return queue().find((d) => d > after) || null; }
function prevDate(before) { return queue().filter((d) => d < before).pop() || null; }

function loadTrack(d, { fromStart = false } = {}) {
  const url = audioUrl(d);
  if (!url) return false;
  savePos(true);
  current = d;
  const saved = parseFloat(localStorage.getItem(posKey(d)));
  pendingSeek = !fromStart && isFinite(saved) ? saved : null;
  audio.src = url;
  applySpeed();
  setMeta();
  $('pl-player').hidden = false;
  renderNow(); renderList(); updateTimes();
  return true;
}
function play() {
  wantPlay = true;
  applySpeed();
  const p = audio.play();
  if (p && p.catch) p.catch((e) => { if (e && e.name !== 'AbortError') $('audio-note').textContent = 'Tap Play to start (' + e.message + ')'; });
}
function startQueue() {
  const q = queue();
  if (!q.length) return;
  // Resume the loaded day if it is still ticked and paused part-way; otherwise start at the oldest ticked day.
  if (current && q.includes(current) && audio.src && audio.paused) { play(); return; }
  if (current && !audio.paused) { audio.pause(); return; }
  loadTrack(q[0]);
  play();   // called synchronously inside the tap handler: unlocks this <audio> element on iOS Safari
  $('pl-player').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function goNext(auto) {
  const n = current && nextDate(current);
  if (n) { loadTrack(n, { fromStart: auto }); play(); return true; }
  if (auto) { wantPlay = false; $('audio-note').textContent = 'Finished: all ticked days played.'; }
  return false;
}
function goPrev() {
  if (audio.currentTime > 5) { audio.currentTime = 0; return; }
  const p = current && prevDate(current);
  const playing = !audio.paused;
  if (p) { loadTrack(p, { fromStart: true }); if (playing || wantPlay) play(); } else audio.currentTime = 0;
}
function skip(sec) {
  const d = audio.duration;
  let t = audio.currentTime + sec;
  if (isFinite(d)) t = Math.min(t, d - 0.5);
  audio.currentTime = Math.max(0, t);
  updateTimes(); updatePositionState();
}
function savePos(force) {
  if (!current) return;
  const now = Date.now();
  if (!force && now - lastSave < 2000) return;
  lastSave = now;
  const t = audio.currentTime, d = audio.duration;
  try {
    if (isFinite(d) && t > d - 5) localStorage.removeItem(posKey(current));
    else if (t > 1) localStorage.setItem(posKey(current), t.toFixed(1));
  } catch { /* */ }
}

/* ---------- UI ---------- */
function updateTimes() {
  const m = current && meta(current);
  const d = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (m && m.duration_s) || 0;
  const t = scrubbing ? (scrub.value / 1000) * d : audio.currentTime;
  $('cur').textContent = fmtTime(t);
  $('left').textContent = '-' + fmtTime(d - t);
  if (!scrubbing) scrub.value = d ? Math.round((t / d) * 1000) : 0;
  scrub.style.setProperty('--p', (scrub.value / 10) + '%');
}
function setPlayingUI(on) {
  $('play').classList.toggle('playing', on);
  $('play').setAttribute('aria-label', on ? 'Pause' : 'Play');
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = on ? 'playing' : 'paused';
  updateBar(); renderList();
}
function renderNow() {
  const q = queue();
  const i = q.indexOf(current);
  $('pl-now').textContent = current ? longDate(current) : '–';
  $('pl-now-k').textContent = current ? (i >= 0 ? `Now playing · day ${i + 1} of ${q.length}` : 'Now playing (not ticked)') : 'Now playing';
  $('prev').disabled = !current;
  $('next').disabled = !(current && nextDate(current));
}
function updateBar() {
  const q = queue();
  const secs = q.reduce((s, d) => s + ((meta(d) || {}).duration_s || 0), 0);
  const r = getSpeed();
  $('pl-sel').textContent = q.length
    ? `${q.length} day${q.length === 1 ? '' : 's'} · ${fmtMin(secs / r)} at ${speedLabel(r)}`
    : 'Tick the days you want to hear';
  const go = $('pl-go');
  go.disabled = !q.length;
  const playing = !audio.paused && !!current;
  go.classList.toggle('playing', playing);
  $('pl-go-t').textContent = playing ? 'Pause'
    : (current && q.includes(current) && audio.currentTime > 1 ? 'Resume'
      : (q.length ? `Play ${q.length} day${q.length === 1 ? '' : 's'}` : 'Play'));
  renderNow();
}
function renderList() {
  const list = $('pl-list');
  if (!editions.length) { list.replaceChildren(h('li', { class: 'skeleton' }, 'No editions yet.')); return; }
  const heard = heardSet();
  list.replaceChildren(...editions.map((e) => {
    const noAudio = e.audio === false;
    const isCur = e.date === current;
    const cb = h('input', { type: 'checkbox', class: 'pl-cb', 'aria-label': longDate(e.date), disabled: noAudio });
    cb.checked = selected.has(e.date);
    cb.addEventListener('change', () => {
      if (cb.checked) selected.add(e.date); else selected.delete(e.date);
      saveSel(); updateBar(); renderList();
    });
    const badges = [];
    if (isCur) badges.push(h('span', { class: 'badge now' }, audio.paused ? 'Paused' : 'Playing'));
    else if (heard.has(e.date)) badges.push(h('span', { class: 'badge heard' }, 'Heard'));
    if (noAudio) badges.push(h('span', { class: 'badge' }, 'No audio'));
    const papers = `${e.n_papers} paper${e.n_papers === 1 ? '' : 's'}`;
    return h('li', { class: 'pl-row' + (cb.checked ? ' on' : '') + (isCur ? ' cur' : '') },
      h('label', { class: 'pl-label' }, cb, h('span', { class: 'pl-box', 'aria-hidden': 'true' }),
        h('span', { class: 'pl-txt' },
          h('span', { class: 'pl-d' }, longDate(e.date)),
          h('span', { class: 'pl-m' }, papers + (e.duration_s ? ` · ${fmtMin(e.duration_s)} audio` : ''), ...badges))));
  }));
}
function saveSel() { store(LS_SEL, [...selected]); }
function selectWhere(fn) { selected = new Set(editions.filter((e) => e.audio !== false && fn(e)).map((e) => e.date)); saveSel(); updateBar(); renderList(); }
function isoDaysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ---------- Media Session (lock screen / headphones) ---------- */
function setMeta() {
  if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined' || !current) return;
  const abs = (p) => new URL(p, location.href).href;
  const q = queue(), i = q.indexOf(current), m = meta(current) || {};
  navigator.mediaSession.metadata = new MediaMetadata({
    title: longDate(current), artist: 'Cardio Briefing',
    album: (i >= 0 ? `Day ${i + 1} of ${q.length} · ` : '') + `${m.n_papers || 0} papers`,
    artwork: [{ src: abs('icons/icon-192.png'), sizes: '192x192', type: 'image/png' },
      { src: abs('icons/icon-512.png'), sizes: '512x512', type: 'image/png' }],
  });
}
function updatePositionState() {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  const d = audio.duration;
  if (!isFinite(d) || d <= 0) return;
  try { navigator.mediaSession.setPositionState({ duration: d, playbackRate: audio.playbackRate || getSpeed(), position: Math.min(audio.currentTime, d) }); } catch { /* */ }
}
function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const set = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch { /* unsupported */ } };
  set('play', () => play());
  set('pause', () => { wantPlay = false; audio.pause(); });
  set('stop', () => { wantPlay = false; audio.pause(); });
  set('previoustrack', () => goPrev());
  set('nexttrack', () => goNext(false));
  set('seekbackward', (d) => skip(-(d && d.seekOffset ? d.seekOffset : 15)));
  set('seekforward', (d) => skip(d && d.seekOffset ? d.seekOffset : 30));
  set('seekto', (d) => { audio.currentTime = d.seekTime; updatePositionState(); });
}

function bind() {
  $('pl-go').addEventListener('click', startQueue);
  $('play').addEventListener('click', () => { if (audio.paused) play(); else { wantPlay = false; audio.pause(); } });
  $('prev').addEventListener('click', goPrev);
  $('next').addEventListener('click', () => goNext(false));
  $('back').addEventListener('click', () => skip(-15));
  $('fwd').addEventListener('click', () => skip(30));
  $('sel-7').addEventListener('click', () => { const from = isoDaysAgo(6); selectWhere((e) => e.date >= from); });
  $('sel-unheard').addEventListener('click', () => { const hd = heardSet(); selectWhere((e) => !hd.has(e.date)); });
  $('sel-all').addEventListener('click', () => selectWhere(() => true));
  $('sel-none').addEventListener('click', () => selectWhere(() => false));
  scrub.addEventListener('input', () => { scrubbing = true; updateTimes(); });
  scrub.addEventListener('change', () => {
    if (isFinite(audio.duration)) audio.currentTime = (scrub.value / 1000) * audio.duration;
    scrubbing = false; updateTimes(); updatePositionState(); savePos(true);
  });
  audio.addEventListener('loadedmetadata', () => {
    applySpeed();
    if (pendingSeek != null && pendingSeek < audio.duration - 5) audio.currentTime = pendingSeek;
    pendingSeek = null;
    updateTimes(); updatePositionState();
  });
  audio.addEventListener('play', () => { applySpeed(); setPlayingUI(true); setMeta(); });
  audio.addEventListener('playing', () => { applySpeed(); $('audio-note').textContent = ''; });
  audio.addEventListener('pause', () => { setPlayingUI(false); savePos(true); });
  audio.addEventListener('waiting', () => { $('audio-note').textContent = 'Loading audio…'; });
  audio.addEventListener('timeupdate', () => { if (!scrubbing) updateTimes(); savePos(false); });
  audio.addEventListener('ratechange', () => { if (audio.playbackRate !== getSpeed()) audio.playbackRate = getSpeed(); updatePositionState(); });
  audio.addEventListener('ended', () => {
    if (current) { try { localStorage.removeItem(posKey(current)); } catch { /* */ } markHeard(current); }
    // Same <audio> element, new src, play() straight from 'ended': iOS Safari allows this once the element has
    // been started by a tap, including on the lock screen.
    if (!goNext(true)) setPlayingUI(false);
  });
  audio.addEventListener('error', () => {
    if (!current) return;
    $('audio-note').textContent = navigator.onLine ? `Audio for ${longDate(current)} could not be loaded; skipping.` : 'Offline: audio needs a connection.';
    if (navigator.onLine && wantPlay) goNext(true);
  });
  window.addEventListener('pagehide', () => savePos(true));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') savePos(true); });
  setupMediaSession();
}

async function init() {
  renderSpeed();
  bind();
  try {
    const r = await fetch('data/editions.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const idx = await r.json();
    editions = (Array.isArray(idx.editions) ? idx.editions : [])
      .filter((e) => e && typeof e.date === 'string' && DATE_RE.test(e.date))
      .map((e) => ({ date: e.date, audio: e.audio !== false, n_papers: Number(e.n_papers) || 0,
        duration_s: Number(e.duration_s) || 0, audio_bytes: Math.max(0, Math.floor(Number(e.audio_bytes) || 0)) }))
      .sort((a, b) => b.date.localeCompare(a.date));
  } catch (e) {
    $('pl-list').replaceChildren(h('li', { class: 'error' }, 'Could not load editions (' + e.message + ').'));
    return;
  }
  const known = new Set(editions.map((e) => e.date));
  selected = new Set((load(LS_SEL, []) || []).filter((d) => known.has(d)));
  renderList(); updateBar();
}

init();   // service worker registration and app updates: appupdate.js
