(async () => {
  'use strict';
  const { esc, rupiah, fmtDateTime, rangeText, $ } = LP;
  let creds = null, booking = null;
  const ui = { method: null, option: 'dp', proofData: '' };
  const settings = await LP.ready;
  const q = new URLSearchParams(location.search);

  function stored() {
    try {
      const pre = JSON.parse(sessionStorage.getItem('lp_prefill') || 'null'); sessionStorage.removeItem('lp_prefill');
      if (pre && pre.code && pre.phone) return pre;
      return JSON.parse(localStorage.getItem('lp_track') || 'null');
    } catch { return null; }
  }
  const remember = c => { try { localStorage.setItem('lp_track', JSON.stringify(c)); } catch { /* abaikan */ } };
  const forget = () => { try { localStorage.removeItem('lp_track'); } catch { /* abaikan */ } };

  async function fetchBooking() {
    const d = await LP.api(`/api/track?code=${encodeURIComponent(creds.code)}&phone=${encodeURIComponent(creds.phone)}`);
    booking = d.booking; remember(creds);
  }
  async function lookup(code, phone, { silent = false } = {}) {
    const alertBox = $('#lookupAlert'); alertBox.innerHTML = '';
    creds = { code: code.trim().toUpperCase(), phone: phone.replace(/\D/g, '').slice(-4) };
    const btn = $('#lookupBtn'); btn.disabled = true; btn.textContent = 'Mencari…';
    try { await fetchBooking(); render(); }
    catch (err) { booking = null; $('#result').innerHTML = ''; $('#lookupPanel').hidden = false; if (!silent) alertBox.innerHTML = `<div class="alert err">${esc(err.message)}</div>`; }
    finally { btn.disabled = false; btn.textContent = 'Lacak →'; }
  }
  $('#lookupForm').addEventListener('submit', e => { e.preventDefault(); lookup($('#code').value, $('#phone').value); });

  function stepper(b) {
    if (b.status === 'Dibatalkan') return '<div class="alert err">Pemesanan ini dibatalkan. Hubungi kami jika ada pertanyaan.</div>';
    const ps = b.paymentStatus, st = b.status;
    const stages = [
      { t: 'Diterima', done: true },
      { t: 'Pembayaran', done: ps === 'Lunas' || ps === 'DP', sub: ps === 'Lunas' ? 'Lunas' : ps === 'DP' ? 'DP diterima' : ps === 'Menunggu verifikasi' ? 'Diverifikasi' : '' },
      { t: 'Dikonfirmasi', done: ['Dikonfirmasi', 'Dalam Perjalanan', 'Selesai'].includes(st) },
      { t: 'Dalam Perjalanan', done: ['Dalam Perjalanan', 'Selesai'].includes(st) },
      { t: 'Selesai', done: st === 'Selesai' }
    ];
    const cur = stages.findIndex(s => !s.done);
    return `<ol class="stepper" aria-label="Tahapan pemesanan">${stages.map((s, i) => `<li class="${s.done ? 'done' : i === cur ? 'current' : ''}"${i === cur ? ' aria-current="step"' : ''}><div class="dot">${s.done ? '✓' : i + 1}</div>${esc(s.t)}<small>${esc(s.sub || (s.done ? 'Selesai' : i === cur ? 'Sedang berjalan' : ''))}</small></li>`).join('')}</ol>`;
  }

  const dpAmount = b => Math.min(b.balance, Math.ceil((b.price * (Number(settings.dpPercent) || 50)) / 100 / 1000) * 1000);
  const methodsAvailable = () => [
    ...((settings.banks || []).length ? ['transfer'] : []),
    ...(settings.qris && settings.qris.enabled && settings.qris.image ? ['qris'] : [])
  ];

  function paymentPanel(b) {
    if (b.status === 'Dibatalkan') return '';
    const pending = b.payments.some(p => p.status === 'Menunggu verifikasi');
    let body = '';
    if (!(b.price > 0)) {
      body = '<div class="alert warn">Harga untuk pemesanan ini sedang disiapkan oleh tim kami. Anda akan dihubungi lewat WhatsApp, dan opsi pembayaran muncul di sini setelah harga ditetapkan.</div>';
    } else if (b.balance <= 0) {
      body = '<div class="alert ok"><b>Pembayaran lunas.</b> Terima kasih! Tidak ada tagihan tersisa.</div>';
    } else if (pending) {
      body = '<div class="alert info">Bukti pembayaran Anda sudah kami terima dan <b>sedang diverifikasi</b>. Status akan diperbarui di halaman ini.</div>';
    } else {
      const methods = methodsAvailable();
      if (!methods.length) {
        body = `<div class="alert warn">Metode pembayaran online belum diatur oleh admin. Silakan hubungi kami lewat WhatsApp untuk instruksi pembayaran.</div><p class="mt"><a class="btn" target="_blank" rel="noopener noreferrer" href="${esc(LP.waLink(settings, `Halo Lautan Pasir, saya ingin membayar pemesanan ${b.id}.`))}">Hubungi via WhatsApp</a></p>`;
      } else {
        if (!methods.includes(ui.method)) ui.method = methods[0];
        const first = b.paid === 0;
        if (!first) ui.option = 'lunas';
        const amount = ui.option === 'dp' && first ? dpAmount(b) : b.balance;
        body = `<p class="lead">Sisa tagihan <b>${rupiah(b.balance)}</b> dari total ${rupiah(b.price)}.</p>`
          + (first ? `<div class="opt-cards" role="radiogroup" aria-label="Nominal pembayaran"><label class="opt-card"><input type="radio" name="option" value="dp" ${ui.option === 'dp' ? 'checked' : ''}><strong>Bayar DP ${esc(settings.dpPercent)}%</strong><span>${rupiah(dpAmount(b))}</span></label><label class="opt-card"><input type="radio" name="option" value="lunas" ${ui.option === 'lunas' ? 'checked' : ''}><strong>Bayar Lunas</strong><span>${rupiah(b.balance)}</span></label></div>` : '')
          + `<div class="amount-due"><span>Nominal yang harus dibayar</span><strong>${rupiah(amount)}</strong></div>`
          + (methods.length > 1 ? `<div class="pay-methods" role="group" aria-label="Metode pembayaran">${methods.map(m => `<button type="button" data-method="${m}" aria-pressed="${ui.method === m}">${m === 'transfer' ? 'Transfer Bank' : 'QRIS'}</button>`).join('')}</div>` : '')
          + (ui.method === 'transfer'
            ? `<h3>Transfer ke rekening berikut</h3>${settings.banks.map(k => `<div class="bank"><div><b>${esc(k.bank)}</b><div class="no">${esc(k.number)}</div><small>a.n. ${esc(k.holder)}</small></div><button class="mini-btn line" type="button" data-copy="${esc(k.number.replace(/[^\d]/g, ''))}">Salin</button></div>`).join('')}`
            : `<h3>Scan QRIS</h3><div class="qris-box"><img src="${esc(settings.qris.image)}" alt="Kode QRIS Lautan Pasir"><p class="hint">Scan dengan m-banking atau e-wallet, lalu masukkan nominal <b>${rupiah(amount)}</b>.</p></div>`)
          + (settings.paymentNote ? `<div class="alert info">${esc(settings.paymentNote)}</div>` : '')
          + `<form id="payForm" class="mt"><h3>Unggah bukti pembayaran</h3><div class="field"><label for="sender">Nama pengirim / pemilik rekening</label><input id="sender" class="inp" required maxlength="100" value="${esc(b.customerName)}"></div><div class="field mt"><label for="senderBank">${ui.method === 'transfer' ? 'Bank pengirim' : 'Aplikasi pembayaran'} (opsional)</label><input id="senderBank" class="inp" maxlength="60" placeholder="${ui.method === 'transfer' ? 'Contoh: BCA' : 'Contoh: GoPay, DANA, m-banking'}"></div><div class="field mt"><label for="proof">Foto / screenshot bukti</label><input id="proof" class="inp" type="file" accept="image/png,image/jpeg,image/webp" required><span class="hint">JPG, PNG, atau WebP. Ukuran diperkecil otomatis.</span><img id="proofPrev" class="proof-preview" alt="Pratinjau bukti pembayaran" hidden></div><div id="payAlert" role="alert"></div><button class="btn wide mt" id="payBtn" type="submit">Kirim Bukti Pembayaran →</button></form>`;
      }
    }
    const history = b.payments.length ? `<h3>Riwayat pembayaran</h3><ul class="pay-list">${b.payments.slice().reverse().map(p => `<li><span><b>${rupiah(p.amount)}</b> · ${esc(p.method === 'qris' ? 'QRIS' : p.method === 'transfer' ? 'Transfer' : p.method)} · ${esc(fmtDateTime(p.at))}${p.note ? `<br><small class="muted">${esc(p.note)}</small>` : ''}</span><span class="badge ${p.status === 'Terverifikasi' ? 'p-Lunas' : p.status === 'Ditolak' ? 'p-Dikembalikan' : 'p-Menunggu'}">${esc(p.status)}</span></li>`).join('')}</ul>` : '';
    return `<div class="panel"><h2>Pembayaran</h2>${body}${history}</div>`;
  }

  function render() {
    const b = booking;
    $('#lookupPanel').hidden = true;
    const wa = LP.waLink(settings, `Halo Lautan Pasir, saya ingin menanyakan pemesanan ${b.id}.`);
    $('#result').innerHTML = `<div class="panel"><div class="track-head"><div><div class="kicker">Kode pemesanan</div><div class="code">${esc(b.id)}</div><div class="badges mt">${LP.badgeStatus(b.status)} ${LP.badgePayment(b.paymentStatus)}</div></div><div class="head-actions"><button class="btn line sm" type="button" id="reloadBtn">Muat ulang</button><a class="btn line sm" target="_blank" rel="noopener noreferrer" href="${esc(wa)}">Tanya admin</a><button class="btn line sm" type="button" id="otherBtn">Cari pesanan lain</button></div></div>
      ${stepper(b)}
      <div class="kv"><div><small>Layanan</small><strong>${esc(b.package)}</strong></div><div><small>Armada</small><strong>${b.fleetCount > 1 ? `${esc(b.fleetCount)} × ` : ''}${esc(b.fleet)}</strong></div><div><small>Tanggal perjalanan</small><strong>${esc(rangeText(b.date, b.days))}</strong></div><div><small>Lama / peserta</small><strong>${esc(b.days)} hari · ${esc(b.guests)} orang</strong></div><div><small>Tujuan / penjemputan</small><strong>${esc(b.destination || '-')}</strong></div><div><small>Total</small><strong>${b.price > 0 ? rupiah(b.price) : 'Menunggu penawaran'}</strong></div>${b.price > 0 ? `<div><small>Sudah dibayar</small><strong>${rupiah(b.paid)}</strong></div><div><small>Sisa tagihan</small><strong>${rupiah(b.balance)}</strong></div>` : ''}</div></div>
      <div class="two-col">${paymentPanel(b) || '<div></div>'}<div class="panel"><h2>Perkembangan</h2><ul class="timeline">${b.timeline.slice().reverse().map(t => `<li><strong>${esc(t.label)}</strong>${t.note ? `<p>${esc(t.note)}</p>` : ''}<time datetime="${esc(t.at)}">${esc(fmtDateTime(t.at))}</time></li>`).join('')}</ul></div></div>`;
    $('#reloadBtn').addEventListener('click', async () => { try { await fetchBooking(); render(); LP.toast('Data diperbarui.'); } catch (err) { LP.toast(err.message); } });
    $('#otherBtn').addEventListener('click', () => { forget(); booking = null; creds = null; $('#result').innerHTML = ''; $('#lookupPanel').hidden = false; $('#code').focus(); });
    wirePayment();
  }

  function wirePayment() {
    for (const r of LP.$$('input[name=option]')) r.addEventListener('change', () => { ui.option = r.value; render(); });
    for (const m of LP.$$('[data-method]')) m.addEventListener('click', () => { ui.method = m.dataset.method; render(); });
    const file = $('#proof'); if (!file) return;
    file.addEventListener('change', async () => {
      const prev = $('#proofPrev'); ui.proofData = ''; prev.hidden = true;
      if (!file.files[0]) return;
      try { ui.proofData = await LP.fileToDataUrl(file.files[0], { maxDim: 1600, quality: 0.82 }); prev.src = ui.proofData; prev.hidden = false; }
      catch (err) { file.value = ''; $('#payAlert').innerHTML = `<div class="alert err">${esc(err.message)}</div>`; }
    });
    $('#payForm').addEventListener('submit', async e => {
      e.preventDefault();
      const alertBox = $('#payAlert'); alertBox.innerHTML = '';
      if (!ui.proofData) { alertBox.innerHTML = '<div class="alert err">Pilih foto bukti pembayaran terlebih dahulu.</div>'; return; }
      const btn = $('#payBtn'); btn.disabled = true; btn.textContent = 'Mengunggah…';
      try {
        const d = await LP.api('/api/track/payments', { method: 'POST', body: JSON.stringify({ code: creds.code, phone: creds.phone, method: ui.method, option: ui.option, senderName: $('#sender').value, bank: $('#senderBank').value, proof: ui.proofData }) });
        booking = d.booking; ui.proofData = ''; render(); LP.toast('Bukti pembayaran terkirim. Menunggu verifikasi admin.');
        window.scrollTo({ top: $('#result').offsetTop - 90, behavior: 'smooth' });
      } catch (err) { alertBox.innerHTML = `<div class="alert err">${esc(err.message)}</div>`; btn.disabled = false; btn.textContent = 'Kirim Bukti Pembayaran →'; }
    });
  }

  const start = stored();
  const queryCode = (q.get('code') || '').toUpperCase();
  if (queryCode) $('#code').value = queryCode;
  if (start && start.code && start.phone && (!queryCode || queryCode === start.code)) {
    $('#code').value = start.code; $('#phone').value = start.phone;
    lookup(start.code, start.phone, { silent: true });
  }
})();
