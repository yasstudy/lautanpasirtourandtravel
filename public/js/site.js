/* Lautan Pasir — skrip bersama: header, footer, helper, kalender ketersediaan. Tanpa inline handler (CSP script-src 'self'). */
(() => {
  'use strict';
  const DEFAULTS = { waNumber: '6282234567890', phoneDisplay: '0822-3456-7890', email: 'lautanpasirtravel@gmail.com', address: 'Jl. Raya Madiun No. 123, Malang', dpPercent: 50, paymentNote: '', banks: [], qris: { enabled: false, image: '' } };

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rupiah = n => 'Rp ' + new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Number(n) || 0);
  const fmtDate = v => v ? new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${v}T00:00:00Z`)) : '-';
  const fmtShort = v => new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${v}T00:00:00Z`));
  const fmtDateTime = v => v ? new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(v)) + ' WIB' : '';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* ---- tanggal (UTC murni, tanpa efek zona waktu perangkat) ---- */
  const DAY = 864e5;
  const parseD = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  const fmtD = ms => new Date(ms).toISOString().slice(0, 10);
  const addDays = (s, n) => fmtD(parseD(s) + n * DAY);
  const todayWib = () => fmtD(Date.now() + 7 * 3600e3);
  const lastDayOfMonth = ym => fmtD(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0));
  const addMonths = (ym, n) => { const t = (+ym.slice(0, 4)) * 12 + (+ym.slice(5, 7) - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
  const rangeText = (date, days) => days > 1 ? `${fmtShort(date)} – ${fmtDate(addDays(date, days - 1))}` : fmtDate(date);

  async function api(url, options = {}) {
    const init = { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } };
    let response;
    try { response = await fetch(url, init); } catch { throw new Error('Tidak dapat terhubung ke server. Periksa koneksi internet Anda.'); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const e = new Error(data.error || `Permintaan gagal (${response.status}).`); e.status = response.status; e.data = data; throw e; }
    return data;
  }

  let toastTimer;
  function toast(message) {
    let el = $('#toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = message; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3800);
  }

  /** Perkecil & kompres foto di browser sebelum diunggah (hemat kuota, di bawah batas server). */
  function fileToDataUrl(file, { maxDim = 1600, quality = 0.85 } = {}) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\/(png|jpe?g|webp)$/.test(file.type)) return reject(new Error('Pilih berkas gambar JPG, PNG, atau WebP.'));
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Gambar tidak dapat dibaca.')); };
      img.src = url;
    });
  }

  function badgeStatus(status) { return `<span class="badge b-${esc(String(status).replace(/\s/g, ''))}">${esc(status)}</span>`; }
  function badgePayment(ps) {
    const cls = ps === 'Lunas' ? 'p-Lunas' : ps === 'DP' ? 'p-DP' : ps === 'Menunggu verifikasi' ? 'p-Menunggu' : ps === 'Dikembalikan' ? 'p-Dikembalikan' : 'p-Netral';
    return `<span class="badge ${cls}">${esc(ps)}</span>`;
  }
  const waLink = (s, text) => `https://wa.me/${encodeURIComponent((s || DEFAULTS).waNumber)}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

  /* ---- modal ---- */
  function openModal(id) { const m = document.getElementById(id); if (!m) return; m.classList.add('show'); document.body.style.overflow = 'hidden'; const f = m.querySelector('.close'); if (f) f.focus(); }
  function closeModal(id) { const m = document.getElementById(id); if (m) m.classList.remove('show'); if (!$('.modal.show')) document.body.style.overflow = ''; }
  document.addEventListener('click', e => {
    const close = e.target.closest('[data-close-modal]');
    if (close) return closeModal(close.closest('.modal').id);
    if (e.target.classList && e.target.classList.contains('modal')) return closeModal(e.target.id);
    if (e.target.closest('[data-privacy]')) { e.preventDefault(); openModal('privacyModal'); }
    if (e.target.closest('[data-nav-toggle]')) { const nav = $('#nav'); const open = nav.classList.toggle('open'); e.target.closest('[data-nav-toggle]').setAttribute('aria-expanded', open); }
    const copy = e.target.closest('[data-copy]');
    if (copy) { navigator.clipboard?.writeText(copy.dataset.copy).then(() => toast('Nomor disalin.'), () => toast('Salin manual: ' + copy.dataset.copy)); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $$('.modal.show').forEach(m => closeModal(m.id)); });

  /* ---- ketersediaan & kalender ---- */
  /** Ketersediaan (sisa unit per hari) satu rentang. fleetId opsional. */
  const availability = (from, to, fleetId) => api(`/api/availability?from=${from}&to=${to}${fleetId ? `&fleetId=${encodeURIComponent(fleetId)}` : ''}`);
  /** Sisa unit paling sedikit pada rentang [date, date+days-1] dari hasil availability(); null bila tidak ada data. */
  function minFree(av, fleetId, date, days) {
    const f = av && av.fleets && av.fleets[fleetId]; if (!f) return null;
    let min = Infinity;
    for (let i = 0; i < days; i++) { const v = f.free[addDays(date, i)]; if (v === undefined) return null; if (v < min) min = v; }
    return Number.isFinite(min) ? min : null;
  }
  /** Kalender bulanan satu armada. opts: { fleetId, getSelection(): {date,days}|null, onPick(date), month? } */
  function calendar(el, opts) {
    const st = { month: opts.month || todayWib().slice(0, 7), data: null, error: '', loading: false };
    const cache = new Map();
    const today = () => (st.data && st.data.today) || todayWib();
    async function load() {
      const key = `${opts.fleetId}|${st.month}`;
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < 30e3) { st.data = hit.data; st.error = ''; return render(); }
      st.loading = true; render();
      try {
        const d = await availability(`${st.month}-01`, lastDayOfMonth(st.month), opts.fleetId);
        const f = d.fleets[opts.fleetId];
        if (!f) throw new Error('Armada tidak ditemukan.');
        st.data = { today: d.today, units: f.units, free: f.free, name: f.name }; cache.set(key, { at: Date.now(), data: st.data }); st.error = '';
      } catch (err) { st.error = err.message; }
      st.loading = false; render();
    }
    function render() {
      const [y, m] = st.month.split('-').map(Number);
      const title = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
      const cur = todayWib().slice(0, 7);
      const sel = opts.getSelection && opts.getSelection();
      const selSet = new Set(); if (sel && sel.date) for (let i = 0; i < (sel.days || 1); i++) selSet.add(addDays(sel.date, i));
      const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // pekan mulai Senin
      const total = +lastDayOfMonth(st.month).slice(8);
      let cells = '';
      for (let i = 0; i < lead; i++) cells += '<span class="cal-day out" aria-hidden="true"></span>';
      for (let d = 1; d <= total; d++) {
        const date = `${st.month}-${String(d).padStart(2, '0')}`;
        const free = st.data ? st.data.free[date] : undefined;
        const units = st.data ? st.data.units : 0;
        const past = date < today();
        let cls = 'cal-day', label, u = '';
        if (past) { cls += ' past'; label = 'sudah lewat'; }
        else if (free === undefined) { label = 'memuat'; }
        else if (free === 0) { cls += ' full'; label = 'penuh'; u = 'Penuh'; }
        else { cls += free < units ? ' few' : ' ok'; label = `tersedia ${free} dari ${units} unit`; u = `${free} unit`; }
        if (selSet.has(date)) cls += ' sel';
        if (date === today()) cls += ' today';
        const disabled = past || free === 0 || free === undefined;
        cells += `<button type="button" class="${cls}" data-date="${date}" ${disabled ? 'disabled' : ''} aria-label="${esc(fmtDate(date))}: ${label}"${selSet.has(date) ? ' aria-pressed="true"' : ''}><span class="n">${d}</span><span class="u">${esc(u)}</span></button>`;
      }
      el.innerHTML = `<div class="cal${st.loading ? ' cal-loading' : ''}"><div class="cal-head"><h4>${esc(title)}</h4><div class="cal-nav"><button type="button" data-cal="prev" aria-label="Bulan sebelumnya" ${st.month <= cur ? 'disabled' : ''}>‹</button><button type="button" data-cal="next" aria-label="Bulan berikutnya" ${st.month >= addMonths(cur, 24) ? 'disabled' : ''}>›</button></div></div>
<div class="cal-grid" role="group" aria-label="Kalender ${esc(title)}">${['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map(x => `<div class="cal-dow" aria-hidden="true">${x}</div>`).join('')}${cells}</div>
${st.error ? `<div class="alert err">${esc(st.error)}</div>` : ''}
<div class="cal-legend"><span><i style="background:#e8f6ee"></i>Semua unit tersedia</span><span><i style="background:#fff4d6"></i>Sebagian terpakai</span><span><i style="background:#fbe4e1"></i>Penuh</span></div>
<p class="cal-note">${st.data ? `Total armada: ${st.data.units} unit. ` : ''}Ketersediaan bersifat sementara sampai pemesanan dikonfirmasi admin.</p></div>`;
    }
    el.addEventListener('click', e => {
      const nav = e.target.closest('[data-cal]');
      if (nav) { st.month = addMonths(st.month, nav.dataset.cal === 'next' ? 1 : -1); return load(); }
      const day = e.target.closest('.cal-day[data-date]');
      if (day && !day.disabled && opts.onPick) opts.onPick(day.dataset.date);
    });
    load();
    return { refresh() { cache.clear(); return load(); }, rerender: render, setMonth(ym) { st.month = ym; return load(); } };
  }

  /* ---- header & footer ---- */
  const LOGO = (last) => `<svg viewBox="0 0 64 54" fill="none" aria-hidden="true"><path d="M6 16C16 5 25 5 32 16C39 27 49 27 59 15" stroke="#F4B52E" stroke-width="7" stroke-linecap="round"/><path d="M4 27C15 18 25 18 34 27C43 36 51 35 60 26" stroke="#1599D0" stroke-width="7" stroke-linecap="round"/><path d="M4 39C15 30 25 30 34 39C43 48 51 47 60 38" stroke="${last}" stroke-width="7" stroke-linecap="round"/></svg>`;
  const NAV = [['/', 'Beranda'], ['/paket', 'Paket Wisata'], ['/armada', 'Armada'], ['/#cara-pesan', 'Cara Pemesanan'], ['/lacak', 'Lacak Pesanan'], ['#kontak', 'Kontak']];
  const path = location.pathname.replace(/index\.html$/, '').replace(/\.html$/, '') || '/';

  function renderChrome(s) {
    const header = $('#site-header');
    if (header) header.innerHTML = `<header class="topbar"><div class="wrap"><a class="brand" href="/" aria-label="Lautan Pasir beranda">${LOGO('#07508C')}<span>Lautan Pasir<small>TOUR &amp; TRAVEL</small></span></a>
<nav class="nav" id="nav" aria-label="Menu utama">${NAV.map(([h, t]) => `<a href="${h}"${h === path ? ' class="active" aria-current="page"' : ''}>${t}</a>`).join('')}</nav>
<div class="nav-actions"><a class="btn line" href="/lacak">Lacak Pesanan</a><a class="btn" href="/pesan">▣ &nbsp;Ajukan Sewa</a><button class="iconbtn mobile-menu" type="button" aria-label="Buka menu" aria-expanded="false" data-nav-toggle>☰</button></div></div></header>`;
    const footer = $('#site-footer');
    if (footer) footer.innerHTML = `<footer class="footer" id="kontak"><div class="wrap"><div class="footer-grid"><div><a class="brand" href="/">${LOGO('#fff')}<span>Lautan Pasir<small>TOUR &amp; TRAVEL</small></span></a><p>Perjalanan nyaman, cerita tak terlupakan.<br>Your Journey, Our Priority.</p></div>
<div><h4>Hubungi Kami</h4><div class="contact-line">⌖ <span>${esc(s.address)}</span></div><div class="contact-line">☎ <a href="https://wa.me/${esc(s.waNumber)}" rel="noopener">${esc(s.phoneDisplay)}</a></div><div class="contact-line">✉ <a href="mailto:${esc(s.email)}">${esc(s.email)}</a></div></div>
<div><h4>Navigasi</h4><div class="footer-links"><a href="/">Beranda</a><a href="/paket">Paket Wisata</a><a href="/armada">Armada</a><a href="/pesan">Ajukan Sewa</a><a href="/lacak">Lacak Pesanan</a><button type="button" data-privacy>Kebijakan Privasi</button></div></div>
<div><h4>Sudah memesan?</h4><p>Pantau status perjalanan dan unggah bukti pembayaran dengan kode pemesanan Anda.</p><p><a class="btn gold sm" href="/lacak">Lacak &amp; Bayar →</a></p></div></div>
<div class="copyright"><span>© ${new Date().getFullYear()} Lautan Pasir Tour &amp; Travel. All rights reserved.</span><span>Nyaman di perjalanan, indah dalam kenangan.</span></div></div></footer>`;
    let modal = $('#privacyModal');
    if (!modal) { modal = document.createElement('div'); modal.className = 'modal'; modal.id = 'privacyModal'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'privacyTitle'); document.body.appendChild(modal); }
    modal.innerHTML = `<div class="modal-box"><div class="modal-top"><div><div class="kicker">Informasi Pelindungan Data</div><h2 id="privacyTitle">Kebijakan Privasi &amp; Perlindungan Data Pribadi</h2></div><button class="close" type="button" aria-label="Tutup kebijakan privasi" data-close-modal>×</button></div><div class="modal-copy"><p>Kebijakan ini menjelaskan pemrosesan data pribadi pada formulir pemesanan Lautan Pasir Tour &amp; Travel berdasarkan Undang-Undang Republik Indonesia Nomor 27 Tahun 2022 tentang Pelindungan Data Pribadi (UU PDP).</p><h3>Data dan tujuan pemrosesan</h3><p>Data yang diminta meliputi nama, nomor WhatsApp, email (opsional), tanggal perjalanan, jumlah peserta, tujuan atau titik penjemputan, catatan opsional, serta bukti pembayaran yang Anda unggah. Data digunakan untuk menindaklanjuti permintaan, memeriksa ketersediaan, menyiapkan penawaran, dan memverifikasi pembayaran.</p><h3>Dasar, pembagian, dan penyimpanan</h3><p>Dengan mengirim formulir, Anda meminta kami menindaklanjuti layanan yang diminta dan menyetujui pemrosesan untuk tujuan tersebut. Jika Anda memilih WhatsApp, ringkasan pemesanan akan dibuka pada layanan WhatsApp dan tunduk pula pada kebijakan penyedianya. Data tidak dimaksudkan untuk dijual; akses dibatasi pada pihak yang perlu menangani permintaan. Bukti pembayaran hanya dapat dibuka oleh admin. Data disimpan hanya selama diperlukan untuk tujuan layanan atau kewajiban hukum.</p><h3>Hak subjek data</h3><p>Sesuai UU PDP, Anda dapat meminta akses, koreksi, penghentian/penghapusan atau penarikan persetujuan, serta mengajukan keberatan atas pemrosesan sesuai ketentuan yang berlaku. Hubungi kami melalui WhatsApp ${esc(s.phoneDisplay)} atau ${esc(s.email)} untuk permintaan terkait data. Kami akan memverifikasi permintaan dan menindaklanjutinya sesuai batas waktu dan pengecualian hukum.</p><h3>Keamanan dan perubahan</h3><p>Kami menerapkan langkah yang wajar untuk menjaga kerahasiaan dan keamanan data. Kebijakan dapat diperbarui; versi yang berlaku ditampilkan pada halaman ini. Dengan melanjutkan, Anda menyatakan telah membaca pemberitahuan ini.</p></div><button class="btn wide" type="button" data-close-modal>Saya Mengerti</button></div>`;
  }

  let current = { ...DEFAULTS };
  renderChrome(current);
  const ready = api('/api/settings').then(d => { current = { ...DEFAULTS, ...d.settings }; renderChrome(current); return current; }).catch(() => current);

  window.LP = { esc, rupiah, fmtDate, fmtShort, fmtDateTime, rangeText, addDays, todayWib, $, $$, api, toast, fileToDataUrl, badgeStatus, badgePayment, waLink, openModal, closeModal, availability, minFree, calendar, ready, get settings() { return current; } };
})();
