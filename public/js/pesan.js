(async () => {
  'use strict';
  const { esc, rupiah, fmtDate, rangeText, $ } = LP;
  const form = $('#bookingForm');
  const q = new URLSearchParams(location.search);
  const intIn = (v, min, max, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= min && n <= max ? n : d; };
  let packages = [], fleets = [];
  let av = null, avKey = '', avTimer = 0;
  let pickedFleet = '', pickedByUser = false, countByUser = false;

  try {
    const [p, f] = await Promise.all([LP.api('/api/packages'), LP.api('/api/fleet')]);
    packages = p.packages; fleets = f.fleet;
  } catch (err) { form.innerHTML = `<div class="alert err">${esc(err.message)} Muat ulang halaman ini.</div>`; return; }
  if (!fleets.length) { form.innerHTML = '<div class="alert warn">Armada belum tersedia. Silakan hubungi kami lewat WhatsApp.</div>'; return; }

  $('#package').innerHTML = '<option value="">Tanpa paket — sewa armada saja (per hari)</option>' + packages.map(p => `<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.duration || `${p.days} Hari`)}, bus termasuk)</option>`).join('');
  $('#date').min = LP.todayWib();

  /* ---- nilai awal dari tautan (halaman Paket / Armada) ---- */
  if (packages.some(p => p.id === q.get('paket'))) $('#package').value = q.get('paket');
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.get('tanggal') || '') && q.get('tanggal') >= LP.todayWib()) $('#date').value = q.get('tanggal');
  if (q.get('hari')) $('#days').value = intIn(q.get('hari'), 1, 30, 1);
  if (q.get('peserta')) $('#guests').value = intIn(q.get('peserta'), 1, 500, 20);
  if (fleets.some(f => f.id === q.get('armada'))) { pickedFleet = q.get('armada'); pickedByUser = true; }
  if (q.get('jumlah')) { $('#fleetCount').value = intIn(q.get('jumlah'), 1, 20, 1); countByUser = true; }

  /* ---- keadaan turunan ---- */
  const pkg = () => packages.find(p => p.id === $('#package').value) || null;
  const days = () => pkg() ? pkg().days : intIn($('#days').value, 1, 30, 1);
  const guests = () => intIn($('#guests').value, 1, 500, 1);
  const date = () => $('#date').value;
  const need = f => Math.ceil(guests() / f.seats);
  function options() {
    const p = pkg(), d = days();
    if (p) return p.fleetOptions.map(o => ({ f: fleets.find(x => x.id === o.fleetId), unit: o.price })).filter(o => o.f);
    return fleets.map(f => ({ f, unit: f.pricePerDay > 0 ? f.pricePerDay * d : 0 }));
  }
  const freeOf = f => (date() && av && !av.error) ? LP.minFree(av, f.id, date(), days()) : null;
  const status = o => {
    const n = need(o.f), free = freeOf(o.f);
    if (!date()) return { cls: 'idle', text: 'Pilih tanggal untuk cek ketersediaan', ok: true };
    if (av && av.error) return { cls: 'idle', text: 'Ketersediaan belum dapat diperiksa', ok: true };
    if (free === null) return { cls: 'idle', text: 'Memeriksa ketersediaan…', ok: true };
    if (free === 0) return { cls: 'full', text: 'Penuh pada tanggal ini', ok: false };
    if (free < n) return { cls: 'full', text: `Hanya ${free} unit tersisa (butuh ${n})`, ok: false };
    return { cls: free < o.f.units ? 'few' : 'ok', text: `Tersedia ${free} dari ${o.f.units} unit`, ok: true };
  };
  function recommend() {
    const ok = options().filter(o => status(o).ok);
    ok.sort((a, b) => need(a.f) - need(b.f) || a.f.seats - b.f.seats);
    return ok[0] ? ok[0].f.id : '';
  }

  /* ---- ketersediaan (dari server) ---- */
  function scheduleAvailability() {
    clearTimeout(avTimer);
    const d = date(); if (!d) { av = null; avKey = ''; return; }
    const key = `${d}|${days()}`;
    if (key === avKey && av) return;
    avTimer = setTimeout(async () => {
      avKey = key; av = null; renderAll();
      try { const r = await LP.availability(d, LP.addDays(d, days() - 1)); if (avKey === key) { av = r; } }
      catch (err) { if (avKey === key) av = { error: err.message }; }
      if (avKey === key) renderAll();
    }, 250);
  }

  /* ---- tampilan ---- */
  function renderPicker() {
    const opts = options();
    const rec = recommend();
    $('#fleetPick').innerHTML = opts.map(o => {
      const s = status(o), n = need(o.f), disabled = !s.ok;
      const priceCol = pkg()
        ? (o.unit > 0 ? `${rupiah(o.unit)}<small>per bus, bus termasuk</small>` : 'Hubungi kami<small>harga ditawarkan admin</small>')
        : (o.unit > 0 ? `${rupiah(o.unit)}<small>per bus · ${days()} hari</small>` : 'Hubungi kami<small>harga ditawarkan admin</small>');
      return `<label class="fp-card${disabled ? ' disabled' : ''}"><input type="radio" name="fleet" value="${esc(o.f.id)}" ${pickedFleet === o.f.id ? 'checked' : ''} ${disabled ? 'disabled' : ''}>${o.f.image ? `<img src="${esc(o.f.image)}" alt="" loading="lazy">` : '<span class="ph"></span>'}<span><strong>${esc(o.f.name)}</strong><span class="sub">${esc(o.f.seats)} kursi · ${n > 1 ? `butuh ${n} unit untuk ${guests()} peserta` : `muat ${guests()} peserta dalam 1 unit`}${rec === o.f.id ? ' · <b style="color:#176a48">Disarankan</b>' : ''}</span><span class="avail ${s.cls}">${s.cls === 'ok' ? '✓' : s.cls === 'full' ? '✕' : s.cls === 'few' ? '!' : '•'} ${esc(s.text)}</span></span><span class="p">${priceCol}</span></label>`;
    }).join('') || '<div class="alert warn" style="grid-column:1/-1">Belum ada armada untuk pilihan ini.</div>';
  }

  function estimate() {
    const o = options().find(x => x.f.id === pickedFleet) || null;
    const count = intIn($('#fleetCount').value, 1, 20, 1);
    return { o, f: o && o.f, count, total: o && o.unit > 0 ? o.unit * count : 0, d: days(), g: guests() };
  }

  function renderSummary() {
    const p = pkg(), { f, count, total, d, g } = estimate();
    $('#pkgHint').textContent = p ? `${p.destinations || ''}${p.destinations ? ' · ' : ''}Lama ${p.duration || `${p.days} hari`}. Bus dan pengemudi sudah termasuk; harga mengikuti armada yang Anda pilih.` : 'Pilih paket yang sudah termasuk bus, atau biarkan kosong untuk menyewa armada saja (tarif per hari).';
    $('#daysField').hidden = !!p; $('#daysFixed').hidden = !p;
    if (p) $('#daysFixedText').textContent = `${p.days} hari (mengikuti paket)`;
    const rows = [['Layanan', p ? p.name : 'Sewa armada saja'], ['Armada', f ? `${count} × ${f.name}` : '—'], ['Berangkat', date() ? rangeText(date(), d) : '—'], ['Lama', `${d} hari`], ['Peserta', `${g} orang`]];
    $('#sumList').innerHTML = rows.map(([k, v]) => `<div class="row"><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');
    $('#sumTotal').textContent = !f ? '—' : total > 0 ? rupiah(total) : 'Menunggu penawaran';
    const notes = [];
    if (f && g > f.seats * count) notes.push(`<div class="alert warn">Peserta (${g}) melebihi kapasitas ${count} × ${esc(f.name)} (${f.seats * count} kursi). Tambah jumlah armada menjadi <b>${Math.ceil(g / f.seats)}</b> atau pilih armada lebih besar.</div>`);
    if (f && date() && av && !av.error) {
      const free = LP.minFree(av, f.id, date(), d);
      if (free !== null && free < count) notes.push(`<div class="alert err">${free === 0 ? `${esc(f.name)} penuh` : `${esc(f.name)} hanya tersisa ${free} unit`} pada ${esc(rangeText(date(), d))}. Pilih tanggal lain lewat kalender, atau kurangi jumlah armada.</div>`);
      else if (free !== null) notes.push(`<div class="alert ok">${count} unit ${esc(f.name)} tersedia pada ${esc(rangeText(date(), d))}.</div>`);
    }
    if (f && total > 0) notes.push('<div class="alert info">Harga final dikonfirmasi admin. Setelah memesan, Anda bisa membayar DP atau lunas lewat transfer bank / QRIS.</div>');
    else if (f) notes.push('<div class="alert info">Harga untuk pilihan ini disusun oleh tim kami berdasarkan rute dan tanggal. Anda akan dihubungi lewat WhatsApp, lalu pembayaran dibuka di halaman Lacak setelah harga ditetapkan.</div>');
    $('#sumNote').innerHTML = notes.join('');
    $('#countHint').textContent = f ? `Otomatis menyesuaikan peserta (${f.seats} kursi/unit). Bisa diubah.` : '';
  }

  function renderAll() {
    // armada terpilih yang jadi tidak tersedia / tidak ada di pilihan -> pilih ulang
    const opts = options();
    const cur = opts.find(o => o.f.id === pickedFleet);
    if (!cur || !status(cur).ok) { pickedFleet = ''; pickedByUser = false; }
    if (!pickedFleet) pickedFleet = recommend();
    const f = fleets.find(x => x.id === pickedFleet);
    if (f && !countByUser) $('#fleetCount').value = Math.min(20, need(f));
    renderPicker(); renderSummary();
    const sb = $('#submitBtn');
    const est = estimate(), conflict = est.f && date() && av && !av.error && (LP.minFree(av, est.f.id, date(), est.d) ?? Infinity) < est.count;
    sb.disabled = Boolean(conflict);
  }

  /* ---- interaksi ---- */
  $('#package').addEventListener('change', () => { pickedFleet = ''; pickedByUser = false; countByUser = false; avKey = ''; renderAll(); scheduleAvailability(); });
  for (const id of ['date', 'days']) $('#' + id).addEventListener('input', () => { avKey = ''; renderAll(); scheduleAvailability(); });
  $('#guests').addEventListener('input', () => { if (!pickedByUser) pickedFleet = ''; renderAll(); });
  $('#fleetCount').addEventListener('input', () => { countByUser = true; renderAll(); });
  $('#fleetPick').addEventListener('change', e => {
    if (e.target.name !== 'fleet') return;
    pickedFleet = e.target.value; pickedByUser = true;
    const f = fleets.find(x => x.id === pickedFleet);
    if (f && !countByUser) $('#fleetCount').value = Math.min(20, need(f));
    renderSummary(); renderAll();
    const r = $('#fleetPick input:checked'); if (r) r.focus();
  });

  $('#openCal').addEventListener('click', () => {
    const f = fleets.find(x => x.id === pickedFleet) || (options()[0] && options()[0].f);
    if (!f) return;
    $('#calTitle').textContent = f.name;
    const host = $('#calHost'); host.innerHTML = '';
    const inner = document.createElement('div'); host.appendChild(inner);
    LP.calendar(inner, {
      fleetId: f.id, month: (date() || LP.todayWib()).slice(0, 7),
      getSelection: () => date() ? { date: date(), days: days() } : null,
      onPick: d => { $('#date').value = d; LP.closeModal('calModal'); avKey = ''; renderAll(); scheduleAvailability(); LP.toast(`Tanggal berangkat: ${fmtDate(d)}`); }
    });
    LP.openModal('calModal');
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('#submitBtn'), alertBox = $('#formAlert'); alertBox.innerHTML = '';
    const { f, count, total, d, g } = estimate(), p = pkg();
    const fail = msg => { alertBox.innerHTML = `<div class="alert err">${esc(msg)}</div>`; };
    if (!f) return fail('Pilih armada terlebih dahulu.');
    if (!date()) return fail('Pilih tanggal berangkat.');
    if (g > f.seats * count) return fail(`Peserta (${g}) melebihi kapasitas ${count} × ${f.name}. Tambah jumlah armada.`);
    if (!$('#name').value.trim() || !$('#phone').value.trim() || !$('#destination').value.trim()) return fail('Lengkapi nama, nomor WhatsApp, dan titik penjemputan.');
    const payload = { packageId: p ? p.id : '', fleetId: f.id, fleetCount: count, date: date(), days: d, guests: g, destination: $('#destination').value.trim(), customerName: $('#name').value.trim(), customerPhone: $('#phone').value.trim(), customerEmail: $('#email').value.trim(), notes: $('#notes').value.trim(), website: $('#website').value };
    btn.disabled = true; btn.textContent = 'Mengirim permintaan…';
    try {
      const res = await LP.api('/api/bookings', { method: 'POST', body: JSON.stringify(payload) });
      const b = res.booking, digits = payload.customerPhone.replace(/\D/g, '');
      try { const c = JSON.stringify({ code: b.id, phone: digits.slice(-4) }); localStorage.setItem('lp_track', c); sessionStorage.setItem('lp_prefill', c); } catch { /* abaikan */ }
      const msg = `Halo Lautan Pasir, saya baru membuat pemesanan.\nKode: ${b.id}\nNama: ${payload.customerName}\nPaket/armada: ${b.package} · ${count} × ${b.fleet}\nTanggal: ${rangeText(b.date, b.days)}\nPeserta: ${g}\nTitik penjemputan: ${payload.destination}`;
      form.hidden = true;
      const box = $('#successBox'); box.hidden = false;
      box.innerHTML = `<div class="success-box"><div class="tick">✓</div><h2>Permintaan terkirim!</h2><p class="lead">Armada ${esc(b.fleet)} ditahan untuk ${esc(rangeText(b.date, b.days))}. Simpan kode pemesanan Anda untuk membayar dan melacak perjalanan.</p><div class="code-pill">${esc(b.id)}</div><p class="hint">Untuk membukanya Anda memerlukan kode ini dan 4 digit terakhir nomor WhatsApp (${esc(digits.slice(-4))}).</p>
      ${b.deadlines ? `<div class="alert warn" style="text-align:left"><b>Batas pembayaran</b><br>DP paling lambat <b>${esc(LP.fmtDate(b.deadlines.dpBy))}</b> (3 hari sebelum berangkat); jika tidak, pemesanan dibatalkan.<br>Pelunasan paling lambat <b>${esc(LP.fmtDate(b.deadlines.fullBy))} pukul 23.59 WIB</b> (1 × 24 jam sebelum berangkat); jika tidak, pemesanan dibatalkan dan DP hangus.</div>` : ''}<div class="alert ${total > 0 ? 'info' : 'warn'}" style="text-align:left">${total > 0 ? `Estimasi total <b>${rupiah(b.price)}</b>. Anda bisa langsung membayar DP atau lunas di halaman Lacak &amp; Bayar.` : 'Tim kami sedang menyiapkan penawaran harga dan akan menghubungi Anda lewat WhatsApp. Opsi pembayaran muncul di halaman Lacak setelah harga ditetapkan.'}</div>
      <div class="success-actions"><a class="btn" href="/lacak">${total > 0 ? 'Lacak &amp; Bayar →' : 'Lacak Pesanan →'}</a><a class="btn line" target="_blank" rel="noopener noreferrer" href="${esc(LP.waLink(LP.settings, msg))}">Kirim ke WhatsApp</a></div></div>`;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      fail(err.message);
      if (err.status === 409) { avKey = ''; scheduleAvailability(); }
    } finally { btn.textContent = 'Kirim Permintaan Pemesanan →'; renderAll(); }
  });

  renderAll(); scheduleAvailability();
})();
