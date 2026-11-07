// Registrasi Service Worker & Helper Web Push Notifications
(async function initNotifications() {
  try {
    if ('serviceWorker' in navigator) {
      await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    }
  } catch (e) {
    console.warn('SW init error:', e);
  }
})();

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function registerPushSubscription(channel = 'customer', orderNumber = null) {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
    if (!('Notification' in window)) return null;
    
    // Minta izin jika masih default
    if (Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    if (Notification.permission !== 'granted') return null;

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const res = await api('/push/key');
      if (res && res.publicKey) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(res.publicKey)
        });
      }
    }

    if (sub) {
      await api('/push/subscribe', {
        method: 'POST',
        body: JSON.stringify({
          channel,
          orderNumber,
          subscription: sub.toJSON()
        })
      });
      return sub;
    }
  } catch (e) {
    console.warn('Push registration warning:', e.message);
  }
  return null;
}

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const money = n => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(n || 0));
const shortMoney = n => money(n).replace(/\s/g, ' ');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const formatTime = v => new Date(v).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace('.', ':');
const formatDate = v => new Date(v).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
const todayISO = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

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
      let val = Math.sin(2 * Math.PI * note.freq * t);
      if (note.harmonics) {
        val += 0.50 * Math.sin(2 * Math.PI * note.freq * 2 * t);
        val += 0.25 * Math.sin(2 * Math.PI * note.freq * 3 * t);
        val += 0.15 * Math.sin(2 * Math.PI * note.freq * 4 * t);
      }
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
      this.readyWavUri = synthesizeChime(22050, 1.4, [
        { freq: 880, start: 0.0, duration: 0.85, decay: 3.8, gain: 0.85, harmonics: true },
        { freq: 1108.73, start: 0.18, duration: 0.85, decay: 3.8, gain: 0.85, harmonics: true },
        { freq: 1318.51, start: 0.38, duration: 1.0, decay: 3.0, gain: 0.95, harmonics: true }
      ]);
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
    if (this.unlocked) return;
    this.unlocked = true;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!this.ctx && AudioContextClass) {
        this.ctx = new AudioContextClass();
      }
      if (this.ctx) {
        if (this.ctx.state === 'suspended') {
          this.ctx.resume().catch(() => {});
        }
        if (!this.compressor) {
          this.compressor = this.ctx.createDynamicsCompressor();
          this.compressor.threshold.setValueAtTime(-14, this.ctx.currentTime);
          this.compressor.knee.setValueAtTime(40, this.ctx.currentTime);
          this.compressor.ratio.setValueAtTime(12, this.ctx.currentTime);
          this.compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
          this.compressor.release.setValueAtTime(0.25, this.ctx.currentTime);
          this.compressor.connect(this.ctx.destination);
        }
        const buffer = this.ctx.createBuffer(1, 1, 22050);
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(this.compressor || this.ctx.destination);
        source.start(0);
      }

      // Unlock HTML5 Audio elements silently without audible sound
      if (this.readyAudio) {
        this.readyAudio.muted = true;
        const p1 = this.readyAudio.play();
        if (p1 && typeof p1.then === 'function') {
          p1.then(() => {
            this.readyAudio.pause();
            this.readyAudio.currentTime = 0;
            this.readyAudio.muted = false;
          }).catch(() => { this.readyAudio.muted = false; });
        } else {
          this.readyAudio.pause();
          this.readyAudio.currentTime = 0;
          this.readyAudio.muted = false;
        }
      }
      if (this.adminAudio) {
        this.adminAudio.muted = true;
        const p2 = this.adminAudio.play();
        if (p2 && typeof p2.then === 'function') {
          p2.then(() => {
            this.adminAudio.pause();
            this.adminAudio.currentTime = 0;
            this.adminAudio.muted = false;
          }).catch(() => { this.adminAudio.muted = false; });
        } else {
          this.adminAudio.pause();
          this.adminAudio.currentTime = 0;
          this.adminAudio.muted = false;
        }
      }
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
    try {
      if (this.readyAudio) {
        this.readyAudio.currentTime = 0;
        this.readyAudio.play().catch(() => { });
      }
    } catch { }
    this.playTone(880, 'sine', 0.28, 0.85, 0);
    this.playTone(1108.73, 'triangle', 0.32, 0.90, 0.16);
    this.playTone(1318.51, 'sine', 0.60, 0.95, 0.34);
  }

  playAdminChime() {
    try {
      if (this.adminAudio) {
        this.adminAudio.currentTime = 0;
        this.adminAudio.play().catch(() => { });
      }
    } catch { }
    this.playTone(987.77, 'sine', 0.24, 0.90, 0);
    this.playTone(1318.51, 'sine', 0.45, 0.95, 0.16);
    this.playTone(987.77, 'sine', 0.24, 0.90, 0.48);
    this.playTone(1318.51, 'sine', 0.45, 0.95, 0.64);
  }

  startAlarm(type = 'ready', durationSeconds = 20) {
    this.stopAlarm();
    this.unlock();
    this.isPlaying = true;

    const playChime = () => {
      if (!this.isPlaying) return;
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      if (type === 'admin') {
        this.playAdminChime();
      } else {
        this.playReadyChime();
      }
    };

    playChime();

    try {
      if ('vibrate' in navigator) {
        navigator.vibrate([800, 200, 800, 200, 1000, 250, 1000]);
        this.vibrateInterval = setInterval(() => {
          try { navigator.vibrate([800, 200, 800, 200, 1000, 250, 1000]); } catch { }
        }, 1800);
      }
    } catch { }

    this.interval = setInterval(playChime, 900);

    const ms = Math.max(5, durationSeconds) * 1000;
    this.timeout = setTimeout(() => {
      this.stopAlarm();
    }, ms);
  }

  startAlarm10s(type = 'ready') {
    this.startAlarm(type, 15);
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

['click', 'touchstart', 'touchend', 'pointerdown', 'keydown'].forEach(evt => {
  window.addEventListener(evt, () => alarm.unlock(), { passive: true });
});

function showAlarmBanner(title, subtitle, onDismiss, onViewDetail) {
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
        <small>${esc(subtitle || 'Alarm pesanan masuk berbunyi...')}</small>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-shrink:0;">
        ${onViewDetail ? `<button type="button" class="btn btn-small alarm-view-btn" style="background:#ffffff;color:#2a180e;font-weight:700;border:none;padding:7px 12px;border-radius:8px;font-size:12px;cursor:pointer;">Lihat Pesanan</button>` : ''}
        <button type="button" class="btn btn-small btn-primary alarm-dismiss-btn" style="cursor:pointer;">Matikan Suara</button>
      </div>
    </div>
  `;
  const viewBtn = banner.querySelector('.alarm-view-btn');
  if (viewBtn && onViewDetail) {
    viewBtn.onclick = () => {
      alarm.stopAlarm();
      banner.remove();
      onViewDetail();
    };
  }
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
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  academic: '<path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>',
  box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/>',
  chef: '<path d="M6 13.8a4 4 0 0 1 0-7.6 4 4 0 0 1 7.6-1.5 4 4 0 0 1 4.4 3.1 4 4 0 0 1 0 6M6 17h12a2 2 0 0 1 2 2v2H4v-2a2 2 0 0 1 2-2z"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'
};
function icon(name, size = 20, cls = '') { return `<svg class="icon ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.coffee}</svg>` }

function getAdminToken() {
  try { return sessionStorage.getItem('cc_admin_token') || localStorage.getItem('cc_admin_token') || ''; } catch { return ''; }
}
function setAdminToken(t) {
  try {
    if (t) { sessionStorage.setItem('cc_admin_token', t); localStorage.setItem('cc_admin_token', t); }
    else { sessionStorage.removeItem('cc_admin_token'); localStorage.removeItem('cc_admin_token'); }
  } catch {}
}

async function api(path, opt = {}) {
  try {
    const adminToken = getAdminToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(adminToken ? { 'Authorization': `Bearer ${adminToken}` } : {}),
      ...(opt.headers || {})
    };
    const r = await fetch('/api' + path, { ...opt, headers });
    let d = {}; try { d = await r.json() } catch { }
    if (!r.ok) {
      const err = new Error(d.message || d.error || 'Terjadi kendala. Silakan coba lagi.');
      err.data = d;
      err.status = r.status;
      throw err;
    }
    return d;
  } catch (e) {
    if (e instanceof TypeError) throw new Error('Koneksi ke server terputus.');
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
  if (w) { e.preventDefault(); wifiModal(); return; }
  const callBtn = e.target.closest('#topbarWaiterBtn');
  if (callBtn) { e.preventDefault(); const c = getCart(); callWaiterModal(c.tableToken, c.tableName); return; }
  const aiBtn = e.target.closest('#topbarAiBtn') || e.target.closest('#baristaAiLauncherBtn');
  if (aiBtn) { e.preventDefault(); alarm.unlock(); baristaAiModal(); return; }
  const a = e.target.closest('[data-nav]');
  if (a) { e.preventDefault(); alarm.unlock(); nav(a.getAttribute('href')); }
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
  } catch { return { tableToken: null, tableName: null, customerType: 'REGULAR', studentInfo: { campus: '', studentId: '', studentName: '' }, items: [] }; }
}
function setCart(c) { localStorage.setItem(cartKey, JSON.stringify(c)) }
function clearCart() { const c = getCart(); localStorage.setItem(cartKey, JSON.stringify({ tableToken: c.tableToken, tableName: c.tableName, customerType: c.customerType, studentInfo: c.studentInfo, items: [] })); }
function isStudent(c) { return Boolean(c && c.customerType === 'STUDENT'); }
function getProductEffectivePrice(p, isStudentMode = false) { if (isStudentMode && Number(p?.studentPrice) > 0) return Number(p.studentPrice); return Number(p?.price || 0); }
function cartTotal(c) { return (c.items || []).reduce((s, i) => s + Number(i.price || 0) * Number(i.quantity || 0), 0) }
function cartRegularTotal(c) { return (c.items || []).reduce((s, i) => s + Number(i.regularPrice || i.price || 0) * Number(i.quantity || 0), 0) }
function cartSavings(c) { return Math.max(0, cartRegularTotal(c) - cartTotal(c)) }
function cartCount(c) { return (c.items || []).reduce((s, i) => s + Number(i.quantity || 0), 0) }

function recalculateCartItems(c, allProducts = []) {
  if (!allProducts || !allProducts.length) return c;
  const isStud = isStudent(c);
  c.items.forEach(item => {
    const p = allProducts.find(x => x.id === item.productId);
    if (!p) {
      item.isAvailable = false;
      return;
    }
    item.isAvailable = p.isAvailable !== false;
    const base = getProductEffectivePrice(p, isStud);
    const regBase = p.price;
    const addSize = item.options?.size === 'Large' ? 5000 : 0;
    item.basePrice = base; item.regularBasePrice = regBase; item.price = base + addSize; item.regularPrice = regBase + addSize;
    item.savings = Math.max(0, item.regularPrice - item.price) * item.quantity;
  });
  return c;
}

function customerRoleSwitcher(c) {
  const addTo = getAddTo();
  if (addTo) return `<div class="customer-role-bar"><div class="student-hero-banner"><div class="student-hero-text"><span style="font-size:16px;">🔒</span><div>Tipe harga mengikuti pesanan utama (${addTo.customerType === 'STUDENT' ? '🎓 Pelajar' : '☕ Umum'}).</div></div></div></div>`;
  const isStud = isStudent(c);
  return `<div class="customer-role-bar">
    <div class="customer-role-switch">
      <button type="button" class="role-btn ${!isStud ? 'active' : ''}" data-set-role="REGULAR"><span>☕</span><span>Pelanggan Umum</span></button>
      <button type="button" class="role-btn ${isStud ? 'active student-active' : ''}" data-set-role="STUDENT"><span>🎓</span><span>Pelajar / Mahasiswa</span><span class="role-badge-tag">Hemat Kampus</span></button>
    </div>
    ${isStud ? `<div class="student-hero-banner"><div class="student-hero-text"><span style="font-size:16px;">🎓</span><div><b>Harga Khusus Mahasiswa & Pelajar Aktif!</b> Diskon otomatis diterapkan.</div></div></div>` : ''}
  </div>`;
}

function productImage(p, detail = false) { const src = p.imageData || p.imageUrl || (detail ? '/assets/iced-detail.jpg' : '/assets/iced-latte.jpg'); return `<img src="${esc(src)}" alt="${esc(p.name)}" loading="${detail ? 'eager' : 'lazy'}">`; }
function optionSummary(i) { const o = i.options || {}; return [o.size, o.sweetness, o.ice].filter(Boolean).join(', '); }
function itemKey(productId, options = {}, note = '') { return productId + '|' + JSON.stringify(options) + '|' + String(note || '') }

function addCartItem(p, { quantity = 1, note = '', options = {} } = {}) {
  alarm.unlock();
  const c = getCart(); const isStud = isStudent(c);
  const base = getProductEffectivePrice(p, isStud); const regBase = p.price;
  const addSize = options.size === 'Large' ? 5000 : 0;
  const unit = base + addSize; const regUnit = regBase + addSize;
  const key = itemKey(p.id, options, note);
  let x = c.items.find(i => itemKey(i.productId, i.options, i.note) === key);
  if (x) {
    if (x.quantity + quantity > 20) return toast('Maksimal 20 porsi untuk varian yang sama.', true);
    x.quantity += quantity; x.basePrice = base; x.regularBasePrice = regBase; x.price = unit; x.regularPrice = regUnit;
    x.savings = Math.max(0, regUnit - unit) * x.quantity;
  } else {
    c.items.push({ productId: p.id, name: p.name, basePrice: base, regularBasePrice: regBase, price: unit, regularPrice: regUnit, savings: Math.max(0, regUnit - unit) * quantity, quantity, note, options, imageUrl: p.imageUrl || p.imageData || null });
  }
  setCart(c); toast(`${p.name} masuk ke keranjang ${isStud ? '(Harga Pelajar 🎓)' : ''}`);
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
    if (Date.now() - (raw.at || 0) > 6 * 3600 * 1000) { localStorage.removeItem('cc_active_order'); return null; }
    if (raw.status === 'COMPLETED' || raw.status === 'CANCELLED') return null;
    return raw;
  } catch { return null; }
}

function updateActiveOrder(partial = {}) {
  try {
    const cur = getActiveOrder() || {};
    const updated = { ...cur, ...partial, at: Date.now() };
    if (updated.status === 'COMPLETED' || updated.status === 'CANCELLED') localStorage.removeItem('cc_active_order');
    else localStorage.setItem('cc_active_order', JSON.stringify(updated));
  } catch { }
}

// ---- Mode "Tambah Pesanan": pesanan baru ditautkan ke pesanan utama yang masih berjalan ----
function getAddTo() {
  try {
    const raw = JSON.parse(localStorage.getItem('cc_add_to') || 'null');
    if (!raw || !raw.orderNumber || !raw.accessToken) return null;
    if (Date.now() - (raw.at || 0) > 6 * 3600 * 1000) { localStorage.removeItem('cc_add_to'); return null; }
    return raw;
  } catch { return null; }
}
function setAddTo(v) { try { localStorage.setItem('cc_add_to', JSON.stringify({ ...v, at: Date.now() })); } catch { } }
function clearAddTo() { try { localStorage.removeItem('cc_add_to'); } catch { } }
function addToBanner() {
  const a = getAddTo(); if (!a) return '';
  return `<div class="addon-banner"><div><b>➕ Menambah ke pesanan #${esc(a.orderNumber)}</b><small>Meja & tipe harga mengikuti pesanan utama. Pembayaran tambahan dilakukan terpisah.</small></div><button type="button" class="btn btn-small btn-soft" id="cancelAddTo">Batal</button></div>`;
}

let cachedSettings = null;
async function fetchCachedSettings() {
  if (cachedSettings) return cachedSettings;
  try { cachedSettings = await api('/public/settings'); } 
  catch { cachedSettings = { cafeName: 'Cafe Campus', wifiSsid: 'CafeCampus_HighSpeed', wifiPass: 'kopikampus2026', operatingHours: 'Setiap Hari (08:00 - 23:00 WIB)', cafeAddress: 'Kawasan Kampus Terpadu, Jl. Mahasiswa No. 8', cafePhone: '+62 812-3456-7890' }; }
  return cachedSettings;
}

async function wifiModal() {
  const s = await fetchCachedSettings();
  const ssid = s.wifiSsid || 'CafeCampus_HighSpeed'; const pass = s.wifiPass || 'kopikampus2026';
  const d = modal(`<div class="dialog">
    <div class="dialog-icon" style="background:var(--orange-soft);color:var(--orange);">${icon('wifi', 26)}</div>
    <h3>Wi-Fi Cafe Campus ⚡</h3>
    <p>Koneksi internet super cepat 100 Mbps gratis untuk seluruh pengunjung.</p>
    <div class="wifi-info-box">
      <div class="wifi-field"><label>NAMA JARINGAN (SSID)</label><div class="wifi-val-row"><strong>${esc(ssid)}</strong><button type="button" class="btn-copy-chip" data-copy-val="${esc(ssid)}">Salin</button></div></div>
      <div class="wifi-field"><label>PASSWORD WI-FI</label><div class="wifi-val-row"><strong class="wifi-pass-display">${esc(pass)}</strong><button type="button" class="btn btn-primary btn-small" data-copy-val="${esc(pass)}">Salin Password</button></div></div>
    </div>
    <div class="dialog-actions" style="margin-top:16px;"><button class="btn btn-dark btn-full" data-modal-close>Tutup</button></div>
  </div>`, 'dialog-card');
  $$('[data-copy-val]', d).forEach(b => { b.onclick = () => { try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(b.dataset.copyVal); } catch { } toast('✓ Berhasil disalin'); }; });
}

function callWaiterModal(tableToken = '', tableName = '') {
  const d = modal(`<div class="dialog">
    <div class="dialog-icon">${icon('bell', 24)}</div>
    <h3>Panggil Pelayan / Bantuan</h3>
    <div class="waiter-grid">
      <button type="button" class="waiter-chip active" data-waiter-reason="Minta Tisu & Sendok">🧻 Tisu & Sendok</button>
      <button type="button" class="waiter-chip" data-waiter-reason="Tambah Air Putih">💧 Air Putih</button>
      <button type="button" class="waiter-chip" data-waiter-reason="Minta Bill / Struk Cetak">🧾 Bill / Struk</button>
      <button type="button" class="waiter-chip" data-waiter-reason="Bersihkan Meja">✨ Bersihkan Meja</button>
    </div>
    <div style="margin-top:12px;"><input type="text" id="waiterNote" class="form-input" placeholder="Pesan tambahan jika ada (opsional)..." maxlength="100" style="width:100%;font-size:13px;padding:10px 14px;border-radius:10px;border:1px solid var(--line);background:var(--bg);"></div>
    <div class="dialog-actions" style="margin-top:16px;"><button class="btn btn-soft" data-modal-close>Batal</button><button class="btn btn-primary" id="btnSendCall">Kirim Panggilan</button></div>
  </div>`, 'dialog-card');
  let reason = 'Minta Tisu & Sendok';
  $$('.waiter-chip', d).forEach(b => { b.onclick = () => { $$('.waiter-chip', d).forEach(x => x.classList.remove('active')); b.classList.add('active'); reason = b.dataset.waiterReason; }; });
  $('#btnSendCall', d).onclick = async () => {
    const note = ($('#waiterNote', d)?.value || '').trim();
    const token = tableToken || getCart().tableToken || 'demo-table-01';
    try { await api(`/public/tables/${encodeURIComponent(token)}/call-waiter`, { method: 'POST', body: JSON.stringify({ type: reason, note }) }); d.remove(); toast('✓ Panggilan terkirim ke barista & kasir!'); } catch (e) { toast(e.message, true); }
  };
}

function tablePickerModal(tables = []) {
  modal(`<div class="dialog table-picker-modal-dialog">
    <div class="dialog-icon" style="background:var(--orange-soft);color:var(--orange);">${icon('table', 24)}</div>
    <h3>Pilih Nomor Meja Anda</h3>
    <p style="font-size:12.5px;color:var(--muted);margin-top:-4px;margin-bottom:12px;">Pilih meja tempat Anda duduk untuk mulai memesan langsung</p>
    <div class="table-picker-grid" style="margin:12px 0 16px;max-height:340px;overflow-y:auto;padding-right:4px;">
      ${tables.map(t => `<a data-nav href="/order/${encodeURIComponent(t.publicToken || t.tableNumber)}" class="table-pick-btn" data-modal-close><span>Meja</span><strong>${esc(t.tableNumber || t.name.replace('Meja ', ''))}</strong></a>`).join('')}
    </div>
    <div class="dialog-actions"><button class="btn btn-soft btn-full" data-modal-close>Batal</button></div>
  </div>`, 'dialog-card');
}

let baristaAiMessages = [
  {
    sender: 'bot',
    text: 'Halo kak! 👋 Saya **Barista AI Cafe Campus** ☕ Siap bantu rekomendasikan menu kopi & makanan yang pas, info promo diskon pelajar, password Wi-Fi, atau fasilitas cafe. Mau coba menu apa hari ini?',
    suggestions: ['☕ Rekomendasi Kopi Best Seller', '🥐 Camilan & Snack', '🎓 Info Diskon Mahasiswa', '📶 Sandi Wi-Fi & Colokan'],
    products: []
  }
];

function baristaAiLauncherHtml() {
  return `<div class="barista-ai-floating-trigger" id="baristaAiLauncher">
    <button type="button" class="barista-launcher-btn" id="baristaAiLauncherBtn" aria-label="Tanya Barista AI">
      <span class="barista-cup-icon">☕</span>
      <span class="barista-badge-pulse"></span>
      <span class="barista-launcher-label">Tanya Barista AI</span>
    </button>
  </div>`;
}

function baristaAiModal() {
  const c = getCart();
  const isStud = isStudent(c);

  const renderMessagesHtml = () => {
    return baristaAiMessages.map(m => {
      const isBot = m.sender === 'bot';
      const formattedText = esc(m.text)
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\`([^`]+)\`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>');

      const productsHtml = (m.products && m.products.length) ? `
        <div class="chat-products-carousel">
          ${m.products.map(p => `
            <div class="chat-product-card ${!p.isAvailable ? 'soldout' : ''}">
              <div class="chat-product-img">
                <img src="${esc(p.imageUrl || '/assets/iced-latte.jpg')}" alt="${esc(p.name)}">
                ${!p.isAvailable ? '<span class="chat-sold-badge">Habis</span>' : ''}
              </div>
              <div class="chat-product-details">
                <b>${esc(p.name)}</b>
                <div class="chat-price-row">
                  ${isStud && p.studentPrice < p.price ? `<span class="price-strike" style="font-size:10px;">${money(p.price)}</span>` : ''}
                  <strong style="color:var(--brand);font-size:12px;">${money(isStud ? (p.studentPrice || p.price) : p.price)}</strong>
                </div>
                ${isStud && p.studentPrice < p.price ? '<small style="color:#2c8b5b;font-weight:700;font-size:10px;">🎓 Hemat Mahasiswa</small>' : ''}
                <button type="button" class="btn btn-primary btn-tiny chat-add-btn" data-chat-add="${esc(p.id)}" ${p.isAvailable ? '' : 'disabled'}>
                  ${p.isAvailable ? '+ Tambah' : 'Habis'}
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      ` : '';

      return `
        <div class="chat-bubble-row ${isBot ? 'bot-row' : 'user-row'}">
          ${isBot ? '<div class="chat-avatar">☕</div>' : ''}
          <div class="chat-bubble ${isBot ? 'bot-bubble' : 'user-bubble'}">
            <div class="chat-text">${formattedText}</div>
            ${productsHtml}
          </div>
        </div>
      `;
    }).join('');
  };

  const lastBotMsg = [...baristaAiMessages].reverse().find(m => m.sender === 'bot');
  const suggestions = lastBotMsg?.suggestions || ['☕ Rekomendasi Kopi', '🥐 Camilan', '🎓 Promo Pelajar', '📶 Wi-Fi'];

  const d = modal(`
    <div class="barista-ai-chat-window">
      <div class="barista-chat-header">
        <div class="barista-header-avatar">
          <span class="avatar-icon">☕</span>
          <span class="live-dot"></span>
        </div>
        <div class="barista-header-info">
          <h3>Barista AI • Cafe Campus</h3>
          <span class="barista-online-status">🟢 Online • Powered by Gemini AI</span>
        </div>
        <button type="button" class="plain-icon chat-close-btn" data-modal-close aria-label="Tutup">${icon('close', 20)}</button>
      </div>
      <div class="barista-chat-body" id="baristaChatBody">
        ${renderMessagesHtml()}
      </div>
      <div class="barista-chat-suggestions" id="baristaChatSuggestions">
        ${suggestions.map(s => `<button type="button" class="chat-chip" data-chip="${esc(s)}">${esc(s)}</button>`).join('')}
      </div>
      <form class="barista-chat-input-form" id="baristaChatForm">
        <input type="text" id="baristaChatInput" placeholder="Tanya menu, wifi, colokan, promo..." autocomplete="off" maxlength="200" required>
        <button type="submit" id="baristaChatSendBtn" class="btn btn-primary btn-small">
          ${icon('send', 16) || 'Kirim'}
        </button>
      </form>
    </div>
  `, 'barista-ai-modal-card');

  const chatBody = $('#baristaChatBody', d);
  if (chatBody) setTimeout(() => { chatBody.scrollTop = chatBody.scrollHeight; }, 50);

  const bindChatAddEvents = () => {
    $$('[data-chat-add]', d).forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        alarm.unlock();
        const pId = btn.dataset.chatAdd;
        try {
          const products = await api('/public/products');
          const p = products.find(x => x.id === pId);
          if (!p || !p.isAvailable) return toast('Maaf, menu ini sudah habis.', true);
          addCartItem(p);
          updateCartViews();
          btn.textContent = '✓ Masuk Keranjang';
          btn.style.background = '#2c8b5b';
          btn.disabled = true;
          toast(`✅ 1x ${p.name} ditambahkan ke keranjang!`);
        } catch (err) {
          toast(err.message, true);
        }
      };
    });
  };
  bindChatAddEvents();

  const sendMessage = async (userText) => {
    if (!userText || !userText.trim()) return;
    const text = userText.trim();
    baristaAiMessages.push({ sender: 'user', text, products: [] });
    if (chatBody) {
      chatBody.innerHTML = renderMessagesHtml() + `<div class="chat-bubble-row bot-row" id="chatTypingRow"><div class="chat-avatar">☕</div><div class="chat-bubble bot-bubble typing-bubble"><i></i><i></i><i></i> <span>Barista AI sedang meracik jawaban...</span></div></div>`;
      chatBody.scrollTop = chatBody.scrollHeight;
    }

    try {
      const historyPayload = baristaAiMessages.slice(-6).map(m => ({
        role: m.sender === 'user' ? 'user' : 'assistant',
        text: m.text || ''
      }));
      const res = await api('/public/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: text,
          customerType: isStud ? 'STUDENT' : 'REGULAR',
          tableToken: c.tableToken,
          history: historyPayload
        })
      });

      const typing = $('#chatTypingRow', d);
      if (typing) typing.remove();

      baristaAiMessages.push({
        sender: 'bot',
        text: res.reply || 'Maaf, saya tidak menangkap maksudmu. Coba pilih menu atau tanyakan hal lain ya!',
        suggestions: res.suggestions || [],
        products: res.recommendedProducts || []
      });

      if (chatBody) {
        chatBody.innerHTML = renderMessagesHtml();
        chatBody.scrollTop = chatBody.scrollHeight;
      }
      bindChatAddEvents();

      const chipContainer = $('#baristaChatSuggestions', d);
      if (chipContainer && Array.isArray(res.suggestions)) {
        chipContainer.innerHTML = res.suggestions.map(s => `<button type="button" class="chat-chip" data-chip="${esc(s)}">${esc(s)}</button>`).join('');
        bindChipEvents();
      }
    } catch (err) {
      const typing = $('#chatTypingRow', d);
      if (typing) typing.remove();
      toast(err.message, true);
    }
  };

  const bindChipEvents = () => {
    $$('[data-chip]', d).forEach(chip => {
      chip.onclick = () => {
        alarm.unlock();
        sendMessage(chip.dataset.chip);
      };
    });
  };
  bindChipEvents();

  const form = $('#baristaChatForm', d);
  const input = $('#baristaChatInput', d);
  if (form && input) {
    form.onsubmit = (e) => {
      e.preventDefault();
      alarm.unlock();
      const val = input.value;
      input.value = '';
      sendMessage(val);
    };
  }
}

function customerHeader(tableName = '') {
  const activeOrder = getActiveOrder(); const isTrackPage = typeof location !== 'undefined' && location.pathname.startsWith('/track');
  return `<header class="customer-topbar"><a class="customer-brand" data-nav href="/"><span>${brandMark(34)}</span><div><b>Cafe Campus</b><small class="brand-sub">Artisanal Coffee &amp; Space</small></div></a><div class="topbar-right"><button type="button" class="topbar-chip-btn" id="topbarAiBtn" title="Tanya Barista AI">${icon('sparkles', 15)}<span>Barista AI</span></button><button type="button" class="topbar-chip-btn" id="topbarWifiBtn" title="Lihat Info Wi-Fi">${icon('wifi', 15)}<span>Wi-Fi</span></button>${tableName ? `<button type="button" class="topbar-chip-btn" id="topbarWaiterBtn" title="Panggil Pelayan / Bantuan Meja">${icon('bell', 15)}<span>Panggil</span></button>` : ''}${tableName ? `<div class="table-status"><span></span>${esc(tableName)}</div>` : ''}</div></header>
  ${activeOrder && !isTrackPage ? `<div class="floating-order-banner animate-pop"><div class="fob-content"><span class="aofb-pulse"></span><div><b>Pesanan #${esc(activeOrder.orderNumber)} (${esc(activeOrder.tableName || 'Meja')})</b><small>${statusMeta[activeOrder.status]?.customer || 'Sedang Diproses'}</small></div></div><a data-nav href="/track/${encodeURIComponent(activeOrder.orderNumber)}?access=${encodeURIComponent(activeOrder.accessToken || '')}" class="btn btn-primary btn-small">Lihat Status</a></div>` : ''}`;
}

function customerShell(content, { tableName = '', className = '' } = {}) { return `<div class="customer-app ${className}">${customerHeader(tableName)}${content}${baristaAiLauncherHtml()}</div>`; }
function statusBadge(st) { const m = statusMeta[st] || { label: st, class: '' }; return `<span class="status-badge ${m.class}"><i class="status-dot"></i>${m.label}</span>`; }
function paymentBadge(o) { const paid = o.payment?.status === 'PAID'; const method = o.payment?.method === 'QRIS_DEMO' ? 'QRIS' : 'Tunai'; return `<div class="payment-cell"><span class="payment-badge ${o.payment?.method === 'QRIS_DEMO' ? 'qris' : 'cash'}">${method}</span><span class="pay-status-pill ${paid ? 'paid' : 'pending'}"><i class="pay-dot"></i>${paid ? 'Lunas' : 'Pending'}</span></div>`; }

function adminLinks() {
  return [
    ['dashboard', '/admin', 'dashboard', 'Dashboard'],
    ['kds', '/admin/kds', 'chef', 'Layar Dapur (KDS)'],
    ['orders', '/admin/orders', 'orders', 'Pesanan'],
    ['menu', '/admin/menu', 'menu', 'Kelola Menu'],
    ['inventory', '/admin/inventory', 'box', 'Stok & Resep'],
    ['faculties', '/admin/faculties', 'academic', 'Fakultas'],
    ['categories', '/admin/categories', 'categories', 'Kategori'],
    ['tables', '/admin/tables', 'qr', 'Meja & QR'],
    ['payments', '/admin/payments', 'wallet', 'Pembayaran'],
    ['shifts', '/admin/shifts', 'clock', 'Shift Kasir'],
    ['reports', '/admin/reports', 'report', 'Laporan'],
    ['audit', '/admin/audit', 'shield', 'Audit Log'],
    ['settings', '/admin/settings', 'settings', 'Pengaturan']
  ];
}
function adminShell(content, active = 'dashboard', user = { name: 'Demo Admin' }) {
  const links = adminLinks();
  return `<div class="admin-app"><aside class="admin-sidebar"><a class="admin-logo" data-nav href="/admin">${brandMark(38)}<b>Cafe Campus</b></a><nav>${links.map(([k, h, ic, l]) => `<a data-nav href="${h}" class="${active === k ? 'active' : ''}">${icon(ic, 20)}<span>${l}</span></a>`).join('')}</nav><div class="sidebar-bottom"><div class="admin-user"><div class="avatar">A</div><div><b>Admin Campus</b><small>Staff Kasir & Barista</small></div></div><button class="sidebar-logout" id="sideLogout">${icon('logout', 18)}<span>Keluar</span></button></div></aside><main class="admin-main">${content}</main><nav class="admin-bottom-nav">${[['dashboard', '/admin', 'dashboard', 'Beranda'], ['kds', '/admin/kds', 'chef', 'Dapur'], ['orders', '/admin/orders', 'orders', 'Pesanan'], ['shifts', '/admin/shifts', 'clock', 'Shift']].map(([k, h, ic, l]) => `<a data-nav href="${h}" class="${active === k ? 'active' : ''}">${icon(ic, 18)}<span>${l}</span></a>`).join('')}<button id="moreNav" class="${['menu', 'inventory', 'faculties', 'categories', 'tables', 'payments', 'reports', 'audit', 'settings'].includes(active) ? 'active' : ''}">${icon('more', 18)}<span>Lainnya</span></button></nav></div>`;
}

function bindAdminChrome(active) {
  const out = $('#sideLogout'); if (out) out.onclick = logoutAdmin;
  const more = $('#moreNav');
  if (more) more.onclick = () => {
    const d = modal(`<div class="mobile-more-sheet"><div class="sheet-handle"></div><h3>Menu Lainnya</h3>${[['menu', '/admin/menu', 'menu', 'Kelola Menu'], ['inventory', '/admin/inventory', 'box', 'Stok & Resep'], ['faculties', '/admin/faculties', 'academic', 'Fakultas'], ['categories', '/admin/categories', 'categories', 'Kategori'], ['tables', '/admin/tables', 'qr', 'Meja & QR'], ['payments', '/admin/payments', 'wallet', 'Pembayaran'], ['reports', '/admin/reports', 'report', 'Laporan'], ['audit', '/admin/audit', 'shield', 'Audit Log'], ['settings', '/admin/settings', 'settings', 'Pengaturan']].map(([k, h, ic, l]) => `<a data-nav href="${h}" class="more-link ${active === k ? 'active' : ''}">${icon(ic, 20)}<span>${l}</span>${icon('chevron', 16)}</a>`).join('')}<button class="more-link danger-link" id="mobileLogout">${icon('logout', 20)}<span>Keluar</span></button></div>`, 'bottom-sheet');
    $('#mobileLogout', d).onclick = logoutAdmin;
  };
  const bellBtn = $('#adminBellBtn'); if (bellBtn) bellBtn.onclick = () => adminAudioSettingsModal();
  const livePill = $('#adminLivePill'); if (livePill) livePill.onclick = () => adminStreamStatusModal();
  const unlockBtn = $('#btnUnlockAdminAudio');
  if (unlockBtn) {
    unlockBtn.onclick = () => {
      alarm.unlock();
      alarm.playAdminChime();
      toast('✅ Bel Kasir Aktif & Siap Berbunyi!');
      $('#adminAudioBanner')?.remove();
      registerPushSubscription('admin');
    };
  }
}

function adminAudioSettingsModal() {
  const d = modal(`<div class="modal-heading"><div><span>PENGATURAN NOTIFIKASI</span><h2>Dering & Speaker Kasir</h2></div><span class="status-badge status-ready"><i class="status-dot"></i>Audio Aktif</span></div><div class="audio-control-box"><p style="color:var(--muted);font-size:13.5px;margin-bottom:16px;">Uji coba dan dengarkan dering lonceng notifikasi pesanan masuk serta pemberitahuan pesanan siap untuk kasir dan barista.</p><div class="audio-test-grid"><div class="audio-test-card"><div><b>🔔 Dering Pesanan Masuk (Kasir)</b></div><button class="btn btn-primary btn-small" id="testAdminAlarm">Uji Dering Kasir (15s)</button></div><div class="audio-test-card"><div><b>☕ Dering Pesanan Siap (Pelanggan)</b></div><button class="btn btn-green btn-small" id="testReadyAlarm">Uji Dering Siap</button></div><div class="audio-test-card"><div><b>🔇 Hentikan Dering Aktif</b></div><button class="btn btn-soft btn-small" id="stopAlarmBtn">Matikan Dering</button></div></div></div><div class="modal-actions"><button class="btn btn-dark btn-full" id="closeAudioModal">Tutup Pengaturan</button></div>`, 'dialog-card');
  $('#testAdminAlarm', d).onclick = () => { alarm.startAlarm('admin', 15); toast('🔔 Memutar dering lonceng pesanan baru...'); };
  $('#testReadyAlarm', d).onclick = () => { alarm.startAlarm('ready', 15); toast('☕ Memutar dering pesanan siap...'); };
  $('#stopAlarmBtn', d).onclick = () => { alarm.stopAlarm(); toast('🔇 Dering notifikasi dihentikan'); };
  $('#closeAudioModal', d).onclick = () => d.remove();
}

function adminStreamStatusModal() {
  const d = modal(`<div class="modal-heading"><div><span>KONEKSI SISTEM</span><h2>Status Sinkronisasi Real-Time</h2></div><span class="live-pill" style="display:inline-flex;"><i></i> LIVE</span></div><div class="stream-status-box"><div class="stream-metric-row"><span>Status Server</span><b style="color:var(--green);">🟢 Online & Terhubung</b></div></div><div class="modal-actions"><button class="btn btn-dark btn-full" id="closeStreamModal">Tutup</button></div>`, 'dialog-card');
  $('#closeStreamModal', d).onclick = () => d.remove();
}

async function logoutAdmin() {
  setAdminToken('');
  try { await api('/admin/logout', { method: 'POST', body: '{}' }); } catch { }
  nav('/admin/login');
}
function adminTop(title, subtitle, actions = '') {
  const audioBanner = !alarm.unlocked ? `
    <div class="admin-audio-alert-bar" id="adminAudioBanner">
      <div class="admin-audio-alert-content">
        <span class="pulse-bell">🔔</span>
        <div>
          <strong>Suara Bel Notifikasi Kasir Belum Diaktifkan</strong>
          <small>Browser mewajibkan 1x klik agar alarm lonceng pesanan baru dapat berbunyi nyaring.</small>
        </div>
      </div>
      <button class="btn btn-primary btn-small" id="btnUnlockAdminAudio">🔊 Aktifkan Suara Sekarang</button>
    </div>` : '';

  return `
    ${audioBanner}
    <header class="admin-page-head">
      <div>
        <h1>${esc(title)}</h1>
        <p>${esc(subtitle || '')}</p>
      </div>
      <div class="admin-head-actions">
        ${actions}
        <button class="live-pill" id="adminLivePill" title="Lihat Status Jaringan Real-Time"><i></i> LIVE</button>
        <button class="icon-btn" id="adminBellBtn" title="Pengaturan & Uji Alarm Kasir">${icon('bell', 19)}</button>
      </div>
    </header>
  `;
}

// ==========================================
// RESILIENT REAL-TIME ENGINE (SSE + TUNNEL POLLING FALLBACK)
// ==========================================
function createRealtimeSubscription({ channel, order, access, onEvent, onStatusChange }) {
  let es = null;
  let isClosed = false;
  let sseFailures = 0;
  let pollTimer = null;
  let reconnectTimer = null;
  let cursor = 0;
  let isFirstPoll = true;
  const isTryCloudflare = window.location.hostname.endsWith('trycloudflare.com');
  // Auto-fallback jika di trycloudflare tunnel karena QUIC stream drops
  let mode = isTryCloudflare ? 'POLLING' : 'SSE';

  const updateStatus = (status) => {
    // status: 'LIVE' | 'POLLING' | 'RECONNECTING' | 'PAUSED'
    if (onStatusChange) onStatusChange(status);
  };

  const startPolling = () => {
    if (isClosed || pollTimer) return;
    mode = 'POLLING';
    updateStatus('POLLING');
    const poll = async () => {
      if (isClosed) return;
      try {
        const token = getAdminToken();
        let q = `/events/poll?channel=${encodeURIComponent(channel)}&since=${cursor}`;
        if (order) q += `&order=${encodeURIComponent(order)}&access=${encodeURIComponent(access || '')}`;
        if (token) q += `&token=${encodeURIComponent(token)}`;
        const res = await api(q);
        if (res && res.ok) {
          if (isFirstPoll && cursor === 0) {
            cursor = res.cursor || 0;
            isFirstPoll = false;
            return;
          }
          isFirstPoll = false;
          if (res.cursor) cursor = Math.max(cursor, res.cursor);
          if (Array.isArray(res.events)) {
            for (const ev of res.events) {
              onEvent({ event: ev.event, data: ev.data });
            }
          }
        }
      } catch (err) {}
    };
    poll();
    pollTimer = setInterval(poll, 3000);
  };

  const stopPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const connectSSE = () => {
    if (isClosed) return;
    if (mode === 'POLLING') {
      startPolling();
      return;
    }

    try {
      if (es) { try { es.close(); } catch {} es = null; }
      const token = getAdminToken();
      let url = `/api/events?channel=${encodeURIComponent(channel)}`;
      if (order) url += `&order=${encodeURIComponent(order)}&access=${encodeURIComponent(access || '')}`;
      if (token) url += `&token=${encodeURIComponent(token)}`;
      if (cursor > 0) url += `&lastEventId=${cursor}`;

      updateStatus(sseFailures > 0 ? 'RECONNECTING' : 'LIVE');
      es = new EventSource(url, { withCredentials: true });

      es.onopen = () => {
        sseFailures = 0;
        updateStatus('LIVE');
      };

      es.addEventListener('hello', (e) => {
        try {
          const d = JSON.parse(e.data);
          if (d.eventId) cursor = Math.max(cursor, d.eventId);
        } catch {}
      });

      const eventTypes = ['admin-order', 'kitchen-order', 'order-update'];
      eventTypes.forEach(evt => {
        es.addEventListener(evt, (e) => {
          let data = null;
          try { data = JSON.parse(e.data); } catch { data = e.data; }
          if (e.lastEventId) cursor = Math.max(cursor, Number(e.lastEventId));
          onEvent({ event: evt, data });
        });
      });

      es.onerror = () => {
        if (isClosed) return;
        try { es.close(); } catch {}
        es = null;
        sseFailures++;
        if (sseFailures >= 3 || isTryCloudflare) {
          console.warn('[Realtime] SSE disconnected 3x / on trycloudflare. Switching to cursor polling.');
          mode = 'POLLING';
          startPolling();
        } else {
          updateStatus('RECONNECTING');
          const backoff = Math.min(10000, Math.pow(2, sseFailures - 1) * 1000) + Math.floor(Math.random() * 1000);
          clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(connectSSE, backoff);
        }
      };
    } catch (e) {
      console.warn('[Realtime] SSE init failed:', e);
      mode = 'POLLING';
      startPolling();
    }
  };

  const handleVisibilityChange = () => {
    if (document.hidden) {
      // Pertahankan SSE aktif di background tab agar dering alarm kasir tetap berbunyi saat buka tab lain!
      if (mode === 'POLLING' && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = setInterval(poll, 5000);
      }
    } else {
      if (mode === 'POLLING') {
        stopPolling();
        startPolling();
      } else {
        if (!es || es.readyState === EventSource.CLOSED) {
          connectSSE();
        }
      }
    }
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);

  if (isTryCloudflare) {
    startPolling();
  } else {
    connectSSE();
  }

  return {
    close: () => {
      isClosed = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (es) { try { es.close(); } catch {} es = null; }
      stopPolling();
      clearTimeout(reconnectTimer);
    }
  };
}

function setupAdminRealtime(refresh) {
  // Auto-subscribe Admin Web Push
  registerPushSubscription('admin');

  const updatePill = (status) => {
    const pill = $('#adminLivePill');
    if (!pill) return;
    pill.className = 'live-pill';
    if (status === 'POLLING') {
      pill.classList.add('polling');
      pill.innerHTML = '<i></i> POLLING (Tunnel)';
      pill.title = 'Terhubung via Polling Ringan Cursor (Optimal untuk Cloudflare Tunnel)';
    } else if (status === 'RECONNECTING') {
      pill.classList.add('reconnecting');
      pill.innerHTML = '<i></i> MENYAMBUNG...';
      pill.title = 'Sedang menyambung ulang stream real-time...';
    } else if (status === 'PAUSED') {
      pill.classList.add('reconnecting');
      pill.innerHTML = '<i></i> PAUSED';
      pill.title = 'Koneksi dijeda karena tab browser tidak aktif';
    } else {
      pill.innerHTML = '<i></i> LIVE (SSE)';
      pill.title = 'Terhubung secara real-time via Server-Sent Events';
    }
  };

  const sub = createRealtimeSubscription({
    channel: 'admin',
    onStatusChange: updatePill,
    onEvent: ({ event, data }) => {
      const ord = data;
      const isPaymentUpdate = ord && (ord._eventType === 'payment-update' || ord.paid === true);

      // 1. Selesai Pembayaran dari Customer -> Bunyikan Alarm Kasir
      if (isPaymentUpdate) {
        const title = `💳 Pembayaran #${ord.orderNumber} Lunas!`;
        const sub = `${ord.tableName || 'Meja'} • Total: ${money(ord.total || 0)}`;
        toast(`💳 Pembayaran #${ord.orderNumber} Lunas (${ord.tableName || 'Meja'})`);
        alarm.startAlarm('admin', 15);
        showAlarmBanner(
          title,
          sub,
          () => alarm.stopAlarm(),
          () => {
            if (ord.orderNumber) {
              orderDetailModal(ord.orderNumber, refresh);
            }
          }
        );
        refresh && refresh();
        return;
      }

      // 2. Waiter Call (Panggilan Pelayan) -> Toast saja, TANPA alarm
      if (ord && ord.isWaiterCall) {
        toast(`🛎️ ${ord.tableName || 'Meja'}: ${ord.message || 'Memanggil pelayan'}`);
        refresh && refresh();
        return;
      }

      // 3. Pesanan Baru Masuk (HANYA bila status NEW) -> Bunyikan Alarm Kasir
      if (event === 'admin-order' && ord && ord.status === 'NEW') {
        const title = `🔔 Pesanan Baru #${ord.orderNumber} (${ord.tableName || 'Meja'})`;
        const totalStr = ord?.total ? ` • ${money(ord.total)}` : '';
        toast(`🔔 ${title}${totalStr}`);
        alarm.startAlarm('admin', 20);
        showAlarmBanner(
          title,
          `Total: ${money(ord?.total || 0)} (${ord?.payment?.method === 'CASH' ? 'Bayar Tunai di Kasir' : 'QRIS'})`,
          () => alarm.stopAlarm(),
          () => {
            if (ord?.orderNumber) {
              orderDetailModal(ord.orderNumber, refresh);
            }
          }
        );
        refresh && refresh();

        if ('Notification' in window && Notification.permission === 'granted') {
          try {
            navigator.serviceWorker.ready.then(reg => {
              reg.showNotification(`🔔 ${title}`, {
                body: `Meja: ${ord?.tableName || '-'} • Total: ${money(ord?.total || 0)}`,
                icon: '/assets/icon.png',
                badge: '/assets/icon.png',
                vibrate: [800, 200, 800, 200, 1000],
                tag: 'admin-order-' + (ord?.orderNumber || Date.now()),
                requireInteraction: true,
                data: { url: '/admin/orders' }
              });
            }).catch(() => {
              new Notification(`🔔 ${title}`, { body: `Meja: ${ord?.tableName || '-'} • Total: ${money(ord?.total || 0)}` });
            });
          } catch {}
        }
        return;
      }

      // 4. Update status biasa (KDS bump, proses dapur, kitchen-order, order-update, dll) -> Refresh senyap tanpa alarm
      refresh && refresh();
    }
  });

  disposeOnLeave(() => {
    sub.close();
  });
}

async function render() {
  cleanupPage(); window.scrollTo(0, 0); const u = new URL(location.href); const p = u.pathname; const searchTable = u.searchParams.get('table') || u.searchParams.get('tableNumber') || u.searchParams.get('t'); document.body.className = '';
  try {
    if (searchTable) return tableWelcomePage(searchTable);
    if (p === '/' || p === '/demo') return landing();
    const parts = p.split('/').filter(Boolean);
    if (parts[0] === 'order') { if (parts.length === 1) return landing(); if (parts.length === 2) return tableWelcomePage(decodeURIComponent(parts[1])); if (parts[2] === 'menu') return menuPage(decodeURIComponent(parts[1])); if (parts[2] === 'product' && parts[3]) return productDetailPage(decodeURIComponent(parts[1]), decodeURIComponent(parts[3])); }
    if (p === '/cart') return cartPage(); if (p === '/checkout') return checkoutPage(); if (parts[0] === 'track' && parts[1]) return trackPage(decodeURIComponent(parts[1]));
    if (p === '/admin/login') return loginPage(); if (p === '/admin' || p === '/admin/') return adminGuard(dashboardPage);
    if (p === '/admin/orders') return adminGuard(ordersPage); if (p === '/admin/menu') return adminGuard(menuAdminPage);
    if (p === '/admin/kds') return adminGuard(kdsPage);
    if (p === '/admin/inventory') return adminGuard(inventoryAdminPage);
    if (p === '/admin/faculties') return adminGuard(facultiesAdminPage);
    if (p === '/admin/shifts') return adminGuard(shiftsAdminPage);
    if (p === '/admin/audit') return adminGuard(auditLogsAdminPage);
    if (p === '/admin/categories') return adminGuard(categoriesPage); if (p === '/admin/tables') return adminGuard(tablesPage);
    if (p === '/admin/payments') return adminGuard(paymentsPage); if (p === '/admin/reports') return adminGuard(reportsPage);
    if (p === '/admin/settings') return adminGuard(settingsPage);
    document.body.innerHTML = '<main class="not-found"><h1>404</h1><p>Halaman tidak ditemukan.</p><a class="btn btn-primary" data-nav href="/">Kembali ke Beranda</a></main>';
  } catch (e) { document.body.innerHTML = `<main class="fatal"><div>${icon('bell', 28)}</div><h2>Terjadi kendala</h2><p>${esc(e.message)}</p><button class="btn btn-primary" onclick="location.reload()">Coba Lagi</button></main>`; }
}

async function landing() {
  let tables = []; try { tables = await api('/public/tables') } catch { tables = Array.from({ length: 12 }, (_, i) => ({ tableNumber: String(i + 1).padStart(2, '0'), name: `Meja ${String(i + 1).padStart(2, '0')}`, publicToken: `demo-table-${String(i + 1).padStart(2, '0')}` })); }
  const defaultToken = tables[0]?.publicToken || 'demo-table-b1';
  const settings = await fetchCachedSettings(); const activeOrder = getActiveOrder();
  document.body.className = 'landing-body cafe-home-body';
  document.body.innerHTML = `<main class="cafe-home"><header class="home-navbar"><a class="home-brand" data-nav href="/"><span>${brandMark(38)}</span><div><b>Cafe Campus</b><small>Artisanal &amp; Creative Space</small></div></a><div class="home-nav-actions"><button type="button" class="btn btn-soft btn-small" id="navWifiBtn">${icon('wifi', 15)}<span>Wi-Fi 100 Mbps</span></button><a data-nav href="/order/${encodeURIComponent(defaultToken)}/menu" class="btn btn-outline btn-small">${icon('menu', 15)}<span>Buku Menu</span></a><button type="button" class="btn btn-primary btn-small" id="navOrderBtn">${icon('cart', 15)}<span>Pesan di Meja</span></button></div></header>${activeOrder ? `<section class="home-active-order-bar animate-pop"><div class="haob-left"><span class="aofb-pulse"></span><div><b>Pesanan #${esc(activeOrder.orderNumber)} Sedang Berlangsung</b><small>${esc(activeOrder.tableName || 'Meja')} • Status: ${statusMeta[activeOrder.status]?.customer || 'Sedang Diproses'}</small></div></div><a data-nav href="/track/${encodeURIComponent(activeOrder.orderNumber)}?access=${encodeURIComponent(activeOrder.accessToken || '')}" class="btn btn-primary btn-small">Lacak Pesanan</a></section>` : ''}<section class="cafe-hero"><div class="hero-badge">${icon('sparkles', 14)} <span>Tempat Favorit Nugas &amp; Kopi Spesial Kampus</span></div><h1 class="hero-title">Secangkir Kopi Pilihan &amp; Ruang Nyaman untuk Ide Besarmu</h1><p class="hero-desc">Nikmati racikan espresso kaya aroma, hidangan hangat yang lezat, dan suasana produktif. Pesan langsung dari smartphone tanpa perlu antre di kasir.</p><div class="hero-actions"><button type="button" class="btn btn-primary btn-large hero-cta-btn" id="heroOrderBtn">${icon('cart', 20)} Pesan dari Meja Anda</button><a data-nav href="/order/${encodeURIComponent(defaultToken)}/menu" class="btn btn-soft btn-large hero-menu-btn">${icon('menu', 18)} Lihat Buku Menu Digital</a><button type="button" class="btn btn-soft btn-large hero-wifi-btn" id="heroWifiBtn">${icon('wifi', 18)} Salin Password Wi-Fi</button></div></section></main>`;
  const openTablePicker = () => tablePickerModal(tables); const openWifi = () => wifiModal();
  $('#heroOrderBtn').onclick = openTablePicker; $('#navOrderBtn').onclick = openTablePicker;
  $('#navWifiBtn').onclick = openWifi; $('#heroWifiBtn').onclick = openWifi;
}

async function tableWelcomePage(tableToken) {
  const table = await api('/public/tables/' + encodeURIComponent(tableToken));
  let c = getCart();
  if (c.tableToken && c.tableToken !== table.publicToken && c.tableToken !== tableToken) { c = { tableToken: table.publicToken || tableToken, tableName: table.name, items: [] }; } else { c.tableToken = table.publicToken || tableToken; c.tableName = table.name; }
  setCart(c); document.body.className = 'customer-body';
  document.body.innerHTML = customerShell(`<main class="welcome-page"><section class="welcome-copy"><div class="welcome-logo">${brandMark(64)}<h1>Cafe Campus</h1></div><div class="welcome-mobile-hero"><img src="/assets/hero-mobile.jpg" alt="Cafe Campus"></div><h2>Selamat Datang di Cafe Campus</h2><p>Silakan pesan makanan & minuman langsung dari smartphone Anda tanpa harus antre di kasir.</p><div class="table-detected"><small>NOMOR MEJA ANDA</small><strong>${esc(table.name)}</strong></div><a data-nav href="/order/${encodeURIComponent(table.publicToken || tableToken)}/menu" class="btn btn-primary btn-wide btn-hero-order">${icon('arrow', 18)} Lihat Menu & Mulai Pesan</a></section><div class="welcome-desktop-hero"><img src="/assets/hero-desktop.jpg" alt="Suasana Cafe Campus"></div></main>`, { tableName: table.name, className: 'welcome-shell' });
}

async function menuPage(tableToken) {
  const [table, cats, products] = await Promise.all([api('/public/tables/' + encodeURIComponent(tableToken)), api('/public/categories'), api('/public/products')]);
  let c = getCart();
  if (c.tableToken !== table.publicToken && c.tableToken !== tableToken) { c = { tableToken: table.publicToken || tableToken, tableName: table.name, customerType: c.customerType || 'REGULAR', studentInfo: c.studentInfo || {}, items: [] }; } else { c.tableName = table.name; }
  const addToMode = getAddTo(); if (addToMode) c.customerType = addToMode.customerType;
  recalculateCartItems(c, products); setCart(c);
  let cat = '', query = '';
  const getFilteredProducts = () => products.filter(p => (!cat || p.categorySlug === cat) && (!query || (`${p.name} ${p.description}`).toLowerCase().includes(query.toLowerCase())));

  const renderGridContent = () => {
    const list = getFilteredProducts(); const isStud = isStudent(getCart());
    if (!list.length) return `<div class="search-empty">${icon('search', 30)}<h3>Menu tidak ditemukan</h3><p>Coba kata kunci atau kategori lain.</p></div>`;
    return `<div class="product-grid">${list.map(p => {
      const isAvailable = p.isAvailable !== false; const studPrice = p.studentPrice || p.price; const hasDiscount = isStud && studPrice < p.price; const displayPrice = isStud ? studPrice : p.price;
      return `<article class="product-card ${!isAvailable ? 'soldout' : ''}" data-detail="${p.id}"><div class="product-photo">${productImage(p)}${!isAvailable ? '<span class="sold-label">Habis</span>' : ''}</div><div class="product-info"><h3>${esc(p.name)}</h3><p>${esc(p.description)}</p><div class="product-price-row"><div class="product-price-stack">${hasDiscount ? `<span class="price-strike">${money(p.price)}</span>` : ''}<strong class="price-current ${isStud && hasDiscount ? 'student-highlight' : ''}">${money(displayPrice)}</strong>${hasDiscount ? `<span class="savings-chip">🎓 Hemat ${money(p.price - studPrice)}</span>` : ''}</div><button class="round-add" data-add="${p.id}" ${isAvailable ? '' : 'disabled'} aria-label="Tambah ${esc(p.name)}">${icon('plus', 18)}</button></div></div></article>`;
    }).join('')}</div>`;
  };

  const renderDesktopCartContent = () => {
    const cc = getCart(); const isStud = isStudent(cc); const savings = cartSavings(cc); const hasUnavailable = cc.items.some(i => i.isAvailable === false);
    return `<div class="cart-title"><h3>Keranjang Belanja</h3><span>${cartCount(cc)} Item ${isStud ? '• 🎓 Pelajar' : ''}</span></div>${cc.items.length ? cc.items.map((i, idx) => `<div class="mini-cart-item"><img src="${esc(i.imageUrl || '/assets/iced-latte.jpg')}" alt=""><div><b>${esc(i.name)}</b>${i.isAvailable === false ? '<span class="badge-soldout-chip" style="font-size:10px;padding:1px 5px;margin-bottom:2px;">⚠️ Habis</span>' : ''}<small>${esc(optionSummary(i) || i.note || '')}</small><strong>${money(i.price)}</strong>${i.savings ? `<small style="color:#2c8b5b;font-weight:700;">Hemat ${money(i.savings)}</small>` : ''}</div><div class="mini-qty"><button data-minus-mini="${idx}">${icon('minus', 14)}</button><span>${i.quantity}</span><button data-plus-mini="${idx}">${icon('plus', 14)}</button></div></div>`).join('') : `<div class="empty-cart">${icon('cart', 28)}<b>Keranjang masih kosong</b><span>Pilih menu favoritmu untuk mulai memesan.</span></div>`}<div class="desktop-cart-summary">${savings > 0 ? `<div><span>Subtotal Reguler</span><span style="text-decoration:line-through;color:var(--muted);">${money(cartRegularTotal(cc))}</span></div><div><span>Potongan Pelajar 🎓</span><b style="color:#2c8b5b;">- ${money(savings)}</b></div>` : ''}<div><span>Subtotal</span><b>${money(cartTotal(cc))}</b></div></div>${cc.items.length ? (hasUnavailable ? `<button type="button" class="btn btn-primary btn-wide" disabled style="opacity:0.6;cursor:not-allowed;">Hapus Menu Habis untuk Lanjut</button>` : `<a class="btn btn-primary btn-wide" data-nav href="/checkout">Lanjut ke Pembayaran • ${money(cartTotal(cc))}</a>`) : ''}`;
  };

  const renderMobileCartBarContent = () => {
    const cc = getCart(); if (!cc.items.length) return ''; const savings = cartSavings(cc);
    return `<a class="mobile-cart-bar animate-pop" data-nav href="/cart"><span class="cart-count badge-pulse">${cartCount(cc)}</span><div class="cart-bar-total"><small>${isStudent(cc) ? '🎓 Mode Pelajar' : 'Total Pesanan'}${savings > 0 ? ` • Hemat ${money(savings)}` : ''}</small><b>${money(cartTotal(cc))}</b></div><span class="cart-bar-cta">Lihat Keranjang ${icon('cart', 18)}</span></a>`;
  };

  document.body.className = 'customer-body menu-page-body';
  document.body.innerHTML = customerShell(`<main class="menu-layout"><section class="menu-main">${addToBanner()}<div class="menu-heading"><h1>Menu Favorit</h1><label class="search-box">${icon('search', 18)}<input id="search" placeholder="Cari kopi atau makanan..." value="${esc(query)}"></label></div><div id="roleSwitcherContainer">${customerRoleSwitcher(c)}</div><div class="category-chips" id="categoryChips"><button class="category-chip ${cat === '' ? 'active' : ''}" data-cat="">Semua</button>${cats.map(x => `<button class="category-chip ${cat === x.slug ? 'active' : ''}" data-cat="${x.slug}">${esc(x.name)}</button>`).join('')}</div><div id="productGridContainer">${renderGridContent()}</div></section><aside class="desktop-cart" id="desktopCartContainer">${renderDesktopCartContent()}</aside></main><div id="mobileCartBarWrapper">${renderMobileCartBarContent()}</div>`, { tableName: table.name, className: 'menu-shell' });

  const bindRoleEvents = () => {
    $$('[data-set-role]').forEach(btn => {
      btn.onclick = () => {
        alarm.unlock(); const role = btn.dataset.setRole; let curr = getCart(); curr.customerType = role; recalculateCartItems(curr, products); setCart(curr); toast(role === 'STUDENT' ? '🎓 Mode Pelajar aktif: Harga spesial diterapkan!' : '☕ Mode Pelanggan Umum aktif'); $('#roleSwitcherContainer').innerHTML = customerRoleSwitcher(curr); bindRoleEvents(); updateGridOnly(); updateCartViews();
      };
    });
  };

  const bindGridEvents = () => {
    $$('[data-detail]').forEach(card => card.onclick = e => { if (e.target.closest('[data-add]')) return; nav(`/order/${encodeURIComponent(table.publicToken || tableToken)}/product/${card.dataset.detail}`); });
    $$('[data-add]').forEach(b => b.onclick = e => { e.stopPropagation(); alarm.unlock(); const p = products.find(x => x.id === b.dataset.add); if (!p || !p.isAvailable) return; if (p.customizable) { nav(`/order/${encodeURIComponent(table.publicToken || tableToken)}/product/${p.id}`); } else { addCartItem(p); updateCartViews(); } });
  };

  const bindCartEvents = () => {
    $$('[data-minus-mini]').forEach(b => b.onclick = () => { alarm.unlock(); const curr = getCart(), i = Number(b.dataset.minusMini); curr.items[i].quantity--; if (curr.items[i].quantity <= 0) curr.items.splice(i, 1); setCart(curr); updateCartViews(); });
    $$('[data-plus-mini]').forEach(b => b.onclick = () => { alarm.unlock(); const curr = getCart(), i = Number(b.dataset.plusMini); if (curr.items[i].quantity >= 20) return toast('Maksimal 20 porsi.', true); curr.items[i].quantity++; setCart(curr); updateCartViews(); });
  };

  const updateGridOnly = () => { const container = $('#productGridContainer'); if (container) { container.innerHTML = renderGridContent(); bindGridEvents(); } $$('[data-cat]').forEach(b => b.classList.toggle('active', b.dataset.cat === cat)); };
  const updateCartViews = () => { const dCart = $('#desktopCartContainer'); if (dCart) { dCart.innerHTML = renderDesktopCartContent(); bindCartEvents(); } const mWrapper = $('#mobileCartBarWrapper'); if (mWrapper) { mWrapper.innerHTML = renderMobileCartBarContent(); } };
  const search = $('#search'); if (search) search.oninput = e => { query = e.target.value; clearTimeout(search._t); search._t = setTimeout(updateGridOnly, 100); };
  $$('[data-cat]').forEach(b => b.onclick = () => { cat = b.dataset.cat; updateGridOnly(); });

  bindRoleEvents(); bindGridEvents(); bindCartEvents();
  const cancelAdd = $('#cancelAddTo'); if (cancelAdd) cancelAdd.onclick = () => { clearAddTo(); toast('Mode tambah pesanan dibatalkan'); render(); };
}

async function productDetailPage(tableToken, productId) {
  const [table, products] = await Promise.all([api('/public/tables/' + encodeURIComponent(tableToken)), api('/public/products')]);
  const p = products.find(x => x.id === productId); if (!p) throw new Error('Menu tidak ditemukan.');
  let quantity = 1, options = p.customizable ? { size: 'Regular', sweetness: 'Normal', ice: 'Normal' } : {};
  const getEffectiveBase = () => getProductEffectivePrice(p, isStudent(getCart())); const calcUnitPrice = () => getEffectiveBase() + (options.size === 'Large' ? 5000 : 0); const calcRegularUnitPrice = () => p.price + (options.size === 'Large' ? 5000 : 0);
  const isStud = isStudent(getCart()); const hasDiscount = isStud && (p.studentPrice || p.price) < p.price;

  document.body.className = 'customer-body detail-body';
  document.body.innerHTML = customerShell(`<main class="product-detail-page"><button class="floating-back" id="back" aria-label="Kembali">${icon('back', 20)}</button><div class="detail-photo">${productImage({ ...p, imageUrl: p.name === 'Iced Latte Gula Aren' ? '/assets/iced-detail.jpg' : p.imageUrl }, true)}</div><section class="detail-content"><div class="detail-title-row"><div><h1>${esc(p.name)}</h1><p>${esc(p.description)}</p></div><div style="text-align: right;">${hasDiscount ? `<span class="price-strike" style="font-size:13px;">${money(calcRegularUnitPrice())}</span><br>` : ''}<strong id="unitPriceDisplay" style="${hasDiscount ? 'color:#1b633a;' : ''}">${money(calcUnitPrice())}</strong>${hasDiscount ? `<br><span class="savings-chip">🎓 Harga Pelajar</span>` : ''}</div></div>${p.customizable ? `<div class="option-group"><div class="option-title"><b>Ukuran Gelas</b><span>Pilih salah satu</span></div><div class="option-pills">${['Regular', 'Large'].map(v => `<button type="button" data-size="${v}" class="option-pill ${options.size === v ? 'active' : ''}">${v}${v === 'Large' ? ' (+Rp5.000)' : ''}</button>`).join('')}</div></div><div class="option-group"><div class="option-title"><b>Tingkat Kemanisan (Gula)</b><span>Pilih salah satu</span></div><div class="option-pills">${['Normal', 'Less', 'Tanpa Gula'].map(v => `<button type="button" data-sweet="${v}" class="option-pill ${options.sweetness === v ? 'active' : ''}">${v === 'Less' ? 'Kurang (Less)' : v}</button>`).join('')}</div></div><div class="option-group"><div class="option-title"><b>Takaran Es</b><span>Pilih salah satu</span></div><div class="option-pills">${['Normal', 'Sedikit Es', 'Tanpa Es'].map(v => `<button type="button" data-ice="${v}" class="option-pill ${options.ice === v ? 'active' : ''}">${v}</button>`).join('')}</div></div>` : ''}<div class="detail-bottom"><div class="qty-row"><span>Jumlah Pesanan</span><div class="qty-control"><button id="minus" type="button" aria-label="Kurangi">${icon('minus', 16)}</button><b id="qtyDisplay">${quantity}</b><button id="plus" type="button" aria-label="Tambah">${icon('plus', 16)}</button></div></div><button id="addToCart" class="btn btn-primary btn-wide btn-large" ${p.isAvailable ? '' : 'disabled'}>${p.isAvailable ? `Tambah ke Keranjang • <span id="cartBtnPrice">${money(calcUnitPrice() * quantity)}</span>` : 'Menu Sedang Habis'}</button></div></section></main>`, { tableName: table.name, className: 'detail-shell' });

  const updatePriceAndQty = () => { $('#unitPriceDisplay').textContent = money(calcUnitPrice()); $('#qtyDisplay').textContent = String(quantity); $('#cartBtnPrice').textContent = money(calcUnitPrice() * quantity); };
  $('#back').onclick = () => nav(`/order/${encodeURIComponent(table.publicToken || tableToken)}/menu`);
  $$('[data-size]').forEach(b => b.onclick = () => { alarm.unlock(); options.size = b.dataset.size; $$('[data-size]').forEach(x => x.classList.toggle('active', x.dataset.size === options.size)); updatePriceAndQty(); });
  $$('[data-sweet]').forEach(b => b.onclick = () => { alarm.unlock(); options.sweetness = b.dataset.sweet; $$('[data-sweet]').forEach(x => x.classList.toggle('active', x.dataset.sweet === options.sweetness)); });
  $$('[data-ice]').forEach(b => b.onclick = () => { alarm.unlock(); options.ice = b.dataset.ice; $$('[data-ice]').forEach(x => x.classList.toggle('active', x.dataset.ice === options.ice)); });
  $('#minus').onclick = () => { alarm.unlock(); quantity = Math.max(1, quantity - 1); updatePriceAndQty(); };
  $('#plus').onclick = () => { alarm.unlock(); if (quantity >= 20) return toast('Maksimal 20 porsi.', true); quantity++; updatePriceAndQty(); };
  $('#addToCart').onclick = () => { alarm.unlock(); if (!p.isAvailable) return; addCartItem(p, { quantity, options }); nav(`/order/${encodeURIComponent(table.publicToken || tableToken)}/menu`); };
}

async function cartPage() {
  const c = getCart(); if (!c.tableToken) return nav('/');
  const [settings, products] = await Promise.all([api('/public/settings'), api('/public/products')]);
  const addTo = getAddTo(); if (addTo) c.customerType = addTo.customerType;
  recalculateCartItems(c, products); setCart(c);

  const renderCartView = () => {
    const cc = getCart(); const sub = cartTotal(cc); const regSub = cartRegularTotal(cc); const savings = cartSavings(cc); const isStud = isStudent(cc);
    const hasUnavailable = cc.items.some(i => i.isAvailable === false);
    const fee = Math.round(sub * Number(settings.serviceFee || 0) / 100); const tax = Math.round((sub + fee) * Number(settings.taxPercent || 0) / 100); const total = sub + fee + tax;
    document.body.className = 'customer-body cart-body';
    document.body.innerHTML = customerShell(`<main class="simple-customer-page"><div class="customer-page-title"><button id="back" class="circle-back" aria-label="Kembali">${icon('back', 18)}</button><h1>Keranjang Belanja</h1></div><div id="cartRoleBox">${customerRoleSwitcher(cc)}</div>${hasUnavailable ? `<div style="background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:12px 16px;border-radius:12px;margin-bottom:12px;font-size:12.5px;display:flex;align-items:center;gap:10px;"><span>⚠️</span><div><b>Perhatian:</b> Ada menu yang kehabisan stok di keranjang Anda. Harap hapus menu bertanda merah untuk melanjutkan pembayaran.</div></div>` : ''}${savings > 0 ? `<div class="student-savings-banner"><div class="banner-icon">🎉</div><div class="banner-text"><b>Kamu Hemat ${money(savings)} dengan Harga Pelajar!</b><small>Pastikan membawa Kartu Pelajar / KTM saat pembayaran atau pengambilan pesanan.</small></div></div>` : ''}${cc.items.length ? `<section class="cart-list">${cc.items.map((i, idx) => `<article class="cart-row"><img src="${esc(i.imageUrl || '/assets/iced-latte.jpg')}" alt=""><div class="cart-row-main"><div class="cart-row-title"><b>${esc(i.name)}</b><button data-remove="${idx}" class="plain-icon danger" aria-label="Hapus">${icon('trash', 16)}</button></div>${i.isAvailable === false ? '<span class="badge-soldout-chip">⚠️ Stok Habis</span>' : ''}<small>${esc(optionSummary(i))}</small><div style="display:flex;align-items:center;gap:6px;"><strong class="item-price">${money(i.price)}</strong>${i.savings ? `<small style="color:#2c8b5b;font-weight:700;font-size:11px;">(Hemat ${money(i.savings)})</small>` : ''}</div></div><div class="qty-control"><button data-minus="${idx}" aria-label="Kurang">${icon('minus', 14)}</button><b>${i.quantity}</b><button data-plus="${idx}" aria-label="Tambah">${icon('plus', 14)}</button></div></article>`).join('')}</section><section class="payment-summary"><h3>Rincian Pembayaran</h3>${savings > 0 ? `<div><span>Subtotal Reguler</span><span style="text-decoration:line-through;color:var(--muted);">${money(regSub)}</span></div><div class="student-savings-row"><span>🎉 Subsidi Harga Pelajar</span><strong>- ${money(savings)}</strong></div>` : ''}<div><span>Subtotal</span><b>${money(sub)}</b></div>${fee ? `<div><span>Biaya Layanan (${settings.serviceFee}%)</span><b>${money(fee)}</b></div>` : ''}${tax ? `<div><span>Pajak (${settings.taxPercent}%)</span><b>${money(tax)}</b></div>` : ''}<hr><div class="summary-total"><span>Total Bayar</span><strong>${money(total)}</strong></div></section><div class="sticky-customer-cta">${hasUnavailable ? `<button type="button" class="btn btn-primary btn-wide btn-large" disabled style="opacity:0.6;cursor:not-allowed;">Hapus Menu Habis untuk Lanjut</button>` : `<a class="btn btn-primary btn-wide btn-large" data-nav href="/checkout">Lanjut ke Pembayaran • ${money(total)}</a>`}</div>` : `<section class="empty-page">${icon('cart', 44)}<h2>Keranjang masih kosong</h2><p>Yuk, pilih menu favoritmu di Cafe Campus.</p><a class="btn btn-primary btn-large" data-nav href="/order/${encodeURIComponent(cc.tableToken)}/menu">Lihat Menu</a></section>`}</main>`, { tableName: cc.tableName, className: 'simple-shell' });
    $('#back').onclick = () => nav(`/order/${encodeURIComponent(cc.tableToken)}/menu`);
    $$('[data-set-role]').forEach(btn => { btn.onclick = () => { alarm.unlock(); const role = btn.dataset.setRole; let curr = getCart(); curr.customerType = role; recalculateCartItems(curr, products); setCart(curr); toast(role === 'STUDENT' ? '🎓 Mode Pelajar aktif: Harga spesial diterapkan!' : '☕ Mode Pelanggan Umum aktif'); renderCartView(); }; });
    $$('[data-minus]').forEach(b => b.onclick = () => { alarm.unlock(); const curr = getCart(), i = +b.dataset.minus; curr.items[i].quantity--; if (curr.items[i].quantity <= 0) curr.items.splice(i, 1); setCart(curr); renderCartView(); });
    $$('[data-plus]').forEach(b => b.onclick = () => { alarm.unlock(); const curr = getCart(), i = +b.dataset.plus; if (curr.items[i].quantity >= 20) return toast('Maksimal 20 porsi.', true); curr.items[i].quantity++; setCart(curr); renderCartView(); });
    $$('[data-remove]').forEach(b => b.onclick = () => { alarm.unlock(); const curr = getCart(); curr.items.splice(+b.dataset.remove, 1); setCart(curr); renderCartView(); });
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
        if (w > maxWidth) { h = Math.round(h * (maxWidth / w)); w = maxWidth; }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
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
  let stream = null; let facingMode = 'environment';
  const d = modal(`<div class="modal-heading"><div><span>AI KTM SCANNER CAMERA (REAL-TIME)</span><h2>Pindai Kartu Tanda Mahasiswa (KTM)</h2></div></div><div class="camera-stream-wrapper" style="aspect-ratio:16/10;"><video id="cameraVideo" class="camera-video" autoplay playsinline muted></video><div class="camera-overlay-hud"><div class="camera-hud-badge">🔴 LIVE KTM SCANNER CAMERA</div><div class="camera-guide-frames" style="justify-content:center;"><div class="guide-box card-box" style="width:88%;height:85%;border-radius:12px;border:2px dashed #22c55e;background:rgba(0,0,0,0.2);">🪪 Posisikan Kartu Tanda Mahasiswa (KTM) di Dalam Bingkai</div></div><div style="text-align:center;font-size:11px;color:#fff;background:rgba(0,0,0,0.65);padding:4px 8px;border-radius:6px;">Posisikan kartu agar teks dan foto terbaca jelas. AI akan memindai secara instan.</div></div></div><canvas id="cameraCanvas" style="display:none;"></canvas><div class="camera-controls-bar"><button type="button" class="btn btn-soft" id="btnToggleFacing">🔄 Putar Kamera</button><button type="button" class="btn-snap-photo" id="btnSnap">📸 Pindai Kartu Sekarang</button><button type="button" class="btn btn-dark" id="btnCloseCamera">Batal</button></div>`, 'live-camera-modal');

  const video = $('#cameraVideo', d); const canvas = $('#cameraCanvas', d); const snapBtn = $('#btnSnap', d); const toggleBtn = $('#btnToggleFacing', d); const closeBtn = $('#btnCloseCamera', d);

  const startStream = async () => {
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Browser tidak mendukung WebRTC camera stream.');
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      video.srcObject = stream;
      if (facingMode === 'user') video.classList.remove('back-camera'); else video.classList.add('back-camera');
    } catch (err) {
      d.remove();
      const fallbackInput = document.createElement('input'); fallbackInput.type = 'file'; fallbackInput.accept = 'image/*';
      fallbackInput.onchange = async (e) => { const file = e.target.files?.[0]; if (file) { const compressed = await compressImage(file, 900, 0.85); onCapture(compressed); } };
      fallbackInput.click(); return;
    }
  };
  const stopStream = () => { if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } };
  await startStream();

  closeBtn.onclick = () => { stopStream(); d.remove(); };
  toggleBtn.onclick = async () => { facingMode = facingMode === 'user' ? 'environment' : 'user'; await startStream(); };
  snapBtn.onclick = () => {
    if (!video.videoWidth || !video.videoHeight) return toast('Kamera sedang memuat, mohon tunggu sebentar...', true);
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (facingMode === 'user') { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const photoData = canvas.toDataURL('image/jpeg', 0.85);
    stopStream(); d.remove(); onCapture(photoData);
  };
}

function parseKtmFromScan(photoData, faculties = [], existingInfo = null) {
  if (existingInfo && existingInfo.studentId && existingInfo.studentName && existingInfo.campus) {
    if (!/\b(smp|smpn|sma|sman|smk|smkn|sd|peserta didik)\b/i.test(existingInfo.campus)) {
      return {
        ...existingInfo,
        studentPhoto: photoData || existingInfo.studentPhoto,
        emailVerified: true
      };
    }
  }
  return null;
}

function renderExtractedKtmCard(info) {
  if (!info || !info.studentId) return '';
  const facColor = info.facultyColor || '#0284c7';
  const badgeText = info.isAiScanned !== false 
    ? `✅ Terverifikasi Gemini AI (${info.confidence || '99.4%'})` 
    : `✅ Terverifikasi Valid (${info.confidence || '95%'})`;
  return `
    <div class="ktm-extracted-card">
      <div class="ktm-extracted-head">
        <strong>🛡️ DESKRIPSI LENGKAP HASIL PEMINDAIAN AI</strong>
        <span class="ktm-badge-verified-ai">${badgeText}</span>
      </div>
      <div class="ktm-extracted-grid">
        <div class="ktm-extracted-row full">
          <span>Nama Lengkap Mahasiswa</span>
          <b style="font-size:14px;color:#166534;">🎓 ${esc(info.studentName || '-')}</b>
        </div>
        <div class="ktm-extracted-row">
          <span>Asal Universitas / Kampus</span>
          <b>🏛️ ${esc(info.campus || '-')}</b>
        </div>
        <div class="ktm-extracted-row">
          <span>Nomor Induk Mahasiswa (NIM)</span>
          <b style="font-family:monospace;letter-spacing:1px;color:#0369a1;">🪪 ${esc(info.studentId || '-')}</b>
        </div>
        <div class="ktm-extracted-row">
          <span>Fakultas Terdaftar</span>
          <div>
            <span class="ktm-faculty-chip" style="background:${esc(facColor)}18;color:${esc(facColor)};border:1px solid ${esc(facColor)}44;">
              🏢 ${esc(info.facultyName || info.facultyCode || 'Fakultas Umum')}
            </span>
          </div>
        </div>
        <div class="ktm-extracted-row">
          <span>Program Studi (Jurusan)</span>
          <b>📚 ${esc(info.studyProgram || 'Reguler')}</b>
        </div>
        <div class="ktm-extracted-row">
          <span>Status Keaktifan</span>
          <b style="color:#15803d;">✅ Mahasiswa Aktif 2026</b>
        </div>
        <div class="ktm-extracted-row">
          <span>Email Institusi Resmi</span>
          <b style="color:#475569;font-size:12px;">📧 ${esc(info.email || (info.studentId ? `${info.studentId}@ui.ac.id` : 'mahasiswa@kampus.ac.id'))}</b>
        </div>
      </div>
      <div class="ktm-extracted-actions">
        <small style="color:#64748b;">✨ Data diekstrak otomatis secara real-time dari foto KTM.</small>
        <button type="button" class="btn btn-soft btn-small" id="btnQuickEditKtm" style="font-size:11px;">✏️ Sesuaikan Data</button>
      </div>
    </div>
  `;
}

function openQuickKtmEditModal(currentInfo, faculties, onSave) {
  const d = modal(`
    <div class="dialog wide-dialog">
      <div class="modal-heading">
        <div>
          <span>PENYESUAIAN DATA HASIL SCAN</span>
          <h2>Edit Data KTM Mahasiswa</h2>
        </div>
      </div>
      <form id="formEditKtm" class="form-grid" style="margin-top:12px;">
        <label class="full">
          Nama Lengkap Mahasiswa
          <input class="input" id="editKtmName" value="${esc(currentInfo?.studentName || '')}" required placeholder="Contoh: Rian Ardiansyah">
        </label>
        <label>
          Asal Kampus / Universitas
          <input class="input" id="editKtmCampus" value="${esc(currentInfo?.campus || '')}" required placeholder="Contoh: Universitas Indonesia">
        </label>
        <label>
          Nomor Induk Mahasiswa (NIM)
          <input class="input" id="editKtmNim" value="${esc(currentInfo?.studentId || '')}" required placeholder="Contoh: 2106781290">
        </label>
        <label class="full">
          Fakultas
          <select class="input" id="editKtmFaculty">
            ${faculties.map(f => `<option value="${esc(f.id)}" data-code="${esc(f.code)}" data-name="${esc(f.name)}" data-color="${esc(f.colorTheme || '#0284c7')}" ${currentInfo?.facultyId === f.id ? 'selected' : ''}>${esc(f.name)} (${esc(f.code)})</option>`).join('')}
          </select>
        </label>
        <label>
          Program Studi (Jurusan)
          <input class="input" id="editKtmProgram" value="${esc(currentInfo?.studyProgram || '')}" placeholder="Contoh: Sistem Informasi">
        </label>
        <label>
          Email Institusi (.ac.id)
          <input class="input" id="editKtmEmail" type="email" value="${esc(currentInfo?.email || '')}" placeholder="nama@kampus.ac.id">
        </label>
        <div class="dialog-actions full" style="margin-top:12px;">
          <button type="button" class="btn btn-soft" data-modal-close>Batal</button>
          <button type="submit" class="btn btn-green">Simpan Perubahan</button>
        </div>
      </form>
    </div>
  `, 'dialog-card wide-dialog');

  $('#formEditKtm', d).onsubmit = (e) => {
    e.preventDefault();
    const facEl = $('#editKtmFaculty', d);
    const selOpt = facEl?.selectedOptions?.[0];
    const updated = {
      ...currentInfo,
      studentName: $('#editKtmName', d).value.trim(),
      campus: $('#editKtmCampus', d).value.trim(),
      studentId: $('#editKtmNim', d).value.trim(),
      facultyId: facEl?.value || null,
      facultyCode: selOpt?.dataset?.code || null,
      facultyName: selOpt?.dataset?.name || null,
      facultyColor: selOpt?.dataset?.color || null,
      studyProgram: $('#editKtmProgram', d).value.trim() || 'Reguler',
      email: $('#editKtmEmail', d).value.trim() || `${$('#editKtmNim', d).value.trim()}@ui.ac.id`,
      emailVerified: true
    };
    d.remove();
    onSave(updated);
  };
}

async function checkoutPage() {
  const c = getCart();
  if (!c.tableToken || !c.items.length) return nav('/cart');
  const [settings, products, faculties] = await Promise.all([
    api('/public/settings'),
    api('/public/products'),
    api('/public/faculties').catch(() => [
      { id: 'fac-1', name: 'Fakultas Ilmu Komputer', code: 'FASILKOM', colorTheme: '#0284c7' },
      { id: 'fac-2', name: 'Fakultas Teknik', code: 'FT', colorTheme: '#d97706' },
      { id: 'fac-3', name: 'Fakultas Kedokteran', code: 'FK', colorTheme: '#059669' },
      { id: 'fac-4', name: 'Fakultas Ekonomi & Bisnis', code: 'FEB', colorTheme: '#be123c' },
      { id: 'fac-5', name: 'Fakultas Hukum', code: 'FH', colorTheme: '#7f1d1d' },
      { id: 'fac-6', name: 'Fakultas Psikologi', code: 'FPsi', colorTheme: '#7c3aed' }
    ])
  ]);
  const addTo = getAddTo(); if (addTo) c.customerType = addTo.customerType;
  recalculateCartItems(c, products); setCart(c);

  const hasTobacco = c.items.some(i => {
    const p = products.find(x => x.id === i.productId);
    return Boolean(p && (p.isTobacco || p.categorySlug === 'rokok'));
  });
  const hasUnavailableItem = c.items.some(i => i.isAvailable === false);

  let method = settings.qrisEnabled !== false ? 'QRIS_DEMO' : 'CASH';
  const idemKey = 'cc_demo_checkout_idem_v6';
  let idem = sessionStorage.getItem(idemKey) || genUUID(); sessionStorage.setItem(idemKey, idem);

  let studentPhotoData = c.studentInfo?.studentPhoto || null;

  const sub = cartTotal(c); const regSub = cartRegularTotal(c); const savings = cartSavings(c); const isStud = isStudent(c);
  const fee = Math.round(sub * Number(settings.serviceFee || 0) / 100); const tax = Math.round((sub + fee) * Number(settings.taxPercent || 0) / 100); const total = sub + fee + tax;

  document.body.className = 'customer-body checkout-body';
  document.body.innerHTML = customerShell(`<main class="simple-customer-page checkout-page"><div class="customer-page-title"><button id="back" class="circle-back" aria-label="Kembali">${icon('back', 18)}</button><h1>${addTo ? 'Bayar Pesanan Tambahan' : 'Pilih Pembayaran'}</h1></div><div class="checkout-grid"><section class="checkout-summary-section">${addTo ? `<div class="addon-info-card"><b>➕ Tambahan untuk pesanan #${esc(addTo.orderNumber)}</b><small>Data verifikasi pelajar dan meja otomatis mengikuti pesanan utama, jadi tidak perlu diisi lagi.</small></div>` : ''}${hasUnavailableItem ? `<div class="tobacco-cart-notice" style="background:#fef2f2;border-color:#fca5a5;color:#991b1b;"><span style="font-size:22px;">⚠️</span><div><b>Menu Kehabisan Stok:</b><small style="display:block;margin-top:2px;">Beberapa menu di keranjang Anda sudah habis (sold out). Silakan kembali ke keranjang untuk menghapusnya sebelum melanjutkan.</small></div></div>` : ''}${hasTobacco ? `<div class="tobacco-cart-notice"><span style="font-size:22px;">🔞</span><div><b>Peringatan Produk Tembakau (21+):</b><small style="display:block;margin-top:2px;">Pesanan Anda mengandung rokok/tembakau. Sesuai regulasi pemerintah, pembeli wajib berusia 21 tahun ke atas dan tidak berhak atas diskon pelajar.</small></div></div>` : ''}${isStud && !addTo ? `
    <div class="ktm-scan-container" id="ktmScanContainer">
      <div class="ktm-scan-header">
        <h4>🪪 Verifikasi Mahasiswa Real-Time (Scan KTM)</h4>
        <span class="badge-role-student">Diskon Pelajar Aktif</span>
      </div>
      <p class="ktm-scan-subtext">
        Cukup foto atau upload Kartu Tanda Mahasiswa (KTM) Anda. Sistem AI Scanner Cafe Campus akan memindai Nama, Kampus, Fakultas, dan NIM secara otomatis & real-time tanpa perlu repot mengisi formulir manual!
      </p>

      <div class="ktm-scan-btn-row">
        <button type="button" class="ktm-action-btn ktm-btn-camera" id="btnLaunchKtmCamera">
          📸 Foto KTM (Kamera Langsung)
        </button>
        <button type="button" class="ktm-action-btn ktm-btn-upload" id="btnUploadKtmFile">
          📁 Upload Foto / Galeri KTM
        </button>
        <input type="file" id="ktmFileInput" accept="image/*" style="display:none;">
      </div>

      <div class="ktm-scan-viewport ${studentPhotoData ? 'has-image' : ''}" id="ktmViewport">
        ${studentPhotoData ? `
          <img id="ktmScannedImg" src="${esc(studentPhotoData)}" alt="KTM Card">
        ` : `
          <div class="ktm-scan-placeholder" id="ktmPlaceholder">
            <div class="scan-icon">🪪</div>
            <b>Belum Ada Foto KTM</b>
            <small>Klik tombol kamera atau upload foto kartu pelajar Anda</small>
          </div>
        `}

        <div class="ktm-laser-hud" id="ktmLaserHud" style="display:none;">
          <div class="ktm-corner ktm-corner-tl"></div>
          <div class="ktm-corner ktm-corner-tr"></div>
          <div class="ktm-corner ktm-corner-bl"></div>
          <div class="ktm-corner ktm-corner-br"></div>
          <div class="ktm-laser-line"></div>
          <div class="ktm-hud-badge">⚡ MEMINDAI KTM REAL-TIME...</div>
          <div class="ktm-hud-status-bottom" id="ktmHudStatus">🔍 Mendeteksi kontur kartu & barcode...</div>
        </div>
      </div>

      <div id="ktmExtractedBox" style="${c.studentInfo?.studentId ? '' : 'display:none;'}">
        ${renderExtractedKtmCard(c.studentInfo)}
      </div>

      <div class="quota-notice-badge" style="margin-top:14px;">
        <span>🔒</span>
        <div><b>Anti-Sybil Quota:</b> Diskon pelajar dibatasi maksimal 1 pesanan per hari per identitas (NIM/KTM) untuk mencegah penyalahgunaan.</div>
      </div>
    </div>
  ` : ''}<div class="checkout-order-card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"><h3 style="margin:0;">Ringkasan Pesanan (${esc(c.tableName || 'Meja')})</h3><span class="${isStud ? 'badge-role-student' : 'badge-role-regular'}">${isStud ? '🎓 Pelajar' : '☕ Umum'}</span></div>${c.items.map(i => `<div class="checkout-item"><div><b>${i.quantity}x ${esc(i.name)}</b>${i.isAvailable === false ? '<span class="badge-soldout-chip" style="display:inline-block;margin-left:6px;">⚠️ Habis</span>' : ''}<small>${esc(optionSummary(i))}</small>${i.savings ? `<small style="color:#2c8b5b;display:block;font-weight:700;">Hemat ${money(i.savings)}</small>` : ''}</div><strong>${money(i.price * i.quantity)}</strong></div>`).join('')}<div class="payment-summary compact">${savings > 0 ? `<div><span>Subtotal Reguler</span><span style="text-decoration:line-through;color:var(--muted);">${money(regSub)}</span></div><div class="student-savings-row"><span>🎉 Subsidi Harga Pelajar</span><strong>- ${money(savings)}</strong></div>` : ''}<div><span>Subtotal</span><b>${money(sub)}</b></div>${fee ? `<div><span>Biaya Layanan (${settings.serviceFee}%)</span><b>${money(fee)}</b></div>` : ''}${tax ? `<div><span>Pajak (${settings.taxPercent}%)</span><b>${money(tax)}</b></div>` : ''}<hr><div class="summary-total"><span>Total Pembayaran</span><strong>${money(total)}</strong></div></div></div></section><section class="payment-methods"><h3>Pilih Metode Pembayaran</h3><div id="paymentChoiceList">${settings.qrisEnabled !== false ? `<button type="button" class="payment-choice ${method === 'QRIS_DEMO' ? 'selected' : ''}" data-pay="QRIS_DEMO"><div class="payment-choice-icon qris-icon">QR</div><div><b>QRIS</b><span>Bayar instan via BCA, GoPay, OVO, ShopeePay</span></div><i></i></button>` : ''}${settings.cashEnabled !== false ? `<button type="button" class="payment-choice ${method === 'CASH' ? 'selected' : ''}" data-pay="CASH"><div class="payment-choice-icon">${icon('cart', 19)}</div><div><b>Bayar di Kasir (Tunai)</b><span>Lakukan pembayaran langsung ke meja kasir</span></div><i></i></button>` : ''}</div><div class="demo-payment-note">ℹ️ <b>Mode Demo:</b> QRIS adalah simulasi sandbox (tidak menggunakan saldo nyata).</div><button id="place" class="btn btn-primary btn-wide btn-large" ${hasUnavailableItem ? 'disabled style="opacity:0.6;cursor:not-allowed;"' : ''}>${hasUnavailableItem ? 'Menu Habis — Cek Keranjang' : `Konfirmasi Pesanan • ${money(total)}`}</button></section></div></main>`, { tableName: c.tableName, className: 'simple-shell' });

  $('#back').onclick = () => nav('/cart');
  $$('[data-pay]').forEach(b => b.onclick = () => { alarm.unlock(); method = b.dataset.pay; $$('[data-pay]').forEach(x => x.classList.toggle('selected', x.dataset.pay === method)); });

  // Event handlers untuk Scanning KTM Real-Time
  const bindKtmEvents = () => {
    const btnCamera = $('#btnLaunchKtmCamera');
    const btnUpload = $('#btnUploadKtmFile');
    const fileInput = $('#ktmFileInput');
    const viewport = $('#ktmViewport');
    const extractedBox = $('#ktmExtractedBox');

    const triggerScanProcess = async (photoData) => {
      studentPhotoData = photoData;
      viewport.classList.add('has-image');
      viewport.innerHTML = `<img id="ktmScannedImg" src="${studentPhotoData}" alt="KTM Card">
        <div class="ktm-laser-hud" id="ktmLaserHud">
          <div class="ktm-corner ktm-corner-tl"></div>
          <div class="ktm-corner ktm-corner-tr"></div>
          <div class="ktm-corner ktm-corner-bl"></div>
          <div class="ktm-corner ktm-corner-br"></div>
          <div class="ktm-laser-line"></div>
          <div class="ktm-hud-badge">⚡ MEMINDAI KTM DENGAN GEMINI AI...</div>
          <div class="ktm-hud-status-bottom" id="ktmHudStatus">🔍 Mengirim citra ke Gemini Vision OCR...</div>
        </div>`;
      
      const curHud = $('#ktmLaserHud', viewport);
      const curStatus = $('#ktmHudStatus', viewport);
      if (curHud) curHud.style.display = 'flex';

      const t1 = setTimeout(() => { if (curStatus) curStatus.textContent = '⚡ Gemini AI membaca teks Nama, NIM & Kampus...'; }, 500);
      const t2 = setTimeout(() => { if (curStatus) curStatus.textContent = '🤖 Mengidentifikasi Fakultas & Program Studi...'; }, 1100);

      try {
        const res = await api('/public/scan-ktm', {
          method: 'POST',
          body: JSON.stringify({
            image: studentPhotoData,
            existingInfo: c.studentInfo
          })
        });

        clearTimeout(t1);
        clearTimeout(t2);
        if (curHud) curHud.style.display = 'none';

        if (res && res.data && res.data.isValidKtm !== false) {
          const parsed = res.data;
          c.studentInfo = parsed;
          setCart(c);

          if (extractedBox) {
            extractedBox.innerHTML = renderExtractedKtmCard(parsed);
            extractedBox.style.display = 'block';
            bindEditBtn();
          }
          toast(`✅ Scan KTM Berhasil! ${parsed.studentName || 'Mahasiswa'} (${parsed.campus || 'Kampus'}) terverifikasi.`);
        } else {
          throw new Error(res.message || res.error || 'Kartu tidak valid');
        }
      } catch (err) {
        clearTimeout(t1);
        clearTimeout(t2);
        if (curHud) curHud.style.display = 'none';

        const errData = err.data || {};
        const isRejection = err.status === 422 || errData.isValidKtm === false || /bukan kartu tanda mahasiswa|bukan ktm|kartu ditolak|kartu pelajar|peserta didik|sekolah/i.test(err.message);

        if (isRejection) {
          // Kartu BUKAN KTM Mahasiswa -> DITOLAK
          c.studentInfo = null;
          setCart(c);

          const rejectionMsg = errData.message || errData.error || err.message;
          const detectedTitle = errData.detectedTitle || errData.cardType || 'Kartu Bukan KTM';

          if (extractedBox) {
            extractedBox.innerHTML = `
              <div class="ktm-rejected-card" style="background:#fff1f2; border:1.5px solid #f43f5e; border-radius:14px; padding:18px; margin:16px 0; box-shadow:0 4px 12px rgba(244,63,94,0.12); animation:pulse 0.3s ease;">
                <div style="display:flex; align-items:flex-start; gap:14px;">
                  <span style="font-size:28px; line-height:1;">⛔</span>
                  <div style="flex:1;">
                    <h4 style="margin:0 0 6px 0; color:#9f1239; font-size:15px; font-weight:700;">Pemindaian Ditolak: Khusus KTM Mahasiswa</h4>
                    <p style="margin:0 0 10px 0; font-size:13px; color:#881337; line-height:1.5;">${esc(rejectionMsg)}</p>
                    <div style="background:#ffe4e6; border-radius:8px; padding:8px 12px; font-size:11.5px; color:#9f1239; display:flex; flex-direction:column; gap:4px;">
                      <div>📋 <b>Kartu Terdeteksi:</b> ${esc(detectedTitle)}</div>
                      <div>🎓 <b>Ketentuan:</b> Diskon dan harga mahasiswa HANYA berlaku untuk Mahasiswa aktif Perguruan Tinggi / Universitas resmi.</div>
                    </div>
                    <div style="margin-top:14px; display:flex; gap:8px;">
                      <button type="button" class="btn btn-outline" id="btnRetryKtm" style="border-color:#e11d48; color:#e11d48; font-size:12.5px; padding:8px 16px;">📸 Pindai Ulang KTM Mahasiswa Asli</button>
                    </div>
                  </div>
                </div>
              </div>
            `;
            extractedBox.style.display = 'block';

            const retryBtn = $('#btnRetryKtm', extractedBox);
            if (retryBtn) {
              retryBtn.onclick = () => {
                if (btnCamera) btnCamera.click();
              };
            }
          }

          toast(`⛔ ${rejectionMsg}`, true);
          return;
        }

        console.warn('Scan KTM technical error:', err);
        toast(`Gagal memindai KTM: ${err.message}. Silakan coba lagi.`, true);
      }
    };

    const bindEditBtn = () => {
      const editBtn = $('#btnQuickEditKtm');
      if (editBtn) {
        editBtn.onclick = () => {
          openQuickKtmEditModal(c.studentInfo, faculties, (updated) => {
            c.studentInfo = updated;
            setCart(c);
            if (extractedBox) extractedBox.innerHTML = renderExtractedKtmCard(updated);
            bindEditBtn();
            toast('Data KTM berhasil diperbarui!');
          });
        };
      }
    };
    bindEditBtn();

    if (btnCamera) btnCamera.onclick = () => openLiveCameraModal(photo => triggerScanProcess(photo));
    if (btnUpload && fileInput) {
      btnUpload.onclick = () => fileInput.click();
      fileInput.onchange = async (e) => {
        const file = e.target.files?.[0];
        if (file) {
          try {
            const compressed = await compressImage(file, 900, 0.85);
            triggerScanProcess(compressed);
          } catch(err) {
            toast(err.message, true);
          }
        }
      };
    }
    if (viewport) {
      viewport.onclick = () => {
        if (!studentPhotoData) openLiveCameraModal(photo => triggerScanProcess(photo));
      };
    }
  };
  bindKtmEvents();

  $('#place').onclick = async () => {
    alarm.unlock(); const btn = $('#place');
    if (c.items.some(i => i.isAvailable === false)) {
      return toast('Ada menu yang kehabisan stok di keranjang Anda. Silakan kembali dan hapus item tersebut.', true);
    }
    let studentData = null;

    if (isStud && !addTo) {
      if (!studentPhotoData || !c.studentInfo || !c.studentInfo.studentId || c.studentInfo.isValidKtm === false) {
        return toast('⛔ Harap foto atau upload Kartu Tanda Mahasiswa (KTM) Perguruan Tinggi resmi terlebih dahulu untuk verifikasi diskon.', true);
      }
      studentData = {
        studentName: c.studentInfo.studentName || 'Mahasiswa Terverifikasi',
        campus: c.studentInfo.campus || 'Universitas Indonesia',
        studentId: c.studentInfo.studentId || `${Math.floor(2106000000 + Math.random() * 999999)}`,
        email: c.studentInfo.email || `${c.studentInfo.studentId}@ui.ac.id`,
        emailVerified: true,
        studentPhoto: studentPhotoData,
        facultyId: c.studentInfo.facultyId || null,
        facultyCode: c.studentInfo.facultyCode || null,
        facultyName: c.studentInfo.facultyName || null,
        facultyColor: c.studentInfo.facultyColor || null,
        studyProgram: c.studentInfo.studyProgram || 'Sistem Informasi',
        birthDate: c.studentInfo.birthDate || '2004-05-14'
      };
      c.studentInfo = studentData; setCart(c);
    }
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Memproses pesanan...';

    try {
      const r = await api('/orders', {
        method: 'POST',
        body: JSON.stringify({
          tableToken: c.tableToken,
          customerType: isStud ? 'STUDENT' : 'REGULAR',
          studentInfo: studentData,
          parentOrder: addTo ? { orderNumber: addTo.orderNumber, accessToken: addTo.accessToken } : undefined,
          items: c.items.map(i => ({ productId: i.productId, quantity: i.quantity, options: i.options })),
          paymentMethod: method,
          idempotencyKey: idem
        })
      });
      sessionStorage.setItem('cc_access_' + r.orderNumber, r.accessToken);
      sessionStorage.setItem('cc_table_' + r.orderNumber, c.tableToken);
      if (!addTo) localStorage.setItem('cc_active_order', JSON.stringify({ orderNumber: r.orderNumber, accessToken: r.accessToken, tableName: c.tableName, tableToken: c.tableToken, status: r.status, total: r.total, at: Date.now() }));
      sessionStorage.removeItem(idemKey);
      
      const targetOrderNumber = addTo ? addTo.orderNumber : r.orderNumber;
      sessionStorage.setItem('cc_show_stay_alert_' + targetOrderNumber, '1');

      clearCart();
      if (addTo) clearAddTo();
      
      if (r.paymentUrl) window.location.href = r.paymentUrl;
      else nav('/track/' + targetOrderNumber);
    } catch (e) {
      toast(e.message, true);
      btn.disabled = false;
      btn.textContent = `Konfirmasi Pesanan • ${money(total)}`;
    }
  };
}

function trackAddonsSection(o, access) {
  if (o.parentOrderNumber) {
    const hasParent = !!sessionStorage.getItem('cc_access_' + o.parentOrderNumber);
    return `<section class="track-addons"><h3>Pesanan Tambahan</h3><p class="muted">Ini pesanan tambahan dari <b>#${esc(o.parentOrderNumber)}</b>.</p>${hasParent ? `<a class="btn btn-soft btn-small" data-nav href="/track/${encodeURIComponent(o.parentOrderNumber)}">Lihat pesanan utama</a>` : ''}</section>`;
  }
  const addons = Array.isArray(o.addons) ? o.addons : [];
  const closed = o.status === 'COMPLETED' || o.status === 'CANCELLED' || o.payment?.status === 'FAILED';
  return `<section class="track-addons"><h3>Pesanan Tambahan</h3>${addons.length ? addons.map(a => {
    if (a.accessToken) sessionStorage.setItem('cc_access_' + a.orderNumber, a.accessToken);
    const paid = a.payment?.status === 'PAID';
    return `<a class="addon-row" data-nav href="/track/${encodeURIComponent(a.orderNumber)}"><div><b>#${esc(a.orderNumber)}</b><small>${esc((a.items || []).map(i => `${i.productName} x${i.quantity}`).join(', '))}</small></div><div class="addon-row-right"><b>${money(a.total)}</b><span class="pay-status-pill ${paid ? 'paid' : 'pending'}"><i class="pay-dot"></i>${paid ? 'Lunas' : 'Pending'}</span></div></a>`;
  }).join('') : '<p class="muted">Belum ada pesanan tambahan.</p>'}${closed ? '' : `<button type="button" class="btn btn-primary btn-wide" id="btnAddOrder">${icon('plus', 16)} Tambah Pesanan</button>`}</section>`;
}

function trackingTimeline(o) {
  const steps = [['NEW', 'Pesanan Diterima', 'Pesanan sudah tercatat di antrean kasir'], ['PROCESSING', 'Sedang Disiapkan Barista', 'Kopi & makanan Anda sedang diracik dengan penuh cinta'], ['READY', 'Pesanan Siap Diambil', 'Silakan ambil pesanan Anda di counter pick-up'], ['COMPLETED', 'Pesanan Selesai', 'Terima kasih atas kunjungan Anda di Cafe Campus']];
  const index = { NEW: 0, PROCESSING: 1, READY: 2, COMPLETED: 3, CANCELLED: -1 }[o.status] ?? 0;
  return `<div class="track-timeline">${steps.map((s, i) => `<div class="track-step ${i < index ? 'done' : ''} ${i === index ? 'current' : ''}"><div class="track-node">${i < index ? icon('check', 12) : ''}</div><div><b>${s[1]}</b><span>${s[2]}</span></div></div>`).join('')}</div>`;
}

async function trackPage(orderNumber) {
  const access = sessionStorage.getItem('cc_access_' + orderNumber);
  if (!access) {
    document.body.innerHTML = customerShell(`<main class="empty-page"><h2>Akses pesanan tidak ditemukan</h2><p>Buka status pesanan dari browser yang digunakan saat melakukan pemesanan.</p><a class="btn btn-primary" data-nav href="/">Kembali ke Beranda</a></main>`);
    return;
  }
  let o = await api('/orders/' + encodeURIComponent(orderNumber) + '?access=' + encodeURIComponent(access));
  if (!o.parentOrderNumber) updateActiveOrder({ orderNumber: o.orderNumber, accessToken: access, status: o.status, tableName: o.tableName, tableToken: sessionStorage.getItem('cc_table_' + orderNumber) || o.tableNumber });
  let readyAlarmTriggered = false; let currentScreenMode = '';
  
  // 1. Wake Lock API: jaga agar layar HP tidak mati saat customer menunggu pesanan
  let wakeLockObj = null;
  const requestWakeLock = async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockObj = await navigator.wakeLock.request('screen');
      }
    } catch { }
  };
  requestWakeLock();

  const onVisibilityChange = async () => {
    if (document.visibilityState === 'visible') {
      if (!wakeLockObj) requestWakeLock();
      await refresh();
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  disposeOnLeave(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    if (wakeLockObj) { try { wakeLockObj.release(); } catch { } wakeLockObj = null; }
  });

  // 2. Daftarkan Web Push Customer agar HP tetap berdering saat tab diclose
  registerPushSubscription('customer', orderNumber);

  const triggerReadyAlarm = () => {
    if (readyAlarmTriggered) return;
    readyAlarmTriggered = true;
    alarm.startAlarm('ready', 30);
    showAlarmBanner(`🔔 PESANAN #${esc(o.orderNumber)} SIAP DIAMBIL!`, 'Pesanan siap diambil di counter pick-up barista.', () => alarm.stopAlarm());
    
    // Push Notification sistem (muncul di layar kunci HP & background)
    const notifTitle = `☕ PESANAN #${o.orderNumber} SIAP DIAMBIL!`;
    const notifBody = `Pesanan di ${o.tableName || 'meja Anda'} sudah selesai diracik. Silakan ambil di kasir/barista sekarang!`;
    const notifUrl = location.href;
    
    const sendSWNotif = async () => {
      try {
        if (!('Notification' in window)) return;
        if (Notification.permission !== 'granted') {
          await Notification.requestPermission();
        }
        if (Notification.permission !== 'granted') return;
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification(notifTitle, {
          body: notifBody,
          icon: '/assets/icon.png',
          badge: '/assets/icon.png',
          vibrate: [800, 200, 800, 200, 1000, 250, 1000, 250, 1500],
          tag: 'order-ready-' + o.orderNumber,
          requireInteraction: true,   // tetap tampil di layar kunci hingga ditutup
          renotify: true,
          silent: false,
          data: { url: notifUrl }
        });
      } catch {
        try {
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(notifTitle, { body: notifBody, icon: '/assets/icon.png' });
          }
        } catch { }
      }
    };
    sendSWNotif();
  };

  const renderReadyScreen = () => {
    currentScreenMode = 'ready'; triggerReadyAlarm();
    document.body.className = 'customer-body ready-body pulse-bg';
    document.body.innerHTML = `<main class="ready-page"><div class="ready-top-brand">${brandMark(36)}<b>Cafe Campus</b></div><div class="ready-center"><div class="ready-check">${icon('check', 44)}</div><span>PESANAN SELESAI DIRACIK</span><h1>Pesanan Siap!</h1><p>Racikan spesial barista kami telah siap dinikmati.</p><div class="pickup-card"><small>KODE AMBIL PESANAN</small><strong>#${esc(o.orderNumber)}</strong><div>${icon('table', 16)} ${esc(o.tableName)}</div></div><p class="ready-note">Silakan ambil pesanan Anda di counter pick-up barista terdekat dengan menunjukkan layar ini.</p><button class="btn btn-primary btn-large btn-wide" id="backMenu">Saya Menuju Kasir</button></div></main>`;
    $('#backMenu').onclick = () => { alarm.stopAlarm(); nav(`/order/${encodeURIComponent(sessionStorage.getItem('cc_table_' + orderNumber) || 'demo-table-01')}/menu`); };
  };

  const renderCompletedScreen = () => {
    currentScreenMode = 'completed'; localStorage.removeItem('cc_active_order'); document.body.className = 'customer-body complete-body';
    document.body.innerHTML = customerShell(`<main class="complete-page"><div class="heart-orb">♡</div><h1>Terima Kasih!</h1><p>Semoga harimu menyenangkan ditemani sajian nikmat dari Cafe Campus.</p><div class="complete-summary"><small>RINGKASAN PESANAN</small><div><span>${esc(o.items.map(i => `${i.productName} x${i.quantity}`).join(', '))}</span><b>Selesai</b></div></div><div class="rating-card"><b>Bagaimana pengalaman kuliner Anda hari ini?</b><div class="stars">${[1, 2, 3, 4, 5].map(i => `<button data-star="${i}" aria-label="Bintang ${i}">${icon('star', 26)}</button>`).join('')}</div><small>Nilai kami untuk terus memberikan yang terbaik!</small></div><button id="orderAgain" class="btn btn-primary btn-wide btn-large">Pesan Lagi</button></main>`, { tableName: o.tableName, className: 'simple-shell' });
    $$('[data-star]').forEach(b => b.onclick = () => { alarm.unlock(); const n = +b.dataset.star; $$('[data-star]').forEach((x, i) => x.classList.toggle('active', i < n)); toast('Terima kasih atas penilaiannya!'); });
    $('#orderAgain').onclick = () => { alarm.stopAlarm(); nav(`/order/${encodeURIComponent(sessionStorage.getItem('cc_table_' + orderNumber) || 'demo-table-01')}/menu`); };
  };

  const renderTrackingCardContent = () => {
    const waiting = o.payment?.status !== 'PAID';
    if (o.status === 'CANCELLED') return `<section class="cancelled-card"><h2>Pesanan Dibatalkan</h2><p>Pesanan ini sudah ditutup. Silakan hubungi staff jika membutuhkan bantuan.</p></section>`;
    return `<section class="tracking-card" id="trackingCardInner">${waiting ? `<div class="payment-wait"><div>${o.payment?.method === 'QRIS_DEMO' || o.payment?.method === 'QRIS' ? 'QR' : '$'}</div><div><b>${o.payment?.method === 'QRIS_DEMO' || o.payment?.method === 'QRIS' ? 'Menunggu Pembayaran QRIS' : 'Menunggu Pembayaran di Kasir'}</b><span>${o.payment?.method === 'QRIS_DEMO' || o.payment?.method === 'QRIS' ? 'Scan QRIS atau tekan tombol simulasi di bawah.' : 'Silakan lakukan pembayaran tunai/debit ke meja kasir.'}</span></div></div>${o.payment?.method === 'QRIS' || o.payment?.method === 'QRIS_DEMO' ? `<div class="qris-demo-box">${o.payment?.qrisUrl ? `<img src="${o.payment.qrisUrl}" alt="QRIS Code" style="width:200px; height:200px; border-radius:12px; margin: 0 auto; display:block;">` : `<div class="fake-qr">${icon('qr', 84)}</div>`}<p>Scan QRIS ini dengan M-Banking atau E-Wallet (GoPay, OVO, ShopeePay, Dana, dll) • <b>${money(o.total)}</b></p><div class="loader-pulse" style="font-size:12px; color:var(--muted); margin-top:8px;">Menunggu pembayaran otomatis...</div><button type="button" class="btn btn-primary btn-wide" id="demoPay" style="margin-top:14px;font-weight:700;box-shadow:0 4px 12px rgba(27,99,58,0.25);">⚡ Simulasikan Pembayaran Berhasil (QRIS)</button></div>` : ''}` : trackingTimeline(o)}</section>`;
  };

  const renderTrackShell = () => {
    currentScreenMode = 'track'; document.body.className = 'customer-body track-body';
    const isGranted = ('Notification' in window && Notification.permission === 'granted');
    const buzzerCardHtml = isGranted
      ? `<div class="buzzer-active-pill">🔔 Buzzer Layar Kunci Aktif — HP Berdering &amp; Bergetar Saat Pesanan Siap</div>`
      : `<div class="buzzer-status-card" id="buzzerCard">
          <div class="buzzer-status-icon">🔔</div>
          <div class="buzzer-status-info">
            <b>Aktifkan Alarm Layar Kunci &amp; Suara</b>
            <small>Izinkan notifikasi agar alarm berbunyi kencang meskipun layar HP mati atau tab ditutup.</small>
          </div>
          <button class="btn btn-primary btn-small" id="btnEnableBuzzer">Aktifkan Alarm</button>
        </div>`;

    document.body.innerHTML = customerShell(`<main class="tracking-page"><div class="tracking-top"><span>STATUS PESANAN</span><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;width:100%;"><div><h1>Pesanan #${esc(o.orderNumber)}</h1><em id="estMinutesText">Estimasi ${o.estimatedMinutes || 10} Mnt</em></div><div class="queue-num-chip"><small>ANTREAN</small><strong>#${esc(o.queueNumber || 'Q-001')}</strong></div></div></div>${buzzerCardHtml}<div class="stay-alert-strip" style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:12px 14px;margin-bottom:12px;display:flex;align-items:flex-start;gap:10px;"><span style="font-size:20px;line-height:1.1;">⚠️</span><div style="flex:1;font-size:12.5px;color:#92400e;line-height:1.4;"><strong style="display:block;margin-bottom:2px;font-size:13px;color:#78350f;">PENTING: Jangan Tutup Halaman Ini</strong>Biarkan tab ini tetap terbuka agar alarm dering &amp; getar pesanan siap bisa langsung berbunyi di HP Anda saat barista memanggil.</div></div>${o.studentInfo ? `<div class="track-verify-card ${o.studentInfo.verificationStatus === 'AUTOMATICALLY_VERIFIED' || o.studentInfo.verificationStatus === 'VERIFIED' ? 'verified' : (o.studentInfo.verificationStatus === 'REJECTED' ? 'rejected' : 'pending')}"><div style="font-size:22px;">${o.studentInfo.verificationStatus === 'AUTOMATICALLY_VERIFIED' || o.studentInfo.verificationStatus === 'VERIFIED' ? '✅' : (o.studentInfo.verificationStatus === 'REJECTED' ? '⚠️' : '⏳')}</div><div style="flex:1;"><b style="font-size:12.5px;display:block;">${o.studentInfo.verificationStatus === 'AUTOMATICALLY_VERIFIED' ? 'Identitas Pelajar Terverifikasi Sah (AI Radar)' : (o.studentInfo.verificationStatus === 'VERIFIED' ? 'Verifikasi Kartu Pelajar Disetujui Kasir' : (o.studentInfo.verificationStatus === 'REJECTED' ? 'Verifikasi Pelajar Ditolak: Kembali ke Harga Reguler' : 'Menunggu Validasi Selfie KTM oleh Kasir'))}</b><small style="display:block;margin-top:2px;font-size:11px;">${o.studentInfo.verificationStatus === 'AUTOMATICALLY_VERIFIED' ? `Identitas mahasiswa ${esc(o.studentInfo.campus)} dan domain kampus lolos validasi otomatis.` : (o.studentInfo.verificationStatus === 'VERIFIED' ? `Identitas mahasiswa ${esc(o.studentInfo.campus)} telah diverifikasi sah oleh kasir.` : (o.studentInfo.verificationStatus === 'REJECTED' ? `Alasan: ${esc(o.studentInfo.rejectionReason || 'Foto KTM tidak sesuai')}. Seluruh harga item otomatis disesuaikan ke tarif normal tanpa reload.` : 'Kasir akan memverifikasi foto selfie KTM Anda saat memproses pesanan.'))}</small>${o.studentInfo ? `<button type="button" class="btn btn-soft btn-small" id="btnViewDigitalKtm" style="margin-top:8px;">🪪 Tampilkan Kartu Mahasiswa Digital (KTM)</button>` : ''}</div></div>` : ''}<div id="trackingCardWrapper">${renderTrackingCardContent()}</div><section class="tracking-summary" id="trackingSummarySection"><h3>Rincian Pesanan</h3>${o.items.map(i => `<div><span>${esc(i.productName)} x${i.quantity}<small>${esc(optionSummary(i))}</small></span><b>${money(i.lineTotal)}</b></div>`).join('')}<hr><div><span>Nomor Meja</span><b>${esc(o.tableName)}</b></div><div><span>Metode Pembayaran</span><b id="paymentStatusBadge">${o.payment.method === 'QRIS_DEMO' || o.payment.method === 'QRIS' ? 'QRIS' : 'Bayar di Kasir'} ${o.payment.status === 'PAID' ? '(Lunas)' : '(Pending)'}</b></div><div class="tracking-total"><span>Total Bayar</span><strong id="trackGrandTotal">${money(o.total)}</strong></div></section><div id="trackAddonsWrapper">${trackAddonsSection(o, access)}</div></main>`, { tableName: o.tableName, className: 'simple-shell' });
    bindPayButton(); bindAddOrderButton(); bindBuzzerButton();
    const btnKtm = $('#btnViewDigitalKtm');
    if (btnKtm) btnKtm.onclick = () => openDigitalKtmModal(o.studentInfo);
    checkStayAlertModal();
  };

  const checkStayAlertModal = () => {
    const flagKey = 'cc_show_stay_alert_' + orderNumber;
    if (sessionStorage.getItem(flagKey) === '1') {
      sessionStorage.removeItem(flagKey);
      const m = modal(`
        <div class="stay-alert-modal" style="text-align:center;padding:12px 4px;">
          <div style="font-size:52px;line-height:1;margin-bottom:14px;">⚠️📱</div>
          <h3 style="margin:0 0 10px;font-size:20px;font-weight:800;color:var(--ink,#0f172a);">JANGAN TUTUP HALAMAN INI!</h3>
          <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:var(--text,#475569);">
            Pesanan Anda berhasil masuk antrean! Mohon <b>tetap buka tab browser ini</b> agar sistem alarm suara &amp; buzzer di HP Anda dapat berdering otomatis saat pesanan siap diambil.
          </p>
          <div style="background:var(--bg,#f8fafc);border:1px solid var(--border,#e2e8f0);border-radius:14px;padding:14px;margin-bottom:20px;text-align:left;font-size:12.5px;color:var(--text,#334155);display:flex;flex-direction:column;gap:10px;">
            <div style="display:flex;gap:10px;align-items:flex-start;">
              <span style="font-size:18px;line-height:1;">🔔</span>
              <div><b>Alarm Suara Otomatis:</b> Suara lonceng &amp; getaran HP akan otomatis aktif ketika barista menandai pesanan Anda siap diambil.</div>
            </div>
            <div style="display:flex;gap:10px;align-items:flex-start;">
              <span style="font-size:18px;line-height:1;">💡</span>
              <div><b>Layar Tetap Menyala:</b> Layar HP Anda dijaga tetap aktif selama halaman ini dibuka sehingga Anda tidak ketinggalan panggilan.</div>
            </div>
          </div>
          <button type="button" class="btn btn-primary btn-wide btn-large" id="btnStayUnderstood" style="font-weight:700;font-size:15px;border-radius:12px;box-shadow:0 4px 14px rgba(27,99,58,0.25);">
            Saya Mengerti, Biarkan Terbuka 👍
          </button>
        </div>
      `, 'stay-alert-dialog');

      const btnOk = $('#btnStayUnderstood', m);
      if (btnOk) {
        btnOk.onclick = async () => {
          alarm.unlock();
          requestWakeLock();
          if ('Notification' in window && Notification.permission !== 'granted') {
            try {
              const perm = await Notification.requestPermission();
              if (perm === 'granted') {
                await registerPushSubscription('customer', orderNumber);
              }
            } catch {}
          }
          m.remove();
        };
      }
    }
  };

  const bindBuzzerButton = () => {
    const btnBuzzer = $('#btnEnableBuzzer');
    if (btnBuzzer) {
      btnBuzzer.onclick = async () => {
        alarm.unlock();
        alarm.playReadyChime();
        requestWakeLock();
        if ('Notification' in window) {
          try {
            const perm = await Notification.requestPermission();
            if (perm === 'granted') {
              await registerPushSubscription('customer', orderNumber);
              toast('✅ Alarm Notifikasi Layar Kunci Berhasil Aktif!');
              updateTrackView();
            }
          } catch { }
        }
      };
    }
  };

  const bindAddOrderButton = () => {
    const b = $('#btnAddOrder');
    if (b) b.onclick = () => {
      alarm.unlock();
      const tt = sessionStorage.getItem('cc_table_' + orderNumber) || getCart().tableToken || 'demo-table-01';
      setAddTo({ orderNumber: o.orderNumber, accessToken: access, tableToken: tt, tableName: o.tableName, customerType: o.studentInfo ? 'STUDENT' : 'REGULAR' });
      nav(`/order/${encodeURIComponent(tt)}/menu`);
    };
  };

  const bindPayButton = () => {
    const pay = $('#demoPay');
    if (pay) pay.onclick = async () => {
      alarm.unlock();
      pay.disabled = true;
      pay.innerHTML = '<span class="spinner"></span> Memproses Pembayaran...';
      try {
        await api('/demo/payments/' + encodeURIComponent(orderNumber) + '/pay', {
          method: 'POST',
          body: JSON.stringify({ accessToken: access })
        });
        toast('✅ Pembayaran QRIS demo berhasil!');
        refresh();
      } catch (e) {
        toast(e.message, true);
        pay.disabled = false;
        pay.textContent = '⚡ Simulasikan Pembayaran Berhasil (QRIS)';
      }
    };
  };

  const updateTrackView = () => {
    if (o.status === 'READY') return renderReadyScreen();
    if (o.status === 'COMPLETED') return renderCompletedScreen();
    if (currentScreenMode !== 'track') return renderTrackShell();

    const wrapper = $('#trackingCardWrapper'); if (wrapper) { wrapper.innerHTML = renderTrackingCardContent(); bindPayButton(); }
    const addonsWrap = $('#trackAddonsWrapper'); if (addonsWrap && Array.isArray(o.addons)) { addonsWrap.innerHTML = trackAddonsSection(o, access); bindAddOrderButton(); }
    const badge = $('#paymentStatusBadge'); if (badge) badge.textContent = `${o.payment.method === 'QRIS_DEMO' || o.payment.method === 'QRIS' ? 'QRIS' : 'Bayar di Kasir'} ${o.payment.status === 'PAID' ? '(Lunas)' : '(Pending)'}`;
    const est = $('#estMinutesText'); if (est) est.textContent = `Estimasi ${o.estimatedMinutes || 10} Mnt`;
    const grandTot = $('#trackGrandTotal'); if (grandTot) grandTot.textContent = money(o.total);
    const summarySec = $('#trackingSummarySection');
    if (summarySec) {
      summarySec.innerHTML = `<h3>Rincian Pesanan</h3>${o.items.map(i => `<div><span>${esc(i.productName)} x${i.quantity}<small>${esc(optionSummary(i))}</small></span><b>${money(i.lineTotal)}</b></div>`).join('')}<hr><div><span>Nomor Meja</span><b>${esc(o.tableName)}</b></div><div><span>Metode Pembayaran</span><b id="paymentStatusBadge">${o.payment.method === 'QRIS_DEMO' || o.payment.method === 'QRIS' ? 'QRIS' : 'Bayar di Kasir'} ${o.payment.status === 'PAID' ? '(Lunas)' : '(Pending)'}</b></div><div class="tracking-total"><span>Total Bayar</span><strong id="trackGrandTotal">${money(o.total)}</strong></div>`;
    }
  };

  const refresh = async () => {
    try {
      const prevStatus = o ? o.status : '';
      o = await api('/orders/' + encodeURIComponent(orderNumber) + '?access=' + encodeURIComponent(access));
      if (prevStatus !== 'READY' && o.status === 'READY') triggerReadyAlarm();
      updateTrackView();
    } catch { }
  };

  if (o.status === 'READY') renderReadyScreen(); else if (o.status === 'COMPLETED') renderCompletedScreen(); else renderTrackShell();

  const sub = createRealtimeSubscription({
    channel: 'customer',
    order: orderNumber,
    access: access,
    onEvent: ({ event, data }) => {
      try {
        const prevStatus = o ? o.status : '';
        if (data.status) {
          o.status = data.status;
          if (data.tableName) o.tableName = data.tableName;
        }
        if (data.verificationStatus) {
          if (o.studentInfo) o.studentInfo.verificationStatus = data.verificationStatus;
          if (data.verificationStatus === 'REJECTED') {
            o.customerType = 'REGULAR';
            if (data.total !== undefined) o.total = data.total;
            if (data.subtotal !== undefined) o.subtotal = data.subtotal;
            if (data.serviceFee !== undefined) o.serviceFee = data.serviceFee;
            if (data.tax !== undefined) o.tax = data.tax;
            if (data.totalSavings !== undefined) o.totalSavings = data.totalSavings;
            if (data.items) o.items = data.items;
            toast('⚠️ Verifikasi KTM Ditolak: Seluruh item pesanan kembali ke harga reguler tanpa reload!');
            renderTrackShell();
            return;
          }
        }
        if (prevStatus !== 'READY' && o.status === 'READY') triggerReadyAlarm();
        updateTrackView();
      } catch { }
    }
  });
  disposeOnLeave(() => sub.close());

  const handleBeforeUnload = (e) => {
    if (o && o.status !== 'COMPLETED' && o.status !== 'CANCELLED') {
      e.preventDefault();
      e.returnValue = 'Pesanan Anda sedang diproses. Mohon jangan tutup halaman ini agar notifikasi pesanan siap bisa masuk.';
      return e.returnValue;
    }
  };
  window.addEventListener('beforeunload', handleBeforeUnload);
  disposeOnLeave(() => window.removeEventListener('beforeunload', handleBeforeUnload));

  const timer = setInterval(refresh, 3000); disposeOnLeave(() => clearInterval(timer));
}

async function adminGuard(fn) { try { const user = await api('/admin/me'); return fn(user); } catch { nav('/admin/login'); } }

async function loginPage() {
  let demoMode = false;
  try {
    const settings = await api('/public/settings');
    demoMode = settings.demoMode === true;
  } catch { /* Login form can still render; the submit will show the server error. */ }

  const demoEmail = demoMode ? 'admin@cafecampus.demo' : '';
  const demoPassword = demoMode ? 'admin123' : '';
  document.body.className = 'admin-login-body';
  document.body.innerHTML = `<main class="admin-login-page"><section class="login-card"><div class="login-logo">${brandMark(60)}<h1>Cafe Campus</h1><span>PORTAL STAFF & ADMIN</span></div><form id="loginForm"><h2>Masuk ke Dashboard</h2><label>Email Staff<input id="email" type="email" value="${demoEmail}" placeholder="nama@cafecampus.id" autocomplete="username" required></label><label>Kata Sandi<div class="password-wrap"><input id="password" type="password" value="${demoPassword}" placeholder="Masukkan kata sandi" autocomplete="current-password" required><button type="button" id="showPass" aria-label="Lihat kata sandi">${icon('eye', 17)}</button></div></label><button class="btn btn-primary btn-wide" id="loginBtn">Masuk ${icon('arrow', 17)}</button>${demoMode ? '<button type="button" class="forgot" id="forgot">Gunakan akun demo terisi</button>' : ''}</form></section></main>`;
  $('#showPass').onclick = () => { const x = $('#password'); x.type = x.type === 'password' ? 'text' : 'password' };
  if (demoMode) $('#forgot').onclick = () => toast('Akun demo sudah terisi.');
  $('#loginForm').onsubmit = async e => {
    e.preventDefault(); alarm.unlock(); const b = $('#loginBtn'); b.disabled = true; b.innerHTML = '<span class="spinner"></span> Memeriksa...';
    try {
      const res = await api('/admin/login', { method: 'POST', body: JSON.stringify({ email: $('#email').value, password: $('#password').value }) });
      if (res && res.token) setAdminToken(res.token);
      nav('/admin');
    } catch (err) { toast(err.message, true); b.disabled = false; b.innerHTML = `Masuk ${icon('arrow', 17)}`; }
  };
}

async function dashboardPage(user) {
  const renderDashboard = async () => {
    const [data, allOrders, allTables] = await Promise.all([api('/admin/dashboard'), api('/admin/orders?date=' + todayISO()), api('/admin/tables')]);
    const c = data.counts || {}; const activeOrders = allOrders.filter(o => ['NEW', 'PROCESSING', 'READY'].includes(o.status));
    const itemMap = {}; allOrders.filter(o => o.payment?.status === 'PAID').forEach(o => { o.items.forEach(i => { itemMap[i.productName] = (itemMap[i.productName] || 0) + i.quantity; }); });
    const bestSellers = Object.entries(itemMap).sort((a, b) => b[1] - a[1]).slice(0, 5); const maxQty = bestSellers.length ? Math.max(...bestSellers.map(x => x[1]), 1) : 1;
    const activeTableNumbers = new Set(activeOrders.map(o => o.tableNumber));
    const tableHtml = orderTable(data.recent || [], true); const queueHtml = kitchenQueueCards(activeOrders); const bestSellersHtml = bestsellersWidget(bestSellers, maxQty); const occupancyHtml = tableOccupancyWidget(allTables, activeTableNumbers);

    const mainPanel = $('#dashboardRecentPanel');
    if (mainPanel) {
      $('#countNew') && ($('#countNew').textContent = c.NEW || 0); $('#countProcessing') && ($('#countProcessing').textContent = c.PROCESSING || 0); $('#countReady') && ($('#countReady').textContent = c.READY || 0); $('#countRevenue') && ($('#countRevenue').textContent = money(data.revenue));
      $('#kitchenQueuePanel') && ($('#kitchenQueuePanel').innerHTML = queueHtml); $('#bestSellersPanel') && ($('#bestSellersPanel').innerHTML = bestSellersHtml); $('#occupancyPanel') && ($('#occupancyPanel').innerHTML = occupancyHtml); mainPanel.innerHTML = tableHtml; bindOrderTableActions(renderDashboard); bindQueueCardActions(renderDashboard); return;
    }
    document.body.className = 'admin-body';
    document.body.innerHTML = adminShell(`${adminTop('Dashboard Kasir & Barista', 'Pantau antrean racikan minuman, konfirmasi pembayaran, dan kelola pesanan aktif.')}<div class="dashboard-greeting-banner"><div class="greeting-text"><div class="greeting-pill"><i class="greeting-dot"></i> Shift Aktif • ${new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div><h1>Semangat Bertugas, Tim Cafe Campus ☕</h1><p>Kelola alur pesanan meja, pantau antrean racikan minuman, dan konfirmasi transaksi Cafe Campus secara langsung.</p></div><div class="greeting-actions"><button class="btn btn-primary" id="btnQuickPos">${icon('plus', 18)} Pesanan Kasir (POS Cepat)</button><button class="btn btn-soft" id="btnTestSound">${icon('bell', 18)} Tes Dering Kasir</button><button class="btn btn-soft" id="btnPrintShift">${icon('report', 18)} Rekap Shift</button></div></div><section class="dashboard-metrics"><div class="admin-metric orange"><span>Pesanan Baru</span><strong id="countNew">${c.NEW || 0}</strong><i>${icon('bell', 20)}</i></div><div class="admin-metric blue"><span>Sedang Diproses</span><strong id="countProcessing">${c.PROCESSING || 0}</strong><i>${icon('clock', 20)}</i></div><div class="admin-metric green"><span>Siap Diambil</span><strong id="countReady">${c.READY || 0}</strong><i>${icon('check', 20)}</i></div><div class="admin-metric revenue"><span>Pendapatan Hari Ini</span><strong id="countRevenue">${money(data.revenue)}</strong><i>${icon('wallet', 20)}</i></div></section><section class="admin-panel queue-panel"><div class="panel-head"><div class="panel-head-title"><h2>Antrean Dapur & Barista</h2><span class="badge-count">${activeOrders.length} Pesanan Berjalan</span></div><span class="panel-subtitle">Klik tombol status untuk memajukan pesanan</span></div><div id="kitchenQueuePanel">${queueHtml}</div></section><div class="dashboard-split-grid"><section class="admin-panel main-split-col"><div class="panel-head"><h2>Pesanan Terkini</h2><a data-nav href="/admin/orders" class="link-see-all">Lihat Semua ${icon('arrow', 15)}</a></div><div id="dashboardRecentPanel">${tableHtml}</div></section><div class="side-split-col"><section class="admin-panel widget-panel"><div class="panel-head"><h2>Menu Terlaris Hari Ini</h2><span class="badge-pill">Top 5</span></div><div id="bestSellersPanel">${bestSellersHtml}</div></section><section class="admin-panel widget-panel"><div class="panel-head"><h2>Keterisian Meja Cafe</h2><a data-nav href="/admin/tables" class="link-see-all">Kelola Meja ${icon('arrow', 14)}</a></div><div id="occupancyPanel">${occupancyHtml}</div></section></div></div>`, 'dashboard', user);
    bindAdminChrome('dashboard'); bindOrderTableActions(renderDashboard); bindQueueCardActions(renderDashboard);
    $('#btnQuickPos') && ($('#btnQuickPos').onclick = () => quickPosOrderModal(renderDashboard));
    $('#btnTestSound') && ($('#btnTestSound').onclick = () => { alarm.startAlarm10s('admin'); toast('🔔 Memutar dering kasir selama 10 detik...'); });
    $('#btnPrintShift') && ($('#btnPrintShift').onclick = () => printShiftSummaryModal(data, allOrders));
  };
  await renderDashboard(); setupAdminRealtime(renderDashboard);
}

function kitchenQueueCards(orders) {
  if (!orders.length) return `<div class="queue-empty"><div class="queue-empty-icon">☕</div><b>Antrean Dapur Bersih & Terlayani</b><p>Tidak ada pesanan aktif saat ini. Pesanan baru akan muncul otomatis di sini.</p></div>`;
  return `<div class="queue-cards-grid">${orders.map(o => {
    const isStud = o.customerType === 'STUDENT'; const vStatus = o.studentInfo?.verificationStatus;
    const isPrinted = Boolean(o.receiptPrinted || o.receipt_printed);
    return `<div class="queue-ticket status-border-${o.status.toLowerCase()}"><div class="ticket-head"><div><strong class="ticket-num">#${esc(o.orderNumber)}</strong>${o.parentOrderNumber ? `<small class="addon-tag">+ tambahan #${esc(o.parentOrderNumber)}</small>` : ''}<span class="ticket-table">${esc(o.tableName)}</span></div><div style="display:flex;align-items:center;gap:6px;">${o.status === 'NEW' ? (isPrinted ? '<span class="receipt-mini-badge done" title="Struk sudah dicetak">✓ Struk</span>' : '<span class="receipt-mini-badge pending" title="Wajib cetak struk kasir">⚠️ Belum Cetak</span>') : ''}${statusBadge(o.status)}</div></div>${o.status === 'NEW' ? (!isPrinted ? `<div class="ticket-receipt-strip unprinted"><span>⚠️</span> <span>Belum Cetak Struk (Wajib cetak sebelum racik)</span></div>` : `<div class="ticket-receipt-strip printed"><span>✓</span> <span>Struk Sudah Dicetak</span></div>`) : ''}${isStud ? `<div class="ticket-student-bar"><div style="display:flex;justify-content:space-between;align-items:center;"><b>🎓 ${esc(o.studentInfo?.campus || 'Mahasiswa')}</b>${vStatus === 'VERIFIED' ? '<span class="badge-verify-approved">✅ Sah</span>' : (vStatus === 'REJECTED' ? '<span class="badge-verify-rejected">⚠️ Ditolak</span>' : '<span class="badge-verify-pending">⏳ Cek KTM</span>')}</div><small>NIM: ${esc(o.studentInfo?.studentId || '-')} • ${esc(o.studentInfo?.studentName || 'Pelajar')}</small><div class="ticket-student-photo-row"><button type="button" class="btn-inspect-photo" data-inspect-photo="${esc(o.orderNumber)}">🔍 Foto Selfie KTM</button>${vStatus !== 'VERIFIED' ? `<div class="ticket-verify-btn-group"><button type="button" class="btn-verify-approve" data-verify-student="${esc(o.orderNumber)}" data-decision="VERIFIED" title="Setujui Diskon Pelajar">✓</button><button type="button" class="btn-verify-reject" data-verify-student="${esc(o.orderNumber)}" data-decision="REJECTED" title="Tolak & Ubah ke Harga Normal">✕</button></div>` : ''}</div></div>` : ''}<div class="ticket-time"><span>🕒 ${formatTime(o.createdAt)}</span><span class="ticket-payment ${o.payment.status === 'PAID' ? 'paid' : 'pending'}">${o.payment.method === 'QRIS_DEMO' ? 'QRIS' : 'Tunai'} • ${o.payment.status === 'PAID' ? 'Lunas' : 'Belum Bayar'}</span></div><div class="ticket-items">${o.items.map(i => `<div class="ticket-item-row"><span><b>${i.quantity}x</b> ${esc(i.productName)}</span>${i.options?.size ? `<small class="ticket-mod">${esc(i.options.size)}</small>` : ''}</div>`).join('')}</div><div class="ticket-actions">${o.payment.status === 'PENDING' && o.payment.method === 'CASH' ? `<button class="btn btn-green btn-small" data-quick-pay="${esc(o.orderNumber)}">Konfirmasi Bayar</button>` : ''}${o.status === 'NEW' && o.payment.status === 'PAID' ? (!isPrinted ? `<button class="btn btn-primary btn-small btn-highlight-print" data-print-order="${esc(o.orderNumber)}">🖨️ Cetak Struk (Wajib)</button><button class="btn btn-blue btn-small" data-quick-status="${esc(o.orderNumber)}" data-next="PROCESSING" data-need-receipt="true" title="Wajib cetak struk terlebih dahulu">▶ Proses Racik 🔒</button>` : `<button class="btn btn-blue btn-small" data-quick-status="${esc(o.orderNumber)}" data-next="PROCESSING">▶ Proses Racik</button><button class="btn btn-soft btn-small" data-print-order="${esc(o.orderNumber)}" title="Cetak ulang struk">🖨️ Struk</button>`) : ''}${o.status === 'PROCESSING' ? `<button class="btn btn-primary btn-small" data-quick-status="${esc(o.orderNumber)}" data-next="READY">🔔 Siap Diambil</button><button class="btn btn-soft btn-small" data-print-order="${esc(o.orderNumber)}" title="Cetak ulang struk">🖨️</button>` : ''}${o.status === 'READY' ? `<button class="btn btn-dark btn-small" data-quick-status="${esc(o.orderNumber)}" data-next="COMPLETED">✓ Selesai</button><button class="btn btn-soft btn-small" data-print-order="${esc(o.orderNumber)}" title="Cetak ulang struk">🖨️</button>` : ''}<button class="btn btn-soft btn-small" data-view-order="${esc(o.orderNumber)}">Detail</button></div></div>`;
  }).join('')}</div>`;
}

function bindQueueCardActions(onUpdate) {
  $$('[data-quick-pay]').forEach(b => b.onclick = async () => { b.disabled = true; try { await api('/admin/orders/' + encodeURIComponent(b.dataset.quickPay) + '/payment', { method: 'PATCH', body: '{}' }); toast('Pembayaran kasir berhasil dikonfirmasi LUNAS'); onUpdate(); } catch (e) { toast(e.message, true); b.disabled = false; } });
  $$('[data-print-order]').forEach(b => b.onclick = () => showOrderReceiptDialog(b.dataset.printOrder, onUpdate, false));
  $$('[data-quick-status]').forEach(b => b.onclick = async () => {
    const next = b.dataset.next;
    const num = b.dataset.quickStatus;
    if (next === 'PROCESSING' && b.dataset.needReceipt === 'true') {
      toast('⚠️ Struk wajib dicetak terlebih dahulu sebelum memproses pesanan ke barista/dapur!', true);
      showOrderReceiptDialog(num, onUpdate, true);
      return;
    }
    b.disabled = true;
    try {
      await api('/admin/orders/' + encodeURIComponent(num) + '/status', { method: 'PATCH', body: JSON.stringify({ status: next }) });
      if (next === 'READY') toast('🔔 Pesanan dinyatakan SIAP! Alarm berbunyi di HP customer.');
      else toast('Status pesanan diperbarui');
      onUpdate();
    } catch (e) { toast(e.message, true); b.disabled = false; }
  });
  $$('[data-inspect-photo]').forEach(b => b.onclick = () => viewStudentPhotoModal(b.dataset.inspectPhoto, onUpdate));
  $$('[data-verify-student]').forEach(b => b.onclick = async () => { b.disabled = true; const dec = b.dataset.decision; const num = b.dataset.verifyStudent; try { await api('/admin/orders/' + encodeURIComponent(num) + '/verify-student', { method: 'PATCH', body: JSON.stringify({ status: dec, reason: dec === 'REJECTED' ? 'Foto selfie / kartu tidak valid' : '' }) }); toast(dec === 'VERIFIED' ? '✅ Verifikasi KTM disetujui!' : '⚠️ Verifikasi ditolak. Tagihan disesuaikan ke harga reguler.'); onUpdate(); } catch (e) { toast(e.message, true); b.disabled = false; } });
}

function bestsellersWidget(bestSellers, maxQty) {
  if (!bestSellers.length) return '<div class="admin-empty-widget"><p>Belum ada transaksi hari ini.</p></div>';
  return `<div class="bestsellers-list">${bestSellers.map(([name, qty], idx) => { const pct = Math.round((qty / maxQty) * 100); return `<div class="bestseller-item"><div class="bestseller-header"><span class="bestseller-rank">#${idx + 1}</span><span class="bestseller-name">${esc(name)}</span><strong class="bestseller-qty">${qty} porsi</strong></div><div class="bestseller-track"><div class="bestseller-bar" style="width: ${pct}%"></div></div></div>`; }).join('')}</div>`;
}

function tableOccupancyWidget(tables, activeSet) {
  if (!tables.length) return '<div class="admin-empty-widget"><p>Tidak ada data meja.</p></div>';
  return `<div class="occupancy-grid">${tables.map(t => { const isOccupied = activeSet.has(t.tableNumber); return `<div class="occupancy-pill ${isOccupied ? 'occupied' : 'available'}" title="${esc(t.name)} (${isOccupied ? 'Sedang Ada Pesanan' : 'Tersedia'})"><i class="occupancy-dot"></i><span>${esc(t.name)}</span></div>`; }).join('')}</div><div class="occupancy-legend"><span><i class="occupancy-dot occupied"></i> Terisi (${activeSet.size})</span><span><i class="occupancy-dot available"></i> Kosong (${Math.max(0, tables.length - activeSet.size)})</span></div>`;
}

async function quickPosOrderModal(onSuccess) {
  const [products, settings, allTables, categories] = await Promise.all([api('/public/products'), api('/public/settings'), api('/admin/tables'), api('/public/categories').catch(() => [])]);
  let selectedTableToken = allTables[0]?.publicToken || 'demo-table-01'; let selectedMethod = 'CASH'; let activeCatId = 'ALL'; let posCustomerType = 'REGULAR'; const cart = new Map();
  const d = modal(`<div class="modal-heading"><div><span>KASIR POINT OF SALE</span><h2>Buat Pesanan Kasir Cepat</h2></div><span class="status-badge status-new"><i class="status-dot"></i>Order Kasir</span></div><div class="pos-modal-layout"><div class="pos-form-side"><div class="pos-top-bar"><div class="pos-field" style="flex:1;"><label>Pilih Meja Pemesan:</label><select id="posTableSelect" class="form-input">${allTables.map(t => `<option value="${esc(t.publicToken)}">${esc(t.name)} (Meja ${esc(t.tableNumber)})</option>`).join('')}</select></div><div class="pos-field" style="flex:1;"><label>Kategori Pelanggan:</label><div class="pos-role-segmented"><button type="button" class="active" data-pos-role="REGULAR">☕ Pelanggan Umum</button><button type="button" data-pos-role="STUDENT">🎓 Pelajar / Mahasiswa</button></div></div></div><div class="pos-top-bar" style="margin-top:-6px;"><div class="pos-field" style="flex:1;"><label>Metode Pembayaran:</label><div class="pos-segment-group"><button type="button" class="pos-segment-btn active" data-pos-method="CASH">💵 Tunai Kasir</button><button type="button" class="pos-segment-btn" data-pos-method="QRIS_DEMO">📱 QRIS Instan</button></div></div></div><div class="pos-field"><div class="pos-menu-header"><label style="margin-bottom:0;">Pilih Menu Cafe:</label><div class="pos-cat-filter" id="posCatFilter"><button type="button" class="pos-cat-chip active" data-cat="ALL">Semua</button>${categories.map(c => `<button type="button" class="pos-cat-chip" data-cat="${esc(c.id)}">${esc(c.name)}</button>`).join('')}</div></div><div class="pos-product-picker" id="posProductPicker"></div></div></div><div class="pos-summary-side"><div class="pos-receipt-header"><h3>Ringkasan Tagihan</h3><span class="pos-ticket-badge" id="posCurrentTableBadge">${esc(allTables[0]?.name || 'Meja 01')}</span></div><div id="posCartItems" class="pos-cart-list"><div class="pos-empty-cart"><div class="pos-empty-icon">🧾</div><b>Belum ada menu dipilih</b><p>Klik tombol + Tambah pada menu di sebelah kiri untuk membuat pesanan kasir.</p></div></div><div class="pos-bill-calc"><div class="pos-calc-row"><span>Subtotal:</span><b id="posSubtotal">Rp 0</b></div><div class="pos-calc-row" id="posSavingsRow" style="display:none;color:#2c8b5b;"><span>Hemat Pelajar:</span><b id="posSavings">- Rp 0</b></div><div class="pos-calc-row"><span>Biaya Layanan (${settings.serviceFee || 5}%):</span><b id="posServiceFee">Rp 0</b></div><div class="pos-calc-row"><span>Pajak Resto (${settings.taxPercent || 11}%):</span><b id="posTax">Rp 0</b></div></div><div class="pos-total-row"><span>Total Bayar</span><strong id="posTotalAmount">Rp 0</strong></div><button class="btn btn-green btn-full" id="btnSubmitPos" disabled>✓ Konfirmasi Pesanan & Cetak Struk</button></div></div>`, 'wide-modal');

  const renderProducts = () => {
    const container = $('#posProductPicker', d); if (!container) return; const list = activeCatId === 'ALL' ? products : products.filter(p => p.categoryId === activeCatId); const isStud = posCustomerType === 'STUDENT';
    container.innerHTML = list.map(p => { const effPrice = getProductEffectivePrice(p, isStud); const hasDisc = isStud && effPrice < p.price; return `<div class="pos-prod-card" data-pos-add="${esc(p.id)}"><img src="${esc(p.imageUrl || '/assets/iced-latte.jpg')}" alt="" class="pos-prod-img"><div class="pos-prod-info"><b>${esc(p.name)}</b><span>${money(effPrice)} ${hasDisc ? `<small style="color:#2c8b5b;font-weight:700;">(🎓)</small>` : ''}</span></div><button type="button" class="btn btn-small btn-primary" tabindex="-1">+ Tambah</button></div>`; }).join('');
    $$('[data-pos-add]', d).forEach(card => { card.onclick = () => { const pid = card.dataset.posAdd; cart.set(pid, (cart.get(pid) || 0) + 1); updateCartView(); }; });
  };
  renderProducts();

  $$('[data-pos-role]', d).forEach(btn => { btn.onclick = () => { $$('[data-pos-role]', d).forEach(b => { b.classList.remove('active'); b.classList.remove('student-mode'); }); btn.classList.add('active'); posCustomerType = btn.dataset.posRole; if (posCustomerType === 'STUDENT') btn.classList.add('student-mode'); renderProducts(); updateCartView(); }; });
  $$('.pos-cat-chip', d).forEach(btn => { btn.onclick = () => { $$('.pos-cat-chip', d).forEach(b => b.classList.remove('active')); btn.classList.add('active'); activeCatId = btn.dataset.cat; renderProducts(); }; });
  const tableSelect = $('#posTableSelect', d); tableSelect.onchange = e => { selectedTableToken = e.target.value; const t = allTables.find(x => x.publicToken === selectedTableToken); if (t) $('#posCurrentTableBadge', d).textContent = t.name; };
  $$('[data-pos-method]', d).forEach(btn => { btn.onclick = () => { $$('[data-pos-method]', d).forEach(b => b.classList.remove('active')); btn.classList.add('active'); selectedMethod = btn.dataset.posMethod; }; });

  const updateCartView = () => {
    const listEl = $('#posCartItems', d); const totalEl = $('#posTotalAmount', d); const subtotalEl = $('#posSubtotal', d); const savingsRow = $('#posSavingsRow', d); const savingsEl = $('#posSavings', d); const serviceFeeEl = $('#posServiceFee', d); const taxEl = $('#posTax', d); const submitBtn = $('#btnSubmitPos', d);
    if (cart.size === 0) { listEl.innerHTML = `<div class="pos-empty-cart"><div class="pos-empty-icon">🧾</div><b>Belum ada menu dipilih</b><p>Klik tombol + Tambah pada menu di sebelah kiri untuk membuat pesanan kasir.</p></div>`; subtotalEl.textContent = 'Rp 0'; if (savingsRow) savingsRow.style.display = 'none'; serviceFeeEl.textContent = 'Rp 0'; taxEl.textContent = 'Rp 0'; totalEl.textContent = 'Rp 0'; submitBtn.disabled = true; return; }
    let subtotal = 0; let totalSavings = 0; let html = ''; const isStud = posCustomerType === 'STUDENT';
    cart.forEach((qty, pid) => {
      const p = products.find(x => x.id === pid); if (!p) return; const effPrice = getProductEffectivePrice(p, isStud); const line = effPrice * qty; const regLine = p.price * qty; const savings = Math.max(0, regLine - line); subtotal += line; totalSavings += savings;
      html += `<div class="pos-cart-row"><div class="pos-cart-title"><b>${esc(p.name)}</b><small>${money(effPrice)} x ${qty} ${savings > 0 ? `<span style="color:#2c8b5b;">(Hemat ${money(savings)})</span>` : ''}</small></div><div class="pos-cart-qty"><button type="button" class="btn-qty" data-pos-dec="${esc(p.id)}" title="Kurangi">-</button><span>${qty}</span><button type="button" class="btn-qty" data-pos-inc="${esc(p.id)}" title="Tambah">+</button></div><strong class="pos-cart-line">${money(line)}</strong></div>`;
    });
    const sFee = Math.round(subtotal * (settings.serviceFee || 5) / 100); const tax = Math.round((subtotal + sFee) * (settings.taxPercent || 11) / 100); const grandTotal = subtotal + sFee + tax;
    listEl.innerHTML = html; subtotalEl.textContent = money(subtotal); if (savingsRow) { if (totalSavings > 0) { savingsRow.style.display = 'flex'; savingsEl.textContent = `- ${money(totalSavings)}`; } else { savingsRow.style.display = 'none'; } }
    serviceFeeEl.textContent = money(sFee); taxEl.textContent = money(tax); totalEl.textContent = money(grandTotal); submitBtn.disabled = false;
    $$('[data-pos-dec]', d).forEach(b => b.onclick = () => { const pid = b.dataset.posDec; const q = (cart.get(pid) || 1) - 1; if (q <= 0) cart.delete(pid); else cart.set(pid, q); updateCartView(); });
    $$('[data-pos-inc]', d).forEach(b => b.onclick = () => { const pid = b.dataset.posInc; cart.set(pid, (cart.get(pid) || 0) + 1); updateCartView(); });
  };

  $('#btnSubmitPos', d).onclick = async () => {
    const btn = $('#btnSubmitPos', d); btn.disabled = true; btn.textContent = 'Memproses Pesanan...'; const items = []; cart.forEach((qty, pid) => items.push({ productId: pid, quantity: qty, note: '', options: {} }));
    try {
      const res = await api('/orders', { method: 'POST', body: JSON.stringify({ tableToken: selectedTableToken, customerType: posCustomerType, studentInfo: posCustomerType === 'STUDENT' ? { campus: 'Kampus (POS Kasir)', studentId: 'POS-VERIFIED', studentName: 'Pelajar / Mahasiswa' } : null, items, paymentMethod: selectedMethod, idempotencyKey: 'pos-' + Date.now() }) });
      toast(`Pesanan #${res.orderNumber} berhasil dibuat!`); d.remove(); onSuccess(); showOrderReceiptDialog(res.orderNumber, onSuccess, false);
    } catch (err) { toast(err.message, true); btn.disabled = false; btn.textContent = '✓ Konfirmasi Pesanan & Cetak Struk'; }
  };
}

function printShiftSummaryModal(dashData, allOrders) {
  const today = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const paidOrders = allOrders.filter(o => o.payment.status === 'PAID');
  const qrisTotal = paidOrders.filter(o => o.payment.method === 'QRIS_DEMO').reduce((s, o) => s + o.total, 0); const cashTotal = paidOrders.filter(o => o.payment.method === 'CASH').reduce((s, o) => s + o.total, 0);
  const studentCount = paidOrders.filter(o => o.customerType === 'STUDENT').length; const regularCount = paidOrders.filter(o => o.customerType !== 'STUDENT').length;

  const d = modal(`<div class="print-receipt-container"><div class="receipt-paper"><div class="receipt-header"><h2 style="font-size:18px;margin:0 0 4px 0;">CAFE CAMPUS</h2><p style="font-size:12px;margin:0;color:#666;">REKAPITULASI PENJUALAN SHIFT KASIR</p><p style="font-size:11px;margin:2px 0 0 0;color:#888;">${today}</p><hr style="border:none;border-top:1px dashed #bbb;margin:12px 0;"></div><div class="receipt-body"><div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:6px;"><span>Total Pesanan Masuk:</span><b>${allOrders.length} Pesanan</b></div><div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:6px;"><span>Pesanan Lunas (PAID):</span><b>${paidOrders.length} Pesanan</b></div><div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:6px;color:#2c8b5b;"><span>• Transaksi Pelajar / Mahasiswa:</span><b>${studentCount} Pesanan</b></div><div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:6px;color:#6b4c38;"><span>• Transaksi Pelanggan Umum:</span><b>${regularCount} Pesanan</b></div><hr style="border:none;border-top:1px dashed #bbb;margin:10px 0;"><div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:6px;"><span>Penerimaan Tunai (Cash):</span><b>${money(cashTotal)}</b></div><div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:6px;"><span>Penerimaan QRIS:</span><b>${money(qrisTotal)}</b></div><hr style="border:none;border-top:1px dashed #bbb;margin:10px 0;"><div style="display:flex;justify-content:space-between;font-size:15px;font-weight:bold;margin:8px 0;"><span>TOTAL PENDAPATAN:</span><strong style="color:var(--orange-dark);">${money(dashData.revenue || 0)}</strong></div><hr style="border:none;border-top:1px dashed #bbb;margin:12px 0;"><p style="text-align:center;font-size:11px;color:#888;margin:0;">Dicetak oleh Admin Campus • Sistem POS Cafe Campus</p></div></div></div><div class="modal-actions"><button class="btn btn-primary" id="btnDoPrintShift">🖨️ Cetak Rekap (Print)</button><button class="btn btn-dark" id="btnCloseShiftPrint">Tutup</button></div>`, 'dialog-card');
  $('#btnDoPrintShift', d).onclick = () => window.print(); $('#btnCloseShiftPrint', d).onclick = () => d.remove();
}

async function showOrderReceiptDialog(orderNumber, onDone, autoAdvance = false) {
  let r;
  try {
    r = await api('/admin/orders/' + encodeURIComponent(orderNumber) + '/receipt');
  } catch (err) {
    return toast('Gagal memuat data struk: ' + err.message, true);
  }

  let selectedStation = 'CUSTOMER';
  let printed = Boolean(r.receiptPrinted);

  const getReceiptHtml = (type) => {
    const isCustomer = type === 'CUSTOMER';
    const isDrink = type === 'DRINK';
    const isFood = type === 'FOOD';
    const items = isCustomer ? r.items : (isDrink ? r.drinkItems : r.foodItems);
    const now = new Date();
    const printTime = now.toLocaleString('id-ID', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });

    if (!isCustomer && (!items || items.length === 0)) {
      return `<div style="padding:32px 16px;text-align:center;color:#64748b;">
        <div style="font-size:28px;margin-bottom:8px;">${isDrink ? '☕' : '🍽️'}</div>
        <b>Tidak Ada Menu ${isDrink ? 'Minuman' : 'Makanan'}</b>
        <p style="font-size:12px;margin-top:4px;color:#94a3b8;">Pesanan ini tidak memiliki menu untuk stasiun dapur ${isDrink ? 'barista minuman' : 'dapur makanan'}.</p>
      </div>`;
    }

    return `
      <div class="receipt-paper" style="max-width:340px;margin:0 auto;box-shadow:0 4px 14px rgba(0,0,0,0.08);background:#fff;padding:16px;border-radius:6px;font-family:'Courier New',Courier,monospace;color:#111;">
        <div class="receipt-header" style="text-align:center;">
          <h2 style="font-size:17px;margin:0 0 2px 0;letter-spacing:1px;font-family:inherit;">${esc(r.cafeName || 'CAFE CAMPUS')}</h2>
          ${r.cafeAddress ? `<p style="font-size:10.5px;margin:0;color:#555;">${esc(r.cafeAddress)}</p>` : ''}
          ${r.cafePhone ? `<p style="font-size:10px;margin:1px 0 0;color:#666;">📞 ${esc(r.cafePhone)}</p>` : ''}
          <div style="border-top:1px dashed #999;margin:8px 0 6px;"></div>
          <div style="font-size:12px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:${isDrink ? '#1a6fb5' : (isFood ? '#c0522a' : '#1e293b')};">
            ${isCustomer ? 'STRUK PELANGGAN' : (isDrink ? '☕ TIKET DAPUR MINUMAN' : '🍽️ TIKET DAPUR MAKANAN')}
          </div>
          <div style="border-top:1px dashed #999;margin:6px 0 8px;"></div>
        </div>
        <div style="font-size:11px;margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:2px;">
            <span>No. Pesanan:</span><strong>#${esc(r.orderNumber)}</strong>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:2px;">
            <span>No. Antrean:</span><b style="color:var(--orange-dark);font-size:12px;">${esc(r.queueNumber || 'Q-001')}</b>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:2px;">
            <span>Meja:</span><b>${esc(r.tableName || '-')}</b>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:2px;">
            <span>Waktu:</span><span>${printTime}</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:2px;">
            <span>Metode:</span><b>${r.paymentMethod === 'QRIS_DEMO' ? 'QRIS' : 'Tunai Kasir'} (${r.paymentStatus === 'PAID' ? 'LUNAS' : 'BELUM LUNAS'})</b>
          </div>
          ${r.customerType === 'STUDENT' ? `
            <div style="background:#eaf7ed;border-radius:4px;padding:4px 6px;margin:6px 0;font-size:10.5px;color:#1b633a;">
              <b>🎓 DISKON PELAJAR / MAHASISWA</b><br>
              ${esc(r.studentName || '')} (${esc(r.studentCampus || 'Kampus')}${r.studentIdNum ? ` • NIM: ${esc(r.studentIdNum)}` : ''})
            </div>
          ` : ''}
        </div>
        <div style="border-top:1px dashed #999;margin:6px 0;"></div>
        <div style="font-size:11.5px;">
          ${(items || []).map(i => {
            const opts = Object.entries(i.options || {}).filter(([,v]) => v).map(([k,v]) => `${k}: ${v}`).join(', ');
            return `
              <div style="display:flex;justify-content:space-between;margin-bottom:5px;align-items:flex-start;">
                <div style="flex:1;padding-right:8px;">
                  <b>${i.quantity}x ${esc(i.productName)}</b>
                  ${opts ? `<br><small style="color:#666;font-size:10px;">${esc(opts)}</small>` : ''}
                  ${i.note ? `<br><small style="color:#b45309;font-size:10px;">📝 ${esc(i.note)}</small>` : ''}
                </div>
                ${isCustomer ? `<strong style="white-space:nowrap;">${money(i.lineTotal)}</strong>` : ''}
              </div>
            `;
          }).join('')}
        </div>
        ${isCustomer ? `
          <div style="border-top:1px dashed #999;margin:8px 0 6px;"></div>
          <div style="font-size:11px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:2px;">
              <span>Subtotal:</span><span>${money(r.subtotal)}</span>
            </div>
            ${r.totalSavings ? `
              <div style="display:flex;justify-content:space-between;margin-bottom:2px;color:#1b633a;font-weight:bold;">
                <span>Hemat Pelajar:</span><span>- ${money(r.totalSavings)}</span>
              </div>
            ` : ''}
            ${r.serviceFee ? `
              <div style="display:flex;justify-content:space-between;margin-bottom:2px;">
                <span>Layanan:</span><span>${money(r.serviceFee)}</span>
              </div>
            ` : ''}
            ${r.tax ? `
              <div style="display:flex;justify-content:space-between;margin-bottom:2px;">
                <span>Pajak Resto:</span><span>${money(r.tax)}</span>
              </div>
            ` : ''}
            <div style="border-top:1px dashed #000;margin:4px 0;"></div>
            <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:bold;margin:4px 0;">
              <span>TOTAL BAYAR:</span><strong style="color:var(--orange-dark);">${money(r.total)}</strong>
            </div>
          </div>
        ` : ''}
        <div style="border-top:1px dashed #999;margin:8px 0 6px;"></div>
        <p style="text-align:center;font-size:10px;color:#666;margin:0;">
          ${isCustomer ? 'Terima Kasih Atas Kunjungan Anda! ☕' : `Tiket ${isDrink ? 'Dapur Minuman' : 'Dapur Makanan'} • Cafe Campus`}
        </p>
      </div>
    `;
  };

  const d = modal(`
    <div class="modal-heading">
      <div>
        <span style="display:flex;align-items:center;gap:6px;">
          🖨️ POS CETAK STRUK & TIKET DAPUR
          <span id="receiptStatusBadgeContainer">
            ${printed ? '<span class="badge-receipt-done">✓ Struk Dicetak</span>' : '<span class="badge-receipt-pending">⚠️ Belum Cetak Struk</span>'}
          </span>
        </span>
        <h2>Pesanan #${esc(r.orderNumber)} (${esc(r.tableName)}) ${r.queueNumber ? `[${esc(r.queueNumber)}]` : ''}</h2>
      </div>
      <div>
        ${statusBadge(r.status)}
      </div>
    </div>

    <div style="display:flex;gap:8px;margin-bottom:12px;background:#f8fafc;padding:6px;border-radius:8px;border:1px solid #e2e8f0;overflow-x:auto;">
      <button type="button" class="btn btn-small btn-primary" id="tabPrintCust">🧾 Struk Customer (${r.items.length})</button>
      <button type="button" class="btn btn-small btn-soft" id="tabPrintDrink">☕ Tiket Barista (${(r.drinkItems || []).length})</button>
      <button type="button" class="btn btn-small btn-soft" id="tabPrintFood">🍽️ Tiket Dapur (${(r.foodItems || []).length})</button>
    </div>

    <div id="receiptPreviewBox" style="background:#f1f5f9;padding:16px;border-radius:8px;max-height:360px;overflow-y:auto;border:1px solid #e2e8f0;">
      ${getReceiptHtml('CUSTOMER')}
    </div>

    <div class="modal-actions" style="margin-top:16px;display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between;">
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-primary btn-highlight-print" id="btnExecutePrint">🖨️ Cetak Tab Ini (Print)</button>
        <button class="btn btn-soft" id="btnPrintAllStation">🖨️ Cetak Semua Tiket</button>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${r.status === 'NEW' ? `
          <button class="btn btn-blue" id="btnAdvanceToProcess">▶ Selesai Cetak & Mulai Racik</button>
        ` : ''}
        <button class="btn btn-dark" data-modal-close>Tutup</button>
      </div>
    </div>
  `, 'dialog-card wide-dialog');

  const updateTabs = (st) => {
    selectedStation = st;
    $('#tabPrintCust', d).className = `btn btn-small ${st === 'CUSTOMER' ? 'btn-primary' : 'btn-soft'}`;
    $('#tabPrintDrink', d).className = `btn btn-small ${st === 'DRINK' ? 'btn-primary' : 'btn-soft'}`;
    $('#tabPrintFood', d).className = `btn btn-small ${st === 'FOOD' ? 'btn-primary' : 'btn-soft'}`;
    $('#receiptPreviewBox', d).innerHTML = getReceiptHtml(st);
  };

  $('#tabPrintCust', d).onclick = () => updateTabs('CUSTOMER');
  $('#tabPrintDrink', d).onclick = () => updateTabs('DRINK');
  $('#tabPrintFood', d).onclick = () => updateTabs('FOOD');

  const markPrinted = async (st) => {
    try {
      await api('/admin/orders/' + encodeURIComponent(r.orderNumber) + '/print', {
        method: 'POST',
        body: JSON.stringify({ type: st || selectedStation })
      });
      printed = true;
      r.receiptPrinted = true;
      const bc = $('#receiptStatusBadgeContainer', d);
      if (bc) bc.innerHTML = '<span class="badge-receipt-done">✓ Struk Dicetak</span>';
    } catch(e) {}
  };

  $('#btnExecutePrint', d).onclick = async () => {
    await markPrinted(selectedStation);
    printKitchenReceipt(r, selectedStation);
    toast('Mencetak struk ' + (selectedStation === 'CUSTOMER' ? 'pelanggan' : (selectedStation === 'DRINK' ? 'dapur minuman' : 'dapur makanan')));
    if (autoAdvance && r.status === 'NEW') {
      try {
        await api('/admin/orders/' + encodeURIComponent(r.orderNumber) + '/status', {
          method: 'PATCH',
          body: JSON.stringify({ status: 'PROCESSING' })
        });
        toast('✓ Struk dicetak & pesanan dialihkan ke SEDANG RACIK');
        d.remove();
        onDone && onDone();
      } catch(e) { toast(e.message, true); }
    } else {
      onDone && onDone();
    }
  };

  $('#btnPrintAllStation', d).onclick = async () => {
    await markPrinted('ALL');
    printKitchenReceipt(r, 'CUSTOMER');
    if (r.drinkItems?.length) setTimeout(() => printKitchenReceipt(r, 'DRINK'), 600);
    if (r.foodItems?.length) setTimeout(() => printKitchenReceipt(r, 'FOOD'), 1200);
    toast('Mencetak seluruh tiket stasiun...');
    if (autoAdvance && r.status === 'NEW') {
      try {
        await api('/admin/orders/' + encodeURIComponent(r.orderNumber) + '/status', {
          method: 'PATCH',
          body: JSON.stringify({ status: 'PROCESSING' })
        });
        toast('✓ Struk dicetak & pesanan dialihkan ke SEDANG RACIK');
        d.remove();
        onDone && onDone();
      } catch(e) { toast(e.message, true); }
    } else {
      onDone && onDone();
    }
  };

  const advanceBtn = $('#btnAdvanceToProcess', d);
  if (advanceBtn) {
    advanceBtn.onclick = async () => {
      advanceBtn.disabled = true;
      try {
        if (!printed) {
          await markPrinted('CUSTOMER');
          printKitchenReceipt(r, 'CUSTOMER');
        }
        await api('/admin/orders/' + encodeURIComponent(r.orderNumber) + '/status', {
          method: 'PATCH',
          body: JSON.stringify({ status: 'PROCESSING' })
        });
        toast('✓ Pesanan dialihkan ke SEDANG RACIK!');
        d.remove();
        onDone && onDone();
      } catch(e) {
        toast(e.message, true);
        advanceBtn.disabled = false;
      }
    };
  }
}

function printReceiptModal(o) {
  showOrderReceiptDialog(o.orderNumber || o.num, null, false);
}

function bindOrderTableActions(onUpdate) {
  $$('[data-view-order]').forEach(btn => {
    btn.onclick = async () => {
      const num = btn.dataset.viewOrder;
      try {
        const orders = await api('/admin/orders?q=' + encodeURIComponent(num));
        const order = orders.find(o => o.orderNumber === num) || orders[0];
        if (!order) return toast('Pesanan tidak ditemukan', true);
        orderDetailModal(num, onUpdate);
      } catch(e) { toast(e.message, true); }
    };
  });
  $$('[data-print-order]').forEach(btn => {
    btn.onclick = () => showOrderReceiptDialog(btn.dataset.printOrder, onUpdate, false);
  });
}

async function blacklistModal() {
  let list = [];
  try { list = await api('/admin/fraud/blacklist'); } catch (e) { return toast(e.message, true); }
  const d = modal(`<div class="dialog wide-dialog"><h3>🚫 Daftar Blacklist Pelajar</h3><p class="muted">Identitas di daftar ini tidak bisa memesan dengan harga pelajar. Cabut jika salah masuk.</p>${list.length ? `<div class="blacklist-list">${list.map(b => `<div class="blacklist-row"><div><b>${esc(b.student_name || '-')}</b><small>NIM: ${esc(b.student_id_num || '-')} • ${esc(b.email || '-')}</small><small>Alasan: ${esc(b.reason || '-')}</small></div><button class="btn btn-small btn-danger-soft" data-unblock="${esc(b.id)}">Cabut</button></div>`).join('')}</div>` : '<p class="muted">Daftar blacklist masih kosong.</p>'}<div class="dialog-actions"><button class="btn btn-soft" id="closeBl">Tutup</button></div></div>`);
  $('#closeBl', d).onclick = () => d.remove();
  $$('[data-unblock]', d).forEach(btn => btn.onclick = async () => {
    if (!(await confirmDialog({ title: 'Cabut dari Blacklist?', message: 'Identitas ini akan bisa memesan dengan harga pelajar lagi.', ok: 'Cabut' }))) return;
    try { await api('/admin/fraud/blacklist/' + btn.dataset.unblock, { method: 'DELETE' }); toast('Dicabut dari blacklist'); d.remove(); blacklistModal(); } catch (e) { toast(e.message, true); }
  });
}

async function ordersPage(user) {
  let status = '', payment = '', customerType = '', q = '', date = todayISO();
  const renderTableOnly = async () => {
    const params = new URLSearchParams();
    if (status) params.set('status', status); if (payment) params.set('payment', payment); if (customerType) params.set('customerType', customerType); if (q) params.set('q', q); if (date) params.set('date', date);
    const list = await api('/admin/orders?' + params.toString());
    const panel = $('#ordersTablePanel'); if (panel) { panel.innerHTML = orderTable(list); bindOrderTableActions(renderTableOnly); $$('[data-status]').forEach(b => b.classList.toggle('active', b.dataset.status === status)); }
  };
  const initialLoad = async () => {
    const params = new URLSearchParams();
    if (status) params.set('status', status); if (payment) params.set('payment', payment); if (customerType) params.set('customerType', customerType); if (q) params.set('q', q); if (date) params.set('date', date);
    const list = await api('/admin/orders?' + params.toString());
    document.body.className = 'admin-body';
    document.body.innerHTML = adminShell(`${adminTop('Daftar Semua Pesanan', 'Kelola antrean pesanan masuk, konfirmasi kasir, dan status barista.', `<button class="btn btn-soft" id="btnBlacklist">🚫 Daftar Blacklist</button>`)}<div class="order-tabs" id="orderTabsContainer">${[['', 'Semua'], ['NEW', 'Pesanan Baru'], ['PROCESSING', 'Diproses'], ['READY', 'Siap Diambil'], ['COMPLETED', 'Selesai']].map(([k, l]) => `<button class="${status === k ? 'active' : ''}" data-status="${k}">${l}</button>`).join('')}</div><div class="admin-filters"><label>${icon('search', 18)}<input id="filterQ" placeholder="Cari No. Order / Meja / Mahasiswa / Menu..." value="${esc(q)}"></label><select id="filterRole"><option value="">Semua Tipe Pelanggan</option><option value="REGULAR" ${customerType === 'REGULAR' ? 'selected' : ''}>☕ Pelanggan Umum</option><option value="STUDENT" ${customerType === 'STUDENT' ? 'selected' : ''}>🎓 Pelajar / Mahasiswa</option></select><select id="filterPay"><option value="">Semua Pembayaran</option><option value="PAID" ${payment === 'PAID' ? 'selected' : ''}>Lunas</option><option value="PENDING" ${payment === 'PENDING' ? 'selected' : ''}>Belum Bayar</option></select><input type="date" id="filterDate" value="${date}"></div><section class="admin-panel" id="ordersTablePanel">${orderTable(list)}</section>`, 'orders', user);
    bindAdminChrome('orders'); bindOrderTableActions(renderTableOnly);
    const blBtnList = $('#btnBlacklist'); if (blBtnList) blBtnList.onclick = () => blacklistModal();
    $$('[data-status]').forEach(b => b.onclick = () => { status = b.dataset.status; renderTableOnly() });
    $('#filterRole').onchange = e => { customerType = e.target.value; renderTableOnly() };
    $('#filterPay').onchange = e => { payment = e.target.value; renderTableOnly() };
    $('#filterDate').onchange = e => { date = e.target.value; renderTableOnly() };
    const s = $('#filterQ'); if (s) s.oninput = e => { q = e.target.value; clearTimeout(s._t); s._t = setTimeout(renderTableOnly, 150) };
  };
  await initialLoad(); setupAdminRealtime(renderTableOnly);
}

function orderTable(orders, compact = false) {
  if (!orders.length) return '<div class="admin-empty"><p>Tidak ada data pesanan pada filter ini.</p></div>';
  return `<div class="responsive-table"><table class="admin-table"><thead><tr><th style="width: 105px;">No. Pesanan</th><th style="width: 85px;">Meja</th><th style="width: 110px;">Tipe</th><th>Rincian Item</th><th style="width: 115px;">Total</th><th style="width: 140px;">Pembayaran</th><th style="width: 130px;">Status</th><th style="width: 75px;">Waktu</th><th style="width: 95px; text-align: right;">Aksi</th></tr></thead><tbody>${orders.map(o => {
    const isPrinted = Boolean(o.receiptPrinted || o.receipt_printed);
    return `<tr><td data-label="No. Pesanan"><span class="order-num-tag">#${esc(o.orderNumber)}</span>${o.parentOrderNumber ? `<small class="addon-tag">+ tambahan #${esc(o.parentOrderNumber)}</small>` : ''}</td><td data-label="Meja"><span class="table-name-tag">${esc(o.tableName)}</span></td><td data-label="Tipe">${o.customerType === 'STUDENT' ? `<span class="badge-role-student" title="${esc(o.studentInfo?.campus || '')} (NIM: ${esc(o.studentInfo?.studentId || '-')})">🎓 Pelajar</span>` : `<span class="badge-role-regular">☕ Umum</span>`}</td><td data-label="Rincian Item"><div class="items-cell" title="${esc(o.items.map(i => `${i.quantity}x ${i.productName}`).join(', '))}">${o.items.map(i => `<span class="item-chip"><b>${i.quantity}x</b> ${esc(i.productName)}</span>`).join('')}</div></td><td data-label="Total"><span class="order-total-val">${money(o.total)}</span></td><td data-label="Pembayaran">${paymentBadge(o)}</td><td data-label="Status">${statusBadge(o.status)} ${isPrinted ? '<span class="receipt-mini-badge done" title="Struk sudah dicetak">✓ Struk</span>' : '<span class="receipt-mini-badge pending" title="Belum cetak struk">⚠️ Struk</span>'}</td><td data-label="Waktu"><span class="order-time-tag">${formatTime(o.createdAt)}</span></td><td data-label="Aksi" style="text-align: right;"><div style="display:inline-flex;gap:4px;justify-content:flex-end;"><button class="btn btn-small btn-soft" data-print-order="${esc(o.orderNumber)}" title="Cetak Struk">🖨️</button><button class="btn btn-small btn-soft" data-view-order="${esc(o.orderNumber)}">Detail</button></div></td></tr>`;
  }).join('')}</tbody></table></div>`;
}

async function viewStudentPhotoModal(orderNumber, onUpdate) {
  const orders = await api('/admin/orders?q=' + encodeURIComponent(orderNumber)); const o = orders.find(x => x.orderNumber === orderNumber);
  if (!o || !o.studentInfo) return toast('Data verifikasi pelajar tidak ditemukan.', true);
  const info = o.studentInfo; const photo = info.studentPhoto || '/assets/hero-desktop.jpg'; const isAuto = info.verificationStatus === 'AUTOMATICALLY_VERIFIED'; const isVerified = info.verificationStatus === 'VERIFIED' || isAuto; const isRejected = info.verificationStatus === 'REJECTED';
  const riskClass = info.fraudRisk === 'HIGH' ? 'high' : (info.fraudRisk === 'MEDIUM' ? 'medium' : 'low'); const riskLabel = info.fraudRisk === 'HIGH' ? '🔴 Risiko Tinggi' : (info.fraudRisk === 'MEDIUM' ? '🟡 Risiko Sedang' : '🟢 Risiko Rendah (Aman)');
  const d = modal(`<div class="modal-heading"><div><span>ENGINE ANTI-FRAUD & VERIFIKASI IDENTITAS PELAJAR</span><h2>Pesanan #${esc(o.orderNumber)} (${esc(o.tableName)})</h2></div><div style="display:flex;align-items:center;gap:6px;"><span class="badge-fraud-score ${riskClass}">${riskLabel} • Skor: ${info.fraudScore || 0}%</span>${isAuto ? '<span class="badge-verify-approved">🤖 Auto-Approved (AI)</span>' : (isVerified ? '<span class="badge-verify-approved">✅ Terverifikasi Sah</span>' : (isRejected ? '<span class="badge-verify-rejected">⚠️ Verifikasi Ditolak</span>' : '<span class="badge-verify-pending">⏳ Menunggu Verifikasi</span>'))}</div></div><div class="student-inspect-grid"><div class="student-inspect-photo-box"><img src="${esc(photo)}" alt="Foto Selfie bersama KTM" onerror="this.src='/assets/hero-desktop.jpg'"><button type="button" class="btn btn-soft btn-small btn-wide" id="btnPreviewKtmCardFromPhoto" style="margin-top:8px;">🪪 Buka Kartu Mahasiswa Digital (KTM)</button></div><div class="student-inspect-details"><div class="inspect-detail-row"><span>Nama Pelajar / Mahasiswa</span><strong>${esc(info.studentName || '-')}</strong></div><div class="inspect-detail-row"><span>Asal Kampus / Sekolah</span><strong>${esc(info.campus || '-')}</strong></div><div class="inspect-detail-row"><span>Fakultas / Jurusan</span><strong>${esc(info.facultyName || info.facultyCode || '-')} • ${esc(info.studyProgram || '-')}</strong></div><div class="inspect-detail-row"><span>Nomor Induk (NIM / NIS)</span><strong>${esc(info.studentId || '-')}</strong></div><div class="inspect-detail-row"><span>Email Institusi Resmi</span><strong>${esc(info.email || 'Tidak Dilampirkan')} ${info.email ? '✅' : ''}</strong></div><div class="inspect-detail-row"><span>Total Subsidi Potongan Harga</span><strong style="color:#2c8b5b;">${money(o.totalSavings || 0)}</strong></div><div class="inspect-detail-row"><span>Total Tagihan Saat Ini</span><strong>${money(o.total)}</strong></div>${info.rejectionReason ? `<div class="inspect-detail-row"><span style="color:#e03131;">Alasan Penolakan:</span><strong style="color:#c92a2a;">${esc(info.rejectionReason)}</strong></div>` : ''}<div class="student-verify-notice" style="margin-top:auto;"><span>🛡️</span><div><b>Anti-Fraud AI Radar:</b> ${info.fraudFlags?.length ? info.fraudFlags.join(', ') : 'Format data sesuai standar institusi pendidikan.'}</div></div></div></div><div class="modal-actions" style="margin-top:16px;">${!isVerified ? `<button class="btn btn-green" id="btnApproveStudent">✓ Sahkan Diskon Pelajar</button>` : ''}${!isRejected ? `<button class="btn btn-danger" id="btnRejectStudent">✕ Tolak & Ubah ke Harga Normal</button>` : ''}<button class="btn-blacklist" id="btnBlacklistStudent">🚨 Blacklist Pelajar</button><button class="btn btn-soft" id="btnCloseInspect">Tutup</button></div>`, 'wide-modal');
  $('#btnCloseInspect', d).onclick = () => d.remove();
  const btnKtmPreview = $('#btnPreviewKtmCardFromPhoto', d);
  if (btnKtmPreview) btnKtmPreview.onclick = () => openDigitalKtmModal(info);
  const appBtn = $('#btnApproveStudent', d);
  if (appBtn) appBtn.onclick = async () => { appBtn.disabled = true; try { await api('/admin/orders/' + encodeURIComponent(o.orderNumber) + '/verify-student', { method: 'PATCH', body: JSON.stringify({ status: 'VERIFIED' }) }); toast('✅ Verifikasi pelajar DISETUJUI. Diskon sah!'); d.remove(); onUpdate && onUpdate(); } catch (e) { toast(e.message, true); appBtn.disabled = false; } };
  const rejBtn = $('#btnRejectStudent', d);
  if (rejBtn) rejBtn.onclick = async () => { const reason = prompt('Masukkan alasan penolakan verifikasi:', 'Foto selfie tidak jelas / kartu tidak valid') || 'Foto selfie tidak sesuai'; rejBtn.disabled = true; try { await api('/admin/orders/' + encodeURIComponent(o.orderNumber) + '/verify-student', { method: 'PATCH', body: JSON.stringify({ status: 'REJECTED', reason }) }); toast('⚠️ Verifikasi DITOLAK. Pesanan dialihkan ke harga reguler.'); d.remove(); onUpdate && onUpdate(); } catch (e) { toast(e.message, true); rejBtn.disabled = false; } };
  const blBtn = $('#btnBlacklistStudent', d);
  if (blBtn) blBtn.onclick = async () => { if (!confirm(`Apakah Anda yakin ingin memasukkan NIM ${info.studentId} (${info.studentName}) ke daftar BLACKLIST? Akun ini tidak akan dapat memesan dengan harga pelajar lagi.`)) return; blBtn.disabled = true; try { await api('/admin/fraud/blacklist', { method: 'POST', body: JSON.stringify({ studentId: info.studentId, email: info.email || '', studentName: info.studentName, reason: 'Kecurangan verifikasi identitas pelajar' }) }); await api('/admin/orders/' + encodeURIComponent(o.orderNumber) + '/verify-student', { method: 'PATCH', body: JSON.stringify({ status: 'REJECTED', reason: 'Identitas masuk Daftar Hitam (Blacklist)' }) }); toast('🚨 Identitas berhasil dimasukkan ke BLACKLIST.'); d.remove(); onUpdate && onUpdate(); } catch (e) { toast(e.message, true); blBtn.disabled = false; } };
}

async function orderDetailModal(orderNumber, onUpdate) {
  const orders = await api('/admin/orders?q=' + encodeURIComponent(orderNumber)); const o = orders.find(x => x.orderNumber === orderNumber);
  if (!o) return toast('Pesanan tidak ditemukan.', true);
  const isStud = o.customerType === 'STUDENT'; const vStatus = o.studentInfo?.verificationStatus;
  const isBirthday = Boolean(o.studentInfo?.isBirthdayToday);
  const isBdayClaimed = Boolean(o.studentInfo?.birthdayRewardGiven);
  const isPrinted = Boolean(o.receiptPrinted || o.receipt_printed);

  const d = modal(`<div class="modal-heading"><div><span>DETAIL PESANAN</span><h2>#${esc(o.orderNumber)} (${esc(o.tableName)}) ${o.queueNumber ? `<span class="queue-inline-tag">Antrean #${esc(o.queueNumber)}</span>` : ''}</h2></div><div style="display:flex;align-items:center;gap:8px;">
    <div class="print-btn-group">
      <button class="btn btn-small btn-soft" id="btnPrintCustomer">🧾 Struk Customer</button>
      <button class="btn btn-small btn-soft" id="btnPrintDrink" style="color:#1a6fb5;">☕ Dapur Minuman</button>
      <button class="btn btn-small btn-soft" id="btnPrintFood" style="color:#c0522a;">🍽️ Dapur Makanan</button>
    </div>
    <span id="detailReceiptBadgeContainer">
      ${isPrinted ? '<span class="badge-receipt-done">✓ Struk Dicetak</span>' : '<span class="badge-receipt-pending">⚠️ Belum Cetak Struk</span>'}
    </span>
    ${statusBadge(o.status)}</div></div>
    ${isBirthday ? `
    <div class="birthday-alert-box ${isBdayClaimed ? 'claimed' : 'ready-claim'}">
      <div class="birthday-alert-icon">🎂</div>
      <div class="birthday-alert-content">
        <b>🎉 Mahasiswa ini BERULANG TAHUN Hari Ini!</b>
        <small>${isBdayClaimed ? `Kado ulang tahun spesial tahun ini telah diberikan (${esc(o.studentInfo.birthdayRewardName || 'Free Drink')}).` : 'Sesuai program loyalty kampus, berikan 1x minuman kado ulang tahun gratis!'}</small>
      </div>
      ${!isBdayClaimed ? `<button type="button" class="btn btn-green btn-small" id="btnClaimBirthdayReward">🎁 Berikan Kado Ultah</button>` : `<span class="badge-bday-done">✅ Kado Ultah Diberikan</span>`}
    </div>` : ''}
    <div class="order-detail-grid"><div><div class="detail-meta"><div><span>WAKTU PESAN</span><b>${formatTime(o.createdAt)}</b></div><div><span>TIPE CUSTOMER</span><b>${isStud ? '🎓 Pelajar / Mahasiswa' : '☕ Pelanggan Umum'}</b></div><div><span>METODE</span><b>${o.payment.method === 'QRIS_DEMO' ? 'QRIS' : 'Tunai di Kasir'}</b></div><div><span>STATUS BAYAR</span><b>${o.payment.status === 'PAID' ? 'Lunas' : 'Belum Bayar'}</b></div></div>${o.studentInfo ? `<div class="student-form-card" style="margin-bottom:14px;padding:12px 16px;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><h4 style="margin:0;color:#1b633a;font-size:13px;display:flex;align-items:center;gap:5px;">🎓 Verifikasi Pelajar & Anti-Fraud</h4><div style="display:flex;align-items:center;gap:6px;"><span class="badge-fraud-score ${o.studentInfo.fraudRisk === 'HIGH' ? 'high' : (o.studentInfo.fraudRisk === 'MEDIUM' ? 'medium' : 'low')}">${o.studentInfo.fraudRisk === 'HIGH' ? '🔴 Risiko Tinggi' : (o.studentInfo.fraudRisk === 'MEDIUM' ? '🟡 Risiko Sedang' : '🟢 Aman')} • ${o.studentInfo.fraudScore || 0}%</span>${vStatus === 'AUTOMATICALLY_VERIFIED' ? '<span class="badge-verify-approved">🤖 AI Sah</span>' : (vStatus === 'VERIFIED' ? '<span class="badge-verify-approved">✅ Sah</span>' : (vStatus === 'REJECTED' ? '<span class="badge-verify-rejected">⚠️ Ditolak</span>' : '<span class="badge-verify-pending">⏳ Cek KTM</span>'))}${o.totalSavings ? `<span class="badge-role-student">Hemat ${money(o.totalSavings)}</span>` : ''}</div></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;margin-bottom:10px;"><div><span style="color:#666;">Nama Mahasiswa:</span> <b style="display:block;">${esc(o.studentInfo?.studentName || '-')}</b></div><div><span style="color:#666;">Asal Kampus / Sekolah:</span> <b style="display:block;">${esc(o.studentInfo?.campus || '-')}</b></div><div><span style="color:#666;">Fakultas / Prodi:</span> <b style="display:block;">${esc(o.studentInfo?.facultyName || o.studentInfo?.facultyCode || '-')} • ${esc(o.studentInfo?.studyProgram || '-')}</b></div><div><span style="color:#666;">NIM / NIS:</span> <b style="display:inline-block;">${esc(o.studentInfo?.studentId || '-')}</b></div><div><span style="color:#666;">Email Institusi:</span> <b style="display:inline-block;">${esc(o.studentInfo?.email || '-')}</b></div>${o.studentInfo?.rejectionReason ? `<div style="grid-column:1/-1;"><span style="color:#e03131;">Alasan Tolak:</span> <b style="color:#c92a2a;display:inline-block;">${esc(o.studentInfo.rejectionReason)}</b></div>` : ''}</div><div style="display:flex;gap:8px;"><button type="button" class="btn btn-soft btn-small" id="btnInspectDetailPhoto" style="flex:1;">🔍 Periksa Foto Selfie & AI Radar</button><button type="button" class="btn btn-soft btn-small" id="btnAdminViewKtm" style="flex:1;">🪪 Buka KTM Digital</button></div></div>` : ''}<div class="admin-items-box">${o.items.map(i => `<div class="admin-order-item"><img src="${esc(i.imageUrl || '/assets/iced-latte.jpg')}" alt=""><div><b>${i.quantity}x ${esc(i.productName)}</b><span>${esc(optionSummary(i))}</span>${i.note ? `<small>Catatan: ${esc(i.note)}</small>` : ''}${i.savings ? `<small style="color:#2c8b5b;display:block;font-weight:700;">Hemat Kampus: ${money(i.savings)}</small>` : ''}</div><strong>${money(i.lineTotal)}</strong></div>`).join('')}</div><div class="detail-bill"><div><span>Subtotal</span><b>${money(o.subtotal)}</b></div>${o.totalSavings ? `<div style="color:#2c8b5b;"><span>Total Subsidi Pelajar</span><b>- ${money(o.totalSavings)}</b></div>` : ''}${o.serviceFee ? `<div><span>Biaya Layanan</span><b>${money(o.serviceFee)}</b></div>` : ''}${o.tax ? `<div><span>Pajak</span><b>${money(o.tax)}</b></div>` : ''}<div><span>Total</span><strong>${money(o.total)}</strong></div></div></div><div class="detail-side"><h3>Riwayat Status</h3><div class="history-list">${o.history.map(h => `<div><i></i><div><b>${esc(h.label || h.status)}</b><small>${formatTime(h.at)}</small></div></div>`).join('')}</div></div></div><div class="modal-actions">${o.payment.status === 'PENDING' ? `<button class="btn btn-green" id="confirmCash">Konfirmasi Kasir (Lunas)</button>` : ''}${o.status === 'NEW' && o.payment.status === 'PAID' ? (!isPrinted ? `<button class="btn btn-primary btn-highlight-print" id="btnPrintAndProcess">🖨️ Cetak Struk (Wajib) & Mulai Racik</button><button class="btn btn-blue" id="toProcess" data-need-receipt="true" title="Wajib cetak struk terlebih dahulu">Mulai Proses Barista 🔒</button>` : `<button class="btn btn-blue" id="toProcess">Mulai Proses Barista</button>`) : ''}${o.status === 'PROCESSING' ? `<button class="btn btn-primary" id="toReady">🔔 Pesanan Siap Diambil</button>` : ''}${o.status === 'READY' ? `<button class="btn btn-dark" id="toComplete">Pesanan Selesai (Diambil)</button>` : ''}${o.status === 'NEW' && o.payment.status === 'PENDING' ? `<button class="btn btn-danger" id="toCancel">Batalkan Pesanan</button>` : ''}${o.payment.status === 'PAID' && o.status !== 'CANCELLED' ? `<button class="btn btn-danger-soft" id="btnVoidOrder">⛔ Void / Refund (Pulihkan Stok)</button>` : ''}</div>`, 'wide-modal');
  // Print buttons — fetch receipt data sekali, lalu cetak sesuai tipe
  const fetchAndPrint = async (type) => {
    try {
      const receipt = await api('/admin/orders/' + encodeURIComponent(o.orderNumber) + '/receipt');
      await api('/admin/orders/' + encodeURIComponent(o.orderNumber) + '/print', { method: 'POST', body: JSON.stringify({ type }) }).catch(() => {});
      o.receiptPrinted = true;
      const bc = $('#detailReceiptBadgeContainer', d);
      if (bc) bc.innerHTML = '<span class="badge-receipt-done">✓ Struk Dicetak</span>';
      printKitchenReceipt(receipt, type);
    } catch(e) { toast('Gagal memuat data struk: ' + e.message, true); }
  };
  $('#btnPrintCustomer', d).onclick = () => fetchAndPrint('CUSTOMER');
  $('#btnPrintDrink', d).onclick   = () => fetchAndPrint('DRINK');
  $('#btnPrintFood', d).onclick    = () => fetchAndPrint('FOOD');
  const inspectBtn = $('#btnInspectDetailPhoto', d); if (inspectBtn) inspectBtn.onclick = () => { d.remove(); viewStudentPhotoModal(o.orderNumber, onUpdate); };
  const adminKtmBtn = $('#btnAdminViewKtm', d); if (adminKtmBtn) adminKtmBtn.onclick = () => openDigitalKtmModal(o.studentInfo);
  const claimBdayBtn = $('#btnClaimBirthdayReward', d);
  if (claimBdayBtn) claimBdayBtn.onclick = async () => {
    claimBdayBtn.disabled = true;
    try {
      const res = await api('/admin/orders/' + encodeURIComponent(o.orderNumber) + '/birthday-reward', {
        method: 'POST',
        body: JSON.stringify({ rewardType: 'FREE_ITEM', rewardName: 'Free Birthday Specialty Coffee' })
      });
      toast(`🎉 ${res.message}`);
      d.remove();
      orderDetailModal(o.orderNumber, onUpdate);
    } catch (e) {
      toast(e.message, true);
      claimBdayBtn.disabled = false;
    }
  };
  const voidOrderBtn = $('#btnVoidOrder', d);
  if (voidOrderBtn) voidOrderBtn.onclick = async () => {
    const reason = prompt('Masukkan alasan pembatalan / VOID pesanan (stok bahan baku akan otomatis dikembalikan):', 'Pelanggan membatalkan pesanan');
    if (!reason) return;
    voidOrderBtn.disabled = true;
    try {
      await api('/admin/orders/' + encodeURIComponent(o.orderNumber) + '/void', {
        method: 'POST',
        body: JSON.stringify({ reason })
      });
      toast('Pesanan berhasil di-VOID dan stok bahan baku dikembalikan!');
      d.remove();
      onUpdate && onUpdate();
    } catch (e) {
      toast(e.message, true);
      voidOrderBtn.disabled = false;
    }
  };
  const cash = $('#confirmCash', d); if (cash) cash.onclick = async () => { cash.disabled = true; try { await api('/admin/orders/' + encodeURIComponent(o.orderNumber) + '/payment', { method: 'PATCH', body: '{}' }); toast('Pembayaran kasir dikonfirmasi LUNAS'); d.remove(); onUpdate(); } catch (e) { toast(e.message, true); cash.disabled = false; } };
  const printAndProc = $('#btnPrintAndProcess', d);
  if (printAndProc) {
    printAndProc.onclick = () => {
      showOrderReceiptDialog(o.orderNumber, () => {
        d.remove();
        onUpdate && onUpdate();
      }, true);
    };
  }
  const toProc = $('#toProcess', d);
  if (toProc) {
    toProc.onclick = async () => {
      if (toProc.dataset.needReceipt === 'true') {
        toast('⚠️ Struk pesanan wajib dicetak terlebih dahulu sebelum memproses pesanan ke dapur!', true);
        showOrderReceiptDialog(o.orderNumber, () => {
          d.remove();
          onUpdate && onUpdate();
        }, true);
        return;
      }
      try {
        await api('/admin/orders/' + encodeURIComponent(o.orderNumber) + '/status', { method: 'PATCH', body: JSON.stringify({ status: 'PROCESSING' }) });
        toast('Status diubah ke SEDANG DIPROSES');
        d.remove();
        onUpdate();
      } catch (e) { toast(e.message, true); }
    };
  }
  const toRdy = $('#toReady', d); if (toRdy) toRdy.onclick = async () => { try { await api('/admin/orders/' + encodeURIComponent(o.orderNumber) + '/status', { method: 'PATCH', body: JSON.stringify({ status: 'READY' }) }); toast('Pesanan dinyatakan SIAP! Notifikasi terkirim ke customer.'); d.remove(); onUpdate(); } catch (e) { toast(e.message, true); } };
  const toComp = $('#toComplete', d); if (toComp) toComp.onclick = async () => { try { await api('/admin/orders/' + encodeURIComponent(o.orderNumber) + '/status', { method: 'PATCH', body: JSON.stringify({ status: 'COMPLETED' }) }); toast('Pesanan SELESAI'); d.remove(); onUpdate(); } catch (e) { toast(e.message, true); } };
  const toCanc = $('#toCancel', d); if (toCanc) toCanc.onclick = async () => { if (!(await confirmDialog({ title: 'Batalkan Pesanan?', message: 'Pesanan yang belum dibayar ini akan dibatalkan.', danger: true, ok: 'Batalkan' }))) return; try { await api('/admin/orders/' + encodeURIComponent(o.orderNumber) + '/status', { method: 'PATCH', body: JSON.stringify({ status: 'CANCELLED' }) }); toast('Pesanan dibatalkan'); d.remove(); onUpdate(); } catch (e) { toast(e.message, true); } };
}

// ==========================================
// KITCHEN PRINT RECEIPT ENGINE
// Cetak struk untuk 3 tujuan berbeda:
//   'CUSTOMER' → struk lengkap untuk pelanggan
//   'DRINK'    → tiket dapur minuman
//   'FOOD'     → tiket dapur makanan
// ==========================================
function printKitchenReceipt(r, type) {
  const isCustomer = type === 'CUSTOMER';
  const isDrink    = type === 'DRINK';
  const isFood     = type === 'FOOD';

  // Pilih items sesuai tipe
  const items = isCustomer ? r.items : (isDrink ? r.drinkItems : r.foodItems);
  if (!isCustomer && items.length === 0) {
    toast(`Tidak ada item ${isDrink ? 'minuman' : 'makanan'} di pesanan ini.`, true);
    return;
  }

  const now = new Date();
  const printTime = now.toLocaleString('id-ID', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
  const methodLabel = r.paymentMethod === 'QRIS_DEMO' ? 'QRIS' : 'Tunai';
  const paidLabel = r.paymentStatus === 'PAID' ? 'LUNAS' : 'BELUM BAYAR';

  const itemRows = items.map(i => {
    const opts = Object.entries(i.options || {}).filter(([,v]) => v).map(([k,v]) => `${k}: ${v}`).join(', ');
    return `<tr>
      <td class="qty">${i.quantity}x</td>
      <td class="name">${i.productName}${opts ? `<br><span class="mod">${opts}</span>` : ''}${i.note ? `<br><span class="note">📝 ${i.note}</span>` : ''}</td>
      ${isCustomer ? `<td class="price">${money(i.lineTotal)}</td>` : ''}
    </tr>`;
  }).join('');

  // Header berbeda per tipe struk
  let header = '';
  if (isCustomer) {
    header = `
      <div class="cafe-name">${r.cafeName}</div>
      ${r.cafeAddress ? `<div class="cafe-addr">${r.cafeAddress}</div>` : ''}
      ${r.cafePhone ? `<div class="cafe-addr">📞 ${r.cafePhone}</div>` : ''}
      <div class="divider">================================</div>
      <div class="receipt-type">STRUK PELANGGAN</div>`;
  } else if (isDrink) {
    header = `<div class="kitchen-header drink-header">☕ DAPUR MINUMAN</div>`;
  } else {
    header = `<div class="kitchen-header food-header">🍽️ DAPUR MAKANAN</div>`;
  }

  const html = `<!DOCTYPE html><html lang="id"><head>
    <meta charset="utf-8">
    <title>Struk #${r.orderNumber}</title>
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body { font-family: 'Courier New', Courier, monospace; font-size: 12px; width: 80mm; padding: 6px 8px; color: #000; }
      .cafe-name { font-size: 16px; font-weight: bold; text-align: center; margin-bottom: 2px; }
      .cafe-addr { font-size: 10px; text-align: center; color: #333; }
      .kitchen-header { font-size: 20px; font-weight: bold; text-align: center; padding: 8px 0 4px; letter-spacing: 1px; }
      .drink-header { border-bottom: 3px solid #1a6fb5; color: #1a6fb5; margin-bottom: 6px; }
      .food-header  { border-bottom: 3px solid #c0522a; color: #c0522a; margin-bottom: 6px; }
      .divider { text-align:center; letter-spacing: 0; margin: 4px 0; font-size: 11px; color: #555; }
      .receipt-type { font-size: 11px; text-align: center; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 4px; }
      .order-info { margin: 6px 0; }
      .order-info table { width: 100%; }
      .order-info td { padding: 1px 0; font-size: 11px; vertical-align: top; }
      .order-info td:last-child { text-align: right; font-weight: bold; }
      .section-title { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; border-top: 1px dashed #000; padding-top: 4px; margin-top: 6px; margin-bottom: 4px; }
      table.items { width: 100%; border-collapse: collapse; }
      table.items td { padding: 3px 2px; vertical-align: top; font-size: 12px; }
      td.qty  { width: 22px; font-weight: bold; white-space: nowrap; }
      td.name { width: auto; }
      td.price { text-align: right; white-space: nowrap; font-weight: bold; }
      .mod  { font-size: 10px; color: #444; }
      .note { font-size: 10px; color: #b84a00; font-style: italic; }
      .total-section { border-top: 1px dashed #000; margin-top: 6px; padding-top: 4px; }
      .total-section table { width: 100%; }
      .total-section td { padding: 1px 0; font-size: 11px; }
      .total-section td:last-child { text-align: right; }
      .grand-total td { font-size: 14px; font-weight: bold; }
      .footer { text-align: center; margin-top: 10px; font-size: 10px; color: #555; }
      .badge-paid { display:inline-block; background:#2c8b5b; color:#fff; padding:1px 6px; border-radius:3px; font-size:10px; font-weight:bold; }
      .badge-unpaid { display:inline-block; background:#c0522a; color:#fff; padding:1px 6px; border-radius:3px; font-size:10px; font-weight:bold; }
      .kitchen-order-num { font-size: 36px; font-weight: bold; text-align: center; margin: 8px 0 4px; }
      .kitchen-table { font-size: 16px; text-align: center; margin-bottom: 6px; font-weight: bold; }
      @media print { body { width: 80mm; } }
    </style>
  </head><body>
    ${header}
    <div class="order-info">
      <table>${!isCustomer ? `<tr><td>No. Pesanan</td><td class="kitchen-order-num">#${r.orderNumber.replace('CC-','')}</td></tr>` : `<tr><td>No. Pesanan</td><td>${r.orderNumber}</td></tr>`}
        <tr><td>Meja</td><td>${isCustomer ? r.tableName : `<div class="kitchen-table">${r.tableName}</div>`}</td></tr>
        ${isCustomer ? `<tr><td>Waktu</td><td>${printTime}</td></tr>` : `<tr><td>Waktu Print</td><td>${printTime}</td></tr>`}
        ${isCustomer ? `<tr><td>Pembayaran</td><td>${methodLabel} <span class="${r.paymentStatus === 'PAID' ? 'badge-paid' : 'badge-unpaid'}">${paidLabel}</span></td></tr>` : ''}
        ${isCustomer && r.customerType === 'STUDENT' && r.studentName ? `<tr><td>Pelajar</td><td>${r.studentName}</td></tr>` : ''}
      </table>
    </div>
    <div class="section-title">${isCustomer ? 'Item Pesanan' : (isDrink ? '☕ Menu Minuman' : '🍽️ Menu Makanan')}</div>
    <table class="items">${itemRows}</table>
    ${isCustomer ? `
    <div class="total-section">
      <table>
        <tr><td>Subtotal</td><td>${money(r.subtotal)}</td></tr>
        ${r.serviceFee ? `<tr><td>Biaya Layanan</td><td>${money(r.serviceFee)}</td></tr>` : ''}
        ${r.tax ? `<tr><td>Pajak</td><td>${money(r.tax)}</td></tr>` : ''}
        <tr class="grand-total"><td>TOTAL</td><td>${money(r.total)}</td></tr>
      </table>
    </div>` : ''}
    ${r.note ? `<div class="divider">- - - - - - - - - - - - - - - - -</div><div style="font-size:11px;">📝 Catatan: <b>${r.note}</b></div>` : ''}
    <div class="footer">
      ${isCustomer ? `<div>Terima kasih sudah mampir! ☕</div><div>${r.cafeName} &bull; Cetak: ${printTime}</div>` : `<div>Pesanan masuk: ${printTime}</div><div style="margin-top:4px;font-size:9px;">Struk ${isDrink ? 'Dapur Minuman' : 'Dapur Makanan'} — ${r.cafeName}</div>`}
    </div>
  </body></html>`;

  const w = window.open('', '_blank', 'width=400,height=600');
  if (!w) { toast('Pop-up diblokir browser. Izinkan pop-up untuk mencetak struk.', true); return; }
  w.document.write(html);
  w.document.close();
  w.onload = () => { w.focus(); w.print(); };
}

async function menuAdminPage(user) {
  const [products, cats] = await Promise.all([api('/admin/products'), api('/admin/categories')]);
  let query = '', catId = '';
  const renderList = () => {
    const filtered = products.filter(p => (!catId || p.categoryId === catId) && (!query || p.name.toLowerCase().includes(query.toLowerCase())));
    document.body.className = 'admin-body';
    document.body.innerHTML = adminShell(`${adminTop('Kelola Menu Cafe', 'Atur ketersediaan menu, harga reguler vs pelajar, dan kustomisasi minuman.', `<button class="btn btn-primary" id="addProd">${icon('plus', 16)} Tambah Menu</button>`)}<div class="admin-filters menu-filters"><label>${icon('search', 18)}<input id="searchMenu" placeholder="Cari nama menu..." value="${esc(query)}"></label><select id="filterMenuCat"><option value="">Semua Kategori</option>${cats.map(c => `<option value="${c.id}" ${catId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div><section class="admin-panel"><div class="menu-table-head"><span>Menu</span><span>Kategori</span><span>Harga Umum / Pelajar</span><span>Tersedia</span><span style="text-align:right">Aksi</span></div><div class="admin-menu-list">${filtered.map(p => `<article class="admin-menu-row ${p.active === false ? 'archived' : ''}"><div class="admin-menu-product"><img src="${esc(p.imageUrl || '/assets/iced-latte.jpg')}" alt=""><div><b>${esc(p.name)}${p.active === false ? ' <span class="inactive-pill">Nonaktif</span>' : ''}</b><small>${esc(p.description)}</small></div></div><span>${esc(cats.find(c => c.id === p.categoryId)?.name || 'Kopi')}</span><div><strong>${money(p.price)}</strong>${p.studentPrice ? `<div style="font-size:11.5px;color:#1b633a;font-weight:700;">🎓 ${money(p.studentPrice)}</div>` : ''}</div><div class="switch-row"><button class="switch ${p.isAvailable ? 'on' : ''}" data-toggle-avail="${p.id}"><i></i></button><span>${p.isAvailable ? 'Tersedia' : 'Habis'}</span></div><div class="row-actions"><button class="icon-btn" data-edit-prod="${p.id}" title="Edit Menu">${icon('edit', 16)}</button><button class="icon-btn" data-toggle-active="${p.id}" title="${p.active === false ? 'Aktifkan kembali' : 'Nonaktifkan (sembunyikan dari menu)'}">${icon(p.active === false ? 'eye' : 'lock', 16)}</button><button class="icon-btn icon-btn-danger" data-del-prod="${p.id}" title="Hapus Menu">${icon('trash', 16)}</button></div></article>`).join('')}</div></section>`, 'menu', user);
    bindAdminChrome('menu');
    $('#addProd').onclick = () => productFormModal(null, cats, () => menuAdminPage(user));
    $$('[data-edit-prod]').forEach(b => b.onclick = () => productFormModal(products.find(p => p.id === b.dataset.editProd), cats, () => menuAdminPage(user)));
    $$('[data-toggle-avail]').forEach(b => b.onclick = async () => { const p = products.find(x => x.id === b.dataset.toggleAvail); if (!p) return; const next = !p.isAvailable; await api('/admin/products/' + p.id, { method: 'PATCH', body: JSON.stringify({ isAvailable: next }) }); p.isAvailable = next; toast(`Status ${p.name} diubah ke ${next ? 'Tersedia' : 'Habis'}`); renderList(); });
    $$('[data-toggle-active]').forEach(b => b.onclick = async () => { const p = products.find(x => x.id === b.dataset.toggleActive); if (!p) return; const next = p.active === false; try { await api('/admin/products/' + p.id, { method: 'PATCH', body: JSON.stringify({ active: next }) }); p.active = next; toast(next ? `${p.name} diaktifkan kembali` : `${p.name} dinonaktifkan (disembunyikan dari menu customer)`); renderList(); } catch (e) { toast(e.message, true); } });
    $$('[data-del-prod]').forEach(b => b.onclick = async () => { const p = products.find(x => x.id === b.dataset.delProd); if (!p) return; if (!(await confirmDialog({ title: 'Hapus Menu?', message: `"${p.name}" akan dihapus. Jika menu ini sudah pernah dipesan, sistem hanya menonaktifkannya supaya laporan lama tetap utuh.`, ok: 'Hapus', danger: true }))) return; try { const r = await api('/admin/products/' + p.id, { method: 'DELETE' }); toast(r.mode === 'deleted' ? 'Menu dihapus permanen' : 'Menu punya riwayat pesanan, jadi hanya dinonaktifkan'); menuAdminPage(user); } catch (e) { toast(e.message, true); } });
    const sm = $('#searchMenu'); if (sm) sm.oninput = e => { query = e.target.value; clearTimeout(sm._t); sm._t = setTimeout(renderList, 180) };
    $('#filterMenuCat').onchange = e => { catId = e.target.value; renderList() };
  };
  renderList();
}

function productFormModal(p, cats, onDone) {
  const d = modal(`<div class="dialog wide-dialog"><h3>${p ? 'Edit Menu' : 'Tambah Menu Baru'}</h3><form id="prodForm" class="form-grid"><label>Nama Menu<input class="input" id="pName" value="${esc(p?.name || '')}" required placeholder="Contoh: Iced Caramel Macchiato"></label><label>Kategori<select class="input" id="pCat">${cats.filter(c => c.active).map(c => `<option value="${c.id}" ${p?.categoryId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label><label>Harga Reguler (Rp)<input class="input" id="pPrice" type="number" value="${p?.price || 28000}" required min="1000"></label><label>Harga Pelajar / Mahasiswa (Rp)<input class="input" id="pStudentPrice" type="number" value="${p?.studentPrice ?? (p ? p.price : 22000)}" required min="1000"><small style="color:var(--muted);font-size:11px;">Harga khusus diskon pelajar.</small></label><label class="full">Status Ketersediaan<select class="input" id="pAvail"><option value="true" ${p?.isAvailable !== false ? 'selected' : ''}>Tersedia</option><option value="false" ${p?.isAvailable === false ? 'selected' : ''}>Habis (Sold Out)</option></select></label><label class="full">Deskripsi Singkat<textarea class="textarea" id="pDesc" placeholder="Jelaskan aroma, rasa, atau bahan utama...">${esc(p?.description || '')}</textarea></label><div class="dialog-actions full"><button type="button" class="btn btn-soft" data-modal-close>Batal</button><button class="btn btn-primary" id="saveProd">Simpan Menu</button></div></form></div>`, 'wide-modal');
  $('#prodForm', d).onsubmit = async e => { e.preventDefault(); const btn = $('#saveProd', d); btn.disabled = true; try { const payload = { name: $('#pName', d).value, categoryId: $('#pCat', d).value, price: +$('#pPrice', d).value, studentPrice: +$('#pStudentPrice', d).value, isAvailable: $('#pAvail', d).value === 'true', description: $('#pDesc', d).value }; if (p) await api('/admin/products/' + p.id, { method: 'PATCH', body: JSON.stringify(payload) }); else await api('/admin/products', { method: 'POST', body: JSON.stringify(payload) }); d.remove(); toast('Menu berhasil disimpan'); onDone(); } catch (err) { toast(err.message, true); btn.disabled = false; } };
}

async function categoriesPage(user) {
  const cats = await api('/admin/categories');
  document.body.className = 'admin-body';
  const kitchenLabel = k => k === 'FOOD' ? '<span style="font-size:11px;background:#fff3ee;color:#c0522a;border-radius:4px;padding:1px 7px;font-weight:700;">🍽️ Dapur Makanan</span>' : '<span style="font-size:11px;background:#eef4ff;color:#1a6fb5;border-radius:4px;padding:1px 7px;font-weight:700;">☕ Dapur Minuman</span>';
  document.body.innerHTML = adminShell(`${adminTop('Kelola Kategori', 'Atur grup menu & penentuan struk dapur (Minuman / Makanan) untuk masing-masing printer.', `<button class="btn btn-primary" id="addCat">${icon('plus', 16)} Tambah Kategori</button>`)}<section class="admin-panel"><div class="category-list">${cats.map(c => `<div class="category-row ${!c.active ? 'archived' : ''}"><span class="category-grab">${icon('categories', 18)}</span><div><b>${esc(c.name)}</b><div style="display:flex;align-items:center;gap:6px;margin-top:3px;">${kitchenLabel(c.kitchenType)}<small class="muted">${c.active ? 'Aktif' : 'Diarsipkan'}</small></div></div><div class="row-actions"><button class="btn btn-small btn-soft" data-edit-cat="${c.id}">Edit</button><button class="btn btn-small btn-danger-soft" data-del-cat="${c.id}">Hapus</button></div></div>`).join('')}</div></section>`, 'categories', user);
  bindAdminChrome('categories');
  $$('[data-del-cat]').forEach(b => b.onclick = async () => { const c = cats.find(x => x.id === b.dataset.delCat); if (!c) return; if (!(await confirmDialog({ title: 'Hapus Kategori?', message: `Kategori "${c.name}" akan dihapus permanen. Kategori yang masih dipakai menu tidak bisa dihapus (nonaktifkan saja lewat Edit).`, ok: 'Hapus', danger: true }))) return; try { await api('/admin/categories/' + c.id, { method: 'DELETE' }); toast('Kategori dihapus'); categoriesPage(user); } catch (e) { toast(e.message, true); } });
  $('#addCat').onclick = () => categoryModal(null, () => categoriesPage(user));   $$('[data-edit-cat]').forEach(b => b.onclick = () => categoryModal(cats.find(c => c.id === b.dataset.editCat), () => categoriesPage(user)));
}

function categoryModal(c, onDone) {
  const d = modal(`<div class="dialog"><h3>${c ? 'Edit' : 'Tambah'} Kategori</h3><label class="field-label">Nama Kategori</label><input class="input" id="catName" value="${esc(c?.name || '')}" placeholder="Contoh: Seasonal Special">
    <label class="field-label" style="margin-top:12px;">Arahkan ke Printer Dapur</label>
    <div class="kitchen-type-selector">
      <label class="kitchen-type-option ${(c?.kitchenType || 'DRINK') === 'DRINK' ? 'selected' : ''}" id="kitchenDrink">
        <input type="radio" name="kitchenType" value="DRINK" ${(c?.kitchenType || 'DRINK') === 'DRINK' ? 'checked' : ''}>
        <span>☕</span><div><b>Dapur Minuman</b><small>Kopi, teh, jus, dll</small></div>
      </label>
      <label class="kitchen-type-option ${c?.kitchenType === 'FOOD' ? 'selected' : ''}" id="kitchenFood">
        <input type="radio" name="kitchenType" value="FOOD" ${c?.kitchenType === 'FOOD' ? 'checked' : ''}>
        <span>🍽️</span><div><b>Dapur Makanan</b><small>Makanan, snack, dessert</small></div>
      </label>
    </div>
    ${c ? `<label class="switch-setting" style="margin-top:12px;"><span><b>Status Aktif</b><small>Nonaktifkan jika tidak ingin ditampilkan di menu.</small></span><button type="button" class="switch ${c.active ? 'on' : ''}" id="catActive"><i></i></button></label>` : ''}<div class="dialog-actions"><button class="btn btn-soft" data-modal-close>Batal</button><button class="btn btn-primary" id="saveCat">Simpan</button></div></div>`, 'dialog-card');
  // Interactive radio selection styling
  $$('input[name="kitchenType"]', d).forEach(r => r.onchange = () => {
    $$('.kitchen-type-option', d).forEach(l => l.classList.toggle('selected', l.querySelector('input').checked));
  });
  let active = c?.active ?? true; const sw = $('#catActive', d); if (sw) sw.onclick = () => { active = !active; sw.classList.toggle('on', active) };
  $('#saveCat', d).onclick = async () => {
    try {
      const name = $('#catName', d).value.trim();
      if (!name) return toast('Nama kategori wajib diisi.', true);
      const kitchenType = d.querySelector('input[name="kitchenType"]:checked')?.value || 'DRINK';
      if (c) await api('/admin/categories/' + c.id, { method: 'PATCH', body: JSON.stringify({ name, active, kitchenType }) });
      else await api('/admin/categories', { method: 'POST', body: JSON.stringify({ name }) });
      d.remove(); toast('Kategori disimpan'); onDone();
    } catch (e) { toast(e.message, true); }
  };
}

async function tablesPage(user) {
  const tables = await api('/admin/tables');
  document.body.className = 'admin-body';
  document.body.innerHTML = adminShell(`${adminTop('Meja & QR Code', 'Kelola QR unik untuk setiap meja Cafe Campus.', `<button class="btn btn-primary" id="addTable">${icon('plus', 16)} Tambah Meja</button>`)}<div class="table-summary"><span>Total: <b>${tables.length} Meja</b></span><span>Tersedia: <b>${tables.filter(t => t.active).length}</b></span></div><section class="qr-grid">${tables.map(t => `<article class="qr-table-card ${!t.active ? 'disabled' : ''}"><div class="qr-card-head"><b>${esc(t.name)}</b><span><i></i>${t.active ? 'Tersedia' : 'Nonaktif'}</span></div><img src="/qr/${encodeURIComponent(t.publicToken)}.svg" alt="QR ${esc(t.name)}"><div class="qr-card-actions"><button data-open="${esc(t.publicToken)}" title="Buka customer">${icon('eye', 17)}</button><a href="/qr/${encodeURIComponent(t.publicToken)}.svg" download="Cafe-Campus-${esc(t.name)}-QR.svg" title="Download">${icon('download', 17)}</a><button data-rotate="${t.id}" title="Rotate QR">${icon('rotate', 17)}</button><button data-edit-table="${t.id}" title="Edit">${icon('edit', 17)}</button><button data-del-table="${t.id}" title="Hapus meja">${icon('trash', 17)}</button></div></article>`).join('')}</section>`, 'tables', user);
  bindAdminChrome('tables');
  $$('[data-del-table]').forEach(b => b.onclick = async () => { const t = tables.find(x => x.id === b.dataset.delTable); if (!t) return; if (!(await confirmDialog({ title: 'Hapus Meja?', message: `"${t.name}" akan dihapus. Jika meja ini sudah punya riwayat pesanan, sistem hanya menonaktifkannya supaya laporan tetap utuh.`, ok: 'Hapus', danger: true }))) return; try { const r = await api('/admin/tables/' + t.id, { method: 'DELETE' }); toast(r.mode === 'deleted' ? 'Meja dihapus permanen' : 'Meja punya riwayat pesanan, jadi hanya dinonaktifkan'); tablesPage(user); } catch (e) { toast(e.message, true); } });
  $('#addTable').onclick = () => tableModal(null, () => tablesPage(user));   $$('[data-edit-table]').forEach(b => b.onclick = () => tableModal(tables.find(t => t.id === b.dataset.editTable), () => tablesPage(user)));
  $$('[data-open]').forEach(b => b.onclick = () => window.open('/order/' + encodeURIComponent(b.dataset.open), '_blank'));$$
('[data-rotate]').forEach(b => b.onclick = async () => { if (!(await confirmDialog({ title: 'Buat QR Baru?', message: 'QR lama langsung tidak berlaku setelah token dirotasi.', ok: 'Rotate QR' }))) return; await api('/admin/tables/' + b.dataset.rotate, { method: 'PATCH', body: JSON.stringify({ rotateToken: true }) }); toast('QR baru berhasil dibuat'); tablesPage(user); });
}

function tableModal(t, onDone) {
  const d = modal(`<div class="dialog"><h3>${t ? 'Edit' : 'Tambah'} Meja</h3><label class="field-label">Nomor Meja</label><input class="input" id="tableNo" value="${esc(t?.tableNumber || '')}" placeholder="13"><label class="field-label">Nama Meja</label><input class="input" id="tableName" value="${esc(t?.name || '')}" placeholder="Meja 13">${t ? `<label class="switch-setting"><span><b>Status Meja</b><small>Customer hanya dapat scan QR meja aktif.</small></span><button type="button" class="switch ${t.active ? 'on' : ''}" id="tableActive"><i></i></button></label>` : ''}<div class="dialog-actions"><button class="btn btn-soft" data-modal-close>Batal</button><button class="btn btn-primary" id="saveTable">Simpan</button></div></div>`, 'dialog-card');
  let active = t?.active ?? true; const sw = $('#tableActive', d); if (sw) sw.onclick = () => { active = !active; sw.classList.toggle('on', active) };
  $('#saveTable', d).onclick = async () => { try { const payload = { tableNumber: $('#tableNo', d).value, name: $('#tableName', d).value, active }; if (t) await api('/admin/tables/' + t.id, { method: 'PATCH', body: JSON.stringify(payload) }); else await api('/admin/tables', { method: 'POST', body: JSON.stringify(payload) }); d.remove(); toast('Data meja disimpan'); onDone(); } catch (e) { toast(e.message, true); } };
}

async function paymentsPage(user) {
  let method = '';
  const load = async () => {
    const orders = await api('/admin/orders'); const paid = orders.filter(o => o.payment.status === 'PAID' && (!method || o.payment.method === method));
    const total = paid.reduce((s, o) => s + o.total, 0); const qris = paid.filter(o => o.payment.method === 'QRIS_DEMO').reduce((s, o) => s + o.total, 0); const cash = paid.filter(o => o.payment.method === 'CASH').reduce((s, o) => s + o.total, 0);
    document.body.className = 'admin-body';
    document.body.innerHTML = adminShell(`${adminTop('Laporan Pembayaran', 'Monitor penerimaan transaksi dari QRIS maupun tunai di kasir.')}<section class="payment-metrics"><div class="pay-metric"><span>Total Hari Ini</span><strong>${money(total)}</strong><i>${icon('wallet', 19)}</i></div><div class="pay-metric blue"><span>Metode QRIS</span><strong>${money(qris)}</strong><i>QR</i></div><div class="pay-metric green"><span>Bayar di Kasir</span><strong>${money(cash)}</strong><i>${icon('cash', 19)}</i></div></section><div class="payment-toolbar"><button class="date-filter">${icon('calendar', 16)} Hari Ini (${new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })})</button><select id="payMethod"><option value="">Semua Metode</option><option value="QRIS_DEMO" ${method === 'QRIS_DEMO' ? 'selected' : ''}>QRIS</option><option value="CASH" ${method === 'CASH' ? 'selected' : ''}>Tunai</option></select><button class="btn btn-outline" id="csv">${icon('download', 16)} Unduh CSV</button></div><section class="admin-panel">${paymentTable(paid)}</section>`, 'payments', user);
    bindAdminChrome('payments'); $('#payMethod').onchange = e => { method = e.target.value; load() }; $('#csv').onclick = () => downloadPaymentsCSV(paid);
  };
  await load(); setupAdminRealtime(load);
}

function paymentTable(orders) {
  if (!orders.length) return '<div class="admin-empty">Belum ada transaksi berhasil.</div>';
  return `<div class="responsive-table"><table class="admin-table payment-table"><thead><tr><th>No. Pesanan</th><th>Meja</th><th>Tipe</th><th>Metode</th><th>Jumlah Transaksi</th><th>Status</th><th>Waktu</th></tr></thead><tbody>${orders.map(o => `<tr><td data-label="Pesanan"><b>#${esc(o.orderNumber)}</b></td><td data-label="Meja">${esc(o.tableName)}</td><td data-label="Tipe">${o.customerType === 'STUDENT' ? `<span class="badge-role-student">🎓 Pelajar</span>` : `<span class="badge-role-regular">☕ Umum</span>`}</td><td data-label="Metode">${o.payment.method === 'QRIS_DEMO' ? '<span class="payment-badge qris">QRIS</span>' : '<span class="payment-badge cash">Tunai</span>'}</td><td data-label="Jumlah"><b>${money(o.total)}</b></td><td data-label="Status"><span class="status-badge status-ready">Berhasil</span></td><td data-label="Waktu">${formatTime(o.payment.paidAt || o.createdAt)}</td></tr>`).join('')}</tbody></table></div>`;
}

function downloadPaymentsCSV(orders) {
  const rows = [['No Pesanan', 'Meja', 'Tipe', 'Kampus', 'NIM', 'Metode', 'Jumlah', 'Diskon Hemat', 'Status', 'Waktu'], ...orders.map(o => [o.orderNumber, o.tableName, o.customerType || 'REGULAR', o.studentInfo?.campus || '', o.studentInfo?.studentId || '', o.payment.method === 'QRIS_DEMO' ? 'QRIS' : 'Tunai', o.total, o.totalSavings || 0, 'Berhasil', o.payment.paidAt || o.createdAt])];
  const csv = rows.map(r => r.map(v => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'Cafe-Campus-Pembayaran.csv'; a.click(); URL.revokeObjectURL(a.href);
}

async function reportsPage(user) {
  let days = 7;
  const load = async () => {
    const r = await api('/admin/reports?days=' + days); const max = Math.max(1, ...r.byDay.map(x => x.total));
    document.body.className = 'admin-body';
    document.body.innerHTML = adminShell(`${adminTop('Analitik & Laporan', 'Pantau tren penjualan dan performa menu Cafe Campus.')}<div class="report-tabs"><button data-days="1" class="${days === 1 ? 'active' : ''}">Hari Ini</button><button data-days="7" class="${days === 7 ? 'active' : ''}">Minggu Ini</button><button data-days="30" class="${days === 30 ? 'active' : ''}">Bulan Ini</button></div><section class="report-metrics"><div><span>Total Pendapatan</span><strong>${money(r.revenue)}</strong></div><div><span>Total Pesanan</span><strong>${r.orders} Pesanan</strong></div><div><span>Rata-rata Order</span><strong>${money(r.averageOrder)}</strong></div></section><section class="report-role-split"><div class="report-role-card student-card"><span>🎓 Total Omzet Pelajar / Mahasiswa</span><strong>${money(r.studentRevenue || 0)}</strong><small>${r.studentOrders || 0} Transaksi • Subsidi/Hemat Diberikan: ${money(r.studentSavings || 0)}</small></div><div class="report-role-card"><span>☕ Total Omzet Pelanggan Umum</span><strong>${money(r.regularRevenue || 0)}</strong><small>${r.regularOrders || 0} Transaksi Pelanggan Umum</small></div></section><section class="report-grid"><div class="admin-panel"><h2>Menu Terlaris</h2>${r.best.length ? r.best.map((x, i) => `<div class="best-item"><span class="rank">${i + 1}</span><div><b>${esc(x.name)}</b><small>Terjual ${x.qty} porsi</small></div><strong>${x.qty}</strong></div>`).join('') : '<div class="admin-empty">Belum ada data.</div>'}</div><div class="admin-panel"><div class="panel-head"><h2>Penjualan per Hari</h2></div><div class="bar-chart">${(r.byDay.length ? r.byDay : [{ date: todayISO(), total: 0 }]).map(x => `<div class="bar-col"><span style="height:${Math.max(8, x.total / max * 150)}px"></span><small>${x.date.slice(5)}</small></div>`).join('')}</div></div></section>`, 'reports', user);
    bindAdminChrome('reports'); $$('[data-days]').forEach(b => b.onclick = () => { days = +b.dataset.days; load() });
  };
  await load();
}

async function settingsPage(user) {
  const [s, audit] = await Promise.all([api('/admin/settings'), api('/admin/audit')]);
  const appMode = (s.appMode || 'production').toLowerCase();
  const isDemo = appMode === 'demo';
  let switches = { qrisEnabled: s.qrisEnabled !== false, cashEnabled: s.cashEnabled !== false, soundEnabled: s.soundEnabled !== false, dailyReportEnabled: s.dailyReportEnabled !== false };
  document.body.className = 'admin-body';
  const modeBanner = `<section class="admin-panel settings-panel" style="grid-column: 1 / -1; margin-bottom: 4px; border-left: 4px solid ${isDemo ? '#f59e0b' : '#10b981'}; background: ${isDemo ? 'rgba(245, 158, 11, 0.08)' : 'rgba(16, 185, 129, 0.08)'}; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding: 14px 18px;">
    <div style="display: flex; align-items: center; gap: 12px;">
      <span style="font-size: 22px;">${isDemo ? '⚡' : '🛡️'}</span>
      <div>
        <b style="font-size: 14px;">Mode Sistem: <span style="text-transform: uppercase; color: ${isDemo ? '#d97706' : '#059669'};">${esc(appMode)}</span></b>
        <p style="margin: 2px 0 0; font-size: 12px; color: var(--text-muted, #64748b);">
          ${isDemo ? 'Mode DEMO aktif: fitur simulasi bayar, reset data demo, dan helper pengujian aktif.' : 'Mode PRODUKSI aktif: simulasi dinonaktifkan, pengamanan penuh dan integritas transaksi aktif.'}
        </p>
      </div>
    </div>
    <span class="badge ${isDemo ? 'badge-warning' : 'badge-success'}" style="padding: 4px 10px; font-weight: 700; font-size: 11px;">${isDemo ? 'DEMO MODE' : 'PRODUCTION MODE'}</span>
  </section>`;
  document.body.innerHTML = adminShell(`${adminTop('Pengaturan Sistem', isDemo ? 'Kelola identitas cafe, metode pembayaran, notifikasi, dan akun demo.' : 'Kelola identitas cafe, metode pembayaran, notifikasi, dan operasional.')}<section class="settings-grid">${modeBanner}<div><section class="admin-panel settings-panel"><h2>Profil Cafe</h2>${[['cafeName', 'Nama Cafe', s.cafeName], ['cafeAddress', 'Alamat', s.cafeAddress || ''], ['cafePhone', 'No. Telepon', s.cafePhone || ''], ['operatingHours', 'Jam Operasional', s.operatingHours || '']].map(([id, l, v]) => `<label>${l}<input id="${id}" value="${esc(v)}"></label>`).join('')}<div class="two-fields"><label>Biaya Layanan (%)<input id="serviceFee" type="number" min="0" max="30" value="${s.serviceFee}"></label><label>Pajak (%)<input id="taxPercent" type="number" min="0" max="30" value="${s.taxPercent}"></label></div></section><section class="admin-panel settings-panel"><h2>Metode Pembayaran</h2>${settingSwitch('qrisEnabled', 'Integrasi QRIS Otomatis', 'Mode demo memakai simulasi sandbox.', switches.qrisEnabled)}${settingSwitch('cashEnabled', 'Bayar di Kasir (Tunai)', 'Pelanggan membayar langsung di meja kasir.', switches.cashEnabled)}</section><section class="admin-panel settings-panel"><div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;"><h2 style="margin:0;">🤖 Integrasi Google Gemini AI</h2><span class="badge ${s.geminiStatus?.active ? 'badge-success' : 'badge-warning'}" id="geminiStatusBadge" style="padding: 3px 8px; font-size:11px;">${s.geminiStatus?.active ? '🟢 AKTIF' : '🟡 KUNCI BELUM DIISI'}</span></div><p style="font-size:12px; color:var(--muted); margin-bottom:12px;">Digunakan untuk OCR scan KTM presisi tinggi dan percakapan cerdas Barista AI Chatbot.${s.geminiStatus?.source ? `<br><small style="color:var(--text); display:inline-block; margin-top:4px;">Sumber Kunci: <b>${s.geminiStatus.source === 'ENV' ? 'Railway / Environment' : s.geminiStatus.source === 'DATABASE' ? 'Database Pengaturan' : 'Kunci Bawaan Sistem'}</b> ${s.geminiStatus.maskedKey ? `(${s.geminiStatus.maskedKey})` : ''}</small>` : ''}</p><label>Google Gemini API Key<div style="display:flex; gap:8px;"><input id="geminiApiKey" type="password" placeholder="AIzaSy... atau biarkan bawaan" value="${esc(s.geminiApiKey || '')}" style="flex:1;"><button type="button" class="btn btn-soft" id="btnToggleGeminiKey" style="padding:0 12px;" title="Tampilkan/Sembunyikan">👁️</button></div></label><div style="margin-top:10px; display:flex; gap:8px; align-items:center;"><button type="button" class="btn btn-outline" id="btnTestGemini">⚡ Uji Koneksi AI</button><span id="geminiTestResult" style="font-size:12px; color:var(--muted);"></span></div></section></div><div><section class="admin-panel settings-panel"><h2>Notifikasi & Suara</h2>${settingSwitch('soundEnabled', 'Pesanan Masuk Baru', 'Mainkan notifikasi suara saat browser mengizinkan.', switches.soundEnabled)}${settingSwitch('dailyReportEnabled', 'Laporan Penutupan Harian', 'Siapkan ringkasan operasional harian.', switches.dailyReportEnabled)}</section><section class="admin-panel settings-panel"><h2>Keamanan & Akun</h2><label>Email Akun<input value="${esc(user.email || '')}" disabled></label><div class="setting-actions"><button class="btn btn-outline" id="passwordDemo">Ubah Password</button><button class="btn btn-danger" id="logoutSettings">Keluar Sesi</button></div></section><section class="admin-panel settings-panel demo-controls"><h2>Kontrol Demo</h2><p>Reset mengembalikan menu, meja, sample order, reports, dan settings ke kondisi awal.</p><button class="btn btn-outline" id="resetDemo">Reset Data Demo</button></section></div></section><section class="admin-panel audit-panel"><div class="panel-head"><h2>Audit Trail</h2><span>${audit.length} aktivitas terakhir</span></div><div class="audit-list">${audit.slice(0, 12).map(a => `<div><span>${formatTime(a.at)}</span><b>${esc(a.action.replaceAll('_', ' '))}</b><small>${esc(JSON.stringify(a.meta || {}))}</small></div>`).join('') || '<div class="admin-empty">Belum ada aktivitas admin.</div>'}</div></section><div class="settings-save"><button class="btn btn-primary" id="saveSettings">Simpan Perubahan</button></div>`, 'settings', user);

  bindAdminChrome('settings');
  $$('[data-setting-switch]').forEach(b => b.onclick = () => { const k = b.dataset.settingSwitch; switches[k] = !switches[k]; b.classList.toggle('on', switches[k]); });$('#saveSettings').onclick = async () => {
    try { await api('/admin/settings', { method: 'PATCH', body: JSON.stringify({ cafeName: $('#cafeName').value, cafeAddress: $('#cafeAddress').value, cafePhone: $('#cafePhone').value, operatingHours: $('#operatingHours').value, serviceFee: +$('#serviceFee').value, taxPercent: +$('#taxPercent').value, geminiApiKey: $('#geminiApiKey') ? $('#geminiApiKey').value.trim() : undefined, ...switches }) }); toast('Pengaturan berhasil disimpan'); } catch (e) { toast(e.message, true); }
  };
  if ($('#btnTestGemini')) {
    $('#btnTestGemini').onclick = async () => {
      const statusSpan = $('#geminiTestResult');
      statusSpan.textContent = '⏳ Menguji koneksi ke Google Gemini...';
      try {
        const testRes = await api('/admin/gemini/test', {
          method: 'POST',
          body: JSON.stringify({ apiKey: $('#geminiApiKey') ? $('#geminiApiKey').value.trim() : '' })
        });
        statusSpan.textContent = testRes.message;
        statusSpan.style.color = '#15803d';
        toast(testRes.message);
      } catch (err) {
        statusSpan.textContent = '❌ ' + err.message;
        statusSpan.style.color = '#b91c1c';
        toast('Uji koneksi gagal: ' + err.message, true);
      }
    };
  }
  if ($('#btnToggleGeminiKey')) {
    $('#btnToggleGeminiKey').onclick = () => {
      const input = $('#geminiApiKey');
      input.type = input.type === 'password' ? 'text' : 'password';
    };
  }
  $('#passwordDemo').onclick = () => {
    const d = modal(`<div class="dialog">
      <div class="dialog-icon">${icon('lock', 24)}</div>
      <h3>Ubah Password</h3>
      <p>Gunakan password baru minimal 12 karakter agar akun lebih aman.</p>
      <form id="changePasswordForm" class="form-grid" style="margin-top:16px;">
        <label class="field-label">Password saat ini<input class="input" id="currentPassword" type="password" autocomplete="current-password" required></label>
        <label class="field-label">Password baru<input class="input" id="newPassword" type="password" minlength="12" autocomplete="new-password" required></label>
        <label class="field-label">Konfirmasi password baru<input class="input" id="confirmNewPassword" type="password" minlength="12" autocomplete="new-password" required></label>
        <div class="dialog-actions"><button type="button" class="btn btn-soft" data-modal-close>Batal</button><button type="submit" class="btn btn-primary" id="saveNewPassword">Simpan Password</button></div>
      </form>
    </div>`, 'dialog-card');
    $('#changePasswordForm', d).onsubmit = async e => {
      e.preventDefault();
      const currentPassword = $('#currentPassword', d).value;
      const newPassword = $('#newPassword', d).value;
      const confirmNewPassword = $('#confirmNewPassword', d).value;
      if (newPassword.length < 12) return toast('Password baru minimal 12 karakter.', true);
      if (newPassword !== confirmNewPassword) return toast('Konfirmasi password baru tidak sama.', true);
      const saveButton = $('#saveNewPassword', d);
      saveButton.disabled = true;
      try {
        await api('/admin/me/password', { method: 'PUT', body: JSON.stringify({ currentPassword, newPassword }) });
        d.remove();
        toast('Password berhasil diperbarui. Simpan password baru dengan aman.');
      } catch (err) {
        toast(err.message, true);
        saveButton.disabled = false;
      }
    };
    $('#currentPassword', d).focus();
  };
  $('#logoutSettings').onclick = logoutAdmin;
  $('#resetDemo').onclick = async () => { if (!(await confirmDialog({ title: 'Reset Semua Data Demo?', message: 'Semua perubahan review akan dihapus dan dikembalikan ke data awal.', ok: 'Reset Demo', danger: true }))) return; await api('/admin/demo/reset', { method: 'POST', body: '{}' }); clearCart(); toast('Data demo berhasil di-reset'); nav('/admin'); };
}
function settingSwitch(key, title, desc, on) { return `<div class="setting-switch-row"><span><b>${esc(title)}</b><small>${esc(desc)}</small></span><button type="button" class="switch ${on ? 'on' : ''}" data-setting-switch="${key}"><i></i></button></div>`; }

// ==========================================
// DIGITAL KTM SMART CARD ENGINE (FAKULTAS)
// ==========================================
function renderDigitalKtmCard(s = {}) {
  const facCode = (s.facultyCode || 'UI').toUpperCase();
  const facMap = {
    'FT': { name: 'Fakultas Teknik', color: '#1e3a8a' },
    'FK': { name: 'Fakultas Kedokteran', color: '#065f46' },
    'FEB': { name: 'Fakultas Ekonomi dan Bisnis', color: '#b45309' },
    'FH': { name: 'Fakultas Hukum', color: '#991b1b' },
    'FASILKOM': { name: 'Fakultas Ilmu Komputer', color: '#6b21a8' },
    'FMIPA': { name: 'Fakultas Matematika & IPA', color: '#0e7490' },
    'FISIP': { name: 'Fakultas Ilmu Sosial & Politik', color: '#c2410c' },
    'FIB': { name: 'Fakultas Ilmu Pengetahuan Budaya', color: '#0f766e' },
    'FPSI': { name: 'Fakultas Psikologi', color: '#be185d' }
  };
  const facInfo = facMap[facCode] || { name: 'Fakultas Kampus', color: '#1e3a8a' };
  const facName = s.facultyName || facInfo.name;
  const color = s.facultyColor || facInfo.color;
  const name = s.studentName || 'Mahasiswa Terdaftar';
  const nim = s.studentId || '1234567890';
  const campus = s.campus || 'Universitas Indonesia';
  const prodi = s.studyProgram || 'Program Studi Reguler';
  const birth = s.birthDate ? new Date(s.birthDate).toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric' }) : '-';
  const hasPhoto = Boolean(s.studentPhoto && String(s.studentPhoto).trim().length > 10);
  const photoSvg = `<svg viewBox="0 0 100 100" style="width:100%;height:100%;background:#e2e8f0;fill:#94a3b8;"><circle cx="50" cy="38" r="22"/><path d="M15 88 C15 65 30 58 50 58 C70 58 85 65 85 88 Z"/></svg>`;
  const photoImg = hasPhoto
    ? `<img src="${esc(s.studentPhoto)}" alt="Foto Mahasiswa" onerror="this.src='/assets/hero-desktop.jpg'">`
    : photoSvg;

  return `
    <div class="ktm-smart-card-wrap" style="--ktm-accent: ${esc(color)};">
      <div class="ktm-smart-card">
        <div class="ktm-card-header">
          <div class="ktm-univ-logo">🎓</div>
          <div class="ktm-univ-meta">
            <strong>${esc(campus.toUpperCase())}</strong>
            <span>${esc(facName.toUpperCase())} (${esc(facCode)})</span>
          </div>
          <div class="ktm-faculty-pill">${esc(facCode)}</div>
        </div>
        <div class="ktm-card-body">
          <div class="ktm-photo-col">
            <div class="ktm-photo-frame">
              ${photoImg}
            </div>
            <div class="ktm-chip-graphic">
              <div class="emv-chip"><i></i><i></i><i></i></div>
              <span class="ktm-nfc-icon">🛜</span>
            </div>
          </div>
          <div class="ktm-info-col">
            <div class="ktm-field">
              <label>NAMA MAHASISWA</label>
              <strong>${esc(name)}</strong>
            </div>
            <div class="ktm-field">
              <label>NOMOR INDUK MAHASISWA (NIM)</label>
              <strong class="ktm-nim-display">${esc(nim)}</strong>
            </div>
            <div class="ktm-field-grid">
              <div>
                <label>PROGRAM STUDI</label>
                <span>${esc(prodi)}</span>
              </div>
              <div>
                <label>TGL LAHIR</label>
                <span>${esc(birth)}</span>
              </div>
            </div>
            <div class="ktm-badge-active">
              <span class="badge-dot"></span> MAHASISWA AKTIF KAMPUS
            </div>
          </div>
        </div>
        <div class="ktm-card-footer">
          <div class="ktm-barcode-box">
            <div class="ktm-barcode-lines">||| | |||| | ||||| || | ||| |||| | |||| ||</div>
            <small>KTM-AUTH-${esc(nim)}</small>
          </div>
          <div class="ktm-hologram">
            <span>RESMI</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function openDigitalKtmModal(studentInfo) {
  if (!studentInfo) return toast('Data kartu mahasiswa tidak tersedia.', true);
  const d = modal(`
    <div class="dialog digital-ktm-modal">
      <div class="modal-heading">
        <div>
          <span>KARTU TANDA MAHASISWA DIGITAL (KTM)</span>
          <h2>Verifikasi Otomatis Terintegrasi</h2>
        </div>
        <span class="status-badge status-ready"><i class="status-dot"></i>Valid &amp; Aktif</span>
      </div>
      <div style="margin: 16px 0;">
        ${renderDigitalKtmCard(studentInfo)}
      </div>
      <p style="font-size:12px;color:var(--muted);text-align:center;margin:0 0 16px 0;">
        Desain &amp; warna kartu dibuat otomatis dari profil fakultas mahasiswa (${esc(studentInfo.facultyName || studentInfo.facultyCode || 'Umum')}).
      </p>
      <div class="dialog-actions">
        <button class="btn btn-primary btn-full" data-modal-close>Tutup Kartu Mahasiswa</button>
      </div>
    </div>
  `, 'dialog-card');
}

// ==========================================
// KITCHEN DISPLAY SYSTEM (KDS)
// ==========================================
async function kdsPage(user) {
  let activeStation = 'ALL'; // 'ALL', 'DRINK', 'FOOD'
  const loadKds = async () => {
    const orders = await api('/admin/orders');
    const activeOrders = orders.filter(o => ['NEW', 'PROCESSING', 'READY'].includes(o.status));
    
    document.body.className = 'admin-body kds-page-body';
    document.body.innerHTML = adminShell(`
      ${adminTop('Kitchen Display System (KDS)', 'Layar monitor dapur real-time untuk barista kopi & dapur makanan dengan pemisahan stasiun.', `
        <div class="kds-station-switch">
          <button class="btn btn-small ${activeStation === 'ALL' ? 'btn-primary' : 'btn-soft'}" data-station="ALL">Semua Dapur</button>
          <button class="btn btn-small ${activeStation === 'DRINK' ? 'btn-primary' : 'btn-soft'}" data-station="DRINK">☕ Barista Minuman</button>
          <button class="btn btn-small ${activeStation === 'FOOD' ? 'btn-primary' : 'btn-soft'}" data-station="FOOD">🍽️ Dapur Makanan</button>
        </div>
      `)}
      <div class="kds-board-grid">
        <div class="kds-board-column new-col">
          <div class="kds-col-head">
            <h3><span>🔔</span> Pesanan Baru (Antrean Masuk)</h3>
            <span class="kds-col-count">${activeOrders.filter(o => o.status === 'NEW').length}</span>
          </div>
          <div class="kds-col-body">
            ${renderKdsColumn(activeOrders.filter(o => o.status === 'NEW'), activeStation)}
          </div>
        </div>
        <div class="kds-board-column proc-col">
          <div class="kds-col-head">
            <h3><span>🍳</span> Sedang Dimasak / Diracik</h3>
            <span class="kds-col-count">${activeOrders.filter(o => o.status === 'PROCESSING').length}</span>
          </div>
          <div class="kds-col-body">
            ${renderKdsColumn(activeOrders.filter(o => o.status === 'PROCESSING'), activeStation)}
          </div>
        </div>
        <div class="kds-board-column ready-col">
          <div class="kds-col-head">
            <h3><span>✅</span> Siap Diambil di Pick-Up</h3>
            <span class="kds-col-count">${activeOrders.filter(o => o.status === 'READY').length}</span>
          </div>
          <div class="kds-col-body">
            ${renderKdsColumn(activeOrders.filter(o => o.status === 'READY'), activeStation)}
          </div>
        </div>
      </div>
    `, 'kds', user);

    bindAdminChrome('kds');
    $$('[data-station]').forEach(b => b.onclick = () => {
      activeStation = b.dataset.station;
      loadKds();
    });
    bindKdsActions(loadKds);
  };

  await loadKds();
  setupAdminRealtime(loadKds);
}

function renderKdsColumn(orders, station) {
  let list = orders;
  if (station && station !== 'ALL') {
    list = orders.map(o => {
      const items = (o.items || []).filter(i => {
        const kt = i.kitchenType || ((i.categorySlug === 'makanan' || i.categorySlug === 'snack' || i.categorySlug === 'dessert') ? 'FOOD' : 'DRINK');
        return kt === station;
      });
      return items.length ? { ...o, items } : null;
    }).filter(Boolean);
  }

  if (!list.length) return `<div class="kds-empty-col">Tidak ada pesanan untuk stasiun ${station === 'DRINK' ? 'Barista Minuman' : (station === 'FOOD' ? 'Dapur Makanan' : 'ini')}</div>`;
  return list.map(o => {
    const items = o.items || [];
    const isPaid = (o.payment?.status || o.paymentStatus) === 'PAID';
    return `
      <article class="kds-ticket-card status-${o.status.toLowerCase()}">
        <div class="kds-ticket-top">
          <div class="kds-ticket-title">
            <strong class="kds-order-no">#${esc(o.orderNumber)}</strong>
            <span class="kds-queue-tag">Antrean: ${esc(o.queueNumber || 'Q-001')}</span>
          </div>
          <span class="kds-table-badge">${esc(o.tableName)}</span>
        </div>
        <div class="kds-ticket-meta">
          <span>🕒 ${formatTime(o.createdAt)}</span>
          <span class="${isPaid ? 'kds-paid-tag' : 'kds-unpaid-tag'}">
            ${isPaid ? 'LUNAS' : 'BELUM BAYAR'}
          </span>
        </div>
        <div class="kds-items-list">
          ${items.map(i => `
            <div class="kds-item-row">
              <span class="kds-item-qty">${i.quantity}x</span>
              <div class="kds-item-desc">
                <b>${esc(i.productName)}</b>
                ${i.options ? `<small>${esc(optionSummary(i))}</small>` : ''}
                ${i.note ? `<div class="kds-note-pill">📝 ${esc(i.note)}</div>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
        <div class="kds-card-actions">
          ${o.status === 'NEW' ? (
            !(o.receiptPrinted || o.receipt_printed) ? `
              <div style="margin-bottom:6px;font-size:11px;color:#b45309;background:#fffbeb;border:1px dashed #fde68a;border-radius:4px;padding:3px 6px;text-align:center;">
                ⚠️ Wajib Cetak Struk Kasir
              </div>
              <button class="btn btn-primary btn-small btn-wide btn-highlight-print" data-kds-print="${esc(o.orderNumber)}" data-next="PROCESSING">
                🖨️ Cetak Struk & Mulai Racik
              </button>
            ` : `
              <button class="btn btn-blue btn-small btn-wide" data-kds-bump="${esc(o.orderNumber)}" data-next="PROCESSING">
                ▶ Mulai Racik
              </button>
            `
          ) : ''}
          ${o.status === 'PROCESSING' ? `
            <button class="btn btn-green btn-small btn-wide" data-kds-bump="${esc(o.orderNumber)}" data-next="READY">
              🔔 Siap Diambil
            </button>
          ` : ''}
          ${o.status === 'READY' ? `
            <button class="btn btn-dark btn-small btn-wide" data-kds-bump="${esc(o.orderNumber)}" data-next="COMPLETED">
              ✓ Selesai Pick-up
            </button>
          ` : ''}
        </div>
      </article>
    `;
  }).join('');
}

function bindKdsActions(onUpdate) {
  $$('[data-kds-print]').forEach(b => b.onclick = () => {
    const num = b.dataset.kdsPrint;
    showOrderReceiptDialog(num, onUpdate, true);
  });
  $$('[data-kds-bump]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    const num = b.dataset.kdsBump;
    const next = b.dataset.next;
    try {
      await api('/admin/orders/' + encodeURIComponent(num) + '/status', {
        method: 'PATCH',
        body: JSON.stringify({ status: next })
      });
      if (next === 'READY') {
        alarm.playReadyChime();
        toast('🔔 Pesanan #' + num + ' SIAP! Buzzer & Alarm berdering di layar pelanggan.');
      } else {
        toast('Status pesanan #' + num + ' dimajukan ke ' + next);
      }
      onUpdate();
    } catch(e) {
      toast(e.message, true);
      b.disabled = false;
    }
  });
}

// ==========================================
// MASTER DATA FAKULTAS (CRUD)
// ==========================================
async function facultiesAdminPage(user) {
  const list = await api('/public/faculties');
  document.body.className = 'admin-body';
  document.body.innerHTML = adminShell(`
    ${adminTop('Master Data Fakultas & Tema KTM', 'Kelola daftar fakultas, kode, dan warna tema kartu mahasiswa digital.', `
      <button class="btn btn-primary" id="btnAddFaculty">${icon('plus', 16)} Tambah Fakultas</button>
    `)}
    <section class="admin-panel">
      <div class="responsive-table">
        <table class="admin-table">
          <thead>
            <tr>
              <th style="width:120px;">Kode</th>
              <th>Nama Fakultas</th>
              <th style="width:140px;">Warna Tema KTM</th>
              <th style="width:160px;">Preview Badge</th>
              <th style="width:100px;text-align:right;">Aksi</th>
            </tr>
          </thead>
          <tbody>
            ${list.map(f => `
              <tr>
                <td><b>${esc(f.code)}</b></td>
                <td><strong>${esc(f.name)}</strong></td>
                <td>
                  <div style="display:flex;align-items:center;gap:8px;">
                    <span style="display:inline-block;width:20px;height:20px;border-radius:6px;background:${esc(f.colorTheme)};border:1px solid rgba(0,0,0,0.1);"></span>
                    <code>${esc(f.colorTheme)}</code>
                  </div>
                </td>
                <td>
                  <span class="ktm-preview-chip" style="background:${esc(f.colorTheme)}18;color:${esc(f.colorTheme)};border:1px solid ${esc(f.colorTheme)}44;padding:3px 8px;border-radius:6px;font-size:12px;font-weight:700;">
                    🎓 ${esc(f.code)} Card
                  </span>
                </td>
                <td style="text-align:right;">
                  <button class="icon-btn" data-edit-faculty="${esc(f.id)}" title="Edit">${icon('edit', 16)}</button>
                  <button class="icon-btn icon-btn-danger" data-del-faculty="${esc(f.id)}" title="Hapus">${icon('trash', 16)}</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `, 'faculties', user);

  bindAdminChrome('faculties');
  $('#btnAddFaculty').onclick = () => facultyModal(null, () => facultiesAdminPage(user));
  $$('[data-edit-faculty]').forEach(b => b.onclick = () => {
    const f = list.find(x => x.id === b.dataset.editFaculty);
    facultyModal(f, () => facultiesAdminPage(user));
  });
  $$('[data-del-faculty]').forEach(b => b.onclick = async () => {
    const f = list.find(x => x.id === b.dataset.delFaculty);
    if (!f) return;
    if (!(await confirmDialog({ title: 'Hapus Fakultas?', message: `Fakultas "${f.name}" akan dihapus.`, ok: 'Hapus', danger: true }))) return;
    try {
      await api('/admin/faculties/' + encodeURIComponent(f.id), { method: 'DELETE' });
      toast('Fakultas berhasil dihapus');
      facultiesAdminPage(user);
    } catch(e) { toast(e.message, true); }
  });
}

function facultyModal(f, onDone) {
  const d = modal(`
    <div class="dialog">
      <h3>${f ? 'Edit Fakultas' : 'Tambah Fakultas Baru'}</h3>
      <label class="field-label">ID Fakultas</label>
      <input class="input" id="fId" value="${esc(f?.id || '')}" placeholder="fac-fasilkom" ${f ? 'disabled' : ''}>
      <label class="field-label" style="margin-top:12px;">Nama Fakultas</label>
      <input class="input" id="fName" value="${esc(f?.name || '')}" placeholder="Fakultas Ilmu Komputer">
      <label class="field-label" style="margin-top:12px;">Kode Singkatan (Badge)</label>
      <input class="input" id="fCode" value="${esc(f?.code || '')}" placeholder="FASILKOM">
      <label class="field-label" style="margin-top:12px;">Warna Tema KTM (Hex / Picker)</label>
      <div style="display:flex;gap:10px;align-items:center;">
        <input type="color" id="fColorPicker" value="${esc(f?.colorTheme || '#0284c7')}" style="width:48px;height:38px;padding:2px;border-radius:8px;border:1px solid var(--line);cursor:pointer;">
        <input class="input" id="fColor" value="${esc(f?.colorTheme || '#0284c7')}" placeholder="#0284c7" style="flex:1;">
      </div>
      <div class="dialog-actions" style="margin-top:18px;">
        <button class="btn btn-soft" data-modal-close>Batal</button>
        <button class="btn btn-primary" id="btnSaveFaculty">Simpan Fakultas</button>
      </div>
    </div>
  `, 'dialog-card');

  const picker = $('#fColorPicker', d);
  const text = $('#fColor', d);
  picker.oninput = () => text.value = picker.value;
  text.oninput = () => { if (/^#[0-9A-Fa-f]{6}$/.test(text.value)) picker.value = text.value; };

  $('#btnSaveFaculty', d).onclick = async () => {
    const name = $('#fName', d).value.trim();
    const code = $('#fCode', d).value.trim();
    const colorTheme = text.value.trim();
    if (!name || !code) return toast('Nama dan kode fakultas wajib diisi.', true);

    try {
      if (f) {
        await api('/admin/faculties/' + encodeURIComponent(f.id), {
          method: 'PATCH',
          body: JSON.stringify({ name, code, colorTheme })
        });
      } else {
        const id = ($('#fId', d).value.trim() || ('fac-' + code.toLowerCase().replace(/[^a-z0-9]/g, '')));
        await api('/admin/faculties', {
          method: 'POST',
          body: JSON.stringify({ id, name, code, colorTheme })
        });
      }
      d.remove();
      toast('Fakultas berhasil disimpan');
      onDone();
    } catch(e) { toast(e.message, true); }
  };
}

// ==========================================
// RESEP MENU & STOK BAHAN BAKU REAL-TIME
// ==========================================
async function inventoryAdminPage(user) {
  let activeTab = 'MATERIALS'; // 'MATERIALS' or 'RECIPES'
  const [materials, products, mutations] = await Promise.all([
    api('/admin/materials'),
    api('/admin/products'),
    api('/admin/stock/mutations').catch(() => [])
  ]);

  const renderInventoryView = () => {
    document.body.className = 'admin-body';
    document.body.innerHTML = adminShell(`
      ${adminTop('Komposisi Resep & Stok Real-Time', 'Manajemen bahan baku atomik (Biji kopi, susu, cup, sirup) dan kalkulasi porsi menu.', `
        ${activeTab === 'MATERIALS' ? `<button class="btn btn-primary" id="btnAddMaterial">${icon('plus', 16)} Tambah Bahan Baku</button>` : ''}
      `)}
      <div class="report-tabs" style="margin-bottom:16px;">
        <button class="${activeTab === 'MATERIALS' ? 'active' : ''}" id="tabMat">Bahan Baku &amp; Mutasi Stok</button>
        <button class="${activeTab === 'RECIPES' ? 'active' : ''}" id="tabRec">Komposisi Resep Menu</button>
      </div>

      ${activeTab === 'MATERIALS' ? `
        <div class="inventory-alerts-bar">
          ${materials.filter(m => Number(m.current_stock) <= Number(m.min_stock)).map(m => `
            <div class="badge-stock-warn">
              ⚠️ <b>Peringatan Stok Menipis:</b> ${esc(m.name)} tersisa ${m.current_stock} ${esc(m.unit)} (Batas minimum: ${m.min_stock} ${esc(m.unit)})
            </div>
          `).join('')}
        </div>
        <section class="admin-panel" style="margin-bottom:24px;">
          <div class="panel-head">
            <h2>Daftar Bahan Baku Resto</h2>
            <span>${materials.length} Jenis Bahan</span>
          </div>
          <div class="responsive-table">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Nama Bahan</th>
                  <th>Stok Saat Ini</th>
                  <th>Satuan</th>
                  <th>Stok Minimum</th>
                  <th>Status</th>
                  <th style="text-align:right;">Aksi</th>
                </tr>
              </thead>
              <tbody>
                ${materials.map(m => {
                  const isLow = Number(m.current_stock) <= Number(m.min_stock);
                  return `
                    <tr>
                      <td><b>${esc(m.name)}</b></td>
                      <td><strong style="${isLow ? 'color:#c92a2a;' : ''}">${m.current_stock}</strong></td>
                      <td>${esc(m.unit)}</td>
                      <td>${m.min_stock}</td>
                      <td>
                        <span class="status-badge ${isLow ? 'status-cancelled' : 'status-ready'}">
                          <i class="status-dot"></i>${isLow ? 'Stok Menipis' : 'Stok Aman'}
                        </span>
                      </td>
                      <td style="text-align:right;">
                        <button class="btn btn-small btn-soft" data-adjust-stock="${esc(m.id)}">Sesuaikan Stok</button>
                        <button class="icon-btn" data-edit-mat="${esc(m.id)}" title="Edit">${icon('edit', 16)}</button>
                        <button class="icon-btn icon-btn-danger" data-del-mat="${esc(m.id)}" title="Hapus">${icon('trash', 16)}</button>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </section>

        <section class="admin-panel">
          <div class="panel-head">
            <h2>Riwayat Mutasi Stok Otomatis</h2>
            <span>${mutations.length} Aktivitas Mutasi Terakhir</span>
          </div>
          <div class="responsive-table">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Waktu</th>
                  <th>Bahan Baku</th>
                  <th>Perubahan</th>
                  <th>Stok Akhir</th>
                  <th>Tipe Mutasi</th>
                  <th>Keterangan / Order</th>
                </tr>
              </thead>
              <tbody>
                ${mutations.slice(0, 15).map(mt => `
                  <tr>
                    <td>${formatTime(mt.created_at)}</td>
                    <td><b>${esc(mt.material_name || mt.raw_material_id)}</b></td>
                    <td style="font-weight:700;color:${Number(mt.change_amount) < 0 ? '#c92a2a' : '#2b8a3e'};">
                      ${Number(mt.change_amount) > 0 ? '+' : ''}${mt.change_amount}
                    </td>
                    <td><b>${mt.balance_after}</b></td>
                    <td><span class="badge-role-regular">${esc(mt.mutation_type)}</span></td>
                    <td><small>${esc(mt.notes || '-')}</small></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </section>
      ` : `
        <section class="admin-panel">
          <div class="panel-head">
            <h2>Katalog Menu &amp; Komposisi Resep</h2>
            <span>Klik menu untuk melihat atau mengubah takaran bahan per porsi</span>
          </div>
          <div class="recipe-menu-grid">
            ${products.map(p => `
              <div class="recipe-product-card">
                <div class="rpc-top">
                  <img src="${esc(p.imageUrl || '/assets/iced-latte.jpg')}" alt="">
                  <div>
                    <b>${esc(p.name)}</b>
                    <small>${money(p.price)} • ${p.isAvailable ? 'Tersedia' : 'Habis'}</small>
                  </div>
                </div>
                <div class="rpc-body" id="recipeBox_${esc(p.id)}">
                  <button class="btn btn-soft btn-small btn-wide" data-view-recipe="${esc(p.id)}">
                    📜 Atur Takaran Resep (${esc(p.name)})
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        </section>
      `}
    `, 'inventory', user);

    bindAdminChrome('inventory');
    $('#tabMat').onclick = () => { activeTab = 'MATERIALS'; renderInventoryView(); };
    $('#tabRec').onclick = () => { activeTab = 'RECIPES'; renderInventoryView(); };

    if (activeTab === 'MATERIALS') {
      const addBtn = $('#btnAddMaterial');
      if (addBtn) addBtn.onclick = () => materialModal(null, () => inventoryAdminPage(user));
      $$('[data-adjust-stock]').forEach(b => b.onclick = () => {
        const m = materials.find(x => x.id === b.dataset.adjustStock);
        adjustStockModal(m, () => inventoryAdminPage(user));
      });
      $$('[data-edit-mat]').forEach(b => b.onclick = () => {
        const m = materials.find(x => x.id === b.dataset.editMat);
        materialModal(m, () => inventoryAdminPage(user));
      });
      $$('[data-del-mat]').forEach(b => b.onclick = async () => {
        const m = materials.find(x => x.id === b.dataset.delMat);
        if (!m) return;
        if (!(await confirmDialog({ title: 'Hapus Bahan Baku?', message: `Bahan "${m.name}" akan dihapus.`, ok: 'Hapus', danger: true }))) return;
        try {
          await api('/admin/materials/' + encodeURIComponent(m.id), { method: 'DELETE' });
          toast('Bahan berhasil dihapus');
          inventoryAdminPage(user);
        } catch(e) { toast(e.message, true); }
      });
    } else {
      $$('[data-view-recipe]').forEach(b => b.onclick = () => {
        const p = products.find(x => x.id === b.dataset.viewRecipe);
        recipeModal(p, materials, () => inventoryAdminPage(user));
      });
    }
  };

  renderInventoryView();
}

function materialModal(m, onDone) {
  const d = modal(`
    <div class="dialog">
      <h3>${m ? 'Edit Bahan Baku' : 'Tambah Bahan Baku Baru'}</h3>
      <label class="field-label">Nama Bahan Baku</label>
      <input class="input" id="mName" value="${esc(m?.name || '')}" placeholder="Contoh: Biji Kopi Arabica">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;">
        <div>
          <label class="field-label">Satuan</label>
          <input class="input" id="mUnit" value="${esc(m?.unit || 'gram')}" placeholder="gram, ml, pcs">
        </div>
        <div>
          <label class="field-label">Stok Minimum (Alert)</label>
          <input class="input" type="number" id="mMin" value="${m?.min_stock ?? 100}">
        </div>
      </div>
      ${!m ? `
        <label class="field-label" style="margin-top:12px;">Stok Awal</label>
        <input class="input" type="number" id="mStock" value="1000">
      ` : ''}
      <div class="dialog-actions" style="margin-top:18px;">
        <button class="btn btn-soft" data-modal-close>Batal</button>
        <button class="btn btn-primary" id="btnSaveMat">Simpan Bahan</button>
      </div>
    </div>
  `, 'dialog-card');

  $('#btnSaveMat', d).onclick = async () => {
    const name = $('#mName', d).value.trim();
    const unit = $('#mUnit', d).value.trim();
    const min_stock = Number($('#mMin', d).value) || 0;
    if (!name || !unit) return toast('Nama dan satuan bahan wajib diisi.', true);

    try {
      if (m) {
        await api('/admin/materials/' + encodeURIComponent(m.id), {
          method: 'PATCH',
          body: JSON.stringify({ name, unit, min_stock })
        });
      } else {
        const current_stock = Number($('#mStock', d).value) || 0;
        await api('/admin/materials', {
          method: 'POST',
          body: JSON.stringify({ name, unit, min_stock, current_stock })
        });
      }
      d.remove();
      toast('Data bahan berhasil disimpan');
      onDone();
    } catch(e) { toast(e.message, true); }
  };
}

function adjustStockModal(m, onDone) {
  const d = modal(`
    <div class="dialog">
      <h3>Sesuaikan Stok: ${esc(m.name)}</h3>
      <p style="font-size:12.5px;color:var(--muted);margin-bottom:12px;">
        Stok saat ini: <b>${m.current_stock} ${esc(m.unit)}</b>
      </p>
      <label class="field-label">Jumlah Penyesuaian (${esc(m.unit)})</label>
      <input class="input" type="number" id="adjAmount" placeholder="Contoh: 500 untuk tambah, -200 untuk kurangi">
      <small style="color:var(--muted);font-size:11px;">Gunakan angka positif (+) untuk restock / barang masuk, atau negatif (-) untuk rusak / kedaluwarsa.</small>
      <label class="field-label" style="margin-top:12px;">Alasan / Catatan Mutasi</label>
      <input class="input" id="adjNotes" placeholder="Contoh: Restock pengiriman supplier kopi">
      <div class="dialog-actions" style="margin-top:18px;">
        <button class="btn btn-soft" data-modal-close>Batal</button>
        <button class="btn btn-primary" id="btnSaveAdj">Simpan Mutasi</button>
      </div>
    </div>
  `, 'dialog-card');

  $('#btnSaveAdj', d).onclick = async () => {
    const change = Number($('#adjAmount', d).value);
    const notes = $('#adjNotes', d).value.trim();
    if (!change) return toast('Masukkan jumlah perubahan stok.', true);

    try {
      await api('/admin/materials/' + encodeURIComponent(m.id) + '/adjust', {
        method: 'POST',
        body: JSON.stringify({ changeAmount: change, notes: notes || 'Penyesuaian manual kasir' })
      });
      d.remove();
      toast('Stok bahan berhasil diperbarui dan mutasi tercatat');
      onDone();
    } catch(e) { toast(e.message, true); }
  };
}

async function recipeModal(product, materials, onDone) {
  let recipes = [];
  try {
    recipes = await api('/admin/products/' + encodeURIComponent(product.id) + '/recipe');
  } catch { }

  const renderModalContent = () => {
    return `
      <div class="dialog wide-dialog">
        <div class="modal-heading">
          <div>
            <span>KOMPOSISI RESEP MENU</span>
            <h2>${esc(product.name)}</h2>
          </div>
          <span class="status-badge status-ready">${recipes.length} Bahan Baku</span>
        </div>
        <p style="font-size:12px;color:var(--muted);margin-bottom:14px;">
          Tiap kali 1 porsi menu ini terjual, stok bahan di bawah akan dikurangi secara otomatis dan atomik.
        </p>
        <div class="recipe-items-table" style="margin-bottom:16px;">
          ${recipes.length ? `
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Bahan Baku</th>
                  <th>Takaran per Porsi</th>
                  <th>Satuan</th>
                  <th style="text-align:right;">Hapus</th>
                </tr>
              </thead>
              <tbody>
                ${recipes.map(r => `
                  <tr>
                    <td><b>${esc(r.raw_material_name)}</b></td>
                    <td><strong>${r.amount}</strong></td>
                    <td>${esc(r.unit)}</td>
                    <td style="text-align:right;">
                      <button class="plain-icon danger" data-del-recipe-mat="${esc(r.raw_material_id)}">${icon('trash', 16)}</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<p class="muted">Belum ada bahan baku pada resep menu ini.</p>'}
        </div>
        <div class="add-recipe-bar" style="background:#faf6f0;padding:12px;border-radius:10px;display:flex;gap:10px;align-items:center;">
          <select class="input" id="selMaterial" style="flex:2;">
            <option value="">Pilih Bahan Baku...</option>
            ${materials.map(m => `<option value="${esc(m.id)}">${esc(m.name)} (${esc(m.unit)})</option>`).join('')}
          </select>
          <input class="input" type="number" id="inAmount" placeholder="Jumlah" style="flex:1;">
          <button class="btn btn-primary" id="btnAddRecipeItem">+ Tambah ke Resep</button>
        </div>
        <div class="dialog-actions" style="margin-top:18px;">
          <button class="btn btn-dark btn-full" id="btnCloseRecipe">Selesai</button>
        </div>
      </div>
    `;
  };

  const d = modal(renderModalContent(), 'wide-modal');

  const bindEvents = () => {
    $('#btnCloseRecipe', d).onclick = () => { d.remove(); onDone(); };
    $$('[data-del-recipe-mat]', d).forEach(b => b.onclick = async () => {
      try {
        await api('/admin/products/' + encodeURIComponent(product.id) + '/recipe/' + encodeURIComponent(b.dataset.delRecipeMat), {
          method: 'DELETE'
        });
        toast('Bahan dihapus dari resep');
        recipes = await api('/admin/products/' + encodeURIComponent(product.id) + '/recipe');
        d.innerHTML = renderModalContent();
        bindEvents();
      } catch(e) { toast(e.message, true); }
    });

    const addBtn = $('#btnAddRecipeItem', d);
    if (addBtn) addBtn.onclick = async () => {
      const matId = $('#selMaterial', d).value;
      const amt = Number($('#inAmount', d).value);
      if (!matId || !amt || amt <= 0) return toast('Pilih bahan dan masukkan jumlah takaran.', true);
      addBtn.disabled = true;
      try {
        await api('/admin/products/' + encodeURIComponent(product.id) + '/recipe', {
          method: 'POST',
          body: JSON.stringify({ materialId: matId, amount: amt })
        });
        toast('Bahan berhasil ditambahkan ke resep');
        recipes = await api('/admin/products/' + encodeURIComponent(product.id) + '/recipe');
        d.innerHTML = renderModalContent();
        bindEvents();
      } catch(e) {
        toast(e.message, true);
        addBtn.disabled = false;
      }
    };
  };

  bindEvents();
}

// ==========================================
// SHIFT KASIR & TUTUP KASIR
// ==========================================
async function shiftsAdminPage(user) {
  const [activeShift, allShifts] = await Promise.all([
    api('/admin/shifts/active').catch(() => null),
    api('/admin/shifts').catch(() => [])
  ]);

  document.body.className = 'admin-body';
  document.body.innerHTML = adminShell(`
    ${adminTop('Shift Kasir & Tutup Buku Kas', 'Kelola modal kas awal, penerimaan tunai vs QRIS, dan pencatatan selisih kas fisik laci kasir.', `
      ${!activeShift ? `<button class="btn btn-primary" id="btnOpenShift">${icon('plus', 16)} Buka Shift Baru</button>` : `<button class="btn btn-danger" id="btnCloseShift">🔒 Tutup Shift &amp; Hitung Kas</button>`}
    `)}
    <section class="shift-overview-grid" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(240px, 1fr));gap:16px;margin-bottom:20px;">
      <div class="admin-metric ${activeShift ? 'green' : 'orange'}">
        <span>Status Shift Kasir</span>
        <strong>${activeShift ? '🟢 Sedang Berjalan' : '🔴 Tidak Ada Shift Aktif'}</strong>
        <i>${icon('clock', 20)}</i>
      </div>
      <div class="admin-metric">
        <span>Kas Awal (Modal Tunai)</span>
        <strong>${money(activeShift?.starting_cash || 0)}</strong>
        <i>${icon('wallet', 20)}</i>
      </div>
      <div class="admin-metric blue">
        <span>Total Penjualan Shift</span>
        <strong>${money((activeShift?.total_cash || 0) + (activeShift?.total_qris || 0))}</strong>
        <i>${icon('report', 20)}</i>
      </div>
      <div class="admin-metric revenue">
        <span>Estimasi Kas di Laci</span>
        <strong>${money(activeShift?.expected_ending_cash || 0)}</strong>
        <i>${icon('cash', 20)}</i>
      </div>
    </section>

    ${activeShift ? `
      <section class="admin-panel" style="margin-bottom:24px;">
        <div class="panel-head">
          <h2>Rincian Shift Berjalan</h2>
          <span>Kasir: <b>${esc(activeShift.cashier_name || 'Admin')}</b> • Mulai: ${formatTime(activeShift.start_time)}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:14px;padding:10px 0;">
          <div class="pay-metric green"><span>Penerimaan Tunai:</span><strong>${money(activeShift.total_cash || 0)}</strong></div>
          <div class="pay-metric blue"><span>Penerimaan QRIS:</span><strong>${money(activeShift.total_qris || 0)}</strong></div>
          <div class="pay-metric"><span>Jumlah Transaksi:</span><strong>${activeShift.total_orders || 0} Pesanan</strong></div>
        </div>
      </section>
    ` : ''}

    <section class="admin-panel">
      <div class="panel-head">
        <h2>Riwayat Penutupan Shift Kasir</h2>
        <span>${allShifts.length} Rekap Shift Sebelumnya</span>
      </div>
      <div class="responsive-table">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Waktu Buka / Tutup</th>
              <th>Kasir</th>
              <th>Kas Awal</th>
              <th>Total Tunai</th>
              <th>Total QRIS</th>
              <th>Kas Fisik Aktual</th>
              <th>Selisih (Variance)</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${allShifts.map(s => {
              const diff = Number(s.cash_difference || 0);
              const isOpen = s.status === 'OPEN';
              return `
                <tr>
                  <td>
                    <b>${formatTime(s.start_time)}</b>
                    ${s.end_time ? `<br><small class="muted">s/d ${formatTime(s.end_time)}</small>` : ''}
                  </td>
                  <td><b>${esc(s.cashier_name || 'Admin')}</b></td>
                  <td>${money(s.starting_cash)}</td>
                  <td>${money(s.total_cash ?? s.total_sales_cash ?? 0)}</td>
                  <td>${money(s.total_qris ?? s.total_sales_qris ?? 0)}</td>
                  <td><b>${isOpen ? 'Berjalan' : money(s.actual_ending_cash ?? s.ending_cash_actual ?? 0)}</b></td>
                  <td>
                    ${isOpen ? '-' : `<strong style="color:${diff === 0 ? '#2b8a3e' : (diff > 0 ? '#1c7ed6' : '#c92a2a')};">${diff === 0 ? 'Rp 0 (Pas)' : (diff > 0 ? `+${money(diff)} (Lebihan)` : `${money(diff)} (Kurang)`)}</strong>`}
                  </td>
                  <td>
                    <span class="status-badge ${isOpen ? 'status-processing' : 'status-ready'}">
                      <i class="status-dot"></i>${isOpen ? 'Aktif' : 'Ditutup'}
                    </span>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `, 'shifts', user);

  bindAdminChrome('shifts');
  const btnOpen = $('#btnOpenShift');
  if (btnOpen) btnOpen.onclick = () => openShiftModal(() => shiftsAdminPage(user));
  const btnClose = $('#btnCloseShift');
  if (btnClose) btnClose.onclick = () => closeShiftModal(activeShift, () => shiftsAdminPage(user));
}

function openShiftModal(onDone) {
  const d = modal(`
    <div class="dialog">
      <h3>Buka Shift Kasir Baru</h3>
      <p style="font-size:12.5px;color:var(--muted);margin-bottom:14px;">
        Masukkan modal kas tunai awal (uang kembalian) di laci kasir sebelum memulai transaksi.
      </p>
      <label class="field-label">Kas Awal (Rp)</label>
      <input class="input" type="number" id="startCash" value="200000" min="0" step="10000">
      <label class="field-label" style="margin-top:12px;">Catatan Shift (Opsional)</label>
      <input class="input" id="shiftNotes" placeholder="Contoh: Shift Pagi Barista">
      <div class="dialog-actions" style="margin-top:18px;">
        <button class="btn btn-soft" data-modal-close>Batal</button>
        <button class="btn btn-primary" id="btnConfirmOpenShift">Mulai Buka Shift</button>
      </div>
    </div>
  `, 'dialog-card');

  $('#btnConfirmOpenShift', d).onclick = async () => {
    const cash = Number($('#startCash', d).value) || 0;
    const notes = $('#shiftNotes', d).value.trim();
    try {
      await api('/admin/shifts/open', {
        method: 'POST',
        body: JSON.stringify({ startingCash: cash, notes })
      });
      d.remove();
      toast('Shift kasir berhasil dibuka!');
      onDone();
    } catch(e) { toast(e.message, true); }
  };
}

function closeShiftModal(shift, onDone) {
  const expected = Number(shift?.expected_ending_cash || 0);
  const d = modal(`
    <div class="dialog">
      <h3>Tutup Shift &amp; Hitung Kas Fisik</h3>
      <div style="background:#faf6f0;padding:12px;border-radius:10px;margin-bottom:14px;">
        <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:4px;">
          <span>Kas Awal:</span><b>${money(shift?.starting_cash || 0)}</b>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:4px;">
          <span>Penerimaan Tunai Kasir:</span><b>+ ${money(shift?.total_cash || 0)}</b>
        </div>
        <hr style="border:none;border-top:1px dashed #d5c3b2;margin:8px 0;">
        <div style="display:flex;justify-content:space-between;font-size:13.5px;font-weight:700;">
          <span>Estimasi Kas di Laci:</span><strong style="color:var(--orange-dark);">${money(expected)}</strong>
        </div>
      </div>
      <label class="field-label">Hitungan Fisik Uang Kas Nyata di Laci (Rp)</label>
      <input class="input" type="number" id="actualCash" value="${expected}" step="1000">
      <div id="diffPreview" style="margin-top:6px;font-size:12px;font-weight:700;color:#2b8a3e;">
        Selisih: Rp 0 (Pas)
      </div>
      <label class="field-label" style="margin-top:12px;">Catatan Penutupan Shift</label>
      <input class="input" id="closeNotes" placeholder="Contoh: Selesai shift pagi, kas seimbang">
      <div class="dialog-actions" style="margin-top:18px;">
        <button class="btn btn-soft" data-modal-close>Batal</button>
        <button class="btn btn-danger" id="btnConfirmCloseShift">🔒 Konfirmasi Tutup Shift</button>
      </div>
    </div>
  `, 'dialog-card');

  const actIn = $('#actualCash', d);
  const diffBox = $('#diffPreview', d);
  actIn.oninput = () => {
    const val = Number(actIn.value) || 0;
    const diff = val - expected;
    if (diff === 0) {
      diffBox.style.color = '#2b8a3e';
      diffBox.textContent = 'Selisih: Rp 0 (Pas)';
    } else if (diff > 0) {
      diffBox.style.color = '#1c7ed6';
      diffBox.textContent = `Selisih: +${money(diff)} (LEBIHAN KAS)`;
    } else {
      diffBox.style.color = '#c92a2a';
      diffBox.textContent = `Selisih: ${money(diff)} (KURANGAN KAS)`;
    }
  };

  $('#btnConfirmCloseShift', d).onclick = async () => {
    const act = Number(actIn.value);
    const notes = $('#closeNotes', d).value.trim();
    try {
      await api('/admin/shifts/close', {
        method: 'POST',
        body: JSON.stringify({ actualCash: act, notes })
      });
      d.remove();
      toast('Shift kasir resmi DITUTUP. Rekap buku kas tersimpan.');
      onDone();
    } catch(e) { toast(e.message, true); }
  };
}

// ==========================================
// ROLE & AUDIT LOGS
// ==========================================
async function auditLogsAdminPage(user) {
  let filterAction = '';
  const loadLogs = async () => {
    const logs = await api('/admin/audit');
    const filtered = filterAction ? logs.filter(l => l.action === filterAction) : logs;
    const actions = Array.from(new Set(logs.map(l => l.action))).sort();

    document.body.className = 'admin-body';
    document.body.innerHTML = adminShell(`
      ${adminTop('Audit Log & Hak Akses', 'Rekam jejak setiap aksi penting sistem: pesanan, perubahan harga/stok, void, dan shift.')}
      <div class="admin-filters" style="margin-bottom:16px;">
        <label>${icon('search', 18)}<input id="searchAudit" placeholder="Cari aksi / email / order..."></label>
        <select id="selAuditAction">
          <option value="">Semua Aksi (${logs.length})</option>
          ${actions.map(a => `<option value="${esc(a)}" ${filterAction === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}
        </select>
      </div>
      <section class="admin-panel">
        <div class="responsive-table">
          <table class="admin-table">
            <thead>
              <tr>
                <th style="width:130px;">Waktu</th>
                <th style="width:150px;">Aksi</th>
                <th style="width:160px;">Pengguna (Aktor)</th>
                <th style="width:100px;">Target</th>
                <th>Rincian Metadata</th>
              </tr>
            </thead>
            <tbody>
              ${filtered.map(l => `
                <tr>
                  <td><b>${formatTime(l.at || l.createdAt || l.created_at)}</b></td>
                  <td>
                    <span class="badge-role-regular" style="font-weight:700;">${esc(l.action)}</span>
                  </td>
                  <td>
                    <strong>${esc(l.actorName || l.actorEmail || l.user_name || l.userName || 'Staff / Kasir')}</strong>
                    <br><small class="muted">Role: ${esc(l.actorRole || l.role || 'Staff')}</small>
                  </td>
                  <td><code>${esc(l.targetId || l.target_id || '-')}</code></td>
                  <td>
                    <pre style="margin:0;font-size:11px;background:#faf6f0;padding:4px 8px;border-radius:6px;max-width:400px;overflow-x:auto;">${esc(JSON.stringify(l.meta || l.details || {}, null, 1))}</pre>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </section>
    `, 'audit', user);

    bindAdminChrome('audit');
    $('#selAuditAction').onchange = e => {
      filterAction = e.target.value;
      loadLogs();
    };
  };

  await loadLogs();
}

window.addEventListener('offline', () => toast('Koneksi internet terputus.', true));
window.addEventListener('online', () => toast('Koneksi kembali tersedia.'));
render();