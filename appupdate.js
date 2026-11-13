/* Cardio Briefing: keep the installed app (iPhone home-screen web app) on the current version.
 * iOS often resumes a home-screen web app without reloading it, so a page loaded days ago keeps old code.
 * - registers sw.js with updateViaCache 'none' (the worker script is always checked against the network);
 * - on every return to the foreground: asks the browser to check for a new service worker, and if the app was in
 *   the background for more than 10 minutes and nothing is playing, reloads so new editions and app updates appear;
 * - when a new service worker takes over, reloads once (immediately if nothing is playing, otherwise at the next pause).
 * Only same-origin requests; no data leaves the device. */
(() => {
  'use strict';
  const APP_VERSION = 'cb-v6';            // keep equal to VERSION in sw.js (publish.py checks this)
  const STALE_MS = 10 * 60 * 1000;
  const audio = () => document.getElementById('audio');
  const idle = () => { const a = audio(); return !a || a.paused || a.ended; };
  let hiddenAt = 0;
  let reloading = false;
  let waiting = false;

  function reloadWhenIdle() {
    if (reloading || waiting) return;
    if (idle()) { reloading = true; location.reload(); return; }
    waiting = true;
    audio().addEventListener('pause', () => { if (!reloading) { reloading = true; location.reload(); } }, { once: true });
  }

  const v = document.getElementById('app-version');
  if (v) v.textContent = 'App ' + APP_VERSION;

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistration().then((r) => r && r.update()).catch(() => {});
    if (hiddenAt && Date.now() - hiddenAt > STALE_MS && idle()) { reloading = true; location.reload(); }
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted && idle()) { reloading = true; location.reload(); } });

  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) reloadWhenIdle(); });
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.origin && e.origin !== location.origin) return;
    if (!e.data || e.data.type !== 'cb-activated') return;
    if (e.ports && e.ports[0]) e.ports[0].postMessage('ok');   // tell the worker this page updates itself
    if (e.data.version !== APP_VERSION) reloadWhenIdle();
  });
  navigator.serviceWorker.startMessages();
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then((r) => r.update())
      .catch(() => {});
  });
})();
