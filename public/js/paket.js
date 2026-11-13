(() => {
  'use strict';
  const { esc, rupiah, $ } = LP;
  const grid = $('#grid');
  let packages = [], fleets = [];
  const fleetOf = id => fleets.find(f => f.id === id);

  function summary(p) {
    const opts = p.fleetOptions.map(o => ({ ...o, f: fleetOf(o.fleetId) })).filter(o => o.f);
    const priced = opts.filter(o => o.price > 0).map(o => o.price);
    const seats = opts.map(o => o.f.seats);
    return { opts, min: priced.length ? Math.min(...priced) : 0, seatText: seats.length ? (Math.min(...seats) === Math.max(...seats) ? `${seats[0]} kursi` : `${Math.min(...seats)}–${Math.max(...seats)} kursi`) : '' };
  }

  function render() {
    if (!packages.length) { grid.innerHTML = '<div class="empty"><strong>Paket belum tersedia</strong>Silakan hubungi kami untuk rencana perjalanan yang sesuai.<br><br><a class="btn" href="/pesan">Ajukan Sewa</a></div>'; return; }
    grid.innerHTML = packages.map(p => {
      const s = summary(p);
      const price = s.min > 0
        ? `<span class="price"><span class="from">Mulai dari</span>${rupiah(s.min)} <small>/ bus, sudah termasuk</small></span>`
        : '<span class="price">Hubungi Kami <small>untuk harga</small></span>';
      return `<article class="card" id="${esc(p.id)}"><div class="photo">${p.image ? `<img loading="lazy" src="${esc(p.image)}" alt="${esc(p.name)}">` : ''}${p.tag ? `<span class="tag">${esc(p.tag)}</span>` : ''}</div><div class="card-body"><h3>${esc(p.name)}</h3>${p.destinations ? `<div class="meta">⌖ ${esc(p.destinations)}</div>` : ''}<div class="meta">◷ Durasi ${esc(p.duration || `${p.days} Hari`)}</div><div class="meta">▰ Bus &amp; pengemudi termasuk${s.seatText ? ` · ${esc(s.seatText)}` : ''}</div><div class="card-bottom">${price}<div class="card-actions"><button class="mini-btn line" type="button" data-detail="${esc(p.id)}">Detail</button><a class="mini-btn" href="/pesan?paket=${encodeURIComponent(p.id)}">Pesan →</a></div></div></div></article>`;
    }).join('');
  }

  function openDetail(id) {
    const p = packages.find(x => x.id === id); if (!p) return;
    const s = summary(p);
    const list = (h, items) => items && items.length ? `<h3>${h}</h3><ul>${items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
    const fleetList = s.opts.length ? `<h3>Pilih armada sesuai jumlah peserta</h3><ul class="opt-list">${s.opts.map(o => `<li><span><b>${esc(o.f.name)}</b><br><small class="muted">${esc(o.f.seats)} kursi · ${o.price > 0 ? 'harga per bus, sudah termasuk' : 'harga ditawarkan admin'}</small></span><span class="pr">${o.price > 0 ? rupiah(o.price) : 'Hubungi kami'}</span></li>`).join('')}</ul><p class="hint" style="margin-top:8px">Peserta melebihi satu bus? Tambah jumlah bus saat memesan, harga dikalikan jumlah bus.</p>` : '';
    $('#detailTitle').textContent = p.name;
    $('#detailContent').innerHTML = `<p>Lama perjalanan <b>${esc(p.duration || `${p.days} hari`)}</b>. Armada dan pengemudi sudah termasuk dalam harga paket.</p>` + fleetList + list('Rencana perjalanan (contoh)', p.itinerary) + list('Termasuk', p.includes) + list('Ketentuan', p.terms);
    $('#detailBook').href = `/pesan?paket=${encodeURIComponent(p.id)}`;
    LP.openModal('detailModal');
  }

  grid.addEventListener('click', e => { const b = e.target.closest('[data-detail]'); if (b) { history.replaceState(null, '', `#${b.dataset.detail}`); openDetail(b.dataset.detail); } });
  Promise.all([LP.api('/api/packages'), LP.api('/api/fleet')]).then(([p, f]) => {
    packages = p.packages; fleets = f.fleet; render();
    if (location.hash.length > 1) openDetail(decodeURIComponent(location.hash.slice(1)));
  }).catch(err => { grid.innerHTML = `<div class="empty"><strong>Paket gagal dimuat</strong>${esc(err.message)}</div>`; });
})();
