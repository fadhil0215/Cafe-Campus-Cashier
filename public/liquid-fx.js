/* ==========================================================================
   Cafe Campus — Liquid FX
   Efek visual murni (ripple, kilau kaca yang ikut pointer, stagger, reveal,
   parallax). TIDAK menyentuh logic aplikasi / API / data. Aman dihapus kapan
   saja (hapus <script> di index.html).
   ========================================================================== */
(function () {
  'use strict';
  if (window.__lgFx) return;
  window.__lgFx = true;

  var root = document.documentElement;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* ---- 1. Kilau spekular mengikuti pointer ------------------------------ */
  var LIGHT = '.product-card,.admin-metric,.pay-metric,.queue-ticket,.qr-table-card,.landing-customer-box,' +
              '.payment-choice,.table-pick-btn,.report-metrics > div,.kds-ticket-card';
  if (finePointer && !reduce) {
    var lightRaf = 0, lx = 0, ly = 0, lt = null;
    document.addEventListener('pointermove', function (e) {
      lx = e.clientX; ly = e.clientY;
      lt = e.target && e.target.closest ? e.target.closest(LIGHT) : null;
      if (lightRaf) return;
      lightRaf = requestAnimationFrame(function () {
        lightRaf = 0;
        if (lt) {
          var r = lt.getBoundingClientRect();
          lt.style.setProperty('--mx', (lx - r.left) + 'px');
          lt.style.setProperty('--my', (ly - r.top) + 'px');
        }
        // parallax halus untuk blob latar
        root.style.setProperty('--px', ((lx / window.innerWidth) - .5).toFixed(3));
        root.style.setProperty('--py', ((ly / window.innerHeight) - .5).toFixed(3));
      });
    }, { passive: true });
  }

  /* ---- 2. Parallax scroll untuk blob latar ------------------------------ */
  if (!reduce) {
    var sRaf = 0;
    window.addEventListener('scroll', function () {
      if (sRaf) return;
      sRaf = requestAnimationFrame(function () {
        sRaf = 0;
        root.style.setProperty('--sy', Math.min(window.scrollY || 0, 2400));
      });
    }, { passive: true });
  }

  /* ---- 3. Ripple cairan pada tombol ------------------------------------- */
  var RIPPLE = '.btn,.round-add,.category-chip,.role-btn,.option-pill,.pos-cat-chip,.topbar-chip-btn,' +
               '.admin-sidebar nav a,.admin-bottom-nav a,.admin-bottom-nav button,.cart-bar-cta,.chat-chip,' +
               '.order-tabs button,.report-tabs button,.pos-segment-btn,.table-pick-btn,.kds-station-switch button';
  if (!reduce) {
    document.addEventListener('pointerdown', function (e) {
      var el = e.target && e.target.closest ? e.target.closest(RIPPLE) : null;
      if (!el || el.disabled) return;
      var cs = getComputedStyle(el);
      if (cs.position === 'static') el.style.position = 'relative';
      if (cs.overflow === 'visible') el.style.overflow = 'hidden';
      var r = el.getBoundingClientRect();
      var size = Math.max(r.width, r.height) * 2.2;
      var s = document.createElement('span');
      s.className = 'lg-ripple';
      s.style.width = s.style.height = size + 'px';
      s.style.left = (e.clientX - r.left - size / 2) + 'px';
      s.style.top = (e.clientY - r.top - size / 2) + 'px';
      el.appendChild(s);
      setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 720);
    }, { passive: true });
  }

  /* ---- 4. Stagger index + tooltip rail + reveal saat scroll -------------- */
  var STAGGER_PARENTS = '.dashboard-metrics,.payment-metrics,.report-metrics,.queue-cards-grid,.kds-col-body,' +
    '.cart-list,.qr-grid,.occupancy-grid,.table-picker-grid,.category-list,.bestsellers-list,.payment-methods,.product-grid';
  var REVEAL = '.product-card,.admin-panel,.queue-ticket,.admin-metric,.pay-metric,.cart-row,.qr-table-card,' +
               '.kds-ticket-card,.category-row,.checkout-order-card,.payment-methods,.tracking-card,.tracking-summary';

  var io = null;
  if ('IntersectionObserver' in window && !reduce) {
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.remove('lg-wait');
          io.unobserve(en.target);
        }
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.05 });
  }

  function enhance() {
    // stagger
    var parents = document.querySelectorAll(STAGGER_PARENTS);
    for (var p = 0; p < parents.length; p++) {
      var kids = parents[p].children;
      if (parents[p].__lgN === kids.length) continue;
      parents[p].__lgN = kids.length;
      for (var k = 0; k < kids.length; k++) kids[k].style.setProperty('--i', Math.min(k, 10));
    }
    // tooltip untuk rail ikon sidebar admin
    var links = document.querySelectorAll('.admin-sidebar nav a');
    for (var l = 0; l < links.length; l++) {
      if (!links[l].title) {
        var sp = links[l].querySelector('span');
        if (sp) links[l].title = sp.textContent.trim();
      }
    }
    // reveal: tahan animasi elemen yang masih di bawah layar sampai terlihat
    if (io) {
      var vh = window.innerHeight || 800;
      var items = document.querySelectorAll(REVEAL);
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.__lgSeen) continue;
        it.__lgSeen = true;
        if (it.getBoundingClientRect().top > vh * 1.02) {
          it.classList.add('lg-wait');
          io.observe(it);
        }
      }
    }
  }

  var pending = 0;
  function schedule() {
    if (pending) return;
    pending = setTimeout(function () {
      pending = 0;
      requestAnimationFrame(enhance);
    }, 60);
  }

  function start() {
    enhance();
    if ('MutationObserver' in window) {
      new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    }
  }
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
