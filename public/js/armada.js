(() => {
  'use strict';
  const { esc, rupiah, $, $$ } = LP;
  const grid = $('#grid');
  const q = new URLSearchParams(location.search);
  let fleet = [], av = null, avKey = '', timer = 0;
  const intIn = (v, min, max, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= min && n <= max ? n : d; };

  $('#rDate').min = LP.todayWib();
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.get('tanggal') || '') && q.get('tanggal') >= LP.todayWib()) $('#rDate').value = q.get('tanggal');
  $('#rDays').value = intIn(q.get('hari'), 1, 30, 1);
  if (q.get('peserta')) $('#rGuests').value = intIn(q.get('peserta'), 1, 500, '');

  const sel = () => ({ date: $('#rDate').value, days: intIn($('#rDays').value, 1, 30, 1), guests: intIn($('#rGuests').value, 1, 500, 0) });

  async function loadAvailability() {
    const { date, days } = sel();
    if (!date) { av = null; avKey = ''; return render(); }
    const key = `${date}|${days}`;
    avKey = key; av = null; render();
    try {
      const d = await LP.availability(date, LP.addDays(date, days - 1));
      if (avKey === key) { av = d; render(); }
    } catch (err) { if (avKey === key) { av = { error: err.message }; render(); } }
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(loadAvailability, 250); render(); };

  function cardHtml(f) {
    const { date, days, guests } = sel();
    const need = guests ? Math.ceil(guests / f.seats) : 1;
    const priced = f.pricePerDay > 0;
    let pill, canBook = true;
    if (!date) { pill = ['idle', 'Pilih tanggal untuk cek ketersediaan']; }
    else if (!av) { pill = ['idle', 'Memeriksa ketersediaan…']; }
    else if (av.error) { pill = ['idle', 'Ketersediaan belum dapat diperiksa']; }
    else {
      const free = LP.minFree(av, f.id, date, days);
      if (free === null) pill = ['idle', 'Memeriksa ketersediaan…'];
      else if (free === 0) { pill = ['full', 'Penuh pada tanggal ini']; canBook = false; }
      else if (free < need) { pill = ['full', `Hanya ${free} unit tersisa (butuh ${need})`]; canBook = false; }
      else pill = [free < f.units ? 'few' : 'ok', `Tersedia ${free} dari ${f.units} unit`];
    }
    const total = priced ? f.pricePerDay * days * need : 0;
    const sum = `<div class="rent-sum">${priced ? `${need} unit × ${days} hari × ${rupiah(f.pricePerDay)}<div class="tot"><span>Estimasi sewa</span><span>${rupiah(total)}</span></div>` : `<b>Harga ditawarkan admin</b> sesuai rute, tanggal, dan lama sewa.`}${guests ? `<div class="hint" style="margin-top:6px">${guests} peserta${need > 1 ? ` membutuhkan ${need} unit (${f.seats} kursi/unit)` : ` muat dalam 1 unit (${f.seats} kursi)`}.</div>` : ''}</div>`;
    const params = new URLSearchParams({ armada: f.id, hari: String(days) });
    if (date) params.set('tanggal', date);
    if (guests) { params.set('peserta', String(guests)); params.set('jumlah', String(need)); }
    return `<article class="card fleet-card"><div class="photo">${f.image ? `<img loading="lazy" src="${esc(f.image)}" alt="${esc(f.name)}">` : ''}</div><div class="card-body"><h3>${esc(f.name)}</h3><div class="meta">♙ ${esc(f.seats)} kursi · ${esc(f.units)} unit</div>${(f.features || []).length ? `<div class="features">${f.features.map(x => `<span class="feature">✓ ${esc(x)}</span>`).join('')}</div>` : ''}<div class="price" style="margin:2px 0 8px">${priced ? `${rupiah(f.pricePerDay)} <small>/ hari</small>` : 'Hubungi Kami <small>untuk harga</small>'}</div><div><span class="avail ${pill[0]}" role="status">${pill[0] === 'ok' ? '✓' : pill[0] === 'full' ? '✕' : pill[0] === 'few' ? '!' : '•'} ${esc(pill[1])}</span></div>${sum}<div class="card-actions"><button class="mini-btn line" type="button" data-cal="${esc(f.id)}">Lihat kalender</button>${canBook ? `<a class="mini-btn" href="/pesan?${params}">Sewa armada ini →</a>` : '<button class="mini-btn" type="button" disabled>Tidak tersedia</button>'}</div></div></article>`;
  }
  function render() {
    if (!fleet.length) return;
    grid.innerHTML = fleet.map(cardHtml).join('');
  }

  /* ---- kalender per armada ---- */
  grid.addEventListener('click', e => {
    const b = e.target.closest('[data-cal]'); if (!b) return;
    const f = fleet.find(x => x.id === b.dataset.cal); if (!f) return;
    $('#calTitle').textContent = f.name;
    const host = $('#calHost'); host.innerHTML = '';
    const inner = document.createElement('div'); host.appendChild(inner);
    LP.calendar(inner, {
      fleetId: f.id,
      month: (sel().date || LP.todayWib()).slice(0, 7),
      getSelection: () => { const s = sel(); return s.date ? { date: s.date, days: s.days } : null; },
      onPick: date => { $('#rDate').value = date; LP.closeModal('calModal'); loadAvailability(); LP.toast(`Tanggal berangkat: ${LP.fmtDate(date)}`); }
    });
    LP.openModal('calModal');
  });

  $('#rentBar').addEventListener('input', schedule);
  $('#rentBar').addEventListener('change', schedule);
  $('#rentBar').addEventListener('click', e => {
    const s = e.target.closest('[data-step]'); if (!s) return;
    $('#rDays').value = Math.min(30, Math.max(1, intIn($('#rDays').value, 1, 30, 1) + Number(s.dataset.step)));
    schedule();
  });
  $('#rentBar').addEventListener('submit', e => e.preventDefault());

  LP.api('/api/fleet').then(d => {
    fleet = d.fleet;
    if (!fleet.length) { grid.innerHTML = '<div class="empty"><strong>Armada belum tersedia</strong>Silakan hubungi kami untuk ketersediaan.</div>'; return; }
    render(); if (sel().date) loadAvailability();
  }).catch(err => { grid.innerHTML = `<div class="empty"><strong>Armada gagal dimuat</strong>${esc(err.message)}</div>`; });
})();
