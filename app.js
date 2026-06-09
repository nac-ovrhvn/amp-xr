// ─────────────────────────────────────────────
//  AMPXR — app.js
//  1. Replace AMPXR_SUPABASE_URL with your Project URL
//  2. Replace AMPXR_PUBLISHABLE_KEY with your Publishable key
// ─────────────────────────────────────────────

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// ── Supabase Config ───────────────────────────
const AMPXR_SUPABASE_URL      = 'https://avjikdnuswuqiqsacpou.supabase.co/rest/v1/';
const AMPXR_PUBLISHABLE_KEY   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2amlrZG51c3d1cWlxc2FjcG91Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5ODE3NjQsImV4cCI6MjA5NjU1Nzc2NH0.CnFaa9BGhWQvqO5tTiKtrFCL7YC-NlCYImKd3h3IgTE';

const ampxrDb = createClient(AMPXR_SUPABASE_URL, AMPXR_PUBLISHABLE_KEY);

// ── Sound Definitions ─────────────────────────
const AMPXR_SOUNDS = [
  { id: 'rain',       name: 'Rain',        icon: '🌧️', file: 'sounds/rain.wav'       },
  { id: 'lightrain',  name: 'Light Rain',  icon: '🌦️', file: 'sounds/lightrain.mp3'  },
  { id: 'thunder',    name: 'Thunder',     icon: '⛈️', file: 'sounds/thunder.mp3'    },
  { id: 'fireplace',  name: 'Fireplace',   icon: '🔥', file: 'sounds/fireplace.wav'  },
  { id: 'river',      name: 'River',       icon: '🏞️', file: 'sounds/river.wav'      },
  { id: 'waves',      name: 'Waves',       icon: '🌊', file: 'sounds/waves.wav'      },
  { id: 'birds',      name: 'Birds',       icon: '🐦', file: 'sounds/birds.wav'      },
  { id: 'whitenoise', name: 'White Noise', icon: '📻', file: 'sounds/whitenoise.wav' },
  { id: 'chimes',     name: 'Chimes',      icon: '🎐', file: 'sounds/chimes.wav'     },
  { id: 'windchimes', name: 'Wind Chimes', icon: '🎋', file: 'sounds/windchimes.wav' },
];

// ── App State ─────────────────────────────────
let ampxrUser       = null;
let ampxrIsGuest    = false;
let ampxrAuthMode   = 'login';

// Audio
const ampxrAudioCtx    = new (window.AudioContext || window.webkitAudioContext)();
const ampxrAudioNodes  = {};   // soundId → { source, gainNode }
const ampxrBufferCache = {};   // soundId → AudioBuffer
const ampxrSoundVols   = {};   // soundId → 0–100
const ampxrSoundSecs   = {};   // soundId → seconds played this session
let   ampxrMasterVol   = 70;
let   ampxrPlayingSet  = new Set();
let   ampxrSoundTicks  = {};   // soundId → interval id

// Timer
let ampxrTimerRunning   = false;
let ampxrTimerPhase     = 'study';
let ampxrTimerSecsLeft  = 0;
let ampxrTimerInterval  = null;
let ampxrSessionsDone   = 0;
let ampxrTotalStudySecs = 0;
let ampxrTotalRestSecs  = 0;
const AMPXR_CIRCUMFERENCE = 2 * Math.PI * 95; // SVG r=95

// Persisted stats (merged from Supabase + localStorage)
let ampxrSavedStats = {
  total_sound_secs : 0,
  total_study_secs : 0,
  total_rest_secs  : 0,
  total_sessions   : 0,
  sound_breakdown  : {},
};

// Init per-sound defaults
AMPXR_SOUNDS.forEach(s => {
  ampxrSoundVols[s.id] = 70;
  ampxrSoundSecs[s.id] = 0;
});

// ─────────────────────────────────────────────
//  AUTH
// ─────────────────────────────────────────────
function setAuthMode(mode) {
  ampxrAuthMode = mode;
  document.querySelectorAll('.login-tab').forEach((t, i) => {
    t.classList.toggle('active',
      (i === 0 && mode === 'login') || (i === 1 && mode === 'signup')
    );
  });
  document.getElementById('field-username').style.display = mode === 'signup' ? 'flex' : 'none';
  document.getElementById('auth-btn').textContent = mode === 'login' ? 'Sign in' : 'Create account';
  document.getElementById('auth-error').textContent = '';
}
window.setAuthMode = setAuthMode;

async function handleAuth() {
  const email    = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const username = document.getElementById('auth-username').value.trim();
  const errEl    = document.getElementById('auth-error');
  const btn      = document.getElementById('auth-btn');

  errEl.textContent = '';
  if (!email || !password) { errEl.textContent = 'Please fill all fields.'; return; }

  btn.disabled = true;
  btn.textContent = ampxrAuthMode === 'login' ? 'Signing in…' : 'Creating account…';

  try {
    if (ampxrAuthMode === 'signup') {
      if (!username) { errEl.textContent = 'Choose a username.'; btn.disabled = false; btn.textContent = 'Create account'; return; }
      const { data, error } = await ampxrDb.auth.signUp({
        email, password,
        options: { data: { username } }
      });
      if (error) throw error;
      if (data.user) {
        await ampxrDb.from('profiles').upsert({ id: data.user.id, username });
        await ampxrDb.from('stats').upsert({
          user_id: data.user.id,
          total_sound_secs: 0, total_study_secs: 0,
          total_rest_secs: 0,  total_sessions: 0,
          sound_breakdown: {}
        });
        ampxrShowToast('Account created! Check your email to verify.');
        setAuthMode('login');
      }
    } else {
      const { data, error } = await ampxrDb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (data.user) await ampxrEnterApp(data.user);
    }
  } catch (e) {
    errEl.textContent = e.message || 'Something went wrong.';
  } finally {
    btn.disabled = false;
    btn.textContent = ampxrAuthMode === 'login' ? 'Sign in' : 'Create account';
  }
}
window.handleAuth = handleAuth;

function guestMode() {
  ampxrIsGuest = true;
  ampxrUser    = null;
  ampxrLoadLocalStats();
  ampxrShowApp('Guest');
}
window.guestMode = guestMode;

async function ampxrEnterApp(user) {
  ampxrUser    = user;
  ampxrIsGuest = false;
  await ampxrLoadRemoteStats();
  const displayName = user.user_metadata?.username || user.email.split('@')[0];
  ampxrShowApp(displayName);
}

async function handleLogout() {
  if (!ampxrIsGuest && ampxrUser) {
    await ampxrPushStats();
    await ampxrDb.auth.signOut();
  }
  ampxrStopAllSounds();
  ampxrResetTimerState();
  ampxrUser    = null;
  ampxrIsGuest = false;
  AMPXR_SOUNDS.forEach(s => { ampxrSoundSecs[s.id] = 0; });
  ampxrSessionsDone = ampxrTotalStudySecs = ampxrTotalRestSecs = 0;
  document.getElementById('screen-app').classList.remove('active');
  document.getElementById('screen-login').classList.add('active');
}
window.handleLogout = handleLogout;

function ampxrShowApp(displayName) {
  document.getElementById('screen-login').classList.remove('active');
  document.getElementById('screen-app').classList.add('active');
  document.getElementById('user-avatar').textContent = displayName.slice(0, 2).toUpperCase();
  document.getElementById('user-name-label').textContent = displayName;
  ampxrBuildSoundGrid();
  ampxrInitTimerDisplay();
}

// Auto-restore session on page load
(async () => {
  const { data } = await ampxrDb.auth.getSession();
  if (data.session) await ampxrEnterApp(data.session.user);

  ampxrDb.auth.onAuthStateChange((_event, session) => {
    if (_event === 'SIGNED_IN' && session && !ampxrUser) {
      ampxrEnterApp(session.user);
    }
  });
})();

// Enter key triggers login
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('screen-login').classList.contains('active')) {
    handleAuth();
  }
});

// ─────────────────────────────────────────────
//  STATS PERSISTENCE
// ─────────────────────────────────────────────
async function ampxrLoadRemoteStats() {
  if (!ampxrUser) return;
  const { data } = await ampxrDb
    .from('stats')
    .select('*')
    .eq('user_id', ampxrUser.id)
    .single();
  if (data) {
    ampxrSavedStats = {
      total_sound_secs : data.total_sound_secs || 0,
      total_study_secs : data.total_study_secs || 0,
      total_rest_secs  : data.total_rest_secs  || 0,
      total_sessions   : data.total_sessions   || 0,
      sound_breakdown  : data.sound_breakdown  || {},
    };
    localStorage.setItem('ampxr_stats', JSON.stringify(ampxrSavedStats));
  }
}

function ampxrLoadLocalStats() {
  try {
    const raw = localStorage.getItem('ampxr_stats');
    if (raw) ampxrSavedStats = { ...ampxrSavedStats, ...JSON.parse(raw) };
  } catch {}
}

async function ampxrPushStats() {
  const sessionSoundSecs = Object.values(ampxrSoundSecs).reduce((a, b) => a + b, 0);
  const merged = {
    total_sound_secs : ampxrSavedStats.total_sound_secs + sessionSoundSecs,
    total_study_secs : ampxrSavedStats.total_study_secs + ampxrTotalStudySecs,
    total_rest_secs  : ampxrSavedStats.total_rest_secs  + ampxrTotalRestSecs,
    total_sessions   : ampxrSavedStats.total_sessions   + ampxrSessionsDone,
    sound_breakdown  : { ...ampxrSavedStats.sound_breakdown },
  };
  AMPXR_SOUNDS.forEach(s => {
    merged.sound_breakdown[s.id] = (merged.sound_breakdown[s.id] || 0) + ampxrSoundSecs[s.id];
  });

  localStorage.setItem('ampxr_stats', JSON.stringify(merged));

  if (ampxrUser && !ampxrIsGuest) {
    await ampxrDb.from('stats').upsert({
      user_id: ampxrUser.id,
      ...merged,
    });
  }

  ampxrSavedStats = merged;
}

// Auto-save every 60s + on page unload
setInterval(ampxrPushStats, 60_000);
window.addEventListener('beforeunload', ampxrPushStats);

// ─────────────────────────────────────────────
//  AUDIO ENGINE
// ─────────────────────────────────────────────
async function ampxrLoadBuffer(soundId, filePath) {
  if (ampxrBufferCache[soundId]) return ampxrBufferCache[soundId];
  const res = await fetch(filePath);
  const arr = await res.arrayBuffer();
  const buf = await ampxrAudioCtx.decodeAudioData(arr);
  ampxrBufferCache[soundId] = buf;
  return buf;
}

function ampxrPlayNode(soundId, buffer) {
  if (ampxrAudioNodes[soundId]) return;
  const gainNode = ampxrAudioCtx.createGain();
  gainNode.gain.setValueAtTime(
    (ampxrSoundVols[soundId] / 100) * (ampxrMasterVol / 100),
    ampxrAudioCtx.currentTime
  );
  gainNode.connect(ampxrAudioCtx.destination);

  const source = ampxrAudioCtx.createBufferSource();
  source.buffer = buffer;
  source.loop   = true;
  source.connect(gainNode);
  source.start(0);

  ampxrAudioNodes[soundId] = { source, gainNode };
}

function ampxrStopNode(soundId) {
  if (!ampxrAudioNodes[soundId]) return;
  try {
    ampxrAudioNodes[soundId].source.stop();
    ampxrAudioNodes[soundId].gainNode.disconnect();
  } catch {}
  delete ampxrAudioNodes[soundId];
}

function ampxrStopAllSounds() {
  [...ampxrPlayingSet].forEach(id => {
    ampxrStopNode(id);
    clearInterval(ampxrSoundTicks[id]);
    const card = document.getElementById('card-' + id);
    if (card) card.classList.remove('playing', 'loading');
  });
  ampxrPlayingSet.clear();
  ampxrUpdateNowPlaying();
}

function ampxrSyncAllGains() {
  Object.entries(ampxrAudioNodes).forEach(([id, { gainNode }]) => {
    gainNode.gain.setValueAtTime(
      (ampxrSoundVols[id] / 100) * (ampxrMasterVol / 100),
      ampxrAudioCtx.currentTime
    );
  });
}

// ─────────────────────────────────────────────
//  SOUND GRID
// ─────────────────────────────────────────────
function ampxrBuildSoundGrid() {
  const grid = document.getElementById('sound-grid');
  grid.innerHTML = '';
  AMPXR_SOUNDS.forEach(s => {
    const card = document.createElement('div');
    card.className = 'sound-card';
    card.id = 'card-' + s.id;
    card.innerHTML = `
      <div class="playing-dot"></div>
      <div class="loading-dot"></div>
      <span class="sound-icon">${s.icon}</span>
      <span class="sound-name">${s.name}</span>
      <div class="sound-vol-row" onclick="event.stopPropagation()">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
        </svg>
        <input type="range" class="mini-range" min="0" max="100" value="70" step="1"
          oninput="ampxrSetSoundVol('${s.id}', this.value)">
      </div>`;
    card.addEventListener('click', () => ampxrToggleSound(s));
    grid.appendChild(card);
  });
}

async function ampxrToggleSound(sound) {
  if (ampxrAudioCtx.state === 'suspended') await ampxrAudioCtx.resume();

  const card = document.getElementById('card-' + sound.id);

  if (ampxrPlayingSet.has(sound.id)) {
    ampxrStopNode(sound.id);
    ampxrPlayingSet.delete(sound.id);
    clearInterval(ampxrSoundTicks[sound.id]);
    card.classList.remove('playing', 'loading');
  } else {
    card.classList.add('loading');
    try {
      const buffer = await ampxrLoadBuffer(sound.id, sound.file);
      ampxrPlayNode(sound.id, buffer);
      ampxrPlayingSet.add(sound.id);
      card.classList.remove('loading');
      card.classList.add('playing');
      ampxrSoundTicks[sound.id] = setInterval(() => { ampxrSoundSecs[sound.id]++; }, 1000);
    } catch {
      card.classList.remove('loading');
      ampxrShowToast('Could not load ' + sound.name);
    }
  }
  ampxrUpdateNowPlaying();
}

function ampxrSetSoundVol(id, val) {
  ampxrSoundVols[id] = parseInt(val);
  if (ampxrAudioNodes[id]) {
    ampxrAudioNodes[id].gainNode.gain.setValueAtTime(
      (ampxrSoundVols[id] / 100) * (ampxrMasterVol / 100),
      ampxrAudioCtx.currentTime
    );
  }
}
window.ampxrSetSoundVol = ampxrSetSoundVol;

function setMasterVol(val) {
  ampxrMasterVol = parseInt(val);
  document.getElementById('master-pct').textContent = val + '%';
  ampxrSyncAllGains();
}
window.setMasterVol = setMasterVol;

function ampxrUpdateNowPlaying() {
  const n  = ampxrPlayingSet.size;
  const el = document.getElementById('now-playing');
  el.classList.toggle('visible', n > 0);
  document.getElementById('playing-count').textContent = n;
}

// ─────────────────────────────────────────────
//  TABS
// ─────────────────────────────────────────────
function switchTab(name, el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.content').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
  if (name === 'stats') ampxrRenderStats();
}
window.switchTab = switchTab;

// ─────────────────────────────────────────────
//  TIMER
// ─────────────────────────────────────────────
const ampxrGetStudySecs = () => (parseInt(document.getElementById('study-min')?.value) || 25) * 60;
const ampxrGetRestSecs  = () => (parseInt(document.getElementById('rest-min')?.value)  || 5)  * 60;

function ampxrInitTimerDisplay() {
  ampxrTimerSecsLeft = ampxrGetStudySecs();
  ampxrTimerPhase    = 'study';
  ampxrUpdateClockDisplay();
}

function toggleTimer() {
  if (ampxrTimerRunning) {
    clearInterval(ampxrTimerInterval);
    ampxrTimerRunning = false;
    ampxrSetPlayIcon(false);
  } else {
    ampxrTimerRunning = true;
    ampxrSetPlayIcon(true);
    ampxrTimerInterval = setInterval(ampxrTickTimer, 1000);
  }
}
window.toggleTimer = toggleTimer;

function ampxrTickTimer() {
  ampxrTimerSecsLeft--;
  if (ampxrTimerPhase === 'study') ampxrTotalStudySecs++;
  else ampxrTotalRestSecs++;

  if (ampxrTimerSecsLeft <= 0) {
    if (ampxrTimerPhase === 'study') {
      ampxrSessionsDone++;
      ampxrTimerPhase    = 'rest';
      ampxrTimerSecsLeft = ampxrGetRestSecs();
      ampxrShowToast('Rest time 🌿');
    } else {
      ampxrTimerPhase    = 'study';
      ampxrTimerSecsLeft = ampxrGetStudySecs();
      ampxrShowToast('Back to focus 🎯');
    }
    ampxrUpdateSessionStrip();
  }
  ampxrUpdateClockDisplay();
}

function resetTimer() {
  clearInterval(ampxrTimerInterval);
  ampxrTimerRunning  = false;
  ampxrSetPlayIcon(false);
  ampxrTimerPhase    = 'study';
  ampxrTimerSecsLeft = ampxrGetStudySecs();
  ampxrUpdateClockDisplay();
}
window.resetTimer = resetTimer;

function ampxrResetTimerState() {
  clearInterval(ampxrTimerInterval);
  ampxrTimerRunning   = false;
  ampxrTimerPhase     = 'study';
  ampxrTimerSecsLeft  = 0;
  ampxrSessionsDone   = 0;
  ampxrTotalStudySecs = 0;
  ampxrTotalRestSecs  = 0;
}

function skipPhase() {
  if (ampxrTimerPhase === 'study') {
    ampxrSessionsDone++;
    ampxrTimerPhase    = 'rest';
    ampxrTimerSecsLeft = ampxrGetRestSecs();
    ampxrShowToast('Rest time 🌿');
  } else {
    ampxrTimerPhase    = 'study';
    ampxrTimerSecsLeft = ampxrGetStudySecs();
    ampxrShowToast('Back to focus 🎯');
  }
  ampxrUpdateSessionStrip();
  ampxrUpdateClockDisplay();
}
window.skipPhase = skipPhase;

function ampxrUpdateClockDisplay() {
  const total  = ampxrTimerPhase === 'study' ? ampxrGetStudySecs() : ampxrGetRestSecs();
  const ratio  = Math.max(0, ampxrTimerSecsLeft / total);
  const offset = AMPXR_CIRCUMFERENCE * (1 - ratio);

  const arc = document.getElementById('ring-arc');
  if (arc) {
    arc.style.strokeDasharray  = AMPXR_CIRCUMFERENCE;
    arc.style.strokeDashoffset = offset;
  }

  const m = Math.floor(ampxrTimerSecsLeft / 60);
  const s = ampxrTimerSecsLeft % 60;
  const timeEl = document.getElementById('clock-time');
  if (timeEl) timeEl.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');

  const phaseEl = document.getElementById('clock-phase');
  if (phaseEl) phaseEl.textContent = ampxrTimerPhase;

  document.getElementById('clock-ring')?.classList.toggle('rest', ampxrTimerPhase === 'rest');
  ampxrUpdateSessionStrip();
}

function ampxrUpdateSessionStrip() {
  const el = id => document.getElementById(id);
  if (el('s-sessions')) el('s-sessions').textContent = ampxrSessionsDone;
  if (el('s-study'))    el('s-study').textContent    = ampxrFmtMin(ampxrTotalStudySecs);
  if (el('s-rest'))     el('s-rest').textContent     = ampxrFmtMin(ampxrTotalRestSecs);
}

function ampxrSetPlayIcon(playing) {
  const el = document.getElementById('play-icon');
  if (!el) return;
  el.innerHTML = playing
    ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
    : '<polygon points="5,3 19,12 5,21"/>';
}

// ─────────────────────────────────────────────
//  STATS RENDER
// ─────────────────────────────────────────────
function ampxrRenderStats() {
  const sessionSoundSecs = Object.values(ampxrSoundSecs).reduce((a, b) => a + b, 0);
  const totalSound = ampxrSavedStats.total_sound_secs + sessionSoundSecs;
  const totalStudy = ampxrSavedStats.total_study_secs + ampxrTotalStudySecs;
  const totalRest  = ampxrSavedStats.total_rest_secs  + ampxrTotalRestSecs;
  const totalSess  = ampxrSavedStats.total_sessions   + ampxrSessionsDone;

  const combined = { ...ampxrSavedStats.sound_breakdown };
  AMPXR_SOUNDS.forEach(s => {
    combined[s.id] = (combined[s.id] || 0) + ampxrSoundSecs[s.id];
  });

  const $ = id => document.getElementById(id);
  $('stat-sound').textContent         = ampxrFmtHM(totalSound);
  $('stat-sessions').textContent      = totalSess;
  $('stat-sessions-sub').textContent  = ampxrFmtMin(totalStudy) + ' study';
  $('stat-study').textContent         = ampxrFmtHM(totalStudy);
  $('stat-sounds-used').textContent   = AMPXR_SOUNDS.filter(s => (combined[s.id] || 0) > 0).length;

  // Bar chart
  const maxSecs = Math.max(...AMPXR_SOUNDS.map(s => combined[s.id] || 0), 1);
  const list    = $('sound-stats-list');
  list.innerHTML = '';

  [...AMPXR_SOUNDS]
    .sort((a, b) => (combined[b.id] || 0) - (combined[a.id] || 0))
    .forEach(s => {
      const secs = combined[s.id] || 0;
      const pct  = Math.round((secs / maxSecs) * 100);
      const row  = document.createElement('div');
      row.className = 'sound-row';
      row.innerHTML = `
        <span class="sound-row-icon">${s.icon}</span>
        <div class="sound-row-info">
          <div class="sound-row-name">${s.name}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
        </div>
        <span class="sound-row-time">${ampxrFmtMin(secs)}</span>`;
      list.appendChild(row);
    });

  $('sync-hint').textContent = ampxrIsGuest
    ? '⚠️ Guest mode — stats not saved across sessions'
    : ampxrUser
      ? '✓ Synced to your account'
      : '';
}

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────
function ampxrFmtMin(secs) {
  const m = Math.floor(secs / 60);
  return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
}

function ampxrFmtHM(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? h + 'h ' + m + 'm' : m + 'm';
}

let ampxrToastTimer;
function ampxrShowToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(ampxrToastTimer);
  ampxrToastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

// Offline detection
window.addEventListener('online',  () => document.body.classList.remove('offline'));
window.addEventListener('offline', () => document.body.classList.add('offline'));
if (!navigator.onLine) document.body.classList.add('offline');

// ── Service Worker Registration ───────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(() => console.log('[ampxr SW] Registered'))
      .catch(e => console.warn('[ampxr SW] Failed:', e));
  });
}
