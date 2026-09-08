const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const money = n => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(n || 0));
const shortMoney = n => money(n).replace(/\s/g, ' ');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const formatTime = v => new Date(v).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace('.', ':');
const formatDate = v => new Date(v).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
const todayISO = () => new Date().toISOString().slice(0, 10);

function genUUID() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch { }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/* ==========================================================================
   ALARM & SOUND SYSTEM (PCM WAV DUAL-CHANNEL & 10 SECONDS SPAM LOOP)
   ========================================================================== */

function createWavDataUri(sampleRate, samples) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return 'data:audio/wav;base64,' + (typeof window !== 'undefined' && window.btoa ? window.btoa(binary) : (typeof Buffer !== 'undefined' ? Buffer.from(buffer).toString('base64') : ''));
}

function synthesizeChime(sampleRate, duration, notes) {
  const numSamples = Math.floor(sampleRate * duration);
  const samples = new Float32Array(numSamples);
  notes.forEach(note => {
    const startIdx = Math.floor(note.start * sampleRate);
    const endIdx = Math.min(numSamples, Math.floor((note.start + note.duration) * sampleRate));
    for (let i = startIdx; i < endIdx; i++) {
      const t = (i - startIdx) / sampleRate;
      const env = Math.exp(-t * (note.decay || 3.5));
      // Rich acoustic bell synthesis (Fundamental + 2nd + 3rd + 4th harmonic)
      let val = Math.sin(2 * Math.PI * note.freq * t);
      if (note.harmonics) {
        val += 0.50 * Math.sin(2 * Math.PI * note.freq * 2 * t);
        val += 0.25 * Math.sin(2 * Math.PI * note.freq * 3 * t);
        val += 0.15 * Math.sin(2 * Math.PI * note.freq * 4 * t);
      }
      // Soft saturation limiter to prevent digital clipping while maximizing perceived loudness
      const raw = val * env * (note.gain || 0.85);
      samples[i] += Math.tanh(raw);
    }
  });
  return createWavDataUri(sampleRate, samples);
}

class SoundAlarmEngine {
  constructor() {
    this.ctx = null;
    this.compressor = null;
    this.interval = null;
    this.timeout = null;
    this.isPlaying = false;
    this.vibrateInterval = null;
    this.unlocked = false;
    this.readyWavUri = null;
    this.adminWavUri = null;
    this.readyAudio = null;
    this.adminAudio = null;
    this.initAudioSources();
  }

  initAudioSources() {
    try {
      // Customer Ready Chime: Ultra-Loud Resonant Tri-Tone Bell (A5 -> C#6 -> E6)
      this.readyWavUri = synthesizeChime(22050, 1.4, [
        { freq: 880, start: 0.0, duration: 0.85, decay: 3.8, gain: 0.85, harmonics: true },
        { freq: 1108.73, start: 0.18, duration: 0.85, decay: 3.8, gain: 0.85, harmonics: true },
        { freq: 1318.51, start: 0.38, duration: 1.0, decay: 3.0, gain: 0.95, harmonics: true }
      ]);
      // Admin Alert: High-Impact Urgent Alarm Bell (B5 -> E6 Double Hit)
      this.adminWavUri = synthesizeChime(22050, 1.2, [
        { freq: 987.77, start: 0.0, duration: 0.45, decay: 4.0, gain: 0.90, harmonics: true },
        { freq: 1318.51, start: 0.15, duration: 0.65, decay: 3.5, gain: 0.95, harmonics: true },
        { freq: 987.77, start: 0.50, duration: 0.45, decay: 4.0, gain: 0.90, harmonics: true },
        { freq: 1318.51, start: 0.65, duration: 0.65, decay: 3.5, gain: 0.95, harmonics: true }
      ]);

      if (typeof Audio !== 'undefined') {
        this.readyAudio = new Audio(this.readyWavUri);
        this.readyAudio.preload = 'auto';
        this.readyAudio.volume = 1.0;

        this.adminAudio = new Audio(this.adminWavUri);
        this.adminAudio.preload = 'auto';
        this.adminAudio.volume = 1.0;
      }
    } catch (e) {
      console.warn('Audio init error:', e);
    }
  }

  unlock() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!this.ctx && AudioContextClass) {
        this.ctx = new AudioContextClass();
      }
      if (this.ctx) {
        if (this.ctx.state === 'suspended') {
          this.ctx.resume();
        }
        // Attach Master Compressor for punchy loudness without distortion
        if (!this.compressor) {
          this.compressor = this.ctx.createDynamicsCompressor();
          this.compressor.threshold.setValueAtTime(-14, this.ctx.currentTime);
          this.compressor.knee.setValueAtTime(40, this.ctx.currentTime);
          this.compressor.ratio.setValueAtTime(12, this.ctx.currentTime);
          this.compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
          this.compressor.release.setValueAtTime(0.25, this.ctx.currentTime);
          this.compressor.connect(this.ctx.destination);
        }
        // Play instant 1-sample silent buffer to activate Web Audio pipeline on mobile
        const buffer = this.ctx.createBuffer(1, 1, 22050);
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(this.compressor || this.ctx.destination);
        source.start(0);
      }

      // Unlock HTML5 Audio Elements for mobile Safari / Chrome
      if (this.readyAudio && !this.unlocked) {
        const p1 = this.readyAudio.play();
        if (p1 && typeof p1.then === 'function') {
          p1.then(() => {
            this.readyAudio.pause();
            this.readyAudio.currentTime = 0;
          }).catch(() => { });
        }
      }
      if (this.adminAudio && !this.unlocked) {
        const p2 = this.adminAudio.play();
        if (p2 && typeof p2.then === 'function') {
          p2.then(() => {
            this.adminAudio.pause();
            this.adminAudio.currentTime = 0;
          }).catch(() => { });
        }
      }
      this.unlocked = true;
    } catch { }
  }

  playTone(freq, type = 'sine', duration = 0.25, gainVal = 0.90, delay = 0) {
    if (!this.ctx) this.unlock();
    if (!this.ctx) return;
    try {
      const t = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(gainVal, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      osc.connect(gain);
      gain.connect(this.compressor || this.ctx.destination);
      osc.start(t);
      osc.stop(t + duration);
    } catch { }
  }

  playReadyChime() {
    // Channel 1: HTML5 Audio WAV file
    try {
      if (this.readyAudio) {
        this.readyAudio.currentTime = 0;
        this.readyAudio.play().catch(() => { });
      }
    } catch { }
    // Channel 2: Web Audio API Oscillator (Louder Resonant Tri-Tone)
    this.playTone(880, 'sine', 0.28, 0.85, 0);
    this.playTone(1108.73, 'triangle', 0.32, 0.90, 0.16);
    this.playTone(1318.51, 'sine', 0.60, 0.95, 0.34);
  }

  playAdminChime() {
    // Channel 1: HTML5 Audio WAV file
    try {
      if (this.adminAudio) {
        this.adminAudio.currentTime = 0;
        this.adminAudio.play().catch(() => { });
      }
    } catch { }
    // Channel 2: Web Audio API Oscillator (High-Energy Double Ring)
    this.playTone(987.77, 'sine', 0.24, 0.90, 0);
    this.playTone(1318.51, 'sine', 0.45, 0.95, 0.16);
    this.playTone(987.77, 'sine', 0.24, 0.90, 0.48);
    this.playTone(1318.51, 'sine', 0.45, 0.95, 0.64);
  }

  startAlarm10s(type = 'ready') {
    this.stopAlarm();
    this.unlock();
    this.isPlaying = true;

    // Trigger immediate sound
    if (type === 'admin') {
      this.playAdminChime();
    } else {
      this.playReadyChime();
    }

    // Trigger strong rhythmic haptic vibration
    try {
      if ('vibrate' in navigator) {
        navigator.vibrate([600, 100, 600, 100, 800]);
        this.vibrateInterval = setInterval(() => {
          try { navigator.vibrate([600, 100, 600, 100, 800]); } catch { }
        }, 1800);
      }
    } catch { }

    // Loop sound spam every 900ms for 10 seconds!
    this.interval = setInterval(() => {
      if (!this.isPlaying) return;
      if (type === 'admin') {
        this.playAdminChime();
      } else {
        this.playReadyChime();
      }
    }, 900);

    // Auto-stop exactly after 10.000 ms (10 seconds)
    this.timeout = setTimeout(() => {
      this.stopAlarm();
    }, 10000);
  }

  stopAlarm() {
    this.isPlaying = false;
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
    if (this.timeout) { clearTimeout(this.timeout); this.timeout = null; }
    if (this.vibrateInterval) { clearInterval(this.vibrateInterval); this.vibrateInterval = null; }
    try { if ('vibrate' in navigator) navigator.vibrate(0); } catch { }
    const b = document.getElementById('alarmBanner');
    if (b) b.remove();
  }
}

const alarm = new SoundAlarmEngine();

// Unlock Mobile Audio on ANY initial user interaction
['click', 'touchstart', 'touchend', 'pointerdown', 'keydown'].forEach(evt => {
  window.addEventListener(evt, () => alarm.unlock(), { passive: true });
});

function showAlarmBanner(title, subtitle, onDismiss) {
  let banner = document.getElementById('alarmBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'alarmBanner';
    banner.className = 'alarm-banner';
    document.body.appendChild(banner);
  }
  banner.innerHTML = `
    <div class="alarm-banner-inner">
      <div class="alarm-banner-icon">🔔</div>
      <div class="alarm-banner-text">
        <strong>${esc(title)}</strong>
        <small>${esc(subtitle || 'Alarm berbunyi selama 10 detik...')}</small>
      </div>
      <button class="btn btn-small btn-primary alarm-dismiss-btn">Matikan Suara</button>
    </div>
  `;
  const btn = banner.querySelector('.alarm-dismiss-btn');
  if (btn) {
    btn.onclick = () => {
      alarm.stopAlarm();
      if (onDismiss) onDismiss();
      banner.remove();
    };
  }
}

const ICONS = {
  coffee: '<path d="M5 8h11v6a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5V8Z"/><path d="M16 10h2a3 3 0 0 1 0 6h-2"/><path d="M8 3v2M12 3v2"/>',
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  orders: '<path d="M6 4h12l1 17H5L6 4Z"/><path d="M9 8a3 3 0 0 0 6 0"/>',
  menu: '<path d="M5 8h14v11H5z"/><path d="M8 3v4M12 3v4M16 3v4"/>',
  categories: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  qr: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v6h-2zM14 18h2v2h-2z"/>',
  wallet: '<path d="M4 6h14a2 2 0 0 1 2 2v10H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12"/><path d="M15 11h6v4h-6a2 2 0 0 1 0-4Z"/>',
  report: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1L7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
  logout: '<path d="M10 17l5-5-5-5M15 12H3"/><path d="M14 3h6a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-6"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  cart: '<circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/><path d="M3 4h2l2.5 11h10l2-7H7"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/>',
  arrow: '<path d="M5 12h14M14 7l5 5-5 5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6"/>',
  table: '<rect x="4" y="6" width="16" height="8" rx="2"/><path d="M7 14v5M17 14v5"/>',
  edit: '<path d="m4 20 4-.8L19 8.2 15.8 5 4.8 16 4 20Z"/><path d="m13.8 7 3.2 3.2"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  rotate: '<path d="M20 7v5h-5"/><path d="M19 12a7 7 0 1 1-2-5"/>',
  eye: '<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  cash: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M7 9H5v2M17 15h2v-2"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  star: '<path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.4l6.1-.9L12 3Z"/>',
  wifi: '<path d="M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/>',
  mapPin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>'
};
function icon(name, size = 20, cls = '') { return `<svg class="icon ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.coffee}</svg>` }

async function api(path, opt = {}) {
  try {
    const r = await fetch('/api' + path, { headers: { 'Content-Type': 'application/json', ...(opt.headers || {}) }, ...opt });
    let d = {}; try { d = await r.json() } catch { }
    if (!r.ok) throw new Error(d.message || 'Terjadi kendala. Silakan coba lagi.');
    return d;
  } catch (e) {
    if (e instanceof TypeError) throw new Error('Koneksi ke demo terputus. Pastikan server masih berjalan.');
    throw e;
  }
}
function toast(msg, bad = false) {
  const old = $$('.toast'); old.forEach(x => x.remove());
  const e = document.createElement('div');
  e.className = 'toast' + (bad ? ' error' : '');
  e.innerHTML = `<span>${bad ? '!' : '✓'}</span><b>${esc(msg)}</b>`;
  document.body.append(e);
  setTimeout(() => e.classList.add('show'), 10);
  setTimeout(() => { e.classList.remove('show'); setTimeout(() => e.remove(), 220) }, 2800);
}
function modal(html, cls = '') {
  const d = document.createElement('div');
  d.className = 'modal-backdrop';
  d.innerHTML = `<div class="modal-card ${cls}">${html}</div>`;
  document.body.append(d);
  d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-modal-close]')) d.remove() });
  return d;
}
function confirmDialog({ title = 'Konfirmasi', message, ok = 'Lanjutkan', danger = false }) {
  return new Promise(resolve => {
    const d = modal(`<div class="dialog"><div class="dialog-icon">${icon(danger ? 'trash' : 'check', 24)}</div><h3>${esc(title)}</h3><p>${esc(message)}</p><div class="dialog-actions"><button class="btn btn-soft" data-confirm-cancel>Batal</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="dialogOk">${esc(ok)}</button></div></div>`, 'dialog-card');
    let done = false;
    const finish = v => { if (done) return; done = true; d.remove(); resolve(v) };
    $('#dialogOk', d).onclick = () => finish(true);
    $('[data-confirm-cancel]', d).onclick = () => finish(false);
    d.addEventListener('click', e => { if (e.target === d) finish(false) });
  });
}

let pageDisposers = [];
const disposeOnLeave = fn => pageDisposers.push(fn);
const cleanupPage = () => {
  alarm.stopAlarm();
  for (const fn of pageDisposers.splice(0)) { try { fn() } catch { } }
};
function nav(path) { history.pushState({}, '', path); render() }
window.addEventListener('popstate', render);
document.addEventListener('click', e => {
  const w = e.target.closest('#topbarWifiBtn');
  if (w) {
    e.preventDefault();
    wifiModal();
    return;
  }
  const callBtn = e.target.closest('#topbarWaiterBtn');
  if (callBtn) {
    e.preventDefault();
    const c = getCart();
    callWaiterModal(c.tableToken, c.tableName);
    return;
  }
  const a = e.target.closest('[data-nav]');
  if (a) {
    e.preventDefault();
    alarm.unlock();
    nav(a.getAttribute('href'));
  }
});

const cartKey = 'cc_demo_cart_v6';
function getCart() {
  try {
    const raw = JSON.parse(localStorage.getItem(cartKey) || '{}');
    return {
      tableToken: raw.tableToken || null,
      tableName: raw.tableName || null,
      customerType: raw.customerType === 'STUDENT' ? 'STUDENT' : 'REGULAR',
      studentInfo: raw.studentInfo || { campus: '', studentId: '', studentName: '' },
      items: Array.isArray(raw.items) ? raw.items : []
    };
  } catch {
    return { tableToken: null, tableName: null, customerType: 'REGULAR', studentInfo: { campus: '', studentId: '', studentName: '' }, items: [] };
  }
}
function setCart(c) { localStorage.setItem(cartKey, JSON.stringify(c)) }
function clearCart() {
  const c = getCart();
  localStorage.setItem(cartKey, JSON.stringify({ tableToken: c.tableToken, tableName: c.tableName, customerType: c.customerType, studentInfo: c.studentInfo, items: [] }));
}
function isStudent(c) { return Boolean(c && c.customerType === 'STUDENT'); }
function getProductEffectivePrice(p, isStudentMode = false) {
  if (isStudentMode && Number(p?.studentPrice) > 0) return Number(p.studentPrice);
  return Number(p?.price || 0);
}
function cartTotal(c) { return (c.items || []).reduce((s, i) => s + Number(i.price || 0) * Number(i.quantity || 0), 0) }
function cartRegularTotal(c) { return (c.items || []).reduce((s, i) => s + Number(i.regularPrice || i.price || 0) * Number(i.quantity || 0), 0) }
function cartSavings(c) { return Math.max(0, cartRegularTotal(c) - cartTotal(c)) }
function cartCount(c) { return (c.items || []).reduce((s, i) => s + Number(i.quantity || 0), 0) }

function recalculateCartItems(c, allProducts = []) {
  if (!allProducts || !allProducts.length) return c;
  const isStud = isStudent(c);
  c.items.forEach(item => {
    const p = allProducts.find(x => x.id === item.productId);
    if (!p) return;
    const base = getProductEffectivePrice(p, isStud);
    const regBase = p.price;
    const addSize = item.options?.size === 'Large' ? 5000 : 0;
    item.basePrice = base;
    item.regularBasePrice = regBase;
    item.price = base + addSize;
    item.regularPrice = regBase + addSize;
    item.savings = Math.max(0, item.regularPrice - item.price) * item.quantity;
  });
  return c;
}

function customerRoleSwitcher(c) {
  const isStud = isStudent(c);
  return `<div class="customer-role-bar">
    <div class="customer-role-switch">
      <button type="button" class="role-btn ${!isStud ? 'active' : ''}" data-set-role="REGULAR">
        <span>☕</span>
        <span>Pelanggan Umum</span>
      </button>
      <button type="button" class="role-btn ${isStud ? 'active student-active' : ''}" data-set-role="STUDENT">
        <span>🎓</span>
        <span>Pelajar / Mahasiswa</span>
        <span class="role-badge-tag">Hemat Kampus</span>
      </button>
    </div>
    ${isStud ? `<div class="student-hero-banner">
      <div class="student-hero-text">
        <span style="font-size:16px;">🎓</span>
        <div><b>Harga Khusus Mahasiswa & Pelajar Aktif!</b> Diskon otomatis diterapkan pada seluruh menu kafe.</div>
      </div>
    </div>` : ''}
  </div>`;
}

function productImage(p, detail = false) {
  const src = p.imageData || p.imageUrl || (detail ? '/assets/iced-detail.jpg' : '/assets/iced-latte.jpg');
  return `<img src="${esc(src)}" alt="${esc(p.name)}" loading="${detail ? 'eager' : 'lazy'}">`;
}
function optionSummary(i) {
  const o = i.options || {};
  return [o.size, o.sweetness, o.ice].filter(Boolean).join(', ');
}
function itemKey(productId, options = {}, note = '') { return productId + '|' + JSON.stringify(options) + '|' + String(note || '') }
function addCartItem(p, { quantity = 1, note = '', options = {} } = {}) {
  alarm.unlock();
  const c = getCart();
  const isStud = isStudent(c);
  const base = getProductEffectivePrice(p, isStud);
  const regBase = p.price;
  const addSize = options.size === 'Large' ? 5000 : 0;
  const unit = base + addSize;
  const regUnit = regBase + addSize;
  const key = itemKey(p.id, options, note);
  let x = c.items.find(i => itemKey(i.productId, i.options, i.note) === key);
  if (x) {
    if (x.quantity + quantity > 20) return toast('Maksimal 20 porsi untuk varian yang sama.', true);
    x.quantity += quantity;
    x.basePrice = base;
    x.regularBasePrice = regBase;
    x.price = unit;
    x.regularPrice = regUnit;
    x.savings = Math.max(0, regUnit - unit) * x.quantity;
  } else {
    c.items.push({
      productId: p.id,
      name: p.name,
      basePrice: base,
      regularBasePrice: regBase,
      price: unit,
      regularPrice: regUnit,
      savings: Math.max(0, regUnit - unit) * quantity,
      quantity,
      note,
      options,
      imageUrl: p.imageUrl || p.imageData || null
    });
  }
  setCart(c);
  toast(`${p.name} masuk ke keranjang ${isStud ? '(Harga Pelajar 🎓)' : ''}`);
  return true;
}

function brandMark(size = 40) { return `<div class="brand-mark" style="--mark:${size}px">${icon('coffee', Math.round(size * .58))}</div>` }

const statusMeta = {
  NEW: { label: 'Pesanan Baru', customer: 'Pesanan Diterima', class: 'status-new' },
  PROCESSING: { label: 'Sedang Diproses', customer: 'Sedang Diproses', class: 'status-processing' },
  READY: { label: 'Siap Diambil', customer: 'Pesanan Siap', class: 'status-ready' },
  COMPLETED: { label: 'Selesai', customer: 'Selesai', class: 'status-complete' },
  CANCELLED: { label: 'Dibatalkan', customer: 'Dibatalkan', class: 'status-cancelled' }
};

function getActiveOrder() {
  try {
    const raw = JSON.parse(localStorage.getItem('cc_active_order') || 'null');
    if (!raw || !raw.orderNumber) return null;
    if (Date.now() - (raw.at || 0) > 6 * 3600 * 1000) {
      localStorage.removeItem('cc_active_order');
      return null;
    }
    if (raw.status === 'COMPLETED' || raw.status === 'CANCELLED') return null;
    return raw;
  } catch { return null; }
}

function updateActiveOrder(partial = {}) {
  try {
    const cur = getActiveOrder() || {};
    const updated = { ...cur, ...partial, at: Date.now() };
    if (updated.status === 'COMPLETED' || updated.status === 'CANCELLED') {
      localStorage.removeItem('cc_active_order');
    } else {
      localStorage.setItem('cc_active_order', JSON.stringify(updated));
    }
  } catch { }
}

let cachedSettings = null;
async function fetchCachedSettings() {
  if (cachedSettings) return cachedSettings;
  try {
    cachedSettings = await api('/public/settings');
  } catch {
    cachedSettings = {
      cafeName: 'Cafe Campus',
      wifiSsid: 'CafeCampus_HighSpeed',
      wifiPass: 'kopikampus2026',
      operatingHours: 'Setiap Hari (08:00 - 23:00 WIB)',
      cafeAddress: 'Kawasan Kampus Terpadu, Jl. Mahasiswa No. 8',
      cafePhone: '+62 812-3456-7890'
    };
  }
  return cachedSettings;
}

async function wifiModal() {
  const s = await fetchCachedSettings();
  const ssid = s.wifiSsid || 'CafeCampus_HighSpeed';
  const pass = s.wifiPass || 'kopikampus2026';
  const d = modal(`<div class="dialog">
    <div class="dialog-icon" style="background:var(--orange-soft);color:var(--orange);">${icon('wifi', 26)}</div>
    <h3>Wi-Fi Cafe Campus ⚡</h3>
    <p>Koneksi internet super cepat 100 Mbps gratis untuk seluruh pengunjung.</p>
    <div class="wifi-info-box">
      <div class="wifi-field">
        <label>NAMA JARINGAN (SSID)</label>
        <div class="wifi-val-row">
          <strong>${esc(ssid)}</strong>
          <button type="button" class="btn-copy-chip" data-copy-val="${esc(ssid)}">Salin</button>
        </div>
      </div>
      <div class="wifi-field">
        <label>PASSWORD WI-FI</label>
        <div class="wifi-val-row">
          <strong class="wifi-pass-display">${esc(pass)}</strong>
          <button type="button" class="btn btn-primary btn-small" data-copy-val="${esc(pass)}">Salin Password</button>
        </div>
      </div>
    </div>
    <div class="dialog-actions" style="margin-top:16px;">
      <button class="btn btn-dark btn-full" data-modal-close>Tutup</button>
    </div>
  </div>`, 'dialog-card');

  $$('[data-copy-val]', d).forEach(b => {
    b.onclick = () => {
      const val = b.dataset.copyVal;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(val);
        }
      } catch { }
      toast('✓ Berhasil disalin: ' + val);
    };
  });
}

function callWaiterModal(tableToken = '', tableName = '') {
  const d = modal(`<div class="dialog">
    <div class="dialog-icon">${icon('bell', 24)}</div>
    <h3>Panggil Pelayan / Bantuan</h3>
    <p>Pilih kebutuhan Anda untuk <b>${esc(tableName || 'meja Anda')}</b>:</p>
    <div class="waiter-grid">
      <button type="button" class="waiter-chip active" data-waiter-reason="Minta Tisu & Sendok">🧻 Tisu & Sendok</button>
      <button type="button" class="waiter-chip" data-waiter-reason="Tambah Air Putih">💧 Air Putih</button>
      <button type="button" class="waiter-chip" data-waiter-reason="Minta Bill / Struk Cetak">🧾 Bill / Struk</button>
      <button type="button" class="waiter-chip" data-waiter-reason="Bersihkan Meja">✨ Bersihkan Meja</button>
    </div>
    <div style="margin-top:12px;">
      <input type="text" id="waiterNote" class="form-input" placeholder="Pesan tambahan jika ada (opsional)..." maxlength="100" style="width:100%;font-size:13px;padding:10px 14px;border-radius:10px;border:1px solid var(--line);background:var(--bg);">
    </div>
    <div class="dialog-actions" style="margin-top:16px;">
      <button class="btn btn-soft" data-modal-close>Batal</button>
      <button class="btn btn-primary" id="btnSendCall">Kirim Panggilan</button>
    </div>
  </div>`, 'dialog-card');

  let reason = 'Minta Tisu & Sendok';
  $$('.waiter-chip', d).forEach(b => {
    b.onclick = () => {
      $$('.waiter-chip', d).forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      reason = b.dataset.waiterReason;
    };
  });

  $('#btnSendCall', d).onclick = async () => {
    const note = ($('#waiterNote', d)?.value || '').trim();
    const token = tableToken || getCart().tableToken || 'demo-table-01';
    try {
      await api(`/public/tables/${encodeURIComponent(token)}/call-waiter`, {
        method: 'POST',
        body: JSON.stringify({ type: reason, note })
      });
      d.remove();
      toast('✓ Panggilan terkirim ke barista & kasir!');
    } catch (e) {
      toast(e.message, true);
    }
  };
}

function tablePickerModal(tables = []) {
  const d = modal(`<div class="dialog table-picker-modal-dialog">
    <div class="dialog-icon" style="background:var(--orange-soft);color:var(--orange);">${icon('table', 24)}</div>
    <h3>Pilih Nomor Meja Anda</h3>
    <p>Silakan pilih nomor meja tempat Anda duduk untuk mulai memesan langsung dari smartphone tanpa antre:</p>
    <div class="table-picker-grid" style="margin:16px 0;max-height:280px;overflow-y:auto;">
      ${tables.map(t => `<a data-nav href="/order/${encodeURIComponent(t.publicToken || t.tableNumber)}" class="table-pick-btn" data-modal-close><span>Meja</span><strong>${esc(t.tableNumber || t.name.replace('Meja ', ''))}</strong></a>`).join('')}
    </div>
    <div class="dialog-actions">
      <button class="btn btn-soft btn-full" data-modal-close>Batal</button>
    </div>
  </div>`, 'dialog-card');
}

function customerHeader(tableName = '') {
  const activeOrder = getActiveOrder();
  const isTrackPage = typeof location !== 'undefined' && location.pathname.startsWith('/track');
  return `<header class="customer-topbar">
    <a class="customer-brand" data-nav href="/">
      <span>${brandMark(34)}</span>
      <div><b>Cafe Campus</b><small class="brand-sub">Artisanal Coffee &amp; Space</small></div>
    </a>
    <div class="topbar-right">
      <button type="button" class="topbar-chip-btn" id="topbarWifiBtn" title="Lihat Info Wi-Fi">${icon('wifi', 15)}<span>Wi-Fi</span></button>
      ${tableName ? `<button type="button" class="topbar-chip-btn" id="topbarWaiterBtn" title="Panggil Pelayan / Bantuan Meja">${icon('bell', 15)}<span>Panggil</span></button>` : ''}
      ${tableName ? `<div class="table-status"><span></span>${esc(tableName)}</div>` : ''}
    </div>
  </header>
  ${activeOrder && !isTrackPage ? `<div class="floating-order-banner animate-pop">
    <div class="fob-content">
      <span class="aofb-pulse"></span>
      <div>
        <b>Pesanan #${esc(activeOrder.orderNumber)} (${esc(activeOrder.tableName || 'Meja')})</b>
        <small>${statusMeta[activeOrder.status]?.customer || 'Sedang Diproses'}</small>
      </div>
    </div>
    <a data-nav href="/track/${encodeURIComponent(activeOrder.orderNumber)}?access=${encodeURIComponent(activeOrder.accessToken || '')}" class="btn btn-primary btn-small">Lihat Status</a>
  </div>` : ''}`;
}

function customerShell(content, { tableName = '', className = '' } = {}) {
  return `<div class="customer-app ${className}">${customerHeader(tableName)}${content}</div>`;
}

function statusBadge(st) {
  const m = statusMeta[st] || { label: st, class: '' };
  return `<span class="status-badge ${m.class}"><i class="status-dot"></i>${m.label}</span>`;
}
function paymentBadge(o) {
  const paid = o.payment?.status === 'PAID';
  const method = o.payment?.method === 'QRIS_DEMO' ? 'QRIS' : 'Tunai';
  return `<div class="payment-cell"><span class="payment-badge ${o.payment?.method === 'QRIS_DEMO' ? 'qris' : 'cash'}">${method}</span><span class="pay-status-pill ${paid ? 'paid' : 'pending'}"><i class="pay-dot"></i>${paid ? 'Lunas' : 'Pending'}</span></div>`;
}

function adminLinks() {
  return [
    ['dashboard', '/admin', 'dashboard', 'Dashboard'],
    ['orders', '/admin/orders', 'orders', 'Pesanan'],
    ['menu', '/admin/menu', 'menu', 'Kelola Menu'],
    ['categories', '/admin/categories', 'categories', 'Kategori'],
    ['tables', '/admin/tables', 'qr', 'Meja & QR'],
    ['payments', '/admin/payments', 'wallet', 'Pembayaran'],
    ['reports', '/admin/reports', 'report', 'Laporan'],
    ['settings', '/admin/settings', 'settings', 'Pengaturan']
  ];
}
function adminShell(content, active = 'dashboard', user = { name: 'Demo Admin' }) {
  const links = adminLinks();
  return `<div class="admin-app">
    <aside class="admin-sidebar">
      <a class="admin-logo" data-nav href="/admin">${brandMark(38)}<b>Cafe Campus</b></a>
      <nav>${links.map(([k, h, ic, l]) => `<a data-nav href="${h}" class="${active === k ? 'active' : ''}">${icon(ic, 20)}<span>${l}</span></a>`).join('')}</nav>
      <div class="sidebar-bottom">
        <div class="admin-user"><div class="avatar">A</div><div><b>Admin Campus</b><small>Staff Kasir & Barista</small></div></div>
        <button class="sidebar-logout" id="sideLogout">${icon('logout', 18)}<span>Keluar</span></button>
      </div>
    </aside>
    <main class="admin-main">${content}</main>
    <nav class="admin-bottom-nav">
      ${[['dashboard', '/admin', 'dashboard', 'Beranda'], ['orders', '/admin/orders', 'orders', 'Pesanan'], ['menu', '/admin/menu', 'menu', 'Menu'], ['reports', '/admin/reports', 'report', 'Laporan']].map(([k, h, ic, l]) => `<a data-nav href="${h}" class="${active === k ? 'active' : ''}">${icon(ic, 18)}<span>${l}</span></a>`).join('')}
      <button id="moreNav" class="${['categories', 'tables', 'payments', 'settings'].includes(active) ? 'active' : ''}">${icon('more', 18)}<span>Lainnya</span></button>
    </nav>
  </div>`;
}
function bindAdminChrome(active) {
  const out = $('#sideLogout'); if (out) out.onclick = logoutAdmin;
  const more = $('#moreNav');
  if (more) more.onclick = () => {
    const d = modal(`<div class="mobile-more-sheet"><div class="sheet-handle"></div><h3>Lainnya</h3>${[['categories', '/admin/categories', 'categories', 'Kategori'], ['tables', '/admin/tables', 'qr', 'Meja & QR'], ['payments', '/admin/payments', 'wallet', 'Pembayaran'], ['settings', '/admin/settings', 'settings', 'Pengaturan']].map(([k, h, ic, l]) => `<a data-nav href="${h}" class="more-link ${active === k ? 'active' : ''}">${icon(ic, 20)}<span>${l}</span>${icon('chevron', 16)}</a>`).join('')}<button class="more-link danger-link" id="mobileLogout">${icon('logout', 20)}<span>Keluar</span></button></div>`, 'bottom-sheet');
    $('#mobileLogout', d).onclick = logoutAdmin;
  };

  const bellBtn = $('#adminBellBtn');
  if (bellBtn) bellBtn.onclick = () => adminAudioSettingsModal();

  const livePill = $('#adminLivePill');
  if (livePill) livePill.onclick = () => adminStreamStatusModal();
}

function adminAudioSettingsModal() {
  const d = modal(`<div class="modal-heading">
    <div><span>PENGATURAN NOTIFIKASI</span><h2>Dering & Speaker Kasir</h2></div>
    <span class="status-badge status-ready"><i class="status-dot"></i>Audio Aktif</span>
  </div>
  <div class="audio-control-box">
    <p style="color:var(--muted);font-size:13.5px;line-height:1.5;margin-bottom:16px;">
      Uji coba dan dengarkan dering lonceng notifikasi pesanan masuk serta pemberitahuan pesanan siap untuk kasir dan barista.
    </p>
    <div class="audio-test-grid">
      <div class="audio-test-card">
        <div>
          <b>🔔 Dering Pesanan Masuk (Kasir)</b>
          <small>Berbunyi selama 10 detik saat pelanggan membuat pesanan baru dari meja</small>
        </div>
        <button class="btn btn-primary btn-small" id="testAdminAlarm">Uji Dering Kasir (10s)</button>
      </div>
      <div class="audio-test-card">
        <div>
          <b>☕ Dering Pesanan Siap (Pelanggan)</b>
          <small>Berbunyi di smartphone pelanggan saat pesanan siap diambil di meja barista</small>
        </div>
        <button class="btn btn-green btn-small" id="testReadyAlarm">Uji Dering Siap</button>
      </div>
      <div class="audio-test-card">
        <div>
          <b>🔇 Hentikan Dering Aktif</b>
          <small>Matikan bunyi dering lonceng yang sedang aktif seketika</small>
        </div>
        <button class="btn btn-soft btn-small" id="stopAlarmBtn">Matikan Dering</button>
      </div>
    </div>
  </div>
  <div class="modal-actions">
    <button class="btn btn-dark btn-full" id="closeAudioModal">Tutup Pengaturan</button>
  </div>`, 'dialog-card');

  $('#testAdminAlarm', d).onclick = () => {
    alarm.startAlarm10s('admin');
    toast('🔔 Memutar dering lonceng pesanan baru...');
  };
  $('#testReadyAlarm', d).onclick = () => {
    alarm.startAlarm10s('ready');
    toast('☕ Memutar dering pesanan siap...');
  };
  $('#stopAlarmBtn', d).onclick = () => {
    alarm.stopAlarm();
    toast('🔇 Dering notifikasi dihentikan');
  };
  $('#closeAudioModal', d).onclick = () => d.remove();
}

function adminStreamStatusModal() {
  const d = modal(`<div class="modal-heading">
    <div><span>KONEKSI SISTEM</span><h2>Status Sinkronisasi Real-Time</h2></div>
    <span class="live-pill" style="display:inline-flex;"><i></i> LIVE</span>
  </div>
  <div class="stream-status-box">
    <div class="stream-metric-row">
      <span>Status Server</span>
      <b style="color:var(--green);">🟢 Online & Terhubung</b>
    </div>
    <div class="stream-metric-row">
      <span>Pembaruan Data</span>
      <b>Otomatis (Real-Time)</b>
    </div>
    <div class="stream-metric-row">
      <span>Jaringan Operasional</span>
      <b>Wi-Fi Lokal Cafe</b>
    </div>
    <div class="stream-metric-row">
      <span>Status Siaga</span>
      <b>Aktif (Respon Cepat)</b>
    </div>
  </div>
  <div class="modal-actions">
    <button class="btn btn-dark btn-full" id="closeStreamModal">Tutup</button>
  </div>`, 'dialog-card');
  $('#closeStreamModal', d).onclick = () => d.remove();
}

async function logoutAdmin() { try { await api('/admin/logout', { method: 'POST', body: '{}' }) } catch { } nav('/admin/login') }
function adminTop(title, subtitle, actions = '') {
  return `<header class="admin-page-head">
    <div>
      <h1>${esc(title)}</h1>
      <p>${esc(subtitle || '')}</p>
    </div>
    <div class="admin-head-actions">
      ${actions}
      <button class="live-pill" id="adminLivePill" title="Lihat Status Jaringan Real-Time"><i></i> LIVE</button>
      <button class="icon-btn" id="adminBellBtn" title="Pengaturan & Uji Alarm Kasir">${icon('bell', 19)}</button>
    </div>
  </header>`;
}
function setupAdminRealtime(refresh) {
  let es;
  try {
    es = new EventSource('/api/events?channel=admin');
    es.addEventListener('admin-order', e => {
      let ord = null;
      try { ord = JSON.parse(e.data); } catch { }
      if (ord && ord.status !== 'NEW') {
        refresh();
        return;
      }
      const title = ord ? `Pesanan Baru #${ord.orderNumber} (${ord.tableName})` : 'Pesanan Baru Masuk!';
      toast(`🔔 ${title}`);
      alarm.startAlarm10s('admin');
      showAlarmBanner(title, 'Alarm pesanan masuk berbunyi selama 10 detik...', () => alarm.stopAlarm());
      refresh();
    });
    disposeOnLeave(() => es.close());
  } catch { }

  // Active polling fallback for admin
  const timer = setInterval(refresh, 5000);
  disposeOnLeave(() => clearInterval(timer));
}

async function render() {
  cleanupPage();
  window.scrollTo(0, 0);
  const u = new URL(location.href);
  const p = u.pathname;
  const searchTable = u.searchParams.get('table') || u.searchParams.get('tableNumber') || u.searchParams.get('t');
  document.body.className = '';

  try {
    if (searchTable) {
      return tableWelcomePage(searchTable);
    }
    if (p === '/' || p === '/demo') return landing();
    const parts = p.split('/').filter(Boolean);
    if (parts[0] === 'order') {
      if (parts.length === 1) return landing();
      if (parts.length === 2) return tableWelcomePage(decodeURIComponent(parts[1]));
      if (parts[2] === 'menu') return menuPage(decodeURIComponent(parts[1]));
      if (parts[2] === 'product' && parts[3]) return productDetailPage(decodeURIComponent(parts[1]), decodeURIComponent(parts[3]));
    }
    if (p === '/cart') return cartPage();
    if (p === '/checkout') return checkoutPage();
    if (parts[0] === 'track' && parts[1]) return trackPage(decodeURIComponent(parts[1]));
    if (p === '/admin/login') return loginPage();
    if (p === '/admin' || p === '/admin/') return adminGuard(dashboardPage);
    if (p === '/admin/orders') return adminGuard(ordersPage);
    if (p === '/admin/menu') return adminGuard(menuAdminPage);
    if (p === '/admin/categories') return adminGuard(categoriesPage);
    if (p === '/admin/tables') return adminGuard(tablesPage);
    if (p === '/admin/payments') return adminGuard(paymentsPage);
    if (p === '/admin/reports') return adminGuard(reportsPage);
    if (p === '/admin/settings') return adminGuard(settingsPage);
    document.body.innerHTML = '<main class="not-found"><h1>404</h1><p>Halaman tidak ditemukan.</p><a class="btn btn-primary" data-nav href="/">Kembali ke Beranda</a></main>';
  } catch (e) {
    document.body.innerHTML = `<main class="fatal"><div>${icon('bell', 28)}</div><h2>Terjadi kendala</h2><p>${esc(e.message)}</p><button class="btn btn-primary" onclick="location.reload()">Coba Lagi</button></main>`;
  }
}

async function landing() {
  let tables = [];
  try { tables = await api('/public/tables') } catch {
    tables = Array.from({ length: 12 }, (_, i) => ({ tableNumber: String(i + 1).padStart(2, '0'), name: `Meja ${String(i + 1).padStart(2, '0')}`, publicToken: `demo-table-${String(i + 1).padStart(2, '0')}` }));
  }
  const settings = await fetchCachedSettings();
  const activeOrder = getActiveOrder();

  document.body.className = 'landing-body cafe-home-body';
  document.body.innerHTML = `<main class="cafe-home">
    <!-- Navbar Top Bar -->
    <header class="home-navbar">
      <a class="home-brand" data-nav href="/">
        <span>${brandMark(38)}</span>
        <div>
          <b>Cafe Campus</b>
          <small>Artisanal &amp; Creative Space</small>
        </div>
      </a>
      <div class="home-nav-actions">
        <button type="button" class="btn btn-soft btn-small" id="navWifiBtn">${icon('wifi', 15)}<span>Wi-Fi 100 Mbps</span></button>
        <a data-nav href="/order/demo-table-01/menu" class="btn btn-outline btn-small">${icon('menu', 15)}<span>Buku Menu</span></a>
        <button type="button" class="btn btn-primary btn-small" id="navOrderBtn">${icon('cart', 15)}<span>Pesan di Meja</span></button>
      </div>
    </header>

    <!-- Floating Active Order Alert if any -->
    ${activeOrder ? `<section class="home-active-order-bar animate-pop">
      <div class="haob-left">
        <span class="aofb-pulse"></span>
        <div>
          <b>Pesanan #${esc(activeOrder.orderNumber)} Sedang Berlangsung</b>
          <small>${esc(activeOrder.tableName || 'Meja')} • Status: ${statusMeta[activeOrder.status]?.customer || 'Sedang Diproses'}</small>
        </div>
      </div>
      <a data-nav href="/track/${encodeURIComponent(activeOrder.orderNumber)}?access=${encodeURIComponent(activeOrder.accessToken || '')}" class="btn btn-primary btn-small">Lacak Pesanan</a>
    </section>` : ''}

    <!-- Hero Section -->
    <section class="cafe-hero">
      <div class="hero-badge">
        ${icon('sparkles', 14)} <span>Tempat Favorit Nugas &amp; Kopi Spesial Kampus</span>
      </div>
      <h1 class="hero-title">Secangkir Kopi Pilihan &amp; Ruang Nyaman untuk Ide Besarmu</h1>
      <p class="hero-desc">
        Nikmati racikan espresso kaya aroma, hidangan hangat yang lezat, dan suasana produktif. Pesan langsung dari smartphone tanpa perlu antre di kasir.
      </p>

      <div class="hero-actions">
        <button type="button" class="btn btn-primary btn-large hero-cta-btn" id="heroOrderBtn">
          ${icon('cart', 20)} Pesan dari Meja Anda
        </button>
        <a data-nav href="/order/demo-table-01/menu" class="btn btn-soft btn-large hero-menu-btn">
          ${icon('menu', 18)} Lihat Buku Menu Digital
        </a>
        <button type="button" class="btn btn-soft btn-large hero-wifi-btn" id="heroWifiBtn">
          ${icon('wifi', 18)} Salin Password Wi-Fi
        </button>
      </div>
    </section>

    <!-- Perks / Facilities Strip -->
    <section class="cafe-perks">
      <div class="section-heading">
        <span class="eyebrow">KENYAMANAN MAKSIMAL</span>
        <h2>Fasilitas Terbaik untuk Nugas &amp; Diskusi</h2>
        <p>Dirancang khusus agar Anda betah berkreasi, belajar kelompok, maupun bersantai sepanjang hari.</p>
      </div>

      <div class="perks-grid">
        <div class="perk-card">
          <div class="perk-icon" style="background:#fff0e5;color:var(--orange);">${icon('wifi', 24)}</div>
          <h3>Wi-Fi Kampus 100 Mbps</h3>
          <p>Koneksi stabil dan cepat untuk riset, submit tugas, streaming, maupun Zoom meeting lancar.</p>
          <button type="button" class="perk-copy-action" id="perkCopyWifiBtn">⚡ Salin Password Wi-Fi</button>
        </div>

        <div class="perk-card">
          <div class="perk-icon" style="background:#e5f1ff;color:#3483e7;">⚡</div>
          <h3>Stopkontak di Setiap Meja</h3>
          <p>Baterai laptop dan HP selalu aman. Nugas berjam-jam tanpa perlu khawatir kehabisan daya.</p>
        </div>

        <div class="perk-card">
          <div class="perk-icon" style="background:#e2f4e9;color:#2c8b5b;">🎓</div>
          <h3>Harga Spesial Mahasiswa</h3>
          <p>Potongan harga khusus pelajar &amp; mahasiswa aktif hingga 25% cukup dengan verifikasi KTM.</p>
        </div>

        <div class="perk-card">
          <div class="perk-icon" style="background:#fef3e2;color:#b47525;">❄️</div>
          <h3>Ruang AC &amp; Outdoor Asri</h3>
          <p>Pilihan area indoor sejuk bebas asap rokok serta teras outdoor yang asri dan nyaman.</p>
        </div>
      </div>
    </section>

    <!-- Signature Menu Showcase -->
    <section class="cafe-showcase">
      <div class="section-heading">
        <span class="eyebrow">MENU UNGGULAN</span>
        <h2>Favorit Mahasiswa &amp; Barista</h2>
        <p>Menu terbaik racikan barista kami yang paling banyak diminati setiap harinya.</p>
      </div>

      <div class="showcase-grid">
        <article class="showcase-card">
          <div class="showcase-img"><img src="/assets/iced-latte.jpg" alt="Iced Latte Gula Aren"></div>
          <div class="showcase-body">
            <span class="showcase-pill best">BEST SELLER</span>
            <h3>Iced Latte Gula Aren</h3>
            <p>Kopi susu lokal spesial dengan gula aren premium dan espresso ganda yang lembut.</p>
            <div class="showcase-foot">
              <div class="showcase-pricing">
                <small>Pelajar 🎓</small>
                <strong>Rp 22.000</strong>
              </div>
              <a data-nav href="/order/demo-table-01/menu" class="btn btn-primary btn-small">Pesan</a>
            </div>
          </div>
        </article>

        <article class="showcase-card">
          <div class="showcase-img"><img src="/assets/nasi-goreng.jpg" alt="Nasi Goreng Kampus"></div>
          <div class="showcase-body">
            <span class="showcase-pill food">MAKANAN UTAMA</span>
            <h3>Nasi Goreng Kampus</h3>
            <p>Nasi goreng gurih istimewa dengan telur mata sapi, sate ayam gurih, dan acar segar.</p>
            <div class="showcase-foot">
              <div class="showcase-pricing">
                <small>Pelajar 🎓</small>
                <strong>Rp 28.000</strong>
              </div>
              <a data-nav href="/order/demo-table-01/menu" class="btn btn-primary btn-small">Pesan</a>
            </div>
          </div>
        </article>

        <article class="showcase-card">
          <div class="showcase-img"><img src="/assets/matcha.jpg" alt="Uji Matcha Latte"></div>
          <div class="showcase-body">
            <span class="showcase-pill noncoffee">NON-KOPI</span>
            <h3>Uji Matcha Latte</h3>
            <p>Matcha Jepang autentik kualitas premium dipadu susu segar dingin yang creamy.</p>
            <div class="showcase-foot">
              <div class="showcase-pricing">
                <small>Pelajar 🎓</small>
                <strong>Rp 25.000</strong>
              </div>
              <a data-nav href="/order/demo-table-01/menu" class="btn btn-primary btn-small">Pesan</a>
            </div>
          </div>
        </article>

        <article class="showcase-card">
          <div class="showcase-img"><img src="/assets/brownies.jpg" alt="Brownies Gelato"></div>
          <div class="showcase-body">
            <span class="showcase-pill dessert">DESSERT</span>
            <h3>Brownies Gelato</h3>
            <p>Brownies cokelat panggang hangat dengan lelehan cokelat dan gelato vanilla manis.</p>
            <div class="showcase-foot">
              <div class="showcase-pricing">
                <small>Pelajar 🎓</small>
                <strong>Rp 26.000</strong>
              </div>
              <a data-nav href="/order/demo-table-01/menu" class="btn btn-primary btn-small">Pesan</a>
            </div>
          </div>
        </article>
      </div>

      <div class="showcase-cta">
        <a data-nav href="/order/demo-table-01/menu" class="btn btn-outline btn-large">
          Lihat Seluruh Menu (${money(20000)} - ${money(38000)}) ${icon('arrow', 18)}
        </a>
      </div>
    </section>

    <!-- Info & Jam Operasional -->
    <section class="cafe-outlet-info">
      <div class="outlet-card">
        <div class="outlet-item">
          <div class="outlet-icon">${icon('mapPin', 22)}</div>
          <div>
            <b>Lokasi Kafe</b>
            <p>${esc(settings.cafeAddress || 'Kawasan Kampus Terpadu, Jl. Mahasiswa No. 8')}</p>
          </div>
        </div>
        <div class="outlet-divider"></div>
        <div class="outlet-item">
          <div class="outlet-icon">${icon('clock', 22)}</div>
          <div>
            <b>Jam Operasional</b>
            <p>${esc(settings.operatingHours || 'Setiap Hari: 08.00 - 23.00 WIB')}</p>
          </div>
        </div>
        <div class="outlet-divider"></div>
        <div class="outlet-item">
          <div class="outlet-icon">${icon('phone', 22)}</div>
          <div>
            <b>Kontak &amp; Reservasi</b>
            <p>${esc(settings.cafePhone || '+62 812-3456-7890')}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Footer Kafe -->
    <footer class="cafe-home-footer">
      <div class="footer-wrap">
        <div class="footer-brand-col">
          <div class="footer-logo">
            ${brandMark(34)}
            <b>Cafe Campus</b>
          </div>
          <p>Tempat terbaik menikmati kopi artisan berkualitas dan ruang diskusi hangat bersama teman-teman kampus.</p>
        </div>

        <div class="footer-nav-col">
          <b>Navigasi</b>
          <button type="button" class="footer-link-btn" id="footerOrderBtn">Pesan dari Meja</button>
          <a data-nav href="/order/demo-table-01/menu">Buku Menu Lengkap</a>
          <button type="button" class="footer-link-btn" id="footerWifiBtn">Info Wi-Fi Kafe</button>
        </div>

        <div class="footer-staff-col">
          <b>Internal Staff</b>
          <a data-nav href="/admin/login" class="footer-staff-link">${icon('lock', 14)} Portal Kasir &amp; Barista</a>
          <small>Khusus karyawan operasional kafe.</small>
        </div>
      </div>

      <div class="footer-copyright">
        <span>&copy; ${new Date().getFullYear()} Cafe Campus. Seluruh hak cipta dilindungi.</span>
        <span>QR-Ordering System v6.0</span>
      </div>
    </footer>
  </main>`;

  // Bind interactive elements
  const openTablePicker = () => tablePickerModal(tables);
  const openWifi = () => wifiModal();

  $('#heroOrderBtn').onclick = openTablePicker;
  $('#navOrderBtn').onclick = openTablePicker;
  $('#footerOrderBtn').onclick = openTablePicker;

  $('#navWifiBtn').onclick = openWifi;
  $('#heroWifiBtn').onclick = openWifi;
  $('#perkCopyWifiBtn').onclick = openWifi;
  $('#footerWifiBtn').onclick = openWifi;
}

async function tableWelcomePage(tableToken) {
  const table = await api('/public/tables/' + encodeURIComponent(tableToken));
  let c = getCart();
  if (c.tableToken && c.tableToken !== table.publicToken && c.tableToken !== tableToken) {
    c = { tableToken: table.publicToken || tableToken, tableName: table.name, items: [] };
  } else {
    c.tableToken = table.publicToken || tableToken;
    c.tableName = table.name;
  }
  setCart(c);
  document.body.className = 'customer-body';
  document.body.innerHTML = customerShell(`<main class="welcome-page">
    <section class="welcome-copy">
      <div class="welcome-logo">${brandMark(64)}<h1>Cafe Campus</h1></div>
      <div class="welcome-mobile-hero"><img src="/assets/hero-mobile.jpg" alt="Cafe Campus"></div>
      <h2>Selamat Datang di Cafe Campus</h2>
      <p>Silakan pesan makanan & minuman langsung dari smartphone Anda tanpa harus antre di kasir.</p>
      <div class="table-detected">
        <small>NOMOR MEJA ANDA</small>
        <strong>${esc(table.name)}</strong>
      </div>
      <a data-nav href="/order/${encodeURIComponent(table.publicToken || tableToken)}/menu" class="btn btn-primary btn-wide btn-hero-order">
        ${icon('arrow', 18)} Lihat Menu & Mulai Pesan
      </a>
    </section>
    <div class="welcome-desktop-hero"><img src="/assets/hero-desktop.jpg" alt="Suasana Cafe Campus"></div>
  </main>`, { tableName: table.name, className: 'welcome-shell' });
}

async function menuPage(tableToken) {
  const [table, cats, products] = await Promise.all([
    api('/public/tables/' + encodeURIComponent(tableToken)),
    api('/public/categories'),
    api('/public/products')
  ]);
  let c = getCart();
  if (c.tableToken !== table.publicToken && c.tableToken !== tableToken) {
    c = { tableToken: table.publicToken || tableToken, tableName: table.name, customerType: c.customerType || 'REGULAR', studentInfo: c.studentInfo || {}, items: [] };
  } else {
    c.tableName = table.name;
  }
  recalculateCartItems(c, products);
  setCart(c);

  let cat = '', query = '';

  const getFilteredProducts = () => products.filter(p => (!cat || p.categorySlug === cat) && (!query || (`${p.name} ${p.description}`).toLowerCase().includes(query.toLowerCase())));

  const renderGridContent = () => {
    const list = getFilteredProducts();
    const isStud = isStudent(getCart());
    if (!list.length) {
      return `<div class="search-empty">${icon('search', 30)}<h3>Menu tidak ditemukan</h3><p>Coba kata kunci atau kategori lain.</p></div>`;
    }
    return `<div class="product-grid">${list.map(p => {
      const isAvailable = p.isAvailable !== false;
      const studPrice = p.studentPrice || p.price;
      const hasDiscount = isStud && studPrice < p.price;
      const displayPrice = isStud ? studPrice : p.price;

      return `<article class="product-card ${!isAvailable ? 'soldout' : ''}" data-detail="${p.id}">
        <div class="product-photo">${productImage(p)}${!isAvailable ? '<span class="sold-label">Habis</span>' : ''}</div>
        <div class="product-info">
          <h3>${esc(p.name)}</h3>
          <p>${esc(p.description)}</p>
          <div class="product-price-row">
            <div class="product-price-stack">
              ${hasDiscount ? `<span class="price-strike">${money(p.price)}</span>` : ''}
              <strong class="price-current ${isStud && hasDiscount ? 'student-highlight' : ''}">${money(displayPrice)}</strong>
              ${hasDiscount ? `<span class="savings-chip">🎓 Hemat ${money(p.price - studPrice)}</span>` : ''}
            </div>
            <button class="round-add" data-add="${p.id}" ${isAvailable ? '' : 'disabled'} aria-label="Tambah ${esc(p.name)}">${icon('plus', 18)}</button>
          </div>
        </div>
      </article>`;
    }).join('')}</div>`;
  };

  const renderDesktopCartContent = () => {
    const cc = getCart();
    const isStud = isStudent(cc);
    const savings = cartSavings(cc);
    return `<div class="cart-title">
        <h3>Keranjang Belanja</h3>
        <span>${cartCount(cc)} Item ${isStud ? '• 🎓 Pelajar' : ''}</span>
      </div>
      ${cc.items.length ? cc.items.map((i, idx) => `<div class="mini-cart-item">
        <img src="${esc(i.imageUrl || '/assets/iced-latte.jpg')}" alt="">
        <div>
          <b>${esc(i.name)}</b>
          <small>${esc(optionSummary(i) || i.note || '')}</small>
          <strong>${money(i.price)}</strong>
          ${i.savings ? `<small style="color:#2c8b5b;font-weight:700;">Hemat ${money(i.savings)}</small>` : ''}
        </div>
        <div class="mini-qty"><button data-minus-mini="${idx}">${icon('minus', 14)}</button><span>${i.quantity}</span><button data-plus-mini="${idx}">${icon('plus', 14)}</button></div>
      </div>`).join('') : `<div class="empty-cart">${icon('cart', 28)}<b>Keranjang masih kosong</b><span>Pilih menu favoritmu untuk mulai memesan.</span></div>`}
      <div class="desktop-cart-summary">
        ${savings > 0 ? `<div><span>Subtotal Reguler</span><span style="text-decoration:line-through;color:var(--muted);">${money(cartRegularTotal(cc))}</span></div>
        <div><span>Potongan Pelajar 🎓</span><b style="color:#2c8b5b;">- ${money(savings)}</b></div>` : ''}
        <div><span>Subtotal</span><b>${money(cartTotal(cc))}</b></div>
      </div>
      ${cc.items.length ? `<a class="btn btn-primary btn-wide" data-nav href="/checkout">Lanjut ke Pembayaran • ${money(cartTotal(cc))}</a>` : ''}`;
  };

  const renderMobileCartBarContent = () => {
    const cc = getCart();
    if (!cc.items.length) return '';
    const savings = cartSavings(cc);
    return `<a class="mobile-cart-bar animate-pop" data-nav href="/cart">
      <span class="cart-count badge-pulse">${cartCount(cc)}</span>
      <div class="cart-bar-total">
        <small>${isStudent(cc) ? '🎓 Mode Pelajar' : 'Total Pesanan'}${savings > 0 ? ` • Hemat ${money(savings)}` : ''}</small>
        <b>${money(cartTotal(cc))}</b>
      </div>
      <span class="cart-bar-cta">Lihat Keranjang ${icon('cart', 18)}</span>
    </a>`;
  };

  document.body.className = 'customer-body menu-page-body';
  document.body.innerHTML = customerShell(`<main class="menu-layout">
    <section class="menu-main">
      <div class="menu-heading">
        <h1>Menu Favorit</h1>
        <label class="search-box">${icon('search', 18)}<input id="search" placeholder="Cari kopi atau makanan..." value="${esc(query)}"></label>
      </div>
      <div id="roleSwitcherContainer">${customerRoleSwitcher(c)}</div>
      <div class="category-chips" id="categoryChips">
        <button class="category-chip ${cat === '' ? 'active' : ''}" data-cat="">Semua</button>
        ${cats.map(x => `<button class="category-chip ${cat === x.slug ? 'active' : ''}" data-cat="${x.slug}">${esc(x.name)}</button>`).join('')}
      </div>
      <div id="productGridContainer">${renderGridContent()}</div>
    </section>
    <aside class="desktop-cart" id="desktopCartContainer">${renderDesktopCartContent()}</aside>
  </main>
  <div id="mobileCartBarWrapper">${renderMobileCartBarContent()}</div>`, { tableName: table.name, className: 'menu-shell' });

  const bindRoleEvents = () => {
    $$('[data-set-role]').forEach(btn => {
      btn.onclick = () => {
        alarm.unlock();
        const role = btn.dataset.setRole;
        let curr = getCart();
        curr.customerType = role;
        recalculateCartItems(curr, products);
        setCart(curr);
        toast(role === 'STUDENT' ? '🎓 Mode Pelajar aktif: Harga spesial diterapkan!' : '☕ Mode Pelanggan Umum aktif');
        const roleBox = $('#roleSwitcherContainer');
        if (roleBox) roleBox.innerHTML = customerRoleSwitcher(curr);
        bindRoleEvents();
        updateGridOnly();
        updateCartViews();
      };
    });
  };

  const bindGridEvents = () => {
    $$('[data-detail]').forEach(card => card.onclick = e => {
      if (e.target.closest('[data-add]')) return;
      nav(`/order/${encodeURIComponent(table.publicToken || tableToken)}/product/${card.dataset.detail}`);
    });
    $$('[data-add]').forEach(b => b.onclick = e => {
      e.stopPropagation();
      alarm.unlock();
      const p = products.find(x => x.id === b.dataset.add);
      if (!p || !p.isAvailable) return;
      if (p.customizable) {
        nav(`/order/${encodeURIComponent(table.publicToken || tableToken)}/product/${p.id}`);
      } else {
        addCartItem(p);
        updateCartViews();
      }
    });
  };

  const bindCartEvents = () => {
    $$('[data-minus-mini]').forEach(b => b.onclick = () => {
      alarm.unlock();
      const curr = getCart(), i = Number(b.dataset.minusMini);
      curr.items[i].quantity--;
      if (curr.items[i].quantity <= 0) curr.items.splice(i, 1);
      setCart(curr);
      updateCartViews();
    });
    $$('[data-plus-mini]').forEach(b => b.onclick = () => {
      alarm.unlock();
      const curr = getCart(), i = Number(b.dataset.plusMini);
      if (curr.items[i].quantity >= 20) return toast('Maksimal 20 porsi.', true);
      curr.items[i].quantity++;
      setCart(curr);
      updateCartViews();
    });
  };

  const updateGridOnly = () => {
    const container = $('#productGridContainer');
    if (container) {
      container.innerHTML = renderGridContent();
      bindGridEvents();
    }
    $$('[data-cat]').forEach(b => b.classList.toggle('active', b.dataset.cat === cat));
  };

  const updateCartViews = () => {
    const dCart = $('#desktopCartContainer');
    if (dCart) {
      dCart.innerHTML = renderDesktopCartContent();
      bindCartEvents();
    }
    const mWrapper = $('#mobileCartBarWrapper');
    if (mWrapper) {
      mWrapper.innerHTML = renderMobileCartBarContent();
    }
  };

  const search = $('#search');
  if (search) search.oninput = e => {
    query = e.target.value;
    clearTimeout(search._t);
    search._t = setTimeout(updateGridOnly, 100);
  };

  $$('[data-cat]').forEach(b => b.onclick = () => {
    cat = b.dataset.cat;
    updateGridOnly();
  });

  bindRoleEvents();
  bindGridEvents();
  bindCartEvents();
}

async function productDetailPage(tableToken, productId) {
  const [table, products] = await Promise.all([
    api('/public/tables/' + encodeURIComponent(tableToken)),
    api('/public/products')
  ]);
  const p = products.find(x => x.id === productId);
  if (!p) throw new Error('Menu tidak ditemukan.');
  let quantity = 1, note = '', options = p.customizable ? { size: 'Regular', sweetness: 'Normal', ice: 'Normal' } : {};

  const getEffectiveBase = () => getProductEffectivePrice(p, isStudent(getCart()));
  const calcUnitPrice = () => getEffectiveBase() + (options.size === 'Large' ? 5000 : 0);
  const calcRegularUnitPrice = () => p.price + (options.size === 'Large' ? 5000 : 0);

  const isStud = isStudent(getCart());
  const hasDiscount = isStud && (p.studentPrice || p.price) < p.price;

  document.body.className = 'customer-body detail-body';
  document.body.innerHTML = customerShell(`<main class="product-detail-page">
    <button class="floating-back" id="back" aria-label="Kembali">${icon('back', 20)}</button>
    <div class="detail-photo">${productImage({ ...p, imageUrl: p.name === 'Iced Latte Gula Aren' ? '/assets/iced-detail.jpg' : p.imageUrl }, true)}</div>
    <section class="detail-content">
      <div class="detail-title-row">
        <div>
          <h1>${esc(p.name)}</h1>
          <p>${esc(p.description)}</p>
        </div>
        <div style="text-align: right;">
          ${hasDiscount ? `<span class="price-strike" style="font-size:13px;">${money(calcRegularUnitPrice())}</span><br>` : ''}
          <strong id="unitPriceDisplay" style="${hasDiscount ? 'color:#1b633a;' : ''}">${money(calcUnitPrice())}</strong>
          ${hasDiscount ? `<br><span class="savings-chip">🎓 Harga Pelajar</span>` : ''}
        </div>
      </div>
      ${p.customizable ? `<div class="option-group">
        <div class="option-title"><b>Ukuran Gelas</b><span>Pilih salah satu</span></div>
        <div class="option-pills">
          ${['Regular', 'Large'].map(v => `<button type="button" data-size="${v}" class="option-pill ${options.size === v ? 'active' : ''}">${v}${v === 'Large' ? ' (+Rp5.000)' : ''}</button>`).join('')}
        </div>
      </div>
      <div class="option-group">
        <div class="option-title"><b>Tingkat Kemanisan (Gula)</b><span>Pilih salah satu</span></div>
        <div class="option-pills">
          ${['Normal', 'Less', 'Tanpa Gula'].map(v => `<button type="button" data-sweet="${v}" class="option-pill ${options.sweetness === v ? 'active' : ''}">${v === 'Less' ? 'Kurang (Less)' : v}</button>`).join('')}
        </div>
      </div>
      <div class="option-group">
        <div class="option-title"><b>Takaran Es</b><span>Pilih salah satu</span></div>
        <div class="option-pills">
          ${['Normal', 'Sedikit Es', 'Tanpa Es'].map(v => `<button type="button" data-ice="${v}" class="option-pill ${options.ice === v ? 'active' : ''}">${v}</button>`).join('')}
        </div>
      </div>`: ''}
      <div class="option-group">
        <div class="option-title"><b>Catatan tambahan</b><small class="muted">Opsional</small></div>
        <textarea id="detailNote" class="textarea" placeholder="Contoh: Tanpa sedotan, kurangi manis, dll...">${esc(note)}</textarea>
      </div>
      <div class="detail-bottom">
        <div class="qty-row">
          <span>Jumlah Pesanan</span>
          <div class="qty-control">
            <button id="minus" type="button" aria-label="Kurangi">${icon('minus', 16)}</button>
            <b id="qtyDisplay">${quantity}</b>
            <button id="plus" type="button" aria-label="Tambah">${icon('plus', 16)}</button>
          </div>
        </div>
        <button id="addToCart" class="btn btn-primary btn-wide btn-large" ${p.isAvailable ? '' : 'disabled'}>
          ${p.isAvailable ? `Tambah ke Keranjang • <span id="cartBtnPrice">${money(calcUnitPrice() * quantity)}</span>` : 'Menu Sedang Habis'}
        </button>
      </div>
    </section>
  </main>`, { tableName: table.name, className: 'detail-shell' });

  const updatePriceAndQty = () => {
    const unit = calcUnitPrice();
    const up = $('#unitPriceDisplay');
    if (up) up.textContent = money(unit);
    const qd = $('#qtyDisplay');
    if (qd) qd.textContent = String(quantity);
    const cp = $('#cartBtnPrice');
    if (cp) cp.textContent = money(unit * quantity);
  };

  $('#back').onclick = () => nav(`/order/${encodeURIComponent(table.publicToken || tableToken)}/menu`);
  const n = $('#detailNote');
  if (n) n.oninput = e => note = e.target.value;

  $$('[data-size]').forEach(b => b.onclick = () => {
    alarm.unlock();
    options.size = b.dataset.size;
    $$('[data-size]').forEach(x => x.classList.toggle('active', x.dataset.size === options.size));
    updatePriceAndQty();
  });
  $$('[data-sweet]').forEach(b => b.onclick = () => {
    alarm.unlock();
    options.sweetness = b.dataset.sweet;
    $$('[data-sweet]').forEach(x => x.classList.toggle('active', x.dataset.sweet === options.sweetness));
  });
  $$('[data-ice]').forEach(b => b.onclick = () => {
    alarm.unlock();
    options.ice = b.dataset.ice;
    $$('[data-ice]').forEach(x => x.classList.toggle('active', x.dataset.ice === options.ice));
  });

  $('#minus').onclick = () => {
    alarm.unlock();
    quantity = Math.max(1, quantity - 1);
    updatePriceAndQty();
  };
  $('#plus').onclick = () => {
    alarm.unlock();
    if (quantity >= 20) return toast('Maksimal 20 porsi.', true);
    quantity++;
    updatePriceAndQty();
  };
  $('#addToCart').onclick = () => {
    alarm.unlock();
    if (!p.isAvailable) return;
    note = $('#detailNote')?.value || note;
    addCartItem(p, { quantity, note, options });
    nav(`/order/${encodeURIComponent(table.publicToken || tableToken)}/menu`);
  };
}

async function cartPage() {
  const c = getCart();
  if (!c.tableToken) return nav('/');
  const [settings, products] = await Promise.all([
    api('/public/settings'),
    api('/public/products')
  ]);
  recalculateCartItems(c, products);
  setCart(c);

  const renderCartView = () => {
    const cc = getCart();
    const sub = cartTotal(cc);
    const regSub = cartRegularTotal(cc);
    const savings = cartSavings(cc);
    const isStud = isStudent(cc);
    const fee = Math.round(sub * Number(settings.serviceFee || 0) / 100);
    const tax = Math.round((sub + fee) * Number(settings.taxPercent || 0) / 100);
    const total = sub + fee + tax;

    document.body.className = 'customer-body cart-body';
    document.body.innerHTML = customerShell(`<main class="simple-customer-page">
      <div class="customer-page-title">
        <button id="back" class="circle-back" aria-label="Kembali">${icon('back', 18)}</button>
        <h1>Keranjang Belanja</h1>
      </div>
      <div id="cartRoleBox">${customerRoleSwitcher(cc)}</div>
      ${savings > 0 ? `<div class="student-savings-banner">
        <div class="banner-icon">🎉</div>
        <div class="banner-text">
          <b>Kamu Hemat ${money(savings)} dengan Harga Pelajar!</b>
          <small>Pastikan membawa Kartu Pelajar / KTM saat pembayaran atau pengambilan pesanan.</small>
        </div>
      </div>` : ''}
      ${cc.items.length ? `<section class="cart-list">
        ${cc.items.map((i, idx) => `<article class="cart-row">
          <img src="${esc(i.imageUrl || '/assets/iced-latte.jpg')}" alt="">
          <div class="cart-row-main">
            <div class="cart-row-title">
              <b>${esc(i.name)}</b>
              <button data-remove="${idx}" class="plain-icon danger" aria-label="Hapus">${icon('trash', 16)}</button>
            </div>
            <small>${esc(optionSummary(i))}${i.note ? ` • Catatan: ${esc(i.note)}` : ''}</small>
            <div style="display:flex;align-items:center;gap:6px;">
              <strong class="item-price">${money(i.price)}</strong>
              ${i.savings ? `<small style="color:#2c8b5b;font-weight:700;font-size:11px;">(Hemat ${money(i.savings)})</small>` : ''}
            </div>
          </div>
          <div class="qty-control">
            <button data-minus="${idx}" aria-label="Kurang">${icon('minus', 14)}</button>
            <b>${i.quantity}</b>
            <button data-plus="${idx}" aria-label="Tambah">${icon('plus', 14)}</button>
          </div>
        </article>`).join('')}
      </section>
      <section class="payment-summary">
        <h3>Rincian Pembayaran</h3>
        ${savings > 0 ? `<div><span>Subtotal Reguler</span><span style="text-decoration:line-through;color:var(--muted);">${money(regSub)}</span></div>
        <div class="student-savings-row"><span>🎉 Subsidi Harga Pelajar</span><strong>- ${money(savings)}</strong></div>` : ''}
        <div><span>Subtotal</span><b>${money(sub)}</b></div>
        ${fee ? `<div><span>Biaya Layanan (${settings.serviceFee}%)</span><b>${money(fee)}</b></div>` : ''}
        ${tax ? `<div><span>Pajak (${settings.taxPercent}%)</span><b>${money(tax)}</b></div>` : ''}
        <hr>
        <div class="summary-total"><span>Total Bayar</span><strong>${money(total)}</strong></div>
      </section>
      <div class="sticky-customer-cta">
        <a class="btn btn-primary btn-wide btn-large" data-nav href="/checkout">Lanjut ke Pembayaran • ${money(total)}</a>
      </div>`:
        `<section class="empty-page">
        ${icon('cart', 44)}
        <h2>Keranjang masih kosong</h2>
        <p>Yuk, pilih menu favoritmu di Cafe Campus.</p>
        <a class="btn btn-primary btn-large" data-nav href="/order/${encodeURIComponent(cc.tableToken)}/menu">Lihat Menu</a>
      </section>`}
    </main>`, { tableName: cc.tableName, className: 'simple-shell' });

    $('#back').onclick = () => nav(`/order/${encodeURIComponent(cc.tableToken)}/menu`);

    $$('[data-set-role]').forEach(btn => {
      btn.onclick = () => {
        alarm.unlock();
        const role = btn.dataset.setRole;
        let curr = getCart();
        curr.customerType = role;
        recalculateCartItems(curr, products);
        setCart(curr);
        toast(role === 'STUDENT' ? '🎓 Mode Pelajar aktif: Harga spesial diterapkan!' : '☕ Mode Pelanggan Umum aktif');
        renderCartView();
      };
    });

    $$('[data-minus]').forEach(b => b.onclick = () => {
      alarm.unlock();
      const curr = getCart(), i = +b.dataset.minus;
      curr.items[i].quantity--;
      if (curr.items[i].quantity <= 0) curr.items.splice(i, 1);
      setCart(curr);
      renderCartView();
    });
    $$('[data-plus]').forEach(b => b.onclick = () => {
      alarm.unlock();
      const curr = getCart(), i = +b.dataset.plus;
      if (curr.items[i].quantity >= 20) return toast('Maksimal 20 porsi.', true);
      curr.items[i].quantity++;
      setCart(curr);
      renderCartView();
    });
    $$('[data-remove]').forEach(b => b.onclick = () => {
      alarm.unlock();
      const curr = getCart();
      curr.items.splice(+b.dataset.remove, 1);
      setCart(curr);
      renderCartView();
    });
  };

  renderCartView();
}

function compressImage(file, maxWidth = 800, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > maxWidth) {
          h = Math.round(h * (maxWidth / w));
          w = maxWidth;
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Format file gambar tidak didukung'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Gagal membaca file gambar'));
    reader.readAsDataURL(file);
  });
}

async function openLiveCameraModal(onCapture) {
  let stream = null;
  let facingMode = 'user';

  const d = modal(`<div class="modal-heading">
    <div>
      <span>VERIFIKASI REAL-TIME LIVENESS (KAMERA LANGSUNG)</span>
      <h2>Ambil Foto Selfie bersama KTM</h2>
    </div>
  </div>
  <div class="camera-stream-wrapper">
    <video id="cameraVideo" class="camera-video" autoplay playsinline muted></video>
    <div class="camera-overlay-hud">
      <div class="camera-hud-badge">🔴 LIVE LIVENESS CAMERA</div>
      <div class="camera-guide-frames">
        <div class="guide-box face-box">👤 Posisikan Wajah</div>
        <div class="guide-box card-box">🪪 Tunjukkan KTM / Kartu Pelajar</div>
      </div>
      <div style="text-align:center;font-size:11px;color:#fff;background:rgba(0,0,0,0.65);padding:4px 8px;border-radius:6px;">
        Pegang kartu di samping wajah. Foto diambil langsung secara real-time.
      </div>
    </div>
  </div>
  <canvas id="cameraCanvas" style="display:none;"></canvas>
  <div class="camera-controls-bar">
    <button type="button" class="btn btn-soft" id="btnToggleFacing">🔄 Putar Kamera</button>
    <button type="button" class="btn-snap-photo" id="btnSnap">📸 Ambil Foto Sekarang</button>
    <button type="button" class="btn btn-dark" id="btnCloseCamera">Batal</button>
  </div>`, 'live-camera-modal');

  const video = $('#cameraVideo', d);
  const canvas = $('#cameraCanvas', d);
  const snapBtn = $('#btnSnap', d);
  const toggleBtn = $('#btnToggleFacing', d);
  const closeBtn = $('#btnCloseCamera', d);

  const startStream = async () => {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Browser tidak mendukung WebRTC camera stream.');
      }
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
      video.srcObject = stream;
      if (facingMode === 'user') {
        video.classList.remove('back-camera');
      } else {
        video.classList.add('back-camera');
      }
    } catch (err) {
      console.warn('Live WebRTC camera error, falling back to direct mobile camera capture:', err);
      d.remove();
      const fallbackInput = document.createElement('input');
      fallbackInput.type = 'file';
      fallbackInput.accept = 'image/*';
      fallbackInput.capture = 'user'; // strict direct mobile camera
      fallbackInput.onchange = async (e) => {
        const file = e.target.files?.[0];
        if (file) {
          const compressed = await compressImage(file, 800, 0.85);
          onCapture(compressed);
        }
      };
      fallbackInput.click();
      return;
    }
  };

  const stopStream = () => {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
  };

  await startStream();

  closeBtn.onclick = () => {
    stopStream();
    d.remove();
  };

  toggleBtn.onclick = async () => {
    facingMode = facingMode === 'user' ? 'environment' : 'user';
    await startStream();
  };

  snapBtn.onclick = () => {
    if (!video.videoWidth || !video.videoHeight) {
      return toast('Kamera sedang memuat, mohon tunggu sebentar...', true);
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (facingMode === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const photoData = canvas.toDataURL('image/jpeg', 0.85);
    stopStream();
    d.remove();
    onCapture(photoData);
  };
}

async function checkoutPage() {
  const c = getCart();
  if (!c.tableToken || !c.items.length) return nav('/cart');
  const [settings, products] = await Promise.all([
    api('/public/settings'),
    api('/public/products')
  ]);
  recalculateCartItems(c, products);
  setCart(c);

  let method = settings.qrisEnabled !== false ? 'QRIS_DEMO' : 'CASH';
  let orderNote = '';
  const idemKey = 'cc_demo_checkout_idem_v6';
  let idem = sessionStorage.getItem(idemKey) || genUUID();
  sessionStorage.setItem(idemKey, idem);

  let studentPhotoData = c.studentInfo?.studentPhoto || null;
  let isEmailVerified = !!(c.studentInfo?.emailVerified);
  let studentEmailVal = c.studentInfo?.email || '';

  const sub = cartTotal(c);
  const regSub = cartRegularTotal(c);
  const savings = cartSavings(c);
  const isStud = isStudent(c);
  const fee = Math.round(sub * Number(settings.serviceFee || 0) / 100);
  const tax = Math.round((sub + fee) * Number(settings.taxPercent || 0) / 100);
  const total = sub + fee + tax;

  document.body.className = 'customer-body checkout-body';
  document.body.innerHTML = customerShell(`<main class="simple-customer-page checkout-page">
    <div class="customer-page-title">
      <button id="back" class="circle-back" aria-label="Kembali">${icon('back', 18)}</button>
      <h1>Pilih Pembayaran</h1>
    </div>
    <div class="checkout-grid">
      <section class="checkout-summary-section">
        ${isStud ? `<div class="student-form-card">
          <div class="student-form-header">
            <h4>🎓 Verifikasi Identitas Pelajar & Edu ID</h4>
            <span class="badge-role-student">Harga Hemat Aktif</span>
          </div>
          <div class="student-form-grid">
            <label class="full">
              Nama Lengkap Pelajar / Mahasiswa
              <input id="studentName" placeholder="Contoh: Rian Ardiansyah" value="${esc(c.studentInfo?.studentName || '')}" required>
            </label>
            <label>
              Asal Kampus / Sekolah
              <input id="studentCampus" placeholder="Contoh: Universitas Indonesia / ITB / SMA 1" value="${esc(c.studentInfo?.campus || '')}" required>
            </label>
            <label>
              Nomor Induk (NIM / NIS)
              <input id="studentIdNum" placeholder="Contoh: 2106781290" value="${esc(c.studentInfo?.studentId || '')}" required>
            </label>
            <div class="full" style="margin-top:2px;">
              <label style="display:block;font-size:12px;font-weight:700;color:var(--ink);">
                Email Institusi Kampus Resmi (.ac.id / .edu)
              </label>
              <div class="otp-input-group">
                <input id="studentEmail" type="email" placeholder="Contoh: mahasiswa@ui.ac.id" value="${esc(studentEmailVal)}">
                <button type="button" id="btnSendOtp" class="btn btn-soft btn-small" style="white-space:nowrap;">Kirim OTP</button>
              </div>
              <div id="otpVerifyRow" style="margin-top:8px;display:none;">
                <div class="otp-input-group">
                  <input id="studentOtp" type="text" placeholder="Masukkan 4 digit OTP..." maxlength="6">
                  <button type="button" id="btnVerifyOtp" class="btn btn-green btn-small" style="white-space:nowrap;">Verifikasi OTP</button>
                </div>
              </div>
              <div id="emailVerifiedBadge" style="${isEmailVerified ? '' : 'display:none;'}">
                <span class="badge-edu-verified">✅ Email Kampus Terverifikasi Resmi (.ac.id)</span>
              </div>
            </div>
          </div>

          <div class="student-photo-section">
            <div class="student-photo-label">
              <span>📸 Foto Liveness bersama Kartu Pelajar / KTM</span>
              <span style="font-size:10.5px;color:#2c8b5b;font-weight:700;">Wajib Kamera Langsung (Real-time)</span>
            </div>
            <div id="photoDropzone" class="student-photo-dropzone" style="cursor:pointer;">
              <div id="dropzoneEmpty" class="dropzone-content" style="${studentPhotoData ? 'display:none;' : ''}">
                <div class="dropzone-icon">📷</div>
                <div class="dropzone-text">
                  <b>Buka Kamera Langsung (Selfie bersama KTM)</b>
                  <small>Foto wajib diambil langsung saat ini (bukan dari galeri / dokumen lama)</small>
                </div>
              </div>
              <div id="dropzonePreview" class="student-photo-preview-wrap" style="${studentPhotoData ? '' : 'display:none;'}">
                <img id="previewImg" src="${esc(studentPhotoData || '')}" alt="Selfie KTM">
                <div class="student-photo-preview-info">
                  <b>✅ Foto Liveness Kamera Berhasil Diambil</b>
                  <small>Klik untuk membuka kamera dan mengambil ulang</small>
                </div>
                <button type="button" id="btnChangePhoto" class="btn btn-soft btn-small">Ambil Ulang</button>
              </div>
            </div>
          </div>

          <div class="quota-notice-badge">
            <span>🔒</span>
            <div><b>Anti-Sybil Quota:</b> Diskon pelajar dibatasi maksimal 1x per hari per identitas (NIM/Email) untuk mencegah jastip/pinjam akun.</div>
          </div>
        </div>` : ''}

        <div class="checkout-order-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <h3 style="margin:0;">Ringkasan Pesanan (${esc(c.tableName || 'Meja')})</h3>
            <span class="${isStud ? 'badge-role-student' : 'badge-role-regular'}">${isStud ? '🎓 Pelajar' : '☕ Umum'}</span>
          </div>
          ${c.items.map(i => `<div class="checkout-item">
            <div>
              <b>${i.quantity}x ${esc(i.name)}</b>
              <small>${esc(optionSummary(i))}${i.note ? ` • ${esc(i.note)}` : ''}</small>
              ${i.savings ? `<small style="color:#2c8b5b;display:block;font-weight:700;">Hemat ${money(i.savings)}</small>` : ''}
            </div>
            <strong>${money(i.price * i.quantity)}</strong>
          </div>`).join('')}
          <div class="payment-summary compact">
            ${savings > 0 ? `<div><span>Subtotal Reguler</span><span style="text-decoration:line-through;color:var(--muted);">${money(regSub)}</span></div>
            <div class="student-savings-row"><span>🎉 Subsidi Harga Pelajar</span><strong>- ${money(savings)}</strong></div>` : ''}
            <div><span>Subtotal</span><b>${money(sub)}</b></div>
            ${fee ? `<div><span>Biaya Layanan (${settings.serviceFee}%)</span><b>${money(fee)}</b></div>` : ''}
            ${tax ? `<div><span>Pajak (${settings.taxPercent}%)</span><b>${money(tax)}</b></div>` : ''}
            <hr>
            <div class="summary-total"><span>Total Pembayaran</span><strong>${money(total)}</strong></div>
          </div>
        </div>
        <div class="order-note-box">
          <label class="field-label">Catatan untuk Barista / Dapur</label>
          <textarea id="orderNote" class="textarea" placeholder="Contoh: sajikan bersamaan, sendok tambahan...">${esc(orderNote)}</textarea>
        </div>
      </section>
      <section class="payment-methods">
        <h3>Pilih Metode Pembayaran</h3>
        <div id="paymentChoiceList">
          ${settings.qrisEnabled !== false ? `<button type="button" class="payment-choice ${method === 'QRIS_DEMO' ? 'selected' : ''}" data-pay="QRIS_DEMO">
            <div class="payment-choice-icon qris-icon">QR</div>
            <div><b>QRIS</b><span>Bayar instan via BCA, GoPay, OVO, ShopeePay</span></div>
            <i></i>
          </button>`: ''}
          ${settings.cashEnabled !== false ? `<button type="button" class="payment-choice ${method === 'CASH' ? 'selected' : ''}" data-pay="CASH">
            <div class="payment-choice-icon">${icon('cart', 19)}</div>
            <div><b>Bayar di Kasir (Tunai)</b><span>Lakukan pembayaran langsung ke meja kasir</span></div>
            <i></i>
          </button>`: ''}
        </div>
        <div class="demo-payment-note">ℹ️ <b>Mode Demo:</b> QRIS adalah simulasi sandbox (tidak menggunakan saldo nyata).</div>
        <button id="place" class="btn btn-primary btn-wide btn-large">Konfirmasi Pesanan • ${money(total)}</button>
      </section>
    </div>
  </main>`, { tableName: c.tableName, className: 'simple-shell' });

  $('#back').onclick = () => nav('/cart');
  const n = $('#orderNote');
  if (n) n.oninput = e => orderNote = e.target.value;

  $$('[data-pay]').forEach(b => b.onclick = () => {
    alarm.unlock();
    method = b.dataset.pay;
    $$('[data-pay]').forEach(x => x.classList.toggle('selected', x.dataset.pay === method));
  });

  // OTP handlers
  const btnSendOtp = $('#btnSendOtp');
  const btnVerifyOtp = $('#btnVerifyOtp');
  const otpVerifyRow = $('#otpVerifyRow');
  const emailVerifiedBadge = $('#emailVerifiedBadge');

  if (btnSendOtp) {
    btnSendOtp.onclick = async () => {
      const email = ($('#studentEmail')?.value || '').trim();
      if (!email) return toast('Harap masukkan alamat email kampus (.ac.id / .edu).', true);
      btnSendOtp.disabled = true;
      btnSendOtp.textContent = 'Mengirim...';
      try {
        const res = await api('/public/student/send-otp', {
          method: 'POST',
          body: JSON.stringify({ email })
        });
        toast(`📩 OTP Dikirim! (Kode Demo: ${res.demoOtp})`);
        if (otpVerifyRow) {
          otpVerifyRow.style.display = 'block';
          const otpIn = $('#studentOtp');
          if (otpIn && res.demoOtp) otpIn.value = res.demoOtp;
        }
      } catch (err) {
        toast(err.message, true);
      } finally {
        btnSendOtp.disabled = false;
        btnSendOtp.textContent = 'Kirim Ulang OTP';
      }
    };
  }

  if (btnVerifyOtp) {
    btnVerifyOtp.onclick = async () => {
      const email = ($('#studentEmail')?.value || '').trim();
      const code = ($('#studentOtp')?.value || '').trim();
      if (!code) return toast('Harap masukkan kode OTP.', true);
      btnVerifyOtp.disabled = true;
      try {
        await api('/public/student/verify-otp', {
          method: 'POST',
          body: JSON.stringify({ email, code })
        });
        isEmailVerified = true;
        studentEmailVal = email;
        if (otpVerifyRow) otpVerifyRow.style.display = 'none';
        if (emailVerifiedBadge) emailVerifiedBadge.style.display = 'block';
        toast('✅ Email institusi kampus berhasil diverifikasi!');
      } catch (err) {
        toast(err.message, true);
      } finally {
        btnVerifyOtp.disabled = false;
      }
    };
  }

  const dropzone = $('#photoDropzone');
  const fileInput = $('#studentPhotoInput');
  const dEmpty = $('#dropzoneEmpty');
  const dPreview = $('#dropzonePreview');
  const pImg = $('#previewImg');
  const changeBtn = $('#btnChangePhoto');

  if (dropzone) {
    dropzone.onclick = () => {
      openLiveCameraModal((photoData) => {
        studentPhotoData = photoData;
        pImg.src = studentPhotoData;
        dEmpty.style.display = 'none';
        dPreview.style.display = 'flex';
        toast('✅ Foto liveness kamera berhasil diambil!');
      });
    };
    if (changeBtn) {
      changeBtn.onclick = (e) => {
        e.stopPropagation();
        openLiveCameraModal((photoData) => {
          studentPhotoData = photoData;
          pImg.src = studentPhotoData;
          dEmpty.style.display = 'none';
          dPreview.style.display = 'flex';
          toast('✅ Foto liveness kamera berhasil diperbarui!');
        });
      };
    }
  }

  $('#place').onclick = async () => {
    alarm.unlock();
    const btn = $('#place');

    let studentData = null;
    if (isStud) {
      const sName = ($('#studentName')?.value || '').trim();
      const sCampus = ($('#studentCampus')?.value || '').trim();
      const sId = ($('#studentIdNum')?.value || '').trim();
      const sEmail = ($('#studentEmail')?.value || '').trim();
      if (!sName || !sCampus || !sId) {
        return toast('Harap lengkapi data verifikasi pelajar (Nama, Kampus, & NIM/NIS).', true);
      }
      if (!studentPhotoData) {
        return toast('Harap ambil/unggah foto selfie bersama Kartu Pelajar / KTM.', true);
      }
      studentData = {
        studentName: sName,
        campus: sCampus,
        studentId: sId,
        email: sEmail || null,
        emailVerified: isEmailVerified,
        studentPhoto: studentPhotoData
      };
      c.studentInfo = studentData;
      setCart(c);
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Memproses pesanan...';
    try {
      const r = await api('/orders', {
        method: 'POST',
        body: JSON.stringify({
          tableToken: c.tableToken,
          customerType: isStud ? 'STUDENT' : 'REGULAR',
          studentInfo: studentData,
          items: c.items.map(i => ({ productId: i.productId, quantity: i.quantity, note: i.note, options: i.options })),
          paymentMethod: method,
          note: $('#orderNote')?.value || orderNote,
          idempotencyKey: idem
        })
      });
      sessionStorage.setItem('cc_access_' + r.orderNumber, r.accessToken);
      sessionStorage.setItem('cc_table_' + r.orderNumber, c.tableToken);
      localStorage.setItem('cc_active_order', JSON.stringify({
        orderNumber: r.orderNumber,
        accessToken: r.accessToken,
        tableName: c.tableName,
        tableToken: c.tableToken,
        status: r.status,
        total: r.total,
        at: Date.now()
      }));
      sessionStorage.removeItem(idemKey);
      clearCart();
      nav('/track/' + r.orderNumber);
    } catch (e) {
      toast(e.message, true);
      btn.disabled = false;
      btn.textContent = `Konfirmasi Pesanan • ${money(total)}`;
    }
  };
}

function trackingTimeline(o) {
  const steps = [
    ['NEW', 'Pesanan Diterima', 'Pesanan sudah tercatat di antrean kasir'],
    ['PROCESSING', 'Sedang Disiapkan Barista', 'Kopi & makanan Anda sedang diracik dengan penuh cinta'],
    ['READY', 'Pesanan Siap Diambil', 'Silakan ambil pesanan Anda di counter pick-up'],
    ['COMPLETED', 'Pesanan Selesai', 'Terima kasih atas kunjungan Anda di Cafe Campus']
  ];
  const index = { NEW: 0, PROCESSING: 1, READY: 2, COMPLETED: 3, CANCELLED: -1 }[o.status] ?? 0;
  return `<div class="track-timeline">${steps.map((s, i) => `<div class="track-step ${i < index ? 'done' : ''} ${i === index ? 'current' : ''}">
    <div class="track-node">${i < index ? icon('check', 12) : ''}</div>
    <div><b>${s[1]}</b><span>${s[2]}</span></div>
  </div>`).join('')}</div>`;
}

async function trackPage(orderNumber) {
  const access = sessionStorage.getItem('cc_access_' + orderNumber);
  if (!access) {
    document.body.innerHTML = customerShell(`<main class="empty-page">
      <h2>Akses pesanan tidak ditemukan</h2>
      <p>Buka status pesanan dari browser yang digunakan saat melakukan pemesanan.</p>
      <a class="btn btn-primary" data-nav href="/">Kembali ke Beranda</a>
    </main>`);
    return;
  }
  let o = await api('/orders/' + encodeURIComponent(orderNumber) + '?access=' + encodeURIComponent(access));
  updateActiveOrder({
    orderNumber: o.orderNumber,
    accessToken: access,
    status: o.status,
    tableName: o.tableName,
    tableToken: sessionStorage.getItem('cc_table_' + orderNumber) || o.tableNumber
  });
  let readyAlarmTriggered = false;
  let currentScreenMode = ''; // 'track', 'ready', 'completed'

  const triggerReadyAlarm = () => {
    if (readyAlarmTriggered) return;
    readyAlarmTriggered = true;
    alarm.startAlarm10s('ready');
    showAlarmBanner(`🔔 PESANAN #${esc(o.orderNumber)} SIAP DIAMBIL!`, 'Alarm berbunyi selama 10 detik. Silakan menuju counter pickup.', () => alarm.stopAlarm());
  };

  const renderReadyScreen = () => {
    currentScreenMode = 'ready';
    triggerReadyAlarm();
    document.body.className = 'customer-body ready-body pulse-bg';
    document.body.innerHTML = `<main class="ready-page">
      <div class="ready-top-brand">${brandMark(36)}<b>Cafe Campus</b></div>
      <div class="ready-center">
        <div class="ready-check">${icon('check', 44)}</div>
        <span>PESANAN SELESAI DIRACIK</span>
        <h1>Pesanan Siap!</h1>
        <p>Racikan spesial barista kami telah siap dinikmati.</p>
        <div class="pickup-card">
          <small>KODE AMBIL PESANAN</small>
          <strong>#${esc(o.orderNumber)}</strong>
          <div>${icon('table', 16)} ${esc(o.tableName)}</div>
        </div>
        <p class="ready-note">Silakan ambil pesanan Anda di counter pick-up barista terdekat dengan menunjukkan layar ini.</p>
        <button class="btn btn-primary btn-large btn-wide" id="backMenu">Kembali ke Menu</button>
      </div>
    </main>`;
    $('#backMenu').onclick = () => {
      alarm.stopAlarm();
      nav(`/order/${encodeURIComponent(sessionStorage.getItem('cc_table_' + orderNumber) || 'demo-table-01')}/menu`);
    };
  };

  const renderCompletedScreen = () => {
    currentScreenMode = 'completed';
    localStorage.removeItem('cc_active_order');
    document.body.className = 'customer-body complete-body';
    document.body.innerHTML = customerShell(`<main class="complete-page">
      <div class="heart-orb">♡</div>
      <h1>Terima Kasih!</h1>
      <p>Semoga harimu menyenangkan ditemani sajian nikmat dari Cafe Campus.</p>
      <div class="complete-summary">
        <small>RINGKASAN PESANAN</small>
        <div><span>${o.items.map(i => `${i.productName} x${i.quantity}`).join(', ')}</span><b>Selesai</b></div>
      </div>
      <div class="rating-card">
        <b>Bagaimana pengalaman kuliner Anda hari ini?</b>
        <div class="stars">${[1, 2, 3, 4, 5].map(i => `<button data-star="${i}" aria-label="Bintang ${i}">${icon('star', 26)}</button>`).join('')}</div>
        <small>Nilai kami untuk terus memberikan yang terbaik!</small>
      </div>
      <button id="orderAgain" class="btn btn-primary btn-wide btn-large">Pesan Lagi</button>
    </main>`, { tableName: o.tableName, className: 'simple-shell' });
    $$('[data-star]').forEach(b => b.onclick = () => {
      alarm.unlock();
      const n = +b.dataset.star;
      $$('[data-star]').forEach((x, i) => x.classList.toggle('active', i < n));
      toast('Terima kasih atas penilaiannya!');
    });
    $('#orderAgain').onclick = () => {
      alarm.stopAlarm();
      nav(`/order/${encodeURIComponent(sessionStorage.getItem('cc_table_' + orderNumber) || 'demo-table-01')}/menu`);
    };
  };

  const renderTrackingCardContent = () => {
    const waiting = o.payment.status !== 'PAID';
    if (o.status === 'CANCELLED') {
      return `<section class="cancelled-card">
        <h2>Pesanan Dibatalkan</h2>
        <p>Pesanan ini sudah ditutup. Silakan hubungi staff jika membutuhkan bantuan.</p>
      </section>`;
    }
    return `<section class="tracking-card" id="trackingCardInner">
      ${waiting ? `<div class="payment-wait">
        <div>${o.payment.method === 'QRIS_DEMO' ? 'QR' : '$'}</div>
        <div>
          <b>${o.payment.method === 'QRIS_DEMO' ? 'Menunggu Pembayaran QRIS' : 'Menunggu Pembayaran di Kasir'}</b>
          <span>${o.payment.method === 'QRIS_DEMO' ? 'Scan QRIS atau tekan tombol simulasi di bawah.' : 'Silakan lakukan pembayaran tunai/debit ke meja kasir.'}</span>
        </div>
      </div>
      ${o.payment.method === 'QRIS_DEMO' ? `<div class="qris-demo-box">
        <div class="fake-qr">${icon('qr', 84)}</div>
        <p>Simulasi QRIS • <b>${money(o.total)}</b></p>
        <button id="demoPay" class="btn btn-primary btn-wide">Simulasikan Pembayaran Berhasil</button>
      </div>`: ''}` : trackingTimeline(o)}
    </section>`;
  };

  const renderTrackShell = () => {
    currentScreenMode = 'track';
    document.body.className = 'customer-body track-body';
    document.body.innerHTML = customerShell(`<main class="tracking-page">
      <div class="tracking-top">
        <span>STATUS PESANAN</span>
        <div>
          <h1>Pesanan #${esc(o.orderNumber)}</h1>
          <em id="estMinutesText">Estimasi ${o.estimatedMinutes || 10} Mnt</em>
        </div>
      </div>
      ${o.studentInfo ? `
        <div class="track-verify-card ${o.studentInfo.verificationStatus === 'AUTOMATICALLY_VERIFIED' || o.studentInfo.verificationStatus === 'VERIFIED' ? 'verified' : (o.studentInfo.verificationStatus === 'REJECTED' ? 'rejected' : 'pending')}">
          <div style="font-size:22px;">
            ${o.studentInfo.verificationStatus === 'AUTOMATICALLY_VERIFIED' || o.studentInfo.verificationStatus === 'VERIFIED' ? '✅' : (o.studentInfo.verificationStatus === 'REJECTED' ? '⚠️' : '⏳')}
          </div>
          <div style="flex:1;">
            <b style="font-size:12.5px;display:block;">${o.studentInfo.verificationStatus === 'AUTOMATICALLY_VERIFIED' ? 'Identitas Pelajar Terverifikasi Sah (AI Radar)' : (o.studentInfo.verificationStatus === 'VERIFIED' ? 'Verifikasi Kartu Pelajar Disetujui Kasir' : (o.studentInfo.verificationStatus === 'REJECTED' ? 'Verifikasi Pelajar Ditolak' : 'Menunggu Validasi Selfie KTM oleh Kasir'))}</b>
            <small style="display:block;margin-top:2px;font-size:11px;">
              ${o.studentInfo.verificationStatus === 'AUTOMATICALLY_VERIFIED' ? `Identitas mahasiswa ${esc(o.studentInfo.campus)} dan domain kampus lolos validasi otomatis.` : (o.studentInfo.verificationStatus === 'VERIFIED' ? `Identitas mahasiswa ${esc(o.studentInfo.campus)} telah diverifikasi sah oleh kasir.` : (o.studentInfo.verificationStatus === 'REJECTED' ? `Alasan: ${esc(o.studentInfo.rejectionReason || 'Foto KTM tidak sesuai')}. Tagihan telah disesuaikan ke harga normal.` : 'Kasir akan memverifikasi foto selfie KTM Anda saat memproses pesanan.'))}
            </small>
          </div>
        </div>
      ` : ''}
      <div id="trackingCardWrapper">${renderTrackingCardContent()}</div>
      <section class="tracking-summary">
        <h3>Rincian Pesanan</h3>
        ${o.items.map(i => `<div>
          <span>${esc(i.productName)} x${i.quantity}<small>${esc(optionSummary(i))}</small></span>
          <b>${money(i.lineTotal)}</b>
        </div>`).join('')}
        <hr>
        <div><span>Nomor Meja</span><b>${esc(o.tableName)}</b></div>
        <div><span>Metode Pembayaran</span><b id="paymentStatusBadge">${o.payment.method === 'QRIS_DEMO' ? 'QRIS' : 'Bayar di Kasir'} ${o.payment.status === 'PAID' ? '(Lunas)' : '(Pending)'}</b></div>
        <div class="tracking-total"><span>Total Bayar</span><strong>${money(o.total)}</strong></div>
      </section>
    </main>`, { tableName: o.tableName, className: 'simple-shell' });

    bindPayButton();
  };

  const bindPayButton = () => {
    const pay = $('#demoPay');
    if (pay) pay.onclick = async () => {
      alarm.unlock();
      pay.disabled = true;
      pay.innerHTML = '<span class="spinner"></span> Memproses...';
      try {
        await api('/demo/payments/' + encodeURIComponent(orderNumber) + '/pay', { method: 'POST', body: '{}' });
        toast('Pembayaran QRIS demo berhasil');
        refresh();
      } catch (e) {
        toast(e.message, true);
        pay.disabled = false;
        pay.textContent = 'Simulasikan Pembayaran Berhasil';
      }
    };
  };

  const updateTrackView = () => {
    if (o.status === 'READY') return renderReadyScreen();
    if (o.status === 'COMPLETED') return renderCompletedScreen();

    if (currentScreenMode !== 'track') {
      renderTrackShell();
      return;
    }

    const wrapper = $('#trackingCardWrapper');
    if (wrapper) {
      wrapper.innerHTML = renderTrackingCardContent();
      bindPayButton();
    }
    const badge = $('#paymentStatusBadge');
    if (badge) {
      badge.textContent = `${o.payment.method === 'QRIS_DEMO' ? 'QRIS' : 'Bayar di Kasir'} ${o.payment.status === 'PAID' ? '(Lunas)' : '(Pending)'}`;
    }
    const est = $('#estMinutesText');
    if (est) {
      est.textContent = `Estimasi ${o.estimatedMinutes || 10} Mnt`;
    }
  };

  const refresh = async () => {
    try {
      const prevStatus = o ? o.status : '';
      o = await api('/orders/' + encodeURIComponent(orderNumber) + '?access=' + encodeURIComponent(access));
      if (prevStatus !== 'READY' && o.status === 'READY') {
        triggerReadyAlarm();
      }
      updateTrackView();
    } catch { }
  };

  if (o.status === 'READY') {
    renderReadyScreen();
  } else if (o.status === 'COMPLETED') {
    renderCompletedScreen();
  } else {
    renderTrackShell();
  }

  let es;
  try {
    es = new EventSource('/api/events?order=' + encodeURIComponent(orderNumber) + '&access=' + encodeURIComponent(access));
    es.addEventListener('order-update', e => {
      try {
        const prevStatus = o ? o.status : '';
        o = JSON.parse(e.data);
        if (prevStatus !== 'READY' && o.status === 'READY') {
          triggerReadyAlarm();
        }
        updateTrackView();
      } catch { }
    });
    disposeOnLeave(() => es.close());
  } catch { }

  // Polling fallback: updates in-place without blinking!
  const timer = setInterval(refresh, 3000);
  disposeOnLeave(() => clearInterval(timer));
}

async function adminGuard(fn) {
  try {
    const user = await api('/admin/me');
    return fn(user);
  } catch {
    nav('/admin/login');
  }
}

function loginPage() {
  document.body.className = 'admin-login-body';
  document.body.innerHTML = `<main class="admin-login-page">
    <section class="login-card">
      <div class="login-logo">
        ${brandMark(60)}
        <h1>Cafe Campus</h1>
        <span>PORTAL STAFF & ADMIN</span>
      </div>
      <form id="loginForm">
        <h2>Masuk ke Dashboard</h2>
        <label>Email Staff
          <input id="email" type="email" value="admin@cafecampus.demo" autocomplete="username">
        </label>
        <label>Kata Sandi
          <div class="password-wrap">
            <input id="password" type="password" value="admin123" autocomplete="current-password">
            <button type="button" id="showPass" aria-label="Lihat kata sandi">${icon('eye', 17)}</button>
          </div>
        </label>
        <button class="btn btn-primary btn-wide" id="loginBtn">Masuk ${icon('arrow', 17)}</button>
        <button type="button" class="forgot" id="forgot">Gunakan akun demo terisi</button>
      </form>
    </section>
  </main>`;
  $('#showPass').onclick = () => { const x = $('#password'); x.type = x.type === 'password' ? 'text' : 'password' };
  $('#forgot').onclick = () => toast('Untuk demo gunakan akun yang sudah terisi.');
  $('#loginForm').onsubmit = async e => {
    e.preventDefault();
    alarm.unlock();
    const b = $('#loginBtn');
    b.disabled = true;
    b.innerHTML = '<span class="spinner"></span> Memeriksa...';
    try {
      await api('/admin/login', { method: 'POST', body: JSON.stringify({ email: $('#email').value, password: $('#password').value }) });
      nav('/admin');
    } catch (err) {
      toast(err.message, true);
      b.disabled = false;
      b.innerHTML = `Masuk ${icon('arrow', 17)}`;
    }
  };
}

async function dashboardPage(user) {
  const renderDashboard = async () => {
    const [data, allOrders, allTables] = await Promise.all([
      api('/admin/dashboard'),
      api('/admin/orders?date=' + todayISO()),
      api('/admin/tables')
    ]);
    const c = data.counts || {};
    const activeOrders = allOrders.filter(o => ['NEW', 'PROCESSING', 'READY'].includes(o.status));

    // Top best sellers today
    const itemMap = {};
    allOrders.filter(o => o.payment?.status === 'PAID').forEach(o => {
      o.items.forEach(i => {
        itemMap[i.productName] = (itemMap[i.productName] || 0) + i.quantity;
      });
    });
    const bestSellers = Object.entries(itemMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const maxQty = bestSellers.length ? Math.max(...bestSellers.map(x => x[1]), 1) : 1;

    // Table occupancy
    const activeTableNumbers = new Set(activeOrders.map(o => o.tableNumber));

    const tableHtml = orderTable(data.recent || [], true);
    const queueHtml = kitchenQueueCards(activeOrders);
    const bestSellersHtml = bestsellersWidget(bestSellers, maxQty);
    const occupancyHtml = tableOccupancyWidget(allTables, activeTableNumbers);

    const mainPanel = $('#dashboardRecentPanel');
    if (mainPanel) {
      // In-place update!
      $('#countNew') && ($('#countNew').textContent = c.NEW || 0);
      $('#countProcessing') && ($('#countProcessing').textContent = c.PROCESSING || 0);
      $('#countReady') && ($('#countReady').textContent = c.READY || 0);
      $('#countRevenue') && ($('#countRevenue').textContent = money(data.revenue));
      $('#kitchenQueuePanel') && ($('#kitchenQueuePanel').innerHTML = queueHtml);
      $('#bestSellersPanel') && ($('#bestSellersPanel').innerHTML = bestSellersHtml);
      $('#occupancyPanel') && ($('#occupancyPanel').innerHTML = occupancyHtml);
      mainPanel.innerHTML = tableHtml;
      bindOrderTableActions(renderDashboard);
      bindQueueCardActions(renderDashboard);
      return;
    }

    document.body.className = 'admin-body';
    document.body.innerHTML = adminShell(`
      ${adminTop('Dashboard Kasir & Barista', 'Pantau antrean racikan minuman, konfirmasi pembayaran, dan kelola pesanan aktif.')}

      <div class="dashboard-greeting-banner">
        <div class="greeting-text">
          <div class="greeting-pill"><i class="greeting-dot"></i> Shift Aktif • ${new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
          <h1>Semangat Bertugas, Tim Cafe Campus ☕</h1>
          <p>Kelola alur pesanan meja, pantau antrean racikan minuman, dan konfirmasi transaksi Cafe Campus secara langsung.</p>
        </div>
        <div class="greeting-actions">
          <button class="btn btn-primary" id="btnQuickPos">${icon('plus', 18)} Pesanan Kasir (POS Cepat)</button>
          <button class="btn btn-soft" id="btnTestSound">${icon('bell', 18)} Tes Dering Kasir</button>
          <button class="btn btn-soft" id="btnPrintShift">${icon('report', 18)} Rekap Shift</button>
        </div>
      </div>

      <section class="dashboard-metrics">
        <div class="admin-metric orange"><span>Pesanan Baru</span><strong id="countNew">${c.NEW || 0}</strong><i>${icon('bell', 20)}</i></div>
        <div class="admin-metric blue"><span>Sedang Diproses</span><strong id="countProcessing">${c.PROCESSING || 0}</strong><i>${icon('clock', 20)}</i></div>
        <div class="admin-metric green"><span>Siap Diambil</span><strong id="countReady">${c.READY || 0}</strong><i>${icon('check', 20)}</i></div>
        <div class="admin-metric revenue"><span>Pendapatan Hari Ini</span><strong id="countRevenue">${money(data.revenue)}</strong><i>${icon('wallet', 20)}</i></div>
      </section>

      <!-- LIVE KITCHEN & BARISTA QUEUE TICKETS -->
      <section class="admin-panel queue-panel">
        <div class="panel-head">
          <div class="panel-head-title">
            <h2>Antrean Dapur & Barista</h2>
            <span class="badge-count">${activeOrders.length} Pesanan Berjalan</span>
          </div>
          <span class="panel-subtitle">Klik tombol status untuk memajukan pesanan</span>
        </div>
        <div id="kitchenQueuePanel">${queueHtml}</div>
      </section>

      <!-- 2-COLUMN DASHBOARD GRID -->
      <div class="dashboard-split-grid">
        <section class="admin-panel main-split-col">
          <div class="panel-head">
            <h2>Pesanan Terkini</h2>
            <a data-nav href="/admin/orders" class="link-see-all">Lihat Semua ${icon('arrow', 15)}</a>
          </div>
          <div id="dashboardRecentPanel">${tableHtml}</div>
        </section>

        <div class="side-split-col">
          <section class="admin-panel widget-panel">
            <div class="panel-head">
              <h2>Menu Terlaris Hari Ini</h2>
              <span class="badge-pill">Top 5</span>
            </div>
            <div id="bestSellersPanel">${bestSellersHtml}</div>
          </section>

          <section class="admin-panel widget-panel">
            <div class="panel-head">
              <h2>Keterisian Meja Cafe</h2>
              <a data-nav href="/admin/tables" class="link-see-all">Kelola Meja ${icon('arrow', 14)}</a>
            </div>
            <div id="occupancyPanel">${occupancyHtml}</div>
          </section>
        </div>
      </div>
    `, 'dashboard', user);

    bindAdminChrome('dashboard');
    bindOrderTableActions(renderDashboard);
    bindQueueCardActions(renderDashboard);

    $('#btnQuickPos') && ($('#btnQuickPos').onclick = () => quickPosOrderModal(renderDashboard));
    $('#btnTestSound') && ($('#btnTestSound').onclick = () => {
      alarm.startAlarm10s('admin');
      toast('🔔 Memutar dering kasir selama 10 detik...');
    });
    $('#btnPrintShift') && ($('#btnPrintShift').onclick = () => printShiftSummaryModal(data, allOrders));
  };

  await renderDashboard();
  setupAdminRealtime(renderDashboard);
}

function kitchenQueueCards(orders) {
  if (!orders.length) {
    return `<div class="queue-empty">
      <div class="queue-empty-icon">☕</div>
      <b>Antrean Dapur Bersih & Terlayani</b>
      <p>Tidak ada pesanan aktif saat ini. Pesanan baru akan muncul otomatis di sini.</p>
    </div>`;
  }
  return `<div class="queue-cards-grid">
    ${orders.map(o => {
      const isStud = o.customerType === 'STUDENT';
      const vStatus = o.studentInfo?.verificationStatus;
      return `
      <div class="queue-ticket status-border-${o.status.toLowerCase()}">
        <div class="ticket-head">
          <div>
            <strong class="ticket-num">#${esc(o.orderNumber)}</strong>
            <span class="ticket-table">${esc(o.tableName)}</span>
          </div>
          ${statusBadge(o.status)}
        </div>
        ${isStud ? `<div class="ticket-student-bar">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <b>🎓 ${esc(o.studentInfo?.campus || 'Mahasiswa')}</b>
            ${vStatus === 'VERIFIED' ? '<span class="badge-verify-approved">✅ Sah</span>' : (vStatus === 'REJECTED' ? '<span class="badge-verify-rejected">⚠️ Ditolak</span>' : '<span class="badge-verify-pending">⏳ Cek KTM</span>')}
          </div>
          <small>NIM: ${esc(o.studentInfo?.studentId || '-')} • ${esc(o.studentInfo?.studentName || 'Pelajar')}</small>
          <div class="ticket-student-photo-row">
            <button type="button" class="btn-inspect-photo" data-inspect-photo="${esc(o.orderNumber)}">🔍 Foto Selfie KTM</button>
            ${vStatus !== 'VERIFIED' ? `
              <div class="ticket-verify-btn-group">
                <button type="button" class="btn-verify-approve" data-verify-student="${esc(o.orderNumber)}" data-decision="VERIFIED" title="Setujui Diskon Pelajar">✓</button>
                <button type="button" class="btn-verify-reject" data-verify-student="${esc(o.orderNumber)}" data-decision="REJECTED" title="Tolak & Ubah ke Harga Normal">✕</button>
              </div>
            ` : ''}
          </div>
        </div>` : ''}
        <div class="ticket-time">
          <span>🕒 ${formatTime(o.createdAt)}</span>
          <span class="ticket-payment ${o.payment.status === 'PAID' ? 'paid' : 'pending'}">${o.payment.method === 'QRIS_DEMO' ? 'QRIS' : 'Tunai'} • ${o.payment.status === 'PAID' ? 'Lunas' : 'Belum Bayar'}</span>
        </div>
        <div class="ticket-items">
          ${o.items.map(i => `<div class="ticket-item-row">
            <span><b>${i.quantity}x</b> ${esc(i.productName)}</span>
            ${i.options?.size ? `<small class="ticket-mod">${esc(i.options.size)}</small>` : ''}
          </div>`).join('')}
        </div>
        <div class="ticket-actions">
          ${o.payment.status === 'PENDING' && o.payment.method === 'CASH' ? `<button class="btn btn-green btn-small" data-quick-pay="${esc(o.orderNumber)}">Konfirmasi Bayar</button>` : ''}
          ${o.status === 'NEW' && o.payment.status === 'PAID' ? `<button class="btn btn-blue btn-small" data-quick-status="${esc(o.orderNumber)}" data-next="PROCESSING">▶ Proses Racik</button>` : ''}
          ${o.status === 'PROCESSING' ? `<button class="btn btn-primary btn-small" data-quick-status="${esc(o.orderNumber)}" data-next="READY">🔔 Siap Diambil</button>` : ''}
          ${o.status === 'READY' ? `<button class="btn btn-dark btn-small" data-quick-status="${esc(o.orderNumber)}" data-next="COMPLETED">✓ Selesai</button>` : ''}
          <button class="btn btn-soft btn-small" data-view-order="${esc(o.orderNumber)}">Detail</button>
        </div>
      </div>
    `;
    }).join('')}
  </div>`;
}

function bindQueueCardActions(onUpdate) {
  $$('[data-quick-pay]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    try {
      await api('/admin/orders/' + encodeURIComponent(b.dataset.quickPay) + '/payment', { method: 'PATCH', body: '{}' });
      toast('Pembayaran kasir berhasil dikonfirmasi LUNAS');
      onUpdate();
    } catch (e) { toast(e.message, true); b.disabled = false; }
  });
  $$('[data-quick-status]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    const next = b.dataset.next;
    try {
      await api('/admin/orders/' + encodeURIComponent(b.dataset.quickStatus) + '/status', { method: 'PATCH', body: JSON.stringify({ status: next }) });
      if (next === 'READY') toast('🔔 Pesanan dinyatakan SIAP! Alarm berbunyi di HP customer.');
      else toast('Status pesanan diperbarui');
      onUpdate();
    } catch (e) { toast(e.message, true); b.disabled = false; }
  });
  $$('[data-inspect-photo]').forEach(b => b.onclick = () => viewStudentPhotoModal(b.dataset.inspectPhoto, onUpdate));
  $$('[data-verify-student]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    const dec = b.dataset.decision;
    const num = b.dataset.verifyStudent;
    try {
      await api('/admin/orders/' + encodeURIComponent(num) + '/verify-student', {
        method: 'PATCH',
        body: JSON.stringify({ status: dec, reason: dec === 'REJECTED' ? 'Foto selfie / kartu tidak valid' : '' })
      });
      toast(dec === 'VERIFIED' ? '✅ Verifikasi KTM disetujui!' : '⚠️ Verifikasi ditolak. Tagihan disesuaikan ke harga reguler.');
      onUpdate();
    } catch (e) { toast(e.message, true); b.disabled = false; }
  });
}

function bestsellersWidget(bestSellers, maxQty) {
  if (!bestSellers.length) return '<div class="admin-empty-widget"><p>Belum ada transaksi hari ini.</p></div>';
  return `<div class="bestsellers-list">
    ${bestSellers.map(([name, qty], idx) => {
    const pct = Math.round((qty / maxQty) * 100);
    return `<div class="bestseller-item">
        <div class="bestseller-header">
          <span class="bestseller-rank">#${idx + 1}</span>
          <span class="bestseller-name">${esc(name)}</span>
          <strong class="bestseller-qty">${qty} porsi</strong>
        </div>
        <div class="bestseller-track">
          <div class="bestseller-bar" style="width: ${pct}%"></div>
        </div>
      </div>`;
  }).join('')}
  </div>`;
}

function tableOccupancyWidget(tables, activeSet) {
  if (!tables.length) return '<div class="admin-empty-widget"><p>Tidak ada data meja.</p></div>';
  return `<div class="occupancy-grid">
    ${tables.map(t => {
    const isOccupied = activeSet.has(t.tableNumber);
    return `<div class="occupancy-pill ${isOccupied ? 'occupied' : 'available'}" title="${esc(t.name)} (${isOccupied ? 'Sedang Ada Pesanan' : 'Tersedia'})">
        <i class="occupancy-dot"></i>
        <span>${esc(t.name)}</span>
      </div>`;
  }).join('')}
  </div>
  <div class="occupancy-legend">
    <span><i class="occupancy-dot occupied"></i> Terisi (${activeSet.size})</span>
    <span><i class="occupancy-dot available"></i> Kosong (${Math.max(0, tables.length - activeSet.size)})</span>
  </div>`;
}

async function quickPosOrderModal(onSuccess) {
  const [products, settings, allTables, categories] = await Promise.all([
    api('/public/products'),
    api('/public/settings'),
    api('/admin/tables'),
    api('/public/categories').catch(() => [])
  ]);

  let selectedTableToken = allTables[0]?.publicToken || 'demo-table-01';
  let selectedMethod = 'CASH';
  let activeCatId = 'ALL';
  let posCustomerType = 'REGULAR'; // 'REGULAR' | 'STUDENT'
  const cart = new Map(); // pid -> qty

  const d = modal(`<div class="modal-heading">
    <div><span>KASIR POINT OF SALE</span><h2>Buat Pesanan Kasir Cepat</h2></div>
    <span class="status-badge status-new"><i class="status-dot"></i>Order Kasir</span>
  </div>
  <div class="pos-modal-layout">
    <div class="pos-form-side">
      <div class="pos-top-bar">
        <div class="pos-field" style="flex:1;">
          <label>Pilih Meja Pemesan:</label>
          <select id="posTableSelect" class="form-input">
            ${allTables.map(t => `<option value="${esc(t.publicToken)}">${esc(t.name)} (Meja ${esc(t.tableNumber)})</option>`).join('')}
          </select>
        </div>
        <div class="pos-field" style="flex:1;">
          <label>Kategori Pelanggan:</label>
          <div class="pos-role-segmented">
            <button type="button" class="active" data-pos-role="REGULAR">☕ Pelanggan Umum</button>
            <button type="button" data-pos-role="STUDENT">🎓 Pelajar / Mahasiswa</button>
          </div>
        </div>
      </div>

      <div class="pos-top-bar" style="margin-top:-6px;">
        <div class="pos-field" style="flex:1;">
          <label>Metode Pembayaran:</label>
          <div class="pos-segment-group">
            <button type="button" class="pos-segment-btn active" data-pos-method="CASH">💵 Tunai Kasir</button>
            <button type="button" class="pos-segment-btn" data-pos-method="QRIS_DEMO">📱 QRIS Instan</button>
          </div>
        </div>
      </div>

      <div class="pos-field">
        <div class="pos-menu-header">
          <label style="margin-bottom:0;">Pilih Menu Cafe:</label>
          <div class="pos-cat-filter" id="posCatFilter">
            <button type="button" class="pos-cat-chip active" data-cat="ALL">Semua</button>
            ${categories.map(c => `<button type="button" class="pos-cat-chip" data-cat="${esc(c.id)}">${esc(c.name)}</button>`).join('')}
          </div>
        </div>
        <div class="pos-product-picker" id="posProductPicker">
          <!-- Populated dynamically -->
        </div>
      </div>
    </div>

    <div class="pos-summary-side">
      <div class="pos-receipt-header">
        <h3>Ringkasan Tagihan</h3>
        <span class="pos-ticket-badge" id="posCurrentTableBadge">${esc(allTables[0]?.name || 'Meja 01')}</span>
      </div>
      <div id="posCartItems" class="pos-cart-list">
        <div class="pos-empty-cart">
          <div class="pos-empty-icon">🧾</div>
          <b>Belum ada menu dipilih</b>
          <p>Klik tombol + Tambah pada menu di sebelah kiri untuk membuat pesanan kasir.</p>
        </div>
      </div>
      <div class="pos-bill-calc">
        <div class="pos-calc-row"><span>Subtotal:</span><b id="posSubtotal">Rp 0</b></div>
        <div class="pos-calc-row" id="posSavingsRow" style="display:none;color:#2c8b5b;"><span>Hemat Pelajar:</span><b id="posSavings">- Rp 0</b></div>
        <div class="pos-calc-row"><span>Biaya Layanan (${settings.serviceFee || 5}%):</span><b id="posServiceFee">Rp 0</b></div>
        <div class="pos-calc-row"><span>Pajak Resto (${settings.taxPercent || 11}%):</span><b id="posTax">Rp 0</b></div>
      </div>
      <div class="pos-total-row">
        <span>Total Bayar</span>
        <strong id="posTotalAmount">Rp 0</strong>
      </div>
      <button class="btn btn-green btn-full" id="btnSubmitPos" disabled>✓ Konfirmasi Pesanan & Cetak Struk</button>
    </div>
  </div>`, 'wide-modal');

  const renderProducts = () => {
    const container = $('#posProductPicker', d);
    if (!container) return;
    const list = activeCatId === 'ALL' ? products : products.filter(p => p.categoryId === activeCatId);
    const isStud = posCustomerType === 'STUDENT';
    container.innerHTML = list.map(p => {
      const effPrice = getProductEffectivePrice(p, isStud);
      const hasDisc = isStud && effPrice < p.price;
      return `
        <div class="pos-prod-card" data-pos-add="${esc(p.id)}">
          <img src="${esc(p.imageUrl || '/assets/iced-latte.jpg')}" alt="" class="pos-prod-img">
          <div class="pos-prod-info">
            <b>${esc(p.name)}</b>
            <span>${money(effPrice)} ${hasDisc ? `<small style="color:#2c8b5b;font-weight:700;">(🎓)</small>` : ''}</span>
          </div>
          <button type="button" class="btn btn-small btn-primary" tabindex="-1">+ Tambah</button>
        </div>
      `;
    }).join('');

    $$('[data-pos-add]', d).forEach(card => {
      card.onclick = () => {
        const pid = card.dataset.posAdd;
        cart.set(pid, (cart.get(pid) || 0) + 1);
        updateCartView();
      };
    });
  };

  renderProducts();

  // Role toggle
  $$('[data-pos-role]', d).forEach(btn => {
    btn.onclick = () => {
      $$('[data-pos-role]', d).forEach(b => { b.classList.remove('active'); b.classList.remove('student-mode'); });
      btn.classList.add('active');
      posCustomerType = btn.dataset.posRole;
      if (posCustomerType === 'STUDENT') btn.classList.add('student-mode');
      renderProducts();
      updateCartView();
    };
  });

  // Category filter
  $$('.pos-cat-chip', d).forEach(btn => {
    btn.onclick = () => {
      $$('.pos-cat-chip', d).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeCatId = btn.dataset.cat;
      renderProducts();
    };
  });

  // Table select
  const tableSelect = $('#posTableSelect', d);
  tableSelect.onchange = e => {
    selectedTableToken = e.target.value;
    const t = allTables.find(x => x.publicToken === selectedTableToken);
    if (t) $('#posCurrentTableBadge', d).textContent = t.name;
  };

  // Payment segment
  $$('[data-pos-method]', d).forEach(btn => {
    btn.onclick = () => {
      $$('[data-pos-method]', d).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedMethod = btn.dataset.posMethod;
    };
  });

  const updateCartView = () => {
    const listEl = $('#posCartItems', d);
    const totalEl = $('#posTotalAmount', d);
    const subtotalEl = $('#posSubtotal', d);
    const savingsRow = $('#posSavingsRow', d);
    const savingsEl = $('#posSavings', d);
    const serviceFeeEl = $('#posServiceFee', d);
    const taxEl = $('#posTax', d);
    const submitBtn = $('#btnSubmitPos', d);

    if (cart.size === 0) {
      listEl.innerHTML = `<div class="pos-empty-cart">
        <div class="pos-empty-icon">🧾</div>
        <b>Belum ada menu dipilih</b>
        <p>Klik tombol + Tambah pada menu di sebelah kiri untuk membuat pesanan kasir.</p>
      </div>`;
      subtotalEl.textContent = 'Rp 0';
      if (savingsRow) savingsRow.style.display = 'none';
      serviceFeeEl.textContent = 'Rp 0';
      taxEl.textContent = 'Rp 0';
      totalEl.textContent = 'Rp 0';
      submitBtn.disabled = true;
      return;
    }

    let subtotal = 0;
    let totalSavings = 0;
    let html = '';
    const isStud = posCustomerType === 'STUDENT';

    cart.forEach((qty, pid) => {
      const p = products.find(x => x.id === pid);
      if (!p) return;
      const effPrice = getProductEffectivePrice(p, isStud);
      const line = effPrice * qty;
      const regLine = p.price * qty;
      const savings = Math.max(0, regLine - line);
      subtotal += line;
      totalSavings += savings;

      html += `<div class="pos-cart-row">
        <div class="pos-cart-title">
          <b>${esc(p.name)}</b>
          <small>${money(effPrice)} x ${qty} ${savings > 0 ? `<span style="color:#2c8b5b;">(Hemat ${money(savings)})</span>` : ''}</small>
        </div>
        <div class="pos-cart-qty">
          <button type="button" class="btn-qty" data-pos-dec="${esc(p.id)}" title="Kurangi">-</button>
          <span>${qty}</span>
          <button type="button" class="btn-qty" data-pos-inc="${esc(p.id)}" title="Tambah">+</button>
        </div>
        <strong class="pos-cart-line">${money(line)}</strong>
      </div>`;
    });

    const sFee = Math.round(subtotal * (settings.serviceFee || 5) / 100);
    const tax = Math.round((subtotal + sFee) * (settings.taxPercent || 11) / 100);
    const grandTotal = subtotal + sFee + tax;

    listEl.innerHTML = html;
    subtotalEl.textContent = money(subtotal);
    if (savingsRow) {
      if (totalSavings > 0) {
        savingsRow.style.display = 'flex';
        savingsEl.textContent = `- ${money(totalSavings)}`;
      } else {
        savingsRow.style.display = 'none';
      }
    }
    serviceFeeEl.textContent = money(sFee);
    taxEl.textContent = money(tax);
    totalEl.textContent = money(grandTotal);
    submitBtn.disabled = false;

    $$('[data-pos-dec]', d).forEach(b => b.onclick = () => {
      const pid = b.dataset.posDec;
      const q = (cart.get(pid) || 1) - 1;
      if (q <= 0) cart.delete(pid); else cart.set(pid, q);
      updateCartView();
    });
    $$('[data-pos-inc]', d).forEach(b => b.onclick = () => {
      const pid = b.dataset.posInc;
      cart.set(pid, (cart.get(pid) || 0) + 1);
      updateCartView();
    });
  };

  $('#btnSubmitPos', d).onclick = async () => {
    const btn = $('#btnSubmitPos', d);
    btn.disabled = true;
    btn.textContent = 'Memproses Pesanan...';

    const items = [];
    cart.forEach((qty, pid) => items.push({ productId: pid, quantity: qty, note: '', options: {} }));

    try {
      const res = await api('/orders', {
        method: 'POST',
        body: JSON.stringify({
          tableToken: selectedTableToken,
          customerType: posCustomerType,
          studentInfo: posCustomerType === 'STUDENT' ? { campus: 'Kampus (POS Kasir)', studentId: 'POS-VERIFIED', studentName: 'Pelajar / Mahasiswa' } : null,
          items,
          paymentMethod: selectedMethod,
          idempotencyKey: 'pos-' + Date.now()
        })
      });
      toast(`Pesanan #${res.orderNumber} berhasil dibuat!`);
      d.remove();
      onSuccess();
      orderDetailModal(res.orderNumber, onSuccess);
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
      btn.textContent = '✓ Konfirmasi Pesanan & Cetak Struk';
    }
  };
}

function printShiftSummaryModal(dashData, allOrders) {
  const today = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const paidOrders = allOrders.filter(o => o.payment.status === 'PAID');
  const qrisTotal = paidOrders.filter(o => o.payment.method === 'QRIS_DEMO').reduce((s, o) => s + o.total, 0);
  const cashTotal = paidOrders.filter(o => o.payment.method === 'CASH').reduce((s, o) => s + o.total, 0);
  const studentCount = paidOrders.filter(o => o.customerType === 'STUDENT').length;
  const regularCount = paidOrders.filter(o => o.customerType !== 'STUDENT').length;

  const d = modal(`<div class="print-receipt-container">
    <div class="receipt-paper">
      <div class="receipt-header">
        <h2 style="font-size:18px;margin:0 0 4px 0;">CAFE CAMPUS</h2>
        <p style="font-size:12px;margin:0;color:#666;">REKAPITULASI PENJUALAN SHIFT KASIR</p>
        <p style="font-size:11px;margin:2px 0 0 0;color:#888;">${today}</p>
        <hr style="border:none;border-top:1px dashed #bbb;margin:12px 0;">
      </div>
      <div class="receipt-body">
        <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:6px;">
          <span>Total Pesanan Masuk:</span>
          <b>${allOrders.length} Pesanan</b>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:6px;">
          <span>Pesanan Lunas (PAID):</span>
          <b>${paidOrders.length} Pesanan</b>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:6px;color:#2c8b5b;">
          <span>• Transaksi Pelajar / Mahasiswa:</span>
          <b>${studentCount} Pesanan</b>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:6px;color:#6b4c38;">
          <span>• Transaksi Pelanggan Umum:</span>
          <b>${regularCount} Pesanan</b>
        </div>
        <hr style="border:none;border-top:1px dashed #bbb;margin:10px 0;">
        <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:6px;">
          <span>Penerimaan Tunai (Cash):</span>
          <b>${money(cashTotal)}</b>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:6px;">
          <span>Penerimaan QRIS:</span>
          <b>${money(qrisTotal)}</b>
        </div>
        <hr style="border:none;border-top:1px dashed #bbb;margin:10px 0;">
        <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:bold;margin:8px 0;">
          <span>TOTAL PENDAPATAN:</span>
          <strong style="color:var(--orange-dark);">${money(dashData.revenue || 0)}</strong>
        </div>
        <hr style="border:none;border-top:1px dashed #bbb;margin:12px 0;">
        <p style="text-align:center;font-size:11px;color:#888;margin:0;">Dicetak oleh Admin Campus • Sistem POS Cafe Campus</p>
      </div>
    </div>
  </div>
  <div class="modal-actions">
    <button class="btn btn-primary" id="btnDoPrintShift">🖨️ Cetak Rekap (Print)</button>
    <button class="btn btn-dark" id="btnCloseShiftPrint">Tutup</button>
  </div>`, 'dialog-card');

  $('#btnDoPrintShift', d).onclick = () => window.print();
  $('#btnCloseShiftPrint', d).onclick = () => d.remove();
}

function printReceiptModal(o) {
  const isStud = o.customerType === 'STUDENT';
  const d = modal(`<div class="print-receipt-container">
    <div class="receipt-paper">
      <div class="receipt-header">
        <h2 style="font-size:18px;margin:0 0 2px 0;">CAFE CAMPUS</h2>
        <p style="font-size:11px;margin:0;color:#666;">Gedung Utama Campus Hub</p>
        <p style="font-size:11px;margin:2px 0 0 0;color:#888;">Order #${esc(o.orderNumber)} • ${esc(o.tableName)}</p>
        <p style="font-size:10.5px;margin:2px 0 0 0;color:#888;">${formatTime(o.createdAt)} • Kasir: Admin</p>
        ${isStud ? `<div style="background:#eaf7ed;border-radius:4px;padding:4px 6px;margin:6px 0;font-size:11px;color:#1b633a;text-align:left;">
          <b>🎓 PESANAN PELAJAR / MAHASISWA</b><br>
          <span>${esc(o.studentInfo?.campus || 'Kampus')} (NIM: ${esc(o.studentInfo?.studentId || '-')})</span>
        </div>` : ''}
        <hr style="border:none;border-top:1px dashed #bbb;margin:10px 0;">
      </div>
      <div class="receipt-items">
        ${o.items.map(i => `
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px;">
            <div>
              <b>${i.quantity}x ${esc(i.productName)}</b>
              ${i.options?.size ? `<br><small style="color:#777;">(${esc(i.options.size)})</small>` : ''}
            </div>
            <strong>${money(i.lineTotal)}</strong>
          </div>
        `).join('')}
      </div>
      <hr style="border:none;border-top:1px dashed #bbb;margin:10px 0;">
      <div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:4px;">
        <span>Subtotal:</span>
        <b>${money(o.subtotal)}</b>
      </div>
      ${o.totalSavings ? `<div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:4px;color:#2c8b5b;">
        <span>Hemat Pelajar:</span>
        <b>- ${money(o.totalSavings)}</b>
      </div>` : ''}
      ${o.serviceFee ? `<div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:4px;">
        <span>Layanan:</span>
        <b>${money(o.serviceFee)}</b>
      </div>`: ''}
      ${o.tax ? `<div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:4px;">
        <span>Pajak (11%):</span>
        <b>${money(o.tax)}</b>
      </div>`: ''}
      <hr style="border:none;border-top:1px dashed #bbb;margin:8px 0;">
      <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:bold;margin:6px 0;">
        <span>TOTAL:</span>
        <strong>${money(o.total)}</strong>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:4px;color:#555;">
        <span>Pembayaran:</span>
        <b>${o.payment.method === 'QRIS_DEMO' ? 'QRIS DEMO' : 'TUNAI KASIR'} (${o.payment.status === 'PAID' ? 'LUNAS' : 'BELUM LUNAS'})</b>
      </div>
      <hr style="border:none;border-top:1px dashed #bbb;margin:12px 0;">
      <p style="text-align:center;font-size:11px;color:#777;margin:0;">Terima Kasih Atas Kunjungan Anda! ☕</p>
    </div>
  </div>
  <div class="modal-actions">
    <button class="btn btn-primary" id="btnDoPrintReceipt">🖨️ Cetak Struk (Print)</button>
    <button class="btn btn-dark" id="btnCloseReceiptPrint">Tutup</button>
  </div>`, 'dialog-card');

  $('#btnDoPrintReceipt', d).onclick = () => window.print();
  $('#btnCloseReceiptPrint', d).onclick = () => d.remove();
}

async function ordersPage(user) {
  let status = '', payment = '', customerType = '', q = '', date = todayISO();

  const renderTableOnly = async () => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (payment) params.set('payment', payment);
    if (customerType) params.set('customerType', customerType);
    if (q) params.set('q', q);
    if (date) params.set('date', date);
    const list = await api('/admin/orders?' + params.toString());
    const panel = $('#ordersTablePanel');
    if (panel) {
      panel.innerHTML = orderTable(list);
      bindOrderTableActions(renderTableOnly);
      $$('[data-status]').forEach(b => b.classList.toggle('active', b.dataset.status === status));
    }
  };

  const initialLoad = async () => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (payment) params.set('payment', payment);
    if (customerType) params.set('customerType', customerType);
    if (q) params.set('q', q);
    if (date) params.set('date', date);
    const list = await api('/admin/orders?' + params.toString());

    document.body.className = 'admin-body';
    document.body.innerHTML = adminShell(`${adminTop('Daftar Semua Pesanan', 'Kelola antrean pesanan masuk, konfirmasi kasir, dan status barista.')}
      <div class="order-tabs" id="orderTabsContainer">
        ${[['', 'Semua'], ['NEW', 'Pesanan Baru'], ['PROCESSING', 'Diproses'], ['READY', 'Siap Diambil'], ['COMPLETED', 'Selesai']].map(([k, l]) => `<button class="${status === k ? 'active' : ''}" data-status="${k}">${l}</button>`).join('')}
      </div>
      <div class="admin-filters">
        <label>${icon('search', 18)}<input id="filterQ" placeholder="Cari No. Order / Meja / Mahasiswa / Menu..." value="${esc(q)}"></label>
        <select id="filterRole">
          <option value="">Semua Tipe Pelanggan</option>
          <option value="REGULAR" ${customerType === 'REGULAR' ? 'selected' : ''}>☕ Pelanggan Umum</option>
          <option value="STUDENT" ${customerType === 'STUDENT' ? 'selected' : ''}>🎓 Pelajar / Mahasiswa</option>
        </select>
        <select id="filterPay">
          <option value="">Semua Pembayaran</option>
          <option value="PAID" ${payment === 'PAID' ? 'selected' : ''}>Lunas</option>
          <option value="PENDING" ${payment === 'PENDING' ? 'selected' : ''}>Belum Bayar</option>
        </select>
        <input type="date" id="filterDate" value="${date}">
      </div>
      <section class="admin-panel" id="ordersTablePanel">${orderTable(list)}</section>`, 'orders', user);

    bindAdminChrome('orders');
    bindOrderTableActions(renderTableOnly);
    $$('[data-status]').forEach(b => b.onclick = () => { status = b.dataset.status; renderTableOnly() });
    $('#filterRole').onchange = e => { customerType = e.target.value; renderTableOnly() };
    $('#filterPay').onchange = e => { payment = e.target.value; renderTableOnly() };
    $('#filterDate').onchange = e => { date = e.target.value; renderTableOnly() };
    const s = $('#filterQ');
    if (s) s.oninput = e => { q = e.target.value; clearTimeout(s._t); s._t = setTimeout(renderTableOnly, 150) };
  };

  await initialLoad();
  setupAdminRealtime(renderTableOnly);
}

function orderTable(orders, compact = false) {
  if (!orders.length) return '<div class="admin-empty"><p>Tidak ada data pesanan pada filter ini.</p></div>';
  return `<div class="responsive-table">
    <table class="admin-table">
      <thead>
        <tr>
          <th style="width: 105px;">No. Pesanan</th>
          <th style="width: 85px;">Meja</th>
          <th style="width: 110px;">Tipe</th>
          <th>Rincian Item</th>
          <th style="width: 115px;">Total</th>
          <th style="width: 140px;">Pembayaran</th>
          <th style="width: 130px;">Status</th>
          <th style="width: 75px;">Waktu</th>
          <th style="width: 75px; text-align: right;">Aksi</th>
        </tr>
      </thead>
      <tbody>
        ${orders.map(o => `<tr>
          <td data-label="No. Pesanan"><span class="order-num-tag">#${esc(o.orderNumber)}</span></td>
          <td data-label="Meja"><span class="table-name-tag">${esc(o.tableName)}</span></td>
          <td data-label="Tipe">${o.customerType === 'STUDENT' ? `<span class="badge-role-student" title="${esc(o.studentInfo?.campus || '')} (NIM: ${esc(o.studentInfo?.studentId || '-')})">🎓 Pelajar</span>` : `<span class="badge-role-regular">☕ Umum</span>`}</td>
          <td data-label="Rincian Item">
            <div class="items-cell" title="${esc(o.items.map(i => `${i.quantity}x ${i.productName}`).join(', '))}">
              ${o.items.map(i => `<span class="item-chip"><b>${i.quantity}x</b> ${esc(i.productName)}</span>`).join('')}
            </div>
          </td>
          <td data-label="Total"><span class="order-total-val">${money(o.total)}</span></td>
          <td data-label="Pembayaran">${paymentBadge(o)}</td>
          <td data-label="Status">${statusBadge(o.status)}</td>
          <td data-label="Waktu"><span class="order-time-tag">${formatTime(o.createdAt)}</span></td>
          <td data-label="Aksi" style="text-align: right;">
            <button class="btn btn-small btn-soft" data-view-order="${esc(o.orderNumber)}">Detail</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>`;
}

async function viewStudentPhotoModal(orderNumber, onUpdate) {
  const orders = await api('/admin/orders?q=' + encodeURIComponent(orderNumber));
  const o = orders.find(x => x.orderNumber === orderNumber);
  if (!o || !o.studentInfo) return toast('Data verifikasi pelajar tidak ditemukan.', true);

  const info = o.studentInfo;
  const photo = info.studentPhoto || '/assets/hero-desktop.jpg';
  const isAuto = info.verificationStatus === 'AUTOMATICALLY_VERIFIED';
  const isVerified = info.verificationStatus === 'VERIFIED' || isAuto;
  const isRejected = info.verificationStatus === 'REJECTED';

  const riskClass = info.fraudRisk === 'HIGH' ? 'high' : (info.fraudRisk === 'MEDIUM' ? 'medium' : 'low');
  const riskLabel = info.fraudRisk === 'HIGH' ? '🔴 Risiko Tinggi' : (info.fraudRisk === 'MEDIUM' ? '🟡 Risiko Sedang' : '🟢 Risiko Rendah (Aman)');

  const d = modal(`<div class="modal-heading">
    <div>
      <span>ENGINE ANTI-FRAUD & VERIFIKASI IDENTITAS PELAJAR</span>
      <h2>Pesanan #${esc(o.orderNumber)} (${esc(o.tableName)})</h2>
    </div>
    <div style="display:flex;align-items:center;gap:6px;">
      <span class="badge-fraud-score ${riskClass}">${riskLabel} • Skor: ${info.fraudScore || 0}%</span>
      ${isAuto ? '<span class="badge-verify-approved">🤖 Auto-Approved (AI)</span>' : (isVerified ? '<span class="badge-verify-approved">✅ Terverifikasi Sah</span>' : (isRejected ? '<span class="badge-verify-rejected">⚠️ Verifikasi Ditolak</span>' : '<span class="badge-verify-pending">⏳ Menunggu Verifikasi</span>'))}
    </div>
  </div>
  <div class="student-inspect-grid">
    <div class="student-inspect-photo-box">
      <img src="${esc(photo)}" alt="Foto Selfie bersama KTM" onerror="this.src='/assets/hero-desktop.jpg'">
    </div>
    <div class="student-inspect-details">
      <div class="inspect-detail-row">
        <span>Nama Pelajar / Mahasiswa</span>
        <strong>${esc(info.studentName || '-')}</strong>
      </div>
      <div class="inspect-detail-row">
        <span>Asal Kampus / Sekolah</span>
        <strong>${esc(info.campus || '-')}</strong>
      </div>
      <div class="inspect-detail-row">
        <span>Nomor Induk (NIM / NIS)</span>
        <strong>${esc(info.studentId || '-')}</strong>
      </div>
      <div class="inspect-detail-row">
        <span>Email Institusi Resmi</span>
        <strong>${esc(info.email || 'Tidak Dilampirkan')} ${info.email ? '✅' : ''}</strong>
      </div>
      <div class="inspect-detail-row">
        <span>Total Subsidi Potongan Harga</span>
        <strong style="color:#2c8b5b;">${money(o.totalSavings || 0)}</strong>
      </div>
      <div class="inspect-detail-row">
        <span>Total Tagihan Saat Ini</span>
        <strong>${money(o.total)}</strong>
      </div>
      ${info.rejectionReason ? `<div class="inspect-detail-row"><span style="color:#e03131;">Alasan Penolakan:</span><strong style="color:#c92a2a;">${esc(info.rejectionReason)}</strong></div>` : ''}
      <div class="student-verify-notice" style="margin-top:auto;">
        <span>🛡️</span>
        <div><b>Anti-Fraud AI Radar:</b> ${info.fraudFlags?.length ? info.fraudFlags.join(', ') : 'Format data sesuai standar institusi pendidikan.'}</div>
      </div>
    </div>
  </div>
  <div class="modal-actions" style="margin-top:16px;">
    ${!isVerified ? `<button class="btn btn-green" id="btnApproveStudent">✓ Sahkan Diskon Pelajar</button>` : ''}
    ${!isRejected ? `<button class="btn btn-danger" id="btnRejectStudent">✕ Tolak & Ubah ke Harga Normal</button>` : ''}
    <button class="btn-blacklist" id="btnBlacklistStudent">🚨 Blacklist Pelajar</button>
    <button class="btn btn-soft" id="btnCloseInspect">Tutup</button>
  </div>`, 'wide-modal');

  $('#btnCloseInspect', d).onclick = () => d.remove();

  const appBtn = $('#btnApproveStudent', d);
  if (appBtn) appBtn.onclick = async () => {
    appBtn.disabled = true;
    try {
      await api('/admin/orders/' + encodeURIComponent(o.orderNumber) + '/verify-student', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'VERIFIED' })
      });
      toast('✅ Verifikasi pelajar DISETUJUI. Diskon sah!');
      d.remove();
      onUpdate && onUpdate();
    } catch (e) {
      toast(e.message, true);
      appBtn.disabled = false;
    }
  };

  const rejBtn = $('#btnRejectStudent', d);
  if (rejBtn) rejBtn.onclick = async () => {
    const reason = prompt('Masukkan alasan penolakan verifikasi:', 'Foto selfie tidak jelas / kartu tidak valid') || 'Foto selfie tidak sesuai';
    rejBtn.disabled = true;
    try {
      await api('/admin/orders/' + encodeURIComponent(o.orderNumber) + '/verify-student', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'REJECTED', reason })
      });
      toast('⚠️ Verifikasi DITOLAK. Pesanan dialihkan ke harga reguler.');
      d.remove();
      onUpdate && onUpdate();
    } catch (e) {
      toast(e.message, true);
      rejBtn.disabled = false;
    }
  };

  const blBtn = $('#btnBlacklistStudent', d);
  if (blBtn) blBtn.onclick = async () => {
    if (!confirm(`Apakah Anda yakin ingin memasukkan NIM ${info.studentId} (${info.studentName}) ke daftar BLACKLIST? Akun ini tidak akan dapat memesan dengan harga pelajar lagi.`)) return;
    blBtn.disabled = true;
    try {
      await api('/admin/fraud/blacklist', {
        method: 'POST',
        body: JSON.stringify({
          studentId: info.studentId,
          email: info.email || '',
          studentName: info.studentName,
          reason: 'Kecurangan verifikasi identitas pelajar'
        })
      });
      await api('/admin/orders/' + encodeURIComponent(o.orderNumber) + '/verify-student', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'REJECTED', reason: 'Identitas masuk Daftar Hitam (Blacklist)' })
      });
      toast('🚨 Identitas berhasil dimasukkan ke BLACKLIST.');
      d.remove();
      onUpdate && onUpdate();
    } catch (e) {
      toast(e.message, true);
      blBtn.disabled = false;
    }
  };
}

async function orderDetailModal(orderNumber, onUpdate) {
  const orders = await api('/admin/orders?q=' + encodeURIComponent(orderNumber));
  const o = orders.find(x => x.orderNumber === orderNumber);
  if (!o) return toast('Pesanan tidak ditemukan.', true);

  const isStud = o.customerType === 'STUDENT';
  const vStatus = o.studentInfo?.verificationStatus;

  const d = modal(`<div class="modal-heading">
    <div><span>DETAIL PESANAN</span><h2>#${esc(o.orderNumber)} (${esc(o.tableName)})</h2></div>
    <div style="display:flex;align-items:center;gap:8px;">
      <button class="btn btn-small btn-soft" id="btnPrintReceiptModal">🖨️ Cetak Struk</button>
      ${statusBadge(o.status)}
    </div>
  </div>
  <div class="order-detail-grid">
    <div>
      <div class="detail-meta">
        <div><span>WAKTU PESAN</span><b>${formatTime(o.createdAt)}</b></div>
        <div><span>TIPE CUSTOMER</span><b>${isStud ? '🎓 Pelajar / Mahasiswa' : '☕ Pelanggan Umum'}</b></div>
        <div><span>METODE</span><b>${o.payment.method === 'QRIS_DEMO' ? 'QRIS' : 'Tunai di Kasir'}</b></div>
        <div><span>STATUS BAYAR</span><b>${o.payment.status === 'PAID' ? 'Lunas' : 'Belum Bayar'}</b></div>
      </div>

      ${o.studentInfo ? `<div class="student-form-card" style="margin-bottom:14px;padding:12px 16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <h4 style="margin:0;color:#1b633a;font-size:13px;display:flex;align-items:center;gap:5px;">🎓 Verifikasi Pelajar & Anti-Fraud</h4>
          <div style="display:flex;align-items:center;gap:6px;">
            <span class="badge-fraud-score ${o.studentInfo.fraudRisk === 'HIGH' ? 'high' : (o.studentInfo.fraudRisk === 'MEDIUM' ? 'medium' : 'low')}">${o.studentInfo.fraudRisk === 'HIGH' ? '🔴 Risiko Tinggi' : (o.studentInfo.fraudRisk === 'MEDIUM' ? '🟡 Risiko Sedang' : '🟢 Aman')} • ${o.studentInfo.fraudScore || 0}%</span>
            ${vStatus === 'AUTOMATICALLY_VERIFIED' ? '<span class="badge-verify-approved">🤖 AI Sah</span>' : (vStatus === 'VERIFIED' ? '<span class="badge-verify-approved">✅ Sah</span>' : (vStatus === 'REJECTED' ? '<span class="badge-verify-rejected">⚠️ Ditolak</span>' : '<span class="badge-verify-pending">⏳ Cek KTM</span>'))}
            ${o.totalSavings ? `<span class="badge-role-student">Hemat ${money(o.totalSavings)}</span>` : ''}
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;margin-bottom:10px;">
          <div><span style="color:#666;">Nama Mahasiswa:</span> <b style="display:block;">${esc(o.studentInfo?.studentName || '-')}</b></div>
          <div><span style="color:#666;">Asal Kampus / Sekolah:</span> <b style="display:block;">${esc(o.studentInfo?.campus || '-')}</b></div>
          <div><span style="color:#666;">NIM / NIS:</span> <b style="display:inline-block;">${esc(o.studentInfo?.studentId || '-')}</b></div>
          <div><span style="color:#666;">Email Institusi:</span> <b style="display:inline-block;">${esc(o.studentInfo?.email || '-')}</b></div>
          ${o.studentInfo?.rejectionReason ? `<div style="grid-column:1/-1;"><span style="color:#e03131;">Alasan Tolak:</span> <b style="color:#c92a2a;display:inline-block;">${esc(o.studentInfo.rejectionReason)}</b></div>` : ''}
        </div>
        <button type="button" class="btn btn-soft btn-small btn-wide" id="btnInspectDetailPhoto">🔍 Lihat Foto Selfie bersama KTM & Radar AI</button>
      </div>` : ''}

      <div class="admin-items-box">
        ${o.items.map(i => `<div class="admin-order-item">
          <img src="${esc(i.imageUrl || '/assets/iced-latte.jpg')}" alt="">
          <div>
            <b>${i.quantity}x ${esc(i.productName)}</b>
            <span>${esc(optionSummary(i))}</span>
            ${i.note ? `<small>Catatan: ${esc(i.note)}</small>` : ''}
            ${i.savings ? `<small style="color:#2c8b5b;display:block;font-weight:700;">Hemat Kampus: ${money(i.savings)}</small>` : ''}
          </div>
          <strong>${money(i.lineTotal)}</strong>
        </div>`).join('')}
      </div>
      <div class="detail-bill">
        <div><span>Subtotal</span><b>${money(o.subtotal)}</b></div>
        ${o.totalSavings ? `<div style="color:#2c8b5b;"><span>Total Subsidi Pelajar</span><b>- ${money(o.totalSavings)}</b></div>` : ''}
        ${o.serviceFee ? `<div><span>Biaya Layanan</span><b>${money(o.serviceFee)}</b></div>` : ''}
        ${o.tax ? `<div><span>Pajak</span><b>${money(o.tax)}</b></div>` : ''}
        <div><span>Total</span><strong>${money(o.total)}</strong></div>
      </div>
    </div>
    <div class="detail-side">
      <h3>Riwayat Status</h3>
      <div class="history-list">
        ${o.history.map(h => `<div><i></i><div><b>${esc(h.label || h.status)}</b><small>${formatTime(h.at)}</small></div></div>`).join('')}
      </div>
    </div>
  </div>
  <div class="modal-actions">
    ${o.payment.status === 'PENDING' && o.payment.method === 'CASH' ? `<button class="btn btn-green" id="confirmCash">Konfirmasi Kasir (Lunas)</button>` : ''}
    ${o.status === 'NEW' && o.payment.status === 'PAID' ? `<button class="btn btn-blue" id="toProcess">Mulai Proses Barista</button>` : ''}
    ${o.status === 'PROCESSING' ? `<button class="btn btn-primary" id="toReady">🔔 Pesanan Siap Diambil</button>` : ''}
    ${o.status === 'READY' ? `<button class="btn btn-dark" id="toComplete">Pesanan Selesai (Diambil)</button>` : ''}
    ${o.status === 'NEW' && o.payment.status === 'PENDING' ? `<button class="btn btn-danger" id="toCancel">Batalkan Pesanan</button>` : ''}
  </div>`, 'wide-modal');

  $('#btnPrintReceiptModal', d).onclick = () => printReceiptModal(o);
  const inspectBtn = $('#btnInspectDetailPhoto', d);
  if (inspectBtn) inspectBtn.onclick = () => {
    d.remove();
    viewStudentPhotoModal(o.orderNumber, onUpdate);
  };

  const cash = $('#confirmCash', d);
  if (cash) cash.onclick = async () => {
    cash.disabled = true;
    try {
      await api('/admin/orders/' + encodeURIComponent(o.orderNumber) + '/payment', { method: 'PATCH', body: '{}' });
      toast('Pembayaran kasir dikonfirmasi LUNAS');
      d.remove();
      onUpdate();
    } catch (e) { toast(e.message, true); cash.disabled = false; }
  };

  const toProc = $('#toProcess', d);
  if (toProc) toProc.onclick = async () => {
    try {
      await api('/admin/orders/' + encodeURIComponent(o.orderNumber) + '/status', { method: 'PATCH', body: JSON.stringify({ status: 'PROCESSING' }) });
      toast('Status diubah ke SEDANG DIPROSES');
      d.remove();
      onUpdate();
    } catch (e) { toast(e.message, true); }
  };

  const toRdy = $('#toReady', d);
  if (toRdy) toRdy.onclick = async () => {
    try {
      await api('/admin/orders/' + encodeURIComponent(o.orderNumber) + '/status', { method: 'PATCH', body: JSON.stringify({ status: 'READY' }) });
      toast('Pesanan dinyatakan SIAP! Notifikasi terkirim ke customer.');
      d.remove();
      onUpdate();
    } catch (e) { toast(e.message, true); }
  };

  const toComp = $('#toComplete', d);
  if (toComp) toComp.onclick = async () => {
    try {
      await api('/admin/orders/' + encodeURIComponent(o.orderNumber) + '/status', { method: 'PATCH', body: JSON.stringify({ status: 'COMPLETED' }) });
      toast('Pesanan SELESAI');
      d.remove();
      onUpdate();
    } catch (e) { toast(e.message, true); }
  };

  const toCanc = $('#toCancel', d);
  if (toCanc) toCanc.onclick = async () => {
    if (!(await confirmDialog({ title: 'Batalkan Pesanan?', message: 'Pesanan yang belum dibayar ini akan dibatalkan.', danger: true, ok: 'Batalkan' }))) return;
    try {
      await api('/admin/orders/' + encodeURIComponent(o.orderNumber) + '/status', { method: 'PATCH', body: JSON.stringify({ status: 'CANCELLED' }) });
      toast('Pesanan dibatalkan');
      d.remove();
      onUpdate();
    } catch (e) { toast(e.message, true); }
  };
}

async function menuAdminPage(user) {
  const [products, cats] = await Promise.all([api('/admin/products'), api('/admin/categories')]);
  let query = '', catId = '';
  const renderList = () => {
    const filtered = products.filter(p => (!catId || p.categoryId === catId) && (!query || p.name.toLowerCase().includes(query.toLowerCase())));
    document.body.className = 'admin-body';
    document.body.innerHTML = adminShell(`${adminTop('Kelola Menu Cafe', 'Atur ketersediaan menu, harga reguler vs pelajar, dan kustomisasi minuman.', `<button class="btn btn-primary" id="addProd">${icon('plus', 16)} Tambah Menu</button>`)}
      <div class="admin-filters menu-filters">
        <label>${icon('search', 18)}<input id="searchMenu" placeholder="Cari nama menu..." value="${esc(query)}"></label>
        <select id="filterMenuCat">
          <option value="">Semua Kategori</option>
          ${cats.map(c => `<option value="${c.id}" ${catId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
      </div>
      <section class="admin-panel">
        <div class="menu-table-head"><span>Menu</span><span>Kategori</span><span>Harga Umum / Pelajar</span><span>Tersedia</span><span style="text-align:right">Aksi</span></div>
        <div class="admin-menu-list">
          ${filtered.map(p => `<article class="admin-menu-row">
            <div class="admin-menu-product">
              <img src="${esc(p.imageUrl || '/assets/iced-latte.jpg')}" alt="">
              <div><b>${esc(p.name)}</b><small>${esc(p.description)}</small></div>
            </div>
            <span>${esc(cats.find(c => c.id === p.categoryId)?.name || 'Kopi')}</span>
            <div>
              <strong>${money(p.price)}</strong>
              ${p.studentPrice ? `<div style="font-size:11.5px;color:#1b633a;font-weight:700;">🎓 ${money(p.studentPrice)}</div>` : ''}
            </div>
            <div class="switch-row">
              <button class="switch ${p.isAvailable ? 'on' : ''}" data-toggle-avail="${p.id}"><i></i></button>
              <span>${p.isAvailable ? 'Tersedia' : 'Habis'}</span>
            </div>
            <div class="row-actions">
              <button class="icon-btn" data-edit-prod="${p.id}" title="Edit Menu">${icon('edit', 16)}</button>
            </div>
          </article>`).join('')}
        </div>
      </section>`, 'menu', user);

    bindAdminChrome('menu');
    $('#addProd').onclick = () => productFormModal(null, cats, () => menuAdminPage(user));
    $$('[data-edit-prod]').forEach(b => b.onclick = () => productFormModal(products.find(p => p.id === b.dataset.editProd), cats, () => menuAdminPage(user)));
    $$('[data-toggle-avail]').forEach(b => b.onclick = async () => {
      const p = products.find(x => x.id === b.dataset.toggleAvail);
      if (!p) return;
      const next = !p.isAvailable;
      await api('/admin/products/' + p.id, { method: 'PATCH', body: JSON.stringify({ isAvailable: next }) });
      p.isAvailable = next;
      toast(`Status ${p.name} diubah ke ${next ? 'Tersedia' : 'Habis'}`);
      renderList();
    });
    const sm = $('#searchMenu');
    if (sm) sm.oninput = e => { query = e.target.value; clearTimeout(sm._t); sm._t = setTimeout(renderList, 180) };
    $('#filterMenuCat').onchange = e => { catId = e.target.value; renderList() };
  };
  renderList();
}

function productFormModal(p, cats, onDone) {
  const d = modal(`<div class="dialog wide-dialog">
    <h3>${p ? 'Edit Menu' : 'Tambah Menu Baru'}</h3>
    <form id="prodForm" class="form-grid">
      <label>Nama Menu
        <input class="input" id="pName" value="${esc(p?.name || '')}" required placeholder="Contoh: Iced Caramel Macchiato">
      </label>
      <label>Kategori
        <select class="input" id="pCat">
          ${cats.filter(c => c.active).map(c => `<option value="${c.id}" ${p?.categoryId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
      </label>
      <label>Harga Reguler (Rp)
        <input class="input" id="pPrice" type="number" value="${p?.price || 28000}" required min="1000">
      </label>
      <label>Harga Pelajar / Mahasiswa (Rp)
        <input class="input" id="pStudentPrice" type="number" value="${p?.studentPrice ?? (p ? p.price : 22000)}" required min="1000">
        <small style="color:var(--muted);font-size:11px;">Harga khusus diskon pelajar.</small>
      </label>
      <label class="full">Status Ketersediaan
        <select class="input" id="pAvail">
          <option value="true" ${p?.isAvailable !== false ? 'selected' : ''}>Tersedia</option>
          <option value="false" ${p?.isAvailable === false ? 'selected' : ''}>Habis (Sold Out)</option>
        </select>
      </label>
      <label class="full">Deskripsi Singkat
        <textarea class="textarea" id="pDesc" placeholder="Jelaskan aroma, rasa, atau bahan utama...">${esc(p?.description || '')}</textarea>
      </label>
      <div class="dialog-actions full">
        <button type="button" class="btn btn-soft" data-modal-close>Batal</button>
        <button class="btn btn-primary" id="saveProd">Simpan Menu</button>
      </div>
    </form>
  </div>`, 'wide-modal');

  $('#prodForm', d).onsubmit = async e => {
    e.preventDefault();
    const btn = $('#saveProd', d);
    btn.disabled = true;
    try {
      const payload = {
        name: $('#pName', d).value,
        categoryId: $('#pCat', d).value,
        price: +$('#pPrice', d).value,
        studentPrice: +$('#pStudentPrice', d).value,
        isAvailable: $('#pAvail', d).value === 'true',
        description: $('#pDesc', d).value
      };
      if (p) {
        await api('/admin/products/' + p.id, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        await api('/admin/products', { method: 'POST', body: JSON.stringify(payload) });
      }
      d.remove();
      toast('Menu berhasil disimpan');
      onDone();
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
    }
  };
}

async function categoriesPage(user) {
  const cats = await api('/admin/categories');
  document.body.className = 'admin-body';
  document.body.innerHTML = adminShell(`${adminTop('Kelola Kategori', 'Atur grup menu agar mudah ditemukan customer.', `<button class="btn btn-primary" id="addCat">${icon('plus', 16)} Tambah Kategori</button>`)}
    <section class="admin-panel">
      <div class="category-list">
        ${cats.map(c => `<div class="category-row ${!c.active ? 'archived' : ''}">
          <span class="category-grab">${icon('categories', 18)}</span>
          <div><b>${esc(c.name)}</b><small class="muted">${c.active ? 'Aktif' : 'Diarsipkan'}</small></div>
          <div class="row-actions">
            <button class="btn btn-small btn-soft" data-edit-cat="${c.id}">Edit</button>
          </div>
        </div>`).join('')}
      </div>
    </section>`, 'categories', user);

  bindAdminChrome('categories');
  $('#addCat').onclick = () => categoryModal(null, () => categoriesPage(user));
  $$('[data-edit-cat]').forEach(b => b.onclick = () => categoryModal(cats.find(c => c.id === b.dataset.editCat), () => categoriesPage(user)));
}

function categoryModal(c, onDone) {
  const d = modal(`<div class="dialog">
    <h3>${c ? 'Edit' : 'Tambah'} Kategori</h3>
    <label class="field-label">Nama Kategori</label>
    <input class="input" id="catName" value="${esc(c?.name || '')}" placeholder="Contoh: Seasonal Special">
    ${c ? `<label class="switch-setting"><span><b>Status Aktif</b><small>Nonaktifkan jika tidak ingin ditampilkan di menu.</small></span><button type="button" class="switch ${c.active ? 'on' : ''}" id="catActive"><i></i></button></label>` : ''}
    <div class="dialog-actions">
      <button class="btn btn-soft" data-modal-close>Batal</button>
      <button class="btn btn-primary" id="saveCat">Simpan</button>
    </div>
  </div>`, 'dialog-card');
  let active = c?.active ?? true;
  const sw = $('#catActive', d);
  if (sw) sw.onclick = () => { active = !active; sw.classList.toggle('on', active) };
  $('#saveCat', d).onclick = async () => {
    try {
      const name = $('#catName', d).value.trim();
      if (!name) return toast('Nama kategori wajib diisi.', true);
      if (c) await api('/admin/categories/' + c.id, { method: 'PATCH', body: JSON.stringify({ name, active }) });
      else await api('/admin/categories', { method: 'POST', body: JSON.stringify({ name }) });
      d.remove();
      toast('Kategori disimpan');
      onDone();
    } catch (e) {
      toast(e.message, true);
    }
  };
}

async function tablesPage(user) {
  const tables = await api('/admin/tables');
  document.body.className = 'admin-body';
  document.body.innerHTML = adminShell(`${adminTop('Meja & QR Code', 'Kelola QR unik untuk setiap meja Cafe Campus.', `<button class="btn btn-primary" id="addTable">${icon('plus', 16)} Tambah Meja</button>`)}
    <div class="table-summary">
      <span>Total: <b>${tables.length} Meja</b></span>
      <span>Tersedia: <b>${tables.filter(t => t.active).length}</b></span>
    </div>
    <section class="qr-grid">
      ${tables.map(t => `<article class="qr-table-card ${!t.active ? 'disabled' : ''}">
        <div class="qr-card-head"><b>${esc(t.name)}</b><span><i></i>${t.active ? 'Tersedia' : 'Nonaktif'}</span></div>
        <img src="/qr/${encodeURIComponent(t.publicToken)}.svg" alt="QR ${esc(t.name)}">
        <div class="qr-card-actions">
          <button data-open="${esc(t.publicToken)}" title="Buka customer">${icon('eye', 17)}</button>
          <a href="/qr/${encodeURIComponent(t.publicToken)}.svg" download="Cafe-Campus-${esc(t.name)}-QR.svg" title="Download">${icon('download', 17)}</a>
          <button data-rotate="${t.id}" title="Rotate QR">${icon('rotate', 17)}</button>
          <button data-edit-table="${t.id}" title="Edit">${icon('edit', 17)}</button>
        </div>
      </article>`).join('')}
    </section>`, 'tables', user);
  bindAdminChrome('tables');
  $('#addTable').onclick = () => tableModal(null, () => tablesPage(user));
  $$('[data-edit-table]').forEach(b => b.onclick = () => tableModal(tables.find(t => t.id === b.dataset.editTable), () => tablesPage(user)));
  $$('[data-open]').forEach(b => b.onclick = () => window.open('/order/' + encodeURIComponent(b.dataset.open), '_blank'));
  $$('[data-rotate]').forEach(b => b.onclick = async () => {
    if (!(await confirmDialog({ title: 'Buat QR Baru?', message: 'QR lama langsung tidak berlaku setelah token dirotasi.', ok: 'Rotate QR' }))) return;
    await api('/admin/tables/' + b.dataset.rotate, { method: 'PATCH', body: JSON.stringify({ rotateToken: true }) });
    toast('QR baru berhasil dibuat');
    tablesPage(user);
  });
}

function tableModal(t, onDone) {
  const d = modal(`<div class="dialog">
    <h3>${t ? 'Edit' : 'Tambah'} Meja</h3>
    <label class="field-label">Nomor Meja</label>
    <input class="input" id="tableNo" value="${esc(t?.tableNumber || '')}" placeholder="13">
    <label class="field-label">Nama Meja</label>
    <input class="input" id="tableName" value="${esc(t?.name || '')}" placeholder="Meja 13">
    ${t ? `<label class="switch-setting"><span><b>Status Meja</b><small>Customer hanya dapat scan QR meja aktif.</small></span><button type="button" class="switch ${t.active ? 'on' : ''}" id="tableActive"><i></i></button></label>` : ''}
    <div class="dialog-actions">
      <button class="btn btn-soft" data-modal-close>Batal</button>
      <button class="btn btn-primary" id="saveTable">Simpan</button>
    </div>
  </div>`, 'dialog-card');
  let active = t?.active ?? true;
  const sw = $('#tableActive', d);
  if (sw) sw.onclick = () => { active = !active; sw.classList.toggle('on', active) };
  $('#saveTable', d).onclick = async () => {
    try {
      const payload = { tableNumber: $('#tableNo', d).value, name: $('#tableName', d).value, active };
      if (t) await api('/admin/tables/' + t.id, { method: 'PATCH', body: JSON.stringify(payload) });
      else await api('/admin/tables', { method: 'POST', body: JSON.stringify(payload) });
      d.remove();
      toast('Data meja disimpan');
      onDone();
    } catch (e) {
      toast(e.message, true);
    }
  };
}

async function paymentsPage(user) {
  let method = '';
  const load = async () => {
    const orders = await api('/admin/orders');
    const paid = orders.filter(o => o.payment.status === 'PAID' && (!method || o.payment.method === method));
    const total = paid.reduce((s, o) => s + o.total, 0);
    const qris = paid.filter(o => o.payment.method === 'QRIS_DEMO').reduce((s, o) => s + o.total, 0);
    const cash = paid.filter(o => o.payment.method === 'CASH').reduce((s, o) => s + o.total, 0);
    document.body.className = 'admin-body';
    document.body.innerHTML = adminShell(`${adminTop('Laporan Pembayaran', 'Monitor penerimaan transaksi dari QRIS maupun tunai di kasir.')}
      <section class="payment-metrics">
        <div class="pay-metric"><span>Total Hari Ini</span><strong>${money(total)}</strong><i>${icon('wallet', 19)}</i></div>
        <div class="pay-metric blue"><span>Metode QRIS</span><strong>${money(qris)}</strong><i>QR</i></div>
        <div class="pay-metric green"><span>Bayar di Kasir</span><strong>${money(cash)}</strong><i>${icon('cash', 19)}</i></div>
      </section>
      <div class="payment-toolbar">
        <button class="date-filter">${icon('calendar', 16)} Hari Ini (${new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })})</button>
        <select id="payMethod">
          <option value="">Semua Metode</option>
          <option value="QRIS_DEMO" ${method === 'QRIS_DEMO' ? 'selected' : ''}>QRIS</option>
          <option value="CASH" ${method === 'CASH' ? 'selected' : ''}>Tunai</option>
        </select>
        <button class="btn btn-outline" id="csv">${icon('download', 16)} Unduh CSV</button>
      </div>
      <section class="admin-panel">${paymentTable(paid)}</section>`, 'payments', user);
    bindAdminChrome('payments');
    $('#payMethod').onchange = e => { method = e.target.value; load() };
    $('#csv').onclick = () => downloadPaymentsCSV(paid);
  };
  await load();
  setupAdminRealtime(load);
}

function paymentTable(orders) {
  if (!orders.length) return '<div class="admin-empty">Belum ada transaksi berhasil.</div>';
  return `<div class="responsive-table">
    <table class="admin-table payment-table">
      <thead><tr><th>No. Pesanan</th><th>Meja</th><th>Tipe</th><th>Metode</th><th>Jumlah Transaksi</th><th>Status</th><th>Waktu</th></tr></thead>
      <tbody>${orders.map(o => `<tr>
        <td data-label="Pesanan"><b>#${esc(o.orderNumber)}</b></td>
        <td data-label="Meja">${esc(o.tableName)}</td>
        <td data-label="Tipe">${o.customerType === 'STUDENT' ? `<span class="badge-role-student">🎓 Pelajar</span>` : `<span class="badge-role-regular">☕ Umum</span>`}</td>
        <td data-label="Metode">${o.payment.method === 'QRIS_DEMO' ? '<span class="payment-badge qris">QRIS</span>' : '<span class="payment-badge cash">Tunai</span>'}</td>
        <td data-label="Jumlah"><b>${money(o.total)}</b></td>
        <td data-label="Status"><span class="status-badge status-ready">Berhasil</span></td>
        <td data-label="Waktu">${formatTime(o.payment.paidAt || o.createdAt)}</td>
      </tr>`).join('')}</tbody>
    </table>
  </div>`;
}

function downloadPaymentsCSV(orders) {
  const rows = [['No Pesanan', 'Meja', 'Tipe', 'Kampus', 'NIM', 'Metode', 'Jumlah', 'Diskon Hemat', 'Status', 'Waktu'], ...orders.map(o => [o.orderNumber, o.tableName, o.customerType || 'REGULAR', o.studentInfo?.campus || '', o.studentInfo?.studentId || '', o.payment.method === 'QRIS_DEMO' ? 'QRIS' : 'Tunai', o.total, o.totalSavings || 0, 'Berhasil', o.payment.paidAt || o.createdAt])];
  const csv = rows.map(r => r.map(v => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'Cafe-Campus-Pembayaran.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

async function reportsPage(user) {
  let days = 7;
  const load = async () => {
    const r = await api('/admin/reports?days=' + days);
    const max = Math.max(1, ...r.byDay.map(x => x.total));
    document.body.className = 'admin-body';
    document.body.innerHTML = adminShell(`${adminTop('Analitik & Laporan', 'Pantau tren penjualan dan performa menu Cafe Campus.')}
      <div class="report-tabs">
        <button data-days="1" class="${days === 1 ? 'active' : ''}">Hari Ini</button>
        <button data-days="7" class="${days === 7 ? 'active' : ''}">Minggu Ini</button>
        <button data-days="30" class="${days === 30 ? 'active' : ''}">Bulan Ini</button>
      </div>
      <section class="report-metrics">
        <div><span>Total Pendapatan</span><strong>${money(r.revenue)}</strong></div>
        <div><span>Total Pesanan</span><strong>${r.orders} Pesanan</strong></div>
        <div><span>Rata-rata Order</span><strong>${money(r.averageOrder)}</strong></div>
      </section>
      <section class="report-role-split">
        <div class="report-role-card student-card">
          <span>🎓 Total Omzet Pelajar / Mahasiswa</span>
          <strong>${money(r.studentRevenue || 0)}</strong>
          <small>${r.studentOrders || 0} Transaksi • Subsidi/Hemat Diberikan: ${money(r.studentSavings || 0)}</small>
        </div>
        <div class="report-role-card">
          <span>☕ Total Omzet Pelanggan Umum</span>
          <strong>${money(r.regularRevenue || 0)}</strong>
          <small>${r.regularOrders || 0} Transaksi Pelanggan Umum</small>
        </div>
      </section>
      <section class="report-grid">
        <div class="admin-panel">
          <h2>Menu Terlaris</h2>
          ${r.best.length ? r.best.map((x, i) => `<div class="best-item"><span class="rank">${i + 1}</span><div><b>${esc(x.name)}</b><small>Terjual ${x.qty} porsi</small></div><strong>${x.qty}</strong></div>`).join('') : '<div class="admin-empty">Belum ada data.</div>'}
        </div>
        <div class="admin-panel">
          <div class="panel-head"><h2>Penjualan per Hari</h2></div>
          <div class="bar-chart">${(r.byDay.length ? r.byDay : [{ date: todayISO(), total: 0 }]).map(x => `<div class="bar-col"><span style="height:${Math.max(8, x.total / max * 150)}px"></span><small>${x.date.slice(5)}</small></div>`).join('')}</div>
        </div>
      </section>`, 'reports', user);
    bindAdminChrome('reports');
    $$('[data-days]').forEach(b => b.onclick = () => { days = +b.dataset.days; load() });
  };
  await load();
}

async function settingsPage(user) {
  const [s, audit] = await Promise.all([api('/admin/settings'), api('/admin/audit')]);
  let switches = { qrisEnabled: s.qrisEnabled !== false, cashEnabled: s.cashEnabled !== false, soundEnabled: s.soundEnabled !== false, dailyReportEnabled: s.dailyReportEnabled !== false };
  document.body.className = 'admin-body';
  document.body.innerHTML = adminShell(`${adminTop('Pengaturan Sistem', 'Kelola identitas cafe, metode pembayaran, notifikasi, dan akun demo.')}
    <section class="settings-grid">
      <div>
        <section class="admin-panel settings-panel">
          <h2>Profil Cafe</h2>
          ${[['cafeName', 'Nama Cafe', s.cafeName], ['cafeAddress', 'Alamat', s.cafeAddress || ''], ['cafePhone', 'No. Telepon', s.cafePhone || ''], ['operatingHours', 'Jam Operasional', s.operatingHours || '']].map(([id, l, v]) => `<label>${l}<input id="${id}" value="${esc(v)}"></label>`).join('')}
          <div class="two-fields">
            <label>Biaya Layanan (%)<input id="serviceFee" type="number" min="0" max="30" value="${s.serviceFee}"></label>
            <label>Pajak (%)<input id="taxPercent" type="number" min="0" max="30" value="${s.taxPercent}"></label>
          </div>
        </section>
        <section class="admin-panel settings-panel">
          <h2>Metode Pembayaran</h2>
          ${settingSwitch('qrisEnabled', 'Integrasi QRIS Otomatis', 'Mode demo memakai simulasi sandbox.', switches.qrisEnabled)}
          ${settingSwitch('cashEnabled', 'Bayar di Kasir (Tunai)', 'Pelanggan membayar langsung di meja kasir.', switches.cashEnabled)}
        </section>
      </div>
      <div>
        <section class="admin-panel settings-panel">
          <h2>Notifikasi & Suara</h2>
          ${settingSwitch('soundEnabled', 'Pesanan Masuk Baru', 'Mainkan notifikasi suara saat browser mengizinkan.', switches.soundEnabled)}
          ${settingSwitch('dailyReportEnabled', 'Laporan Penutupan Harian', 'Siapkan ringkasan operasional harian.', switches.dailyReportEnabled)}
        </section>
        <section class="admin-panel settings-panel">
          <h2>Keamanan & Akun</h2>
          <label>Email Akun<input value="admin@cafecampus.demo" disabled></label>
          <div class="setting-actions">
            <button class="btn btn-outline" id="passwordDemo">Ubah Password</button>
            <button class="btn btn-danger" id="logoutSettings">Keluar Sesi</button>
          </div>
        </section>
        <section class="admin-panel settings-panel demo-controls">
          <h2>Kontrol Demo</h2>
          <p>Reset mengembalikan menu, meja, sample order, reports, dan settings ke kondisi awal.</p>
          <button class="btn btn-outline" id="resetDemo">Reset Data Demo</button>
        </section>
      </div>
    </section>
    <section class="admin-panel audit-panel">
      <div class="panel-head"><h2>Audit Trail</h2><span>${audit.length} aktivitas terakhir</span></div>
      <div class="audit-list">${audit.slice(0, 12).map(a => `<div><span>${formatTime(a.at)}</span><b>${esc(a.action.replaceAll('_', ' '))}</b><small>${esc(JSON.stringify(a.meta || {}))}</small></div>`).join('') || '<div class="admin-empty">Belum ada aktivitas admin.</div>'}</div>
    </section>
    <div class="settings-save"><button class="btn btn-primary" id="saveSettings">Simpan Perubahan</button></div>`, 'settings', user);

  bindAdminChrome('settings');
  $$('[data-setting-switch]').forEach(b => b.onclick = () => {
    const k = b.dataset.settingSwitch;
    switches[k] = !switches[k];
    b.classList.toggle('on', switches[k]);
  });
  $('#saveSettings').onclick = async () => {
    try {
      await api('/admin/settings', {
        method: 'PATCH', body: JSON.stringify({
          cafeName: $('#cafeName').value,
          cafeAddress: $('#cafeAddress').value,
          cafePhone: $('#cafePhone').value,
          operatingHours: $('#operatingHours').value,
          serviceFee: +$('#serviceFee').value,
          taxPercent: +$('#taxPercent').value,
          ...switches
        })
      });
      toast('Pengaturan berhasil disimpan');
    } catch (e) {
      toast(e.message, true);
    }
  };
  $('#passwordDemo').onclick = () => toast('Password demo tetap admin123 agar mudah direview.');
  $('#logoutSettings').onclick = logoutAdmin;
  $('#resetDemo').onclick = async () => {
    if (!(await confirmDialog({ title: 'Reset Semua Data Demo?', message: 'Semua perubahan review akan dihapus dan dikembalikan ke data awal.', ok: 'Reset Demo', danger: true }))) return;
    await api('/admin/demo/reset', { method: 'POST', body: '{}' });
    clearCart();
    toast('Data demo berhasil di-reset');
    nav('/admin');
  };
}
function settingSwitch(key, title, desc, on) {
  return `<div class="setting-switch-row">
    <span><b>${esc(title)}</b><small>${esc(desc)}</small></span>
    <button type="button" class="switch ${on ? 'on' : ''}" data-setting-switch="${key}"><i></i></button>
  </div>`;
}

window.addEventListener('offline', () => toast('Koneksi internet terputus.', true));
window.addEventListener('online', () => toast('Koneksi kembali tersedia.'));
render();
