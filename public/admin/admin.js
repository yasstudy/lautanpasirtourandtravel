(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rp = n => 'Rp ' + new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Number(n) || 0);
  const fmtDate = v => v ? new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${v}T00:00:00Z`)) : '-';
  const fmtDT = v => v ? new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(v)) : '';
  const DAY = 864e5;
  const pd = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  const fd = ms => new Date(ms).toISOString().slice(0, 10);
  const addDays = (s, n) => fd(pd(s) + n * DAY);
  const today = () => fd(Date.now() + 7 * 3600e3);
  const addMonths = (ym, n) => { const t = +ym.slice(0, 4) * 12 + (+ym.slice(5, 7) - 1) + n; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`; };
  const monthName = ym => new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ym}-01T00:00:00Z`));
  const STATUSES = ['Pending', 'Dikonfirmasi', 'Dalam Perjalanan', 'Selesai', 'Dibatalkan'];
  const KEY = 'lp_admin_token';
  const store = { get: () => { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } }, set: v => { try { v ? sessionStorage.setItem(KEY, v) : sessionStorage.removeItem(KEY); } catch { /* abaikan */ } } };
  let token = store.get();
  let tab = 'pemesanan';
  let fleets = [];
  let toastT;

  const badge = s => `<span class="badge b-${esc(String(s).replace(/\s/g, ''))}">${esc(s)}</span>`;
  const payBadge = s => `<span class="badge ${s === 'Lunas' ? 'p-Lunas' : s === 'DP' ? 'p-DP' : s === 'Menunggu verifikasi' ? 'p-Menunggu' : s === 'Dikembalikan' ? 'p-Dikembalikan' : ''}">${esc(s || '-')}</span>`;
  function toast(msg) { let t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); } t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), 3500); }

  async function api(url, opt = {}) {
    const headers = { ...(opt.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    let r;
    try { r = await fetch(url, { ...opt, headers }); } catch { throw new Error('Tidak dapat terhubung ke server.'); }
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 && url !== '/api/auth/login') { logout(false); const e = new Error(data.error || 'Sesi berakhir. Masuk kembali.'); e.status = 401; throw e; }
    if (r.status === 403 && data.mustChange) { showView('pw', true); const e = new Error(data.error); e.status = 403; throw e; }
    if (!r.ok) { const e = new Error(data.error || `Permintaan gagal (${r.status}).`); e.status = r.status; e.data = data; throw e; }
    return data;
  }
  const json = (method, body) => ({ method, body: JSON.stringify(body) });
  const guard = fn => async (...a) => { try { return await fn(...a); } catch (e) { if (e.status !== 401 && e.status !== 403) toast(e.message); } };

  /* ---------- tampilan ---------- */
  function showView(v, forced) {
    $('#loginView').classList.toggle('hidden', v !== 'login');
    $('#pwView').classList.toggle('hidden', v !== 'pw');
    $('#appView').classList.toggle('hidden', v !== 'app');
    $('#pwCancel').classList.toggle('hidden', !!forced);
    $('#pwIntro').textContent = forced ? 'Demi keamanan, ganti kata sandi awal sebelum memakai panel admin.' : 'Kata sandi baru akan mengeluarkan perangkat lain yang sedang masuk.';
  }
  function logout(call = true) {
    if (call && token) fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    token = ''; store.set(''); closeLayer(); showView('login');
  }
  $('#logoutBtn').onclick = () => logout();
  $('#pwLogout').onclick = () => logout();
  $('#pwCancel').onclick = () => showView('app');

  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault(); $('#loginErr').textContent = '';
    const form = e.currentTarget, f = new FormData(form);
    try {
      const d = await api('/api/auth/login', json('POST', { username: f.get('username'), password: f.get('password') }));
      token = d.token; store.set(token); form.reset();
      d.mustChange ? showView('pw', true) : start();
    } catch (err) { $('#loginErr').textContent = err.message; }
  });
  $('#pwForm').addEventListener('submit', async e => {
    e.preventDefault(); $('#pwErr').textContent = '';
    const form = e.currentTarget, f = new FormData(form);
    if (f.get('next') !== f.get('again')) { $('#pwErr').textContent = 'Kata sandi baru tidak sama.'; return; }
    try { await api('/api/admin/password', json('POST', { current: f.get('current'), next: f.get('next') })); form.reset(); toast('Kata sandi diganti.'); start(); }
    catch (err) { $('#pwErr').textContent = err.message; }
  });

  async function start() {
    try {
      const me = await api('/api/admin/me');
      if (me.mustChange) return showView('pw', true);
    } catch { return; }
    showView('app');
    go(location.hash.slice(1) || 'pemesanan');
    refreshDot();
  }
  async function refreshDot() {
    try { const s = await api('/api/stats'); const n = (s.pendingPayments || 0) + (s.statusCounts?.Pending || 0); const d = $('#pendDot'); d.textContent = n; d.classList.toggle('hidden', !n); } catch { /* abaikan */ }
  }
  async function loadFleets() { fleets = (await api('/api/admin/fleet')).items; return fleets; }

  /* ---------- layer / drawer ---------- */
  function openLayer(html, cls = '') {
    closeLayer();
    const l = $('#layer');
    l.innerHTML = `<div class="layer ${cls === 'center' ? 'mid' : ''}"><section class="drawer ${cls}" role="dialog" aria-modal="true">${html}</section></div>`;
    document.body.style.overflow = 'hidden';
    const lay = l.firstChild;
    lay.addEventListener('mousedown', e => { if (e.target === lay) closeLayer(); });
    return lay.firstChild;
  }
  function closeLayer() { $('#layer').innerHTML = ''; document.body.style.overflow = ''; }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if ($('.lightbox')) $('.lightbox').remove(); else closeLayer(); } });
  document.addEventListener('click', e => { if (e.target.closest('[data-x]')) closeLayer(); });

  /* ---------- navigasi ---------- */
  const views = { pemesanan: vBookings, kalender: vCalendar, paket: vPackages, armada: vFleet, pengaturan: vSettings, akun: vAccount };
  function go(t) {
    if (!views[t]) t = 'pemesanan';
    tab = t; history.replaceState(null, '', `#${t}`);
    $$('.tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    $('#main').innerHTML = '<div class="empty">Memuat…</div>';
    guard(views[t])();
  }
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) go(b.dataset.tab); });

  /* =================== PEMESANAN =================== */
  let bkFilter = { status: 'Semua', q: '' }, bkTimer;
  async function vBookings() {
    const [st, list] = await Promise.all([api('/api/stats'), api(`/api/bookings?status=${encodeURIComponent(bkFilter.status)}&q=${encodeURIComponent(bkFilter.q)}`), loadFleets()]);
    if (tab !== 'pemesanan') return;
    const sc = st.statusCounts || {};
    $('#main').innerHTML = `
      <div class="head"><h1>Pemesanan</h1></div>
      <div class="stats">
        <div class="stat"><div class="l">Total pemesanan</div><div class="v">${st.totalBookings}</div></div>
        <div class="stat ${sc.Pending ? 'alert' : ''}"><div class="l">Menunggu konfirmasi</div><div class="v">${sc.Pending || 0}</div></div>
        <div class="stat ${st.pendingPayments ? 'alert' : ''}"><div class="l">Pembayaran perlu verifikasi</div><div class="v">${st.pendingPayments}</div></div>
        <div class="stat ${st.awaitingQuote ? 'alert' : ''}"><div class="l">Menunggu harga</div><div class="v">${st.awaitingQuote}</div></div>
        <div class="stat"><div class="l">Omzet terverifikasi</div><div class="v">${rp(st.revenueVerified)}</div></div>
        <div class="stat"><div class="l">Estimasi omzet</div><div class="v">${rp(st.revenueEstimate)}</div></div>
      </div>
      <div class="toolbar">
        <input type="search" id="bkQ" placeholder="Cari kode, nama, WhatsApp, paket…" value="${esc(bkFilter.q)}" aria-label="Cari">
        <select id="bkS" aria-label="Status">${['Semua', ...STATUSES].map(s => `<option ${s === bkFilter.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
      </div>
      <div class="tw"><table><thead><tr><th>Kode / Pelanggan</th><th>Paket &amp; Armada</th><th>Jadwal</th><th>Total</th><th>Status</th></tr></thead><tbody>
      ${list.bookings.map(b => `<tr data-open="${esc(b.id)}"><td><b>${esc(b.id)}</b><small>${esc(b.customerName)} · ${esc(b.customerPhone)}</small></td><td>${esc(b.package)}<small>${esc(b.fleetCount || 1)} × ${esc(b.fleet)} · ${esc(b.guests)} peserta</small></td><td>${fmtDate(b.date)}<small>${b.days || 1} hari${b.days > 1 ? ` s/d ${fmtDate(addDays(b.date, b.days - 1))}` : ''}</small></td><td>${b.price > 0 ? rp(b.price) : '<span class="muted">Belum ada</span>'}<small>${payBadge(b.paymentStatus)}</small></td><td>${badge(b.status)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Belum ada pemesanan.</td></tr>'}
      </tbody></table></div>`;
    $('#bkS').onchange = e => { bkFilter.status = e.target.value; go('pemesanan'); };
    $('#bkQ').oninput = e => { clearTimeout(bkTimer); bkTimer = setTimeout(async () => { bkFilter.q = e.target.value; const pos = e.target.selectionStart; await vBookings(); const q = $('#bkQ'); if (q) { q.focus(); q.setSelectionRange(pos, pos); } }, 350); };
    $('#main tbody').onclick = e => { const tr = e.target.closest('[data-open]'); if (tr) openBooking(tr.dataset.open); };
    window.__bookings = list.bookings;
    refreshDot();
  }

  async function blobUrl(file) {
    const r = await fetch(`/api/admin/proofs/${encodeURIComponent(file)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error('Bukti tidak dapat dimuat.');
    return URL.createObjectURL(await r.blob());
  }

  async function openBooking(id, fresh) {
    let b = fresh || (window.__bookings || []).find(x => x.id === id);
    if (!b) { b = (await api(`/api/bookings?q=${encodeURIComponent(id)}`)).bookings.find(x => x.id === id); if (!b) return; }
    if (!fleets.length) await loadFleets();
    const paid = (b.payments || []).filter(p => p.status === 'Terverifikasi').reduce((s, p) => s + p.amount, 0);
    const el = openLayer(`
      <div class="dh"><div><h2>${esc(b.id)}</h2><div>${badge(b.status)} ${payBadge(b.paymentStatus)}</div></div><button class="x" data-x aria-label="Tutup">×</button></div>
      <dl class="kv" style="margin-top:12px">
        <dt>Pelanggan</dt><dd>${esc(b.customerName)}<br><a href="https://wa.me/${encodeURIComponent(String(b.customerPhone).replace(/^0/, '62'))}" target="_blank" rel="noopener">${esc(b.customerPhone)}</a>${b.customerEmail ? ` · ${esc(b.customerEmail)}` : ''}</dd>
        <dt>Paket</dt><dd>${esc(b.package)}</dd>
        <dt>Tujuan</dt><dd>${esc(b.destination || '-')}</dd>
        <dt>Dibuat</dt><dd>${fmtDT(b.createdAt)} WIB</dd>
        <dt>Dibayar</dt><dd>${rp(paid)} dari ${b.price > 0 ? rp(b.price) : 'harga belum ditetapkan'}</dd>
      </dl>
      <form id="bkForm" class="sec">
        <h3>Ubah pemesanan</h3>
        <div class="row"><div><label for="f_status">Status</label><select id="f_status">${STATUSES.map(s => `<option ${s === b.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div><label for="f_price">Total harga (Rp)</label><input id="f_price" type="number" min="0" step="1000" value="${b.price || 0}"></div></div>
        <div class="row"><div><label for="f_fleet">Armada</label><select id="f_fleet"><option value="">Belum ditentukan</option>${fleets.map(f => `<option value="${esc(f.id)}" ${f.id === b.fleetId ? 'selected' : ''}>${esc(f.name)} (${f.seats} kursi)</option>`).join('')}</select></div>
        <div><label for="f_count">Jumlah unit</label><input id="f_count" type="number" min="1" max="20" value="${b.fleetCount || 1}"></div></div>
        <div class="row3"><div><label for="f_date">Tanggal berangkat</label><input id="f_date" type="date" value="${esc(b.date)}"></div>
        <div><label for="f_days">Lama (hari)</label><input id="f_days" type="number" min="1" max="30" value="${b.days || 1}"></div>
        <div><label for="f_guests">Peserta</label><input id="f_guests" type="number" min="1" max="500" value="${b.guests || 1}"></div></div>
        <label for="f_notes">Catatan internal</label><textarea id="f_notes">${esc(b.adminNotes || '')}</textarea>
        <label class="check"><input type="checkbox" id="f_ref" ${b.refunded ? 'checked disabled' : ''}> Dana sudah dikembalikan ke pelanggan</label>
        <div id="conflictBox"></div>
        <div class="actions"><button class="btn" type="submit">Simpan</button><button class="btn danger" type="button" id="bkDel">Hapus</button></div>
      </form>
      <div class="sec"><h3>Pembayaran</h3>
        ${(b.payments || []).map(p => `<div class="pay" data-pay="${esc(p.id)}"><div class="top"><b>${rp(p.amount)} · ${esc(p.method)}${p.bank ? ` · ${esc(p.bank)}` : ''}</b><span class="badge ${p.status === 'Terverifikasi' ? 'p-Lunas' : p.status === 'Ditolak' ? 'p-Dikembalikan' : 'p-Menunggu'}">${esc(p.status)}</span></div><div class="muted small">${fmtDT(p.at)}${p.senderName ? ` · pengirim: ${esc(p.senderName)}` : ''}${p.note ? ` · ${esc(p.note)}` : ''}</div>${p.proof ? `<img class="proof" data-proof="${esc(p.proof)}" alt="Bukti pembayaran" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==">` : ''}${p.status === 'Menunggu verifikasi' ? `<div class="actions"><button class="btn ok sm" data-verify="Terverifikasi">Verifikasi</button><button class="btn danger sm" data-verify="Ditolak">Tolak</button></div>` : ''}</div>`).join('') || '<p class="muted">Belum ada pembayaran.</p>'}
        <form id="payForm" class="row3" style="align-items:end"><div><label for="pa">Catat pembayaran (Rp)</label><input id="pa" type="number" min="1" step="1000" required></div><div><label for="pm">Metode</label><select id="pm"><option value="tunai">Tunai</option><option value="transfer">Transfer</option><option value="qris">QRIS</option><option value="lainnya">Lainnya</option></select></div><div><button class="btn line" type="submit" style="margin-top:12px">Catat</button></div></form>
      </div>
      <div class="sec"><h3>Linimasa pelanggan</h3>
        <ul class="tl">${[...(b.timeline || [])].reverse().map(t => `<li class="${t.by === 'admin' ? '' : 'sys'}"><b>${esc(t.label)}</b>${t.note ? `<span>${esc(t.note)}</span><br>` : ''}<span class="muted small">${fmtDT(t.at)}</span></li>`).join('')}</ul>
        <form id="tlForm"><label for="tl_l">Kirim update ke pelanggan (tampil di halaman lacak)</label><div class="row"><input id="tl_l" type="text" maxlength="80" placeholder="Judul, mis. Bus menuju titik jemput"><input id="tl_n" type="text" maxlength="300" placeholder="Isi update" required></div><div class="actions"><button class="btn line sm" type="submit">Kirim update</button></div></form>
      </div>`);
    // muat bukti pembayaran (butuh header Authorization)
    $$('[data-proof]', el).forEach(img => blobUrl(img.dataset.proof).then(u => { img.src = u; img.dataset.full = u; }).catch(() => { img.alt = 'Bukti tidak dapat dimuat'; }));
    el.addEventListener('click', e => {
      const im = e.target.closest('.proof');
      if (im && im.dataset.full) { const lb = document.createElement('div'); lb.className = 'lightbox'; lb.innerHTML = `<img alt="Bukti pembayaran" src="${im.dataset.full}">`; lb.onclick = () => lb.remove(); document.body.appendChild(lb); }
    });
    const refresh = nb => { const i = (window.__bookings || []).findIndex(x => x.id === nb.id); if (i >= 0) window.__bookings[i] = nb; openBooking(nb.id, nb); if (tab === 'pemesanan') vBookings(); };
    const save = async force => {
      const body = {
        status: $('#f_status').value, price: Number($('#f_price').value), fleetId: $('#f_fleet').value, fleetCount: Number($('#f_count').value),
        date: $('#f_date').value, days: Number($('#f_days').value), guests: Number($('#f_guests').value), adminNotes: $('#f_notes').value
      };
      if ($('#f_ref').checked && !$('#f_ref').disabled) body.refunded = true;
      if (force) body.force = true;
      try { const d = await api(`/api/bookings/${encodeURIComponent(b.id)}`, json('PATCH', body)); toast('Tersimpan.'); refresh(d.booking); }
      catch (err) {
        if (err.status === 409 && err.data?.conflict) {
          $('#conflictBox').innerHTML = `<div class="warn"><b>Jadwal bentrok.</b> ${esc(err.data.conflict.message)}<div class="actions"><button type="button" class="btn danger sm" id="forceBtn">Tetap simpan (timpa)</button><button type="button" class="btn line sm" id="noForce">Batal</button></div></div>`;
          $('#forceBtn').onclick = () => save(true); $('#noForce').onclick = () => { $('#conflictBox').innerHTML = ''; };
        } else if (err.status !== 401 && err.status !== 403) toast(err.message);
      }
    };
    $('#bkForm', el).addEventListener('submit', e => { e.preventDefault(); save(false); });
    $('#bkDel', el).onclick = guard(async () => { if (!confirm(`Hapus pemesanan ${b.id} beserta bukti pembayarannya? Tindakan ini tidak dapat dibatalkan. (Untuk membatalkan, ubah status ke Dibatalkan.)`)) return; await api(`/api/bookings/${encodeURIComponent(b.id)}`, { method: 'DELETE' }); toast('Pemesanan dihapus.'); closeLayer(); vBookings(); });
    $$('[data-verify]', el).forEach(btn => btn.onclick = guard(async () => {
      const status = btn.dataset.verify; let note = '';
      if (status === 'Ditolak') { note = prompt('Alasan penolakan (dibaca pelanggan):', 'Bukti pembayaran belum sesuai, silakan unggah ulang.'); if (note === null) return; }
      const d = await api(`/api/bookings/${encodeURIComponent(b.id)}/payments/${encodeURIComponent(btn.closest('[data-pay]').dataset.pay)}`, json('PATCH', { status, note })); toast(status === 'Terverifikasi' ? 'Pembayaran diverifikasi.' : 'Pembayaran ditolak.'); refresh(d.booking);
    }));
    $('#payForm', el).addEventListener('submit', guard(async e => { e.preventDefault(); const d = await api(`/api/bookings/${encodeURIComponent(b.id)}/payments`, json('POST', { amount: Number($('#pa').value), method: $('#pm').value })); toast('Pembayaran dicatat.'); refresh(d.booking); }));
    $('#tlForm', el).addEventListener('submit', guard(async e => { e.preventDefault(); const d = await api(`/api/bookings/${encodeURIComponent(b.id)}/timeline`, json('POST', { label: $('#tl_l').value, note: $('#tl_n').value })); toast('Update terkirim.'); refresh(d.booking); }));
  }

  /* =================== KALENDER =================== */
  let calMonth = today().slice(0, 7);
  async function vCalendar() {
    const [c, blocks] = await Promise.all([api(`/api/admin/calendar?month=${calMonth}`), api('/api/admin/blocks')]);
    if (tab !== 'kalender') return;
    const days = []; for (let d = c.from; d <= c.to; d = addDays(d, 1)) days.push(d);
    const usage = {}; // fleetId -> date -> {booked, blocked}
    for (const f of c.fleets) { usage[f.id] = {}; for (const d of days) usage[f.id][d] = { booked: 0, blocked: 0 }; }
    for (const b of c.bookings) for (let i = 0; i < b.days; i++) { const d = addDays(b.date, i); if (usage[b.fleetId]?.[d]) usage[b.fleetId][d].booked += b.fleetCount; }
    for (const k of c.blocks) for (const d of days) if (d >= k.from && d <= k.to && usage[k.fleetId]) usage[k.fleetId][d].blocked += k.units || 1;
    window.__cal = { c, usage };
    const wd = ['M', 'S', 'S', 'R', 'K', 'J', 'S']; // Min Sen Sel Rab Kam Jum Sab
    const cols = `150px repeat(${days.length},minmax(40px,1fr))`;
    $('#main').innerHTML = `
      <div class="head"><h1>Kalender ketersediaan</h1><button class="btn" id="addBlk">+ Blokir tanggal</button></div>
      <div class="cal-nav"><button class="btn line sm" id="cPrev">‹</button><strong>${monthName(calMonth)}</strong><button class="btn line sm" id="cNext">›</button><button class="btn line sm" id="cToday">Bulan ini</button></div>
      <div class="cal-scroll"><div class="cal-grid" style="grid-template-columns:${cols}">
        <div class="hd fn" style="top:0">Armada</div>
        ${days.map(d => { const dow = new Date(pd(d)).getUTCDay(); return `<div class="hd ${dow === 0 || dow === 6 ? 'we' : ''} ${d === c.today ? 'today' : ''}">${+d.slice(8)}<br><small>${wd[dow]}</small></div>`; }).join('')}
        ${c.fleets.map(f => `<div class="fn ${f.active ? '' : 'off'}">${esc(f.name)}<small>${f.units} unit · ${f.seats} kursi</small></div>${days.map(d => { const u = usage[f.id][d]; const free = Math.max(0, f.units - u.booked - u.blocked); const cls = free === 0 ? 'full' : free < f.units ? 'few' : 'ok'; return `<div class="cell ${cls} ${d < c.today ? 'past' : ''}" data-f="${esc(f.id)}" data-d="${d}" title="${esc(f.name)} · ${d}: sisa ${free} dari ${f.units}">${free}</div>`; }).join('')}`).join('')}
      </div></div>
      <div class="legend"><span><i style="background:#e7f6ee"></i>Semua unit tersedia</span><span><i style="background:#fff3d1"></i>Sebagian terpakai</span><span><i style="background:#f8dedd"></i>Penuh</span><span>Angka = sisa unit. Klik sel untuk melihat rincian.</span></div>
      <h2 style="margin:22px 0 10px;font-size:17px">Tanggal yang diblokir</h2>
      <div class="tw"><table><thead><tr><th>Armada</th><th>Periode</th><th>Unit</th><th>Catatan</th><th></th></tr></thead><tbody>
      ${blocks.items.map(k => { const f = fleets.find(x => x.id === k.fleetId) || c.fleets.find(x => x.id === k.fleetId); return `<tr><td>${esc(f ? f.name : k.fleetId)}</td><td>${fmtDate(k.from)}${k.to !== k.from ? ` – ${fmtDate(k.to)}` : ''}</td><td>${k.units || 1}</td><td>${esc(k.note || '-')}</td><td><button class="btn danger sm" data-delblk="${esc(k.id)}">Hapus</button></td></tr>`; }).join('') || '<tr><td colspan="5" class="empty">Belum ada tanggal yang diblokir. Gunakan untuk servis armada, libur, atau pemesanan di luar sistem.</td></tr>'}
      </tbody></table></div>`;
    $('#cPrev').onclick = () => { calMonth = addMonths(calMonth, -1); go('kalender'); };
    $('#cNext').onclick = () => { calMonth = addMonths(calMonth, 1); go('kalender'); };
    $('#cToday').onclick = () => { calMonth = today().slice(0, 7); go('kalender'); };
    $('#addBlk').onclick = () => blockForm(c.fleets);
    $('.cal-grid').onclick = e => { const cell = e.target.closest('.cell'); if (cell) dayDetail(cell.dataset.f, cell.dataset.d); };
    $$('[data-delblk]').forEach(b => b.onclick = guard(async () => { if (!confirm('Hapus blokir ini? Tanggal akan kembali tersedia untuk pelanggan.')) return; await api(`/api/admin/blocks/${encodeURIComponent(b.dataset.delblk)}`, { method: 'DELETE' }); toast('Blokir dihapus.'); vCalendar(); }));
  }
  function dayDetail(fid, d) {
    const { c } = window.__cal; const f = c.fleets.find(x => x.id === fid);
    const bs = c.bookings.filter(b => b.fleetId === fid && d >= b.date && d <= addDays(b.date, b.days - 1));
    const ks = c.blocks.filter(k => k.fleetId === fid && d >= k.from && d <= k.to);
    const el = openLayer(`<div class="dh"><div><h2>${esc(f.name)}</h2><div class="muted">${fmtDate(d)} · ${f.units} unit</div></div><button class="x" data-x aria-label="Tutup">×</button></div>
      <div class="sec"><h3>Pemesanan</h3>${bs.map(b => `<div class="pay"><div class="top"><b>${esc(b.id)} · ${esc(b.customerName)}</b>${badge(b.status)}</div><div class="muted small">${b.fleetCount} unit · ${fmtDate(b.date)}${b.days > 1 ? ` – ${fmtDate(addDays(b.date, b.days - 1))}` : ''} · ${esc(b.package)}</div><div class="actions"><button class="btn line sm" data-ob="${esc(b.id)}">Buka pemesanan</button></div></div>`).join('') || '<p class="muted">Tidak ada pemesanan pada tanggal ini.</p>'}</div>
      <div class="sec"><h3>Blokir</h3>${ks.map(k => `<div class="pay"><b>${k.units || 1} unit</b> · ${fmtDate(k.from)} – ${fmtDate(k.to)}<div class="muted small">${esc(k.note || '-')}</div></div>`).join('') || '<p class="muted">Tidak ada blokir.</p>'}</div>
      <div class="actions"><button class="btn" id="blkHere">Blokir tanggal ini</button></div>`, '');
    $$('[data-ob]', el).forEach(b => b.onclick = () => { closeLayer(); openBooking(b.dataset.ob); });
    $('#blkHere', el).onclick = () => blockForm(c.fleets, { fleetId: fid, from: d, to: d });
  }
  function blockForm(list, pre = {}) {
    const el = openLayer(`<div class="dh"><h2>Blokir tanggal</h2><button class="x" data-x aria-label="Tutup">×</button></div>
      <form id="blkForm"><p class="muted small">Unit yang diblokir tidak bisa dipesan pelanggan pada periode ini.</p>
      <label for="b_f">Armada</label><select id="b_f">${list.map(f => `<option value="${esc(f.id)}" ${f.id === pre.fleetId ? 'selected' : ''}>${esc(f.name)} (${f.units} unit)</option>`).join('')}</select>
      <div class="row"><div><label for="b_from">Dari</label><input id="b_from" type="date" value="${esc(pre.from || today())}" required></div><div><label for="b_to">Sampai</label><input id="b_to" type="date" value="${esc(pre.to || pre.from || today())}" required></div></div>
      <label for="b_u">Jumlah unit diblokir</label><input id="b_u" type="number" min="1" value="1">
      <label for="b_n">Catatan</label><input id="b_n" type="text" maxlength="200" placeholder="mis. Servis berkala">
      <div class="actions"><button class="btn" type="submit">Blokir</button></div></form>`, 'center');
    $('#blkForm', el).addEventListener('submit', guard(async e => {
      e.preventDefault();
      await api('/api/admin/blocks', json('POST', { fleetId: $('#b_f').value, from: $('#b_from').value, to: $('#b_to').value, units: Number($('#b_u').value), note: $('#b_n').value }));
      toast('Tanggal diblokir.'); closeLayer(); if (tab === 'kalender') vCalendar();
    }));
  }

  /* =================== gambar =================== */
  function resizeImage(file, maxDim = 1600) {
    return new Promise((res, rej) => {
      if (!file || !/^image\/(png|jpe?g|webp)$/.test(file.type)) return rej(new Error('Pilih gambar JPG, PNG, atau WebP.'));
      const u = URL.createObjectURL(file), img = new Image();
      img.onload = () => { URL.revokeObjectURL(u); const s = Math.min(1, maxDim / Math.max(img.width, img.height)); const cv = document.createElement('canvas'); cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s); const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, cv.width, cv.height); x.drawImage(img, 0, 0, cv.width, cv.height); res(cv.toDataURL('image/jpeg', .85)); };
      img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('Gambar tidak dapat dibaca.')); };
      img.src = u;
    });
  }
  /** Pemilih gambar: mengunggah ke server dan menyimpan URL pada input tersembunyi. */
  function bindImagePicker(root, hiddenId, prevId, fileId, clearId) {
    const hid = $(hiddenId, root), prev = $(prevId, root);
    const show = () => { prev.innerHTML = hid.value ? `<img src="${esc(hid.value)}" alt="">` : '<span class="muted small">Belum ada gambar</span>'; };
    show();
    $(fileId, root).onchange = guard(async e => { const f = e.target.files[0]; if (!f) return; const image = await resizeImage(f); const d = await api('/api/admin/upload', json('POST', { image })); hid.value = d.url; show(); toast('Gambar diunggah. Klik Simpan untuk menerapkan.'); });
    $(clearId, root).onclick = () => { hid.value = ''; show(); };
  }
  const imgPicker = (val, name) => `<div class="imgpick"><div id="${name}Prev"></div><div><input type="hidden" id="${name}Val" value="${esc(val || '')}"><input type="file" id="${name}File" accept="image/png,image/jpeg,image/webp" aria-label="Unggah gambar"><div class="actions" style="margin-top:6px"><button class="btn line sm" type="button" id="${name}Clr">Hapus gambar</button></div></div></div>`;
  const lines = t => t.split('\n').map(s => s.trim()).filter(Boolean);

  /* =================== PAKET =================== */
  async function vPackages() {
    const [p] = await Promise.all([api('/api/admin/packages'), loadFleets()]);
    if (tab !== 'paket') return;
    window.__pk = p.items;
    $('#main').innerHTML = `<div class="head"><h1>Paket wisata</h1><button class="btn" id="newPk">+ Paket baru</button></div>
      <p class="muted">Setiap paket sudah termasuk armada &amp; pengemudi. Pelanggan memilih armada sesuai kapasitas; harga dikalikan jumlah bus. Harga 0 = penawaran oleh admin.</p>
      <div class="items">${p.items.map(x => { const prices = x.fleetOptions.map(o => o.price).filter(v => v > 0); return `<article class="item ${x.active === false ? 'off' : ''}"><div class="ph">${x.image ? `<img src="${esc(x.image)}" alt="" loading="lazy">` : 'Tanpa foto'}</div><div class="bd"><h3>${esc(x.name)}</h3><div class="muted small">${x.days} hari · ${x.fleetOptions.length} pilihan armada${x.active === false ? ' · <b>Nonaktif</b>' : ''}</div><div>${prices.length ? `Mulai ${rp(Math.min(...prices))} / bus` : '<span class="muted">Harga belum diisi</span>'}</div><div class="actions"><button class="btn line sm" data-edit="${esc(x.id)}">Edit</button><button class="btn danger sm" data-del="${esc(x.id)}">Hapus</button></div></div></article>`; }).join('') || '<div class="empty">Belum ada paket.</div>'}</div>`;
    $('#newPk').onclick = () => packageForm(null);
    $$('[data-edit]').forEach(b => b.onclick = () => packageForm(window.__pk.find(x => x.id === b.dataset.edit)));
    $$('[data-del]').forEach(b => b.onclick = guard(async () => { if (!confirm('Hapus paket ini? Pemesanan yang sudah ada tetap tersimpan.')) return; await api(`/api/admin/packages/${encodeURIComponent(b.dataset.del)}`, { method: 'DELETE' }); toast('Paket dihapus.'); vPackages(); }));
  }
  function packageForm(p) {
    const cur = p || { name: '', days: 3, fleetOptions: [], itinerary: [], includes: [], terms: [], active: true, order: 50 };
    const priceOf = id => (cur.fleetOptions.find(o => o.fleetId === id) || {}).price ?? '';
    const on = id => cur.fleetOptions.some(o => o.fleetId === id);
    const el = openLayer(`<div class="dh"><h2>${p ? 'Edit paket' : 'Paket baru'}</h2><button class="x" data-x aria-label="Tutup">×</button></div>
      <form id="pkForm">
        <label for="k_name">Nama paket</label><input id="k_name" type="text" maxlength="120" required value="${esc(cur.name)}">
        <div class="row3"><div><label for="k_days">Lama (hari)</label><input id="k_days" type="number" min="1" max="30" value="${cur.days || 1}"></div><div><label for="k_tag">Label</label><input id="k_tag" type="text" maxlength="30" value="${esc(cur.tag || '')}" placeholder="Terlaris"></div><div><label for="k_order">Urutan</label><input id="k_order" type="number" min="0" max="999" value="${cur.order ?? 50}"></div></div>
        <label for="k_dest">Destinasi</label><input id="k_dest" type="text" maxlength="160" value="${esc(cur.destinations || '')}">
        <label for="k_fac">Fasilitas singkat</label><input id="k_fac" type="text" maxlength="80" value="${esc(cur.facilities || '')}">
        <label>Armada &amp; harga paket per bus (sudah termasuk bus &amp; pengemudi)</label>
        <table class="opt-table"><tbody>${fleets.map(f => `<tr><td><label class="check" style="margin:0"><input type="checkbox" data-fo="${esc(f.id)}" ${on(f.id) ? 'checked' : ''}> ${esc(f.name)} <span class="muted small">(${f.seats} kursi)</span></label></td><td style="width:150px"><input type="number" min="0" step="10000" data-fp="${esc(f.id)}" value="${priceOf(f.id)}" placeholder="Rp / bus" aria-label="Harga ${esc(f.name)}"></td></tr>`).join('')}</tbody></table>
        <div class="hint">Centang armada yang boleh dipilih untuk paket ini. Harga 0 = “hubungi kami”, admin menetapkan harga di pemesanan.</div>
        <label>Foto</label>${imgPicker(cur.image, 'pimg')}
        <label for="k_it">Rencana perjalanan (satu baris per poin)</label><textarea id="k_it">${esc((cur.itinerary || []).join('\n'))}</textarea>
        <label for="k_inc">Termasuk (satu baris per poin)</label><textarea id="k_inc">${esc((cur.includes || []).join('\n'))}</textarea>
        <label for="k_terms">Ketentuan (satu baris per poin)</label><textarea id="k_terms">${esc((cur.terms || []).join('\n'))}</textarea>
        <label class="check"><input type="checkbox" id="k_act" ${cur.active !== false ? 'checked' : ''}> Tampilkan di situs</label>
        <div class="actions"><button class="btn" type="submit">Simpan</button></div>
      </form>`);
    bindImagePicker(el, '#pimgVal', '#pimgPrev', '#pimgFile', '#pimgClr');
    $('#pkForm', el).addEventListener('submit', guard(async e => {
      e.preventDefault();
      const fleetOptions = $$('[data-fo]', el).filter(c => c.checked).map(c => ({ fleetId: c.dataset.fo, price: Number($(`[data-fp="${c.dataset.fo}"]`, el).value) || 0 }));
      if (!fleetOptions.length) return toast('Pilih minimal satu armada untuk paket ini.');
      const body = { name: $('#k_name').value, days: Number($('#k_days').value), tag: $('#k_tag').value, order: Number($('#k_order').value), destinations: $('#k_dest').value, facilities: $('#k_fac').value, fleetOptions, image: $('#pimgVal').value, itinerary: lines($('#k_it').value), includes: lines($('#k_inc').value), terms: lines($('#k_terms').value), active: $('#k_act').checked, duration: `${Number($('#k_days').value)} Hari` };
      await api(p ? `/api/admin/packages/${encodeURIComponent(p.id)}` : '/api/admin/packages', json(p ? 'PUT' : 'POST', body));
      toast('Paket tersimpan.'); closeLayer(); vPackages();
    }));
  }

  /* =================== ARMADA =================== */
  async function vFleet() {
    const d = await api('/api/admin/fleet'); fleets = d.items;
    if (tab !== 'armada') return;
    $('#main').innerHTML = `<div class="head"><h1>Armada</h1><button class="btn" id="newFl">+ Armada baru</button></div>
      <p class="muted">“Jumlah unit” adalah banyak bus yang Anda miliki untuk tipe ini. Ketersediaan dihitung per unit per hari.</p>
      <div class="items">${fleets.map(f => `<article class="item ${f.active === false ? 'off' : ''}"><div class="ph">${f.image ? `<img src="${esc(f.image)}" alt="" loading="lazy">` : 'Tanpa foto'}</div><div class="bd"><h3>${esc(f.name)}</h3><div class="muted small">${f.seats} kursi · ${f.units} unit${f.active === false ? ' · <b>Nonaktif</b>' : ''}</div><div>${f.pricePerDay > 0 ? `${rp(f.pricePerDay)} / hari` : '<span class="muted">Tarif belum diisi</span>'}</div><div class="actions"><button class="btn line sm" data-edit="${esc(f.id)}">Edit</button><button class="btn danger sm" data-del="${esc(f.id)}">Hapus</button></div></div></article>`).join('') || '<div class="empty">Belum ada armada.</div>'}</div>`;
    $('#newFl').onclick = () => fleetForm(null);
    $$('[data-edit]').forEach(b => b.onclick = () => fleetForm(fleets.find(x => x.id === b.dataset.edit)));
    $$('[data-del]').forEach(b => b.onclick = guard(async () => { if (!confirm('Hapus armada ini? Blokir tanggalnya ikut terhapus dan paket tidak dapat lagi memakainya.')) return; await api(`/api/admin/fleet/${encodeURIComponent(b.dataset.del)}`, { method: 'DELETE' }); toast('Armada dihapus.'); vFleet(); }));
  }
  function fleetForm(f) {
    const cur = f || { name: '', seats: 40, units: 1, pricePerDay: 0, features: [], active: true, order: 50 };
    const el = openLayer(`<div class="dh"><h2>${f ? 'Edit armada' : 'Armada baru'}</h2><button class="x" data-x aria-label="Tutup">×</button></div>
      <form id="flForm">
        <label for="a_name">Nama armada</label><input id="a_name" type="text" maxlength="120" required value="${esc(cur.name)}">
        <div class="row3"><div><label for="a_seats">Kursi / unit</label><input id="a_seats" type="number" min="1" max="100" value="${cur.seats}"></div><div><label for="a_units">Jumlah unit</label><input id="a_units" type="number" min="1" max="200" value="${cur.units || 1}"></div><div><label for="a_order">Urutan</label><input id="a_order" type="number" min="0" max="999" value="${cur.order ?? 50}"></div></div>
        <label for="a_price">Tarif sewa saja (Rp / unit / hari)</label><input id="a_price" type="number" min="0" step="50000" value="${cur.pricePerDay || 0}">
        <div class="hint">Dipakai untuk sewa armada tanpa paket (halaman Armada). Isi 0 bila harga ditawarkan manual.</div>
        <label for="a_feat">Fasilitas (satu baris per poin)</label><textarea id="a_feat">${esc((cur.features || []).join('\n'))}</textarea>
        <label>Foto</label>${imgPicker(cur.image, 'aimg')}
        <label class="check"><input type="checkbox" id="a_act" ${cur.active !== false ? 'checked' : ''}> Tampilkan di situs</label>
        <div class="actions"><button class="btn" type="submit">Simpan</button></div>
      </form>`);
    bindImagePicker(el, '#aimgVal', '#aimgPrev', '#aimgFile', '#aimgClr');
    $('#flForm', el).addEventListener('submit', guard(async e => {
      e.preventDefault();
      const body = { name: $('#a_name').value, seats: Number($('#a_seats').value), units: Number($('#a_units').value), order: Number($('#a_order').value), pricePerDay: Number($('#a_price').value) || 0, features: lines($('#a_feat').value), image: $('#aimgVal').value, active: $('#a_act').checked };
      await api(f ? `/api/admin/fleet/${encodeURIComponent(f.id)}` : '/api/admin/fleet', json(f ? 'PUT' : 'POST', body));
      toast('Armada tersimpan.'); closeLayer(); vFleet();
    }));
  }

  /* =================== PENGATURAN =================== */
  async function vSettings() {
    const { settings: s } = await api('/api/settings');
    if (tab !== 'pengaturan') return;
    const banks = (s.banks && s.banks.length ? s.banks : []);
    const bankHtml = b => `<div class="bank"><div class="row3"><div><label>Bank</label><input type="text" data-b="bank" maxlength="60" value="${esc(b.bank || '')}" placeholder="BCA"></div><div><label>No. rekening</label><input type="text" data-b="number" maxlength="40" value="${esc(b.number || '')}"></div><div><label>Atas nama</label><input type="text" data-b="holder" maxlength="80" value="${esc(b.holder || '')}"></div></div><button class="btn line sm" type="button" data-rmbank style="margin-top:8px">Hapus rekening</button></div>`;
    $('#main').innerHTML = `<div class="head"><h1>Pembayaran &amp; Kontak</h1></div>
      <form id="stForm" class="card" style="max-width:760px">
        <h3>Transfer bank</h3><p class="muted small">Rekening ini tampil di halaman lacak pelanggan. Pelanggan mengunggah bukti, lalu Anda verifikasi di tab Pemesanan.</p>
        <div id="banks">${banks.map(bankHtml).join('')}</div>
        <button class="btn line sm" type="button" id="addBank">+ Tambah rekening</button>
        <h3 style="margin-top:22px">QRIS</h3>
        <label class="check"><input type="checkbox" id="s_qen" ${s.qris?.enabled ? 'checked' : ''}> Aktifkan pembayaran QRIS</label>
        ${imgPicker(s.qris?.image, 'qimg')}
        <h3 style="margin-top:22px">Ketentuan bayar</h3>
        <div class="row"><div><label for="s_dp">Uang muka (DP) %</label><input id="s_dp" type="number" min="10" max="100" value="${s.dpPercent || 50}"></div></div>
        <label for="s_pn">Catatan pembayaran</label><textarea id="s_pn" maxlength="500">${esc(s.paymentNote || '')}</textarea>
        <h3 style="margin-top:22px">Kontak</h3>
        <div class="row"><div><label for="s_wa">WhatsApp (format 628…)</label><input id="s_wa" type="tel" value="${esc(s.waNumber || '')}"></div><div><label for="s_ph">Tampilan nomor</label><input id="s_ph" type="text" value="${esc(s.phoneDisplay || '')}"></div></div>
        <div class="row"><div><label for="s_em">Email</label><input id="s_em" type="email" value="${esc(s.email || '')}"></div><div><label for="s_ad">Alamat</label><input id="s_ad" type="text" value="${esc(s.address || '')}"></div></div>
        <div class="actions"><button class="btn" type="submit">Simpan pengaturan</button></div>
      </form>`;
    bindImagePicker($('#main'), '#qimgVal', '#qimgPrev', '#qimgFile', '#qimgClr');
    $('#addBank').onclick = () => { if ($$('.bank').length >= 6) return toast('Maksimal 6 rekening.'); $('#banks').insertAdjacentHTML('beforeend', bankHtml({})); };
    $('#banks').onclick = e => { const b = e.target.closest('[data-rmbank]'); if (b) b.closest('.bank').remove(); };
    $('#stForm').addEventListener('submit', guard(async e => {
      e.preventDefault();
      const rows = $$('.bank').map(r => Object.fromEntries($$('[data-b]', r).map(i => [i.dataset.b, i.value])));
      const image = $('#qimgVal').value;
      if ($('#s_qen').checked && !image) return toast('Unggah gambar QRIS terlebih dahulu.');
      await api('/api/admin/settings', json('PUT', { banks: rows, qris: { enabled: $('#s_qen').checked, image }, dpPercent: Number($('#s_dp').value), paymentNote: $('#s_pn').value, waNumber: $('#s_wa').value, phoneDisplay: $('#s_ph').value, email: $('#s_em').value, address: $('#s_ad').value }));
      toast('Pengaturan tersimpan.'); vSettings();
    }));
  }

  /* =================== AKUN =================== */
  async function vAccount() {
    const me = await api('/api/admin/me');
    $('#main').innerHTML = `<div class="head"><h1>Akun</h1></div><div class="card" style="max-width:480px"><p>Masuk sebagai <b>${esc(me.username)}</b>.</p><button class="btn" id="chgPw">Ganti kata sandi</button> <button class="btn line" id="outBtn">Keluar</button></div>`;
    $('#chgPw').onclick = () => showView('pw', false);
    $('#outBtn').onclick = () => logout();
  }

  /* ---------- awal ---------- */
  if (token) start(); else showView('login');
})();
