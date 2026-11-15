/* ============================================================
   Inventory — SPA vanilla JS + Firebase (Auth Google, Firestore, Storage)
   Views: SignIn, Dashboard, Barang (list/detail/form), Pengaturan
   ============================================================ */
'use strict';

import {
  watchAuth, googleSignIn, logout as fbLogout, friendlyError,
  fetchAll, createItem, updateItem, deleteItem,
  uploadItemPhotos, removePhotoFiles,
  addCategory, addLocation, renameCategory, renameLocation, deleteCategory, deleteLocation,
  photoToBase64, importBackup, loadSampleData,
} from './firebase.js';

// ---------------- utils ----------------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const fmtIDR = (n) => new Intl.NumberFormat('id-ID', {
  style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
}).format(Number(n) || 0);

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—'
    : d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—'
    : d.toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function relTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'baru saja';
  if (m < 60) return `${m} menit lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} hari lalu`;
  return fmtDate(iso);
}

const CONDITION_LABELS = {
  baru: 'Baru', bekas_baik: 'Bekas (baik)', rusak_ringan: 'Rusak ringan', rusak: 'Rusak',
};
const CONDITION_CHIP = {
  baru: 'chip-ok', bekas_baik: 'chip-primary', rusak_ringan: 'chip-accent', rusak: 'chip-danger',
};

function primaryPhotoUrl(it) {
  return it.photoURLs?.[it.primaryPhotoIndex] || it.photoURLs?.[0] || null;
}

const ICONS = {
  box: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7l9-4 9 4v10l-9 4-9-4V7z" stroke-linejoin="round"/><path d="M3 7l9 4 9-4M12 11v10" stroke-linejoin="round"/></svg>`,
  camera: `<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="12" cy="13.5" r="3.5"/><path d="M8 7l1.5-2.5h5L16 7"/></svg>`,
  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5" stroke-linecap="round"/></svg>`,
  google: `<svg viewBox="0 0 48 48" width="20" height="20"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`,
};

// ---------------- toast & modal ----------------
function toast(message, type = 'ok') {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 3600);
  setTimeout(() => el.remove(), 4000);
}

function openModal(html, { lightbox = false } = {}) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-overlay ${lightbox ? 'lightbox' : ''}"><div class="modal">${html}</div></div>`;
  const overlay = $('.modal-overlay', root);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  return root;
}
function closeModal() { $('#modal-root').innerHTML = ''; }

function confirmModal({ title, message, confirmText = 'Hapus', cancelText = 'Batal', danger = true }) {
  return new Promise((resolve) => {
    openModal(`
      <h3>${esc(title)}</h3><p>${esc(message)}</p>
      <div class="modal-actions">
        <button class="btn btn-outline" id="m-cancel">${esc(cancelText)}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="m-ok">${esc(confirmText)}</button>
      </div>`);
    $('#m-cancel').onclick = () => { closeModal(); resolve(false); };
    $('#m-ok').onclick = () => { closeModal(); resolve(true); };
  });
}

function inputModal({ title, label, value = '', placeholder = '' }) {
  return new Promise((resolve) => {
    openModal(`
      <h3>${esc(title)}</h3>
      <div class="field"><label>${esc(label)}</label>
        <input class="input" id="m-input" value="${esc(value)}" placeholder="${esc(placeholder)}" /></div>
      <div class="modal-actions">
        <button class="btn btn-outline" id="m-cancel">Batal</button>
        <button class="btn btn-primary" id="m-ok">Simpan</button>
      </div>`);
    const input = $('#m-input');
    input.focus(); input.select();
    const done = (v) => { closeModal(); resolve(v); };
    $('#m-cancel').onclick = () => done(null);
    $('#m-ok').onclick = () => done(input.value.trim() || null);
    input.onkeydown = (e) => { if (e.key === 'Enter') done(input.value.trim() || null); };
  });
}

function lightbox(src) {
  openModal(`<img src="${esc(src)}" alt="Foto barang" />`, { lightbox: true });
  $('.modal-overlay').addEventListener('click', closeModal);
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ---------------- state ----------------
const state = {
  user: null,
  items: [],
  categories: [],
  locations: [],
};

async function refreshMeta() {
  const data = await fetchAll();
  state.items = data.items;
  state.categories = data.categories;
  state.locations = data.locations;
}

// ---------------- router ----------------
function navigate(hash) { location.hash = hash; }

function setTopbar(visible) {
  $('#topbar').hidden = !visible;
  if (visible && state.user) {
    $('#user-chip').textContent = state.user.displayName || state.user.email || 'Akun';
  }
  $$('#mainnav a').forEach((a) => a.classList.remove('active'));
  const key = (location.hash || '').split('/')[1];
  const nav = $(`#mainnav a[data-nav="${key}"]`);
  if (nav) nav.classList.add('active');
}

async function router() {
  const hash = location.hash || '#/dashboard';
  const parts = hash.replace(/^#\//, '').split('/');

  if (!state.user) { setTopbar(false); return viewSignIn(); }
  setTopbar(true);

  try {
    switch (parts[0]) {
      case 'items':
        if (parts[1] === 'new') return viewItemForm(null);
        if (parts[1] && parts[2] === 'edit') return viewItemForm(parts[1]);
        if (parts[1]) return viewItemDetail(parts[1]);
        return viewItems();
      case 'settings': return viewSettings();
      case 'dashboard':
      default: return viewDashboard();
    }
  } catch (e) {
    toast(friendlyError(e), 'error');
  }
}

// ---------------- sign-in ----------------
function viewSignIn() {
  $('#app').innerHTML = `
  <div class="auth-screen">
    <div class="card auth-card">
      <div class="auth-brand">
        <svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2" fill="currentColor" opacity=".9"/><path d="M3 9l9-5 9 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 13h6" stroke="var(--bg-card)" stroke-width="2" stroke-linecap="round"/></svg>
        <span>Inventory</span>
      </div>
      <h2 style="margin:0 0 4px;font-size:20px">Catatan barang pribadi</h2>
      <p class="auth-sub">Nilai, qty, lokasi penyimpanan, foto, dan timestamp — semua tersimpan aman di akun Google lo.</p>
      <button class="btn btn-google" id="google-btn">${ICONS.google}<span>Masuk dengan Google</span></button>
      <div id="auth-msg" class="hint" style="margin-top:14px;text-align:center"></div>
    </div>
  </div>`;

  $('#google-btn').addEventListener('click', async () => {
    const btn = $('#google-btn');
    const msg = $('#auth-msg');
    btn.disabled = true;
    msg.textContent = 'Membuka Google Sign-In...';
    try {
      await googleSignIn();
      // onAuthStateChanged akan me-render ulang otomatis
    } catch (e) {
      msg.textContent = friendlyError(e);
      msg.style.color = 'var(--danger)';
      btn.disabled = false;
    }
  });
}

// ---------------- dashboard ----------------
function computeStats() {
  const items = state.items;
  const group = (key, fallback) => {
    const map = new Map();
    for (const it of items) {
      const name = it[key] || fallback;
      const cur = map.get(name) || { name, item_count: 0, total_value: 0 };
      cur.item_count += 1;
      cur.total_value += it.total_value;
      map.set(name, cur);
    }
    return [...map.values()].sort((a, b) => b.total_value - a.total_value);
  };
  return {
    totals: {
      item_count: items.length,
      total_qty: items.reduce((s, i) => s + (i.qty || 0), 0),
      total_value: items.reduce((s, i) => s + i.total_value, 0),
      photo_count: items.reduce((s, i) => s + (i.photoURLs?.length || 0), 0),
    },
    byCategory: group('category', 'Tanpa Kategori'),
    byLocation: group('location', 'Tanpa Lokasi'),
    recent: [...items].sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)).slice(0, 6),
    topValue: [...items].sort((a, b) => b.total_value - a.total_value).slice(0, 5),
  };
}

async function viewDashboard() {
  const s = computeStats();
  const maxCat = Math.max(...s.byCategory.map((c) => c.total_value), 1);
  const maxLoc = Math.max(...s.byLocation.map((l) => l.total_value), 1);

  const bars = (rows, max, alt = false) => rows.length ? rows.map((r) => `
    <div class="bar-row">
      <div class="bar-head"><b>${esc(r.name)}</b>
        <span>${fmtIDR(r.total_value)} · ${r.item_count} item</span></div>
      <div class="bar-track"><div class="bar-fill ${alt ? 'alt' : ''}"
        style="width:${Math.max(3, Math.round((r.total_value / max) * 100))}%"></div></div>
    </div>`).join('') : `<p class="page-sub">Belum ada data.</p>`;

  const miniItems = (rows) => rows.map((r) => {
    const photo = primaryPhotoUrl(r);
    return `
    <div class="mini-row" data-id="${r.id}">
      <div class="mini-thumb">${photo
        ? `<img src="${esc(photo)}" alt="" loading="lazy" />`
        : ICONS.box}</div>
      <div class="mini-info">
        <div class="mini-name">${esc(r.name)}</div>
        <div class="mini-sub">${r.qty} ${esc(r.unit)} · ${r.total_value ? fmtIDR(r.total_value) : '—'}</div>
      </div>
    </div>`;
  }).join('');

  $('#app').innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Halo, ${esc(state.user.displayName || state.user.email || 'bro')} 👋</h1>
        <p class="page-sub">Ringkasan inventaris barang lo — ${new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
      </div>
      <a class="btn btn-primary" href="#/items/new">+ Tambah Barang</a>
    </div>

    ${s.totals.item_count === 0 ? `
    <div class="card card-pad empty">
      <img src="/assets/empty-state.png" alt="" onerror="this.style.display='none'" />
      <h3>Mulai dari mana dulu nih?</h3>
      <p>Isi data contoh dulu buat lihat gimana app-nya jalan, atau langsung tambah barang pertama lo.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
        <button class="btn btn-outline" id="seed-btn">✨ Muat Data Contoh</button>
        <a class="btn btn-primary" href="#/items/new">+ Tambah Barang</a>
      </div>
    </div>` : ''}

    <div class="grid grid-4">
      <div class="card stat">
        <div class="stat-icon">${ICONS.box}</div>
        <div class="stat-label">Jenis Barang</div>
        <div class="stat-value">${s.totals.item_count}</div>
        <div class="stat-hint">item tercatat</div>
      </div>
      <div class="card stat">
        <div class="stat-icon">📦</div>
        <div class="stat-label">Total Qty</div>
        <div class="stat-value">${s.totals.total_qty}</div>
        <div class="stat-hint">keseluruhan satuan</div>
      </div>
      <div class="card stat">
        <div class="stat-icon">💰</div>
        <div class="stat-label">Total Nilai</div>
        <div class="stat-value" style="color:var(--primary-strong)">${fmtIDR(s.totals.total_value)}</div>
        <div class="stat-hint">estimasi nilai inventaris</div>
      </div>
      <div class="card stat">
        <div class="stat-icon">📷</div>
        <div class="stat-label">Foto Tersimpan</div>
        <div class="stat-value">${s.totals.photo_count}</div>
        <div class="stat-hint">foto barang</div>
      </div>
    </div>

    <div class="grid grid-2 section-gap">
      <div class="card card-pad">
        <h3 class="card-title">Nilai per Lokasi 📍</h3>
        ${bars(s.byLocation, maxLoc)}
      </div>
      <div class="card card-pad">
        <h3 class="card-title">Nilai per Kategori 🏷️</h3>
        ${bars(s.byCategory, maxCat, true)}
      </div>
    </div>

    <div class="grid grid-2 section-gap">
      <div class="card card-pad">
        <h3 class="card-title">Barang Terbaru Diubah</h3>
        <div class="mini-list">${s.recent.length ? miniItems(s.recent) : '<p class="page-sub">Belum ada barang.</p>'}</div>
      </div>
      <div class="card card-pad">
        <h3 class="card-title">Nilai Tertinggi</h3>
        <div class="mini-list">${s.topValue.length ? miniItems(s.topValue) : '<p class="page-sub">Belum ada barang.</p>'}</div>
      </div>
    </div>`;

  $('#seed-btn')?.addEventListener('click', async () => {
    if (!await confirmModal({
      title: 'Muat data contoh?', danger: false, confirmText: 'Muat',
      message: '8 item contoh + kategori & lokasi akan ditambahkan ke akun lo. Bisa dihapus kapan aja.',
    })) return;
    try {
      toast('Memuat data contoh...');
      await loadSampleData();
      await refreshMeta();
      toast('Data contoh dimuat!');
      viewDashboard();
    } catch (e) { toast(friendlyError(e), 'error'); }
  });

  $$('.mini-row').forEach((row) => row.addEventListener('click', () => navigate(`#/items/${row.dataset.id}`)));
}

// ---------------- items list ----------------
const itemsState = { q: '', category: '', location: '', sort: 'updated_desc', page: 1, limit: 24 };

async function viewItems() {
  let list = [...state.items];
  const f = itemsState;
  if (f.q) {
    const q = f.q.toLowerCase();
    list = list.filter((it) =>
      it.name.toLowerCase().includes(q) ||
      (it.description || '').toLowerCase().includes(q) ||
      (it.notes || '').toLowerCase().includes(q));
  }
  if (f.category) list = list.filter((it) => it.category === f.category);
  if (f.location) list = list.filter((it) => it.location === f.location);

  const sorters = {
    updated_desc: (a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0),
    created_desc: (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
    name_asc: (a, b) => a.name.localeCompare(b.name, 'id'),
    value_desc: (a, b) => b.total_value - a.total_value,
    qty_desc: (a, b) => b.qty - a.qty,
  };
  list.sort(sorters[f.sort] || sorters.updated_desc);

  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / f.limit));
  if (f.page > pages) f.page = pages;
  const pageItems = list.slice((f.page - 1) * f.limit, f.page * f.limit);

  const cards = pageItems.map((it) => {
    const photo = primaryPhotoUrl(it);
    return `
    <div class="card item-card" data-id="${it.id}">
      <div class="item-thumb">${photo
        ? `<img src="${esc(photo)}" alt="${esc(it.name)}" loading="lazy" />`
        : `<div class="placeholder">${ICONS.camera}</div>`}</div>
      <div class="item-body">
        <h3 class="item-name">${esc(it.name)}</h3>
        <div class="item-meta">
          ${it.category ? `<span class="chip chip-primary">${esc(it.category)}</span>` : ''}
          ${it.location ? `<span class="chip">📍 ${esc(it.location)}</span>` : ''}
        </div>
        <div class="item-foot">
          <span class="item-value">${fmtIDR(it.total_value)}</span>
          <span class="item-qty">Qty ${it.qty} ${esc(it.unit)}</span>
        </div>
      </div>
    </div>`;
  }).join('');

  $('#app').innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Barang</h1>
        <p class="page-sub">${total} item${f.q || f.category || f.location ? ` (dari ${state.items.length} total)` : ' tercatat di inventaris lo'}</p>
      </div>
      <a class="btn btn-primary" href="#/items/new">+ Tambah Barang</a>
    </div>

    <div class="toolbar">
      <div class="search-wrap">${ICONS.search}
        <input class="input" id="f-q" placeholder="Cari nama / deskripsi / catatan..." value="${esc(f.q)}" />
      </div>
      <select class="input select-sm" id="f-cat">
        <option value="">Semua Kategori</option>
        ${state.categories.map((c) => `<option value="${esc(c.name)}" ${c.name === f.category ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select>
      <select class="input select-sm" id="f-loc">
        <option value="">Semua Lokasi</option>
        ${state.locations.map((l) => `<option value="${esc(l.name)}" ${l.name === f.location ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}
      </select>
      <select class="input select-sm" id="f-sort">
        <option value="updated_desc" ${f.sort === 'updated_desc' ? 'selected' : ''}>Terbaru diubah</option>
        <option value="created_desc" ${f.sort === 'created_desc' ? 'selected' : ''}>Terbaru ditambah</option>
        <option value="name_asc" ${f.sort === 'name_asc' ? 'selected' : ''}>Nama A–Z</option>
        <option value="value_desc" ${f.sort === 'value_desc' ? 'selected' : ''}>Nilai tertinggi</option>
        <option value="qty_desc" ${f.sort === 'qty_desc' ? 'selected' : ''}>Qty terbanyak</option>
      </select>
    </div>

    ${total ? `<div class="items-grid">${cards}</div>` : `
      <div class="empty">
        <img src="/assets/empty-state.png" alt="" onerror="this.style.display='none'" />
        <h3>${f.q || f.category || f.location ? 'Tidak ada yang cocok' : 'Belum ada barang'}</h3>
        <p>${f.q || f.category || f.location ? 'Coba ubah kata kunci atau filternya.' : 'Mulai catat barang pertama lo: nama, qty, nilai, lokasi, dan fotonya.'}</p>
        ${f.q || f.category || f.location
          ? '<button class="btn btn-outline" id="clear-filter">Reset filter</button>'
          : '<a class="btn btn-primary" href="#/items/new">+ Tambah Barang</a>'}
      </div>`}

    ${pages > 1 ? `
      <div class="pagination">
        <button class="btn btn-outline btn-sm" id="pg-prev" ${f.page <= 1 ? 'disabled' : ''}>‹ Sebelumnya</button>
        <span>Halaman ${f.page} dari ${pages}</span>
        <button class="btn btn-outline btn-sm" id="pg-next" ${f.page >= pages ? 'disabled' : ''}>Berikutnya ›</button>
      </div>` : ''}`;

  let debounce;
  $('#f-q').addEventListener('input', (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      itemsState.q = e.target.value;
      itemsState.page = 1;
      itemsState.focusSearch = true;
      viewItems();
    }, 320);
  });
  $('#f-cat').addEventListener('change', (e) => { itemsState.category = e.target.value; itemsState.page = 1; viewItems(); });
  $('#f-loc').addEventListener('change', (e) => { itemsState.location = e.target.value; itemsState.page = 1; viewItems(); });
  $('#f-sort').addEventListener('change', (e) => { itemsState.sort = e.target.value; viewItems(); });
  $('#clear-filter')?.addEventListener('click', () => {
    Object.assign(itemsState, { q: '', category: '', location: '', page: 1 });
    viewItems();
  });
  $('#pg-prev')?.addEventListener('click', () => { itemsState.page -= 1; viewItems(); });
  $('#pg-next')?.addEventListener('click', () => { itemsState.page += 1; viewItems(); });
  $$('.item-card').forEach((c) => c.addEventListener('click', () => navigate(`#/items/${c.dataset.id}`)));

  // pertahankan fokus di kolom search setelah re-render
  if (itemsState.focusSearch) {
    itemsState.focusSearch = false;
    const input = $('#f-q');
    input?.focus();
    const v = input?.value || '';
    input?.setSelectionRange(v.length, v.length);
  }
}

// ---------------- item detail ----------------
async function viewItemDetail(id) {
  const it = state.items.find((x) => x.id === id);
  if (!it) { toast('Barang tidak ditemukan.', 'error'); return navigate('#/items'); }
  const photo = primaryPhotoUrl(it);
  const photos = it.photoURLs || [];

  $('#app').innerHTML = `
    <div class="page-head">
      <div>
        <a href="#/items" class="page-sub">← Kembali ke daftar barang</a>
        <h1 class="page-title" style="margin-top:6px">${esc(it.name)}</h1>
        <div class="item-meta" style="margin-top:8px">
          ${it.category ? `<span class="chip chip-primary">${esc(it.category)}</span>` : ''}
          ${it.location ? `<span class="chip">📍 ${esc(it.location)}</span>` : ''}
          <span class="chip ${CONDITION_CHIP[it.condition] || ''}">${CONDITION_LABELS[it.condition] || esc(it.condition)}</span>
        </div>
      </div>
      <div style="display:flex;gap:10px">
        <a class="btn btn-primary" href="#/items/${it.id}/edit">✏️ Edit</a>
        <button class="btn btn-danger" id="del-btn">🗑️ Hapus</button>
      </div>
    </div>

    <div class="detail-grid">
      <div>
        ${photo ? `
          <div class="gallery-main" id="g-main"><img id="g-img" src="${esc(photo)}" alt="${esc(it.name)}" /></div>
          ${photos.length > 1 ? `<div class="gallery-thumbs">${photos.map((p) => `
            <button class="g-thumb ${p === photo ? 'selected' : ''}" data-src="${esc(p)}">
              <img src="${esc(p)}" alt="" loading="lazy" />
            </button>`).join('')}</div>` : ''}`
        : `<div class="gallery-main"><div style="text-align:center;color:var(--text-faint)">
            ${ICONS.camera}<div style="margin-top:8px;font-size:13px">Belum ada foto</div></div></div>`}
        ${it.description ? `<div class="card card-pad section-gap"><h3 class="card-title">Deskripsi</h3><p style="margin:0;white-space:pre-wrap">${esc(it.description)}</p></div>` : ''}
        ${it.notes ? `<div class="card card-pad section-gap"><h3 class="card-title">Catatan</h3><p style="margin:0;white-space:pre-wrap">${esc(it.notes)}</p></div>` : ''}
      </div>
      <div>
        <div class="card card-pad">
          <h3 class="card-title">Detail</h3>
          <dl class="kv">
            <dt>Qty</dt><dd>${it.qty} ${esc(it.unit)}</dd>
            <dt>Nilai satuan</dt><dd>${fmtIDR(it.value)}</dd>
            <dt>Total nilai</dt><dd style="color:var(--primary-strong);font-weight:800">${fmtIDR(it.total_value)}</dd>
            <dt>Kondisi</dt><dd>${CONDITION_LABELS[it.condition] || esc(it.condition)}</dd>
            <dt>Tanggal beli</dt><dd>${fmtDate(it.purchaseDate)}</dd>
            <dt>Kategori</dt><dd>${esc(it.category || '—')}</dd>
            <dt>Lokasi</dt><dd>${esc(it.location || '—')}</dd>
            <dt>Dibuat</dt><dd>${fmtDateTime(it.createdAt)}</dd>
            <dt>Diubah</dt><dd>${fmtDateTime(it.updatedAt)}</dd>
          </dl>
        </div>
      </div>
    </div>`;

  $('#g-main')?.addEventListener('click', () => lightbox($('#g-img').src));
  $$('.g-thumb').forEach((t) => t.addEventListener('click', () => {
    $('#g-img').src = t.dataset.src;
    $$('.g-thumb').forEach((x) => x.classList.remove('selected'));
    t.classList.add('selected');
  }));

  $('#del-btn').addEventListener('click', async () => {
    if (!await confirmModal({ title: 'Hapus barang?', message: `"${it.name}" akan dihapus permanen beserta fotonya.` })) return;
    try {
      await deleteItem(it.id);
      await refreshMeta();
      toast('Barang dihapus.');
      navigate('#/items');
    } catch (e) { toast(friendlyError(e), 'error'); }
  });
}

// ---------------- item form (new / edit) ----------------
async function processFile(file) {
  try {
    if (file.type === 'image/gif') return file;
    const bitmap = await createImageBitmap(file);
    const max = 1280;
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.82));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }) : file;
  } catch {
    return file;
  }
}

function galleryHtml(photos, primaryUrl, name) {
  if (!photos.length) {
    return `<div class="gallery-main"><div style="text-align:center;color:var(--text-faint)">
      ${ICONS.camera}<div style="margin-top:8px;font-size:13px">Belum ada foto</div></div></div>`;
  }
  return `
    <div class="gallery-main" id="g-main"><img id="g-img" src="${esc(primaryUrl)}" alt="${esc(name)}" /></div>
    ${photos.length > 1 ? `<div class="gallery-thumbs">${photos.map((p) => `
      <button class="g-thumb ${p === primaryUrl ? 'selected' : ''}" data-src="${esc(p)}">
        <img src="${esc(p)}" alt="" loading="lazy" />
      </button>`).join('')}</div>` : ''}`;
}

async function viewItemForm(id) {
  const editing = !!id;
  const it = editing ? state.items.find((x) => x.id === id) : null;
  if (editing && !it) { toast('Barang tidak ditemukan.', 'error'); return navigate('#/items'); }

  // draft foto: { key, file?, url?, src, isPrimary } — semua perubahan foto di-commit saat save
  const draft = (it?.photoURLs || []).map((url, i) => ({
    key: `p${i}`, url, src: url, isPrimary: i === (it.primaryPhotoIndex ?? 0),
  }));

  const catOptions = (sel) => `<option value="">— Tanpa kategori —</option>` +
    state.categories.map((c) => `<option value="${esc(c.name)}" ${c.name === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const locOptions = (sel) => `<option value="">— Tanpa lokasi —</option>` +
    state.locations.map((l) => `<option value="${esc(l.name)}" ${l.name === sel ? 'selected' : ''}>${esc(l.name)}</option>`).join('');

  $('#app').innerHTML = `
    <div class="page-head">
      <div>
        <a href="${editing ? `#/items/${id}` : '#/items'}" class="page-sub">← Batal</a>
        <h1 class="page-title" style="margin-top:6px">${editing ? 'Edit Barang' : 'Tambah Barang'}</h1>
        <p class="page-sub">${editing ? 'Perbarui data barang lo.' : 'Catat barang baru: identitas, qty, nilai, lokasi, dan foto.'}</p>
      </div>
    </div>

    <form id="item-form" class="card card-pad">
      <div class="form-row">
        <div class="field"><label>Nama barang *</label>
          <input class="input" name="name" required maxlength="140" value="${esc(it?.name || '')}" placeholder="mis. Laptop ASUS VivoBook" /></div>
        <div class="field"><label>Kondisi</label>
          <select class="input" name="condition">
            ${Object.entries(CONDITION_LABELS).map(([v, l]) =>
              `<option value="${v}" ${(it?.condition || 'baik') === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select></div>
      </div>

      <div class="form-row">
        <div class="field"><label>Kategori</label>
          <div style="display:flex;gap:8px">
            <select class="input" name="category" id="sel-cat">${catOptions(it?.category)}</select>
            <button type="button" class="btn btn-outline btn-sm" id="add-cat" title="Kategori baru">+</button>
          </div></div>
        <div class="field"><label>Lokasi penyimpanan</label>
          <div style="display:flex;gap:8px">
            <select class="input" name="location" id="sel-loc">${locOptions(it?.location)}</select>
            <button type="button" class="btn btn-outline btn-sm" id="add-loc" title="Lokasi baru">+</button>
          </div></div>
      </div>

      <div class="form-row-3">
        <div class="field"><label>Qty</label>
          <input class="input" name="qty" type="number" min="0" step="any" value="${it?.qty ?? 1}" /></div>
        <div class="field"><label>Satuan</label>
          <input class="input" name="unit" maxlength="20" value="${esc(it?.unit || 'pcs')}" placeholder="pcs / unit / set" /></div>
        <div class="field"><label>Nilai satuan (Rp)</label>
          <input class="input" name="value" id="value-input" inputmode="numeric" value="${it ? String(Math.round(it.value)) : '0'}" placeholder="0" />
          <span class="hint">Total nilai: <b id="total-preview">${fmtIDR((it?.qty ?? 1) * (it?.value ?? 0))}</b></span></div>
      </div>

      <div class="form-row">
        <div class="field"><label>Tanggal beli</label>
          <input class="input" name="purchaseDate" type="date" value="${esc(it?.purchaseDate || '')}" /></div>
        <div class="field"><label>Deskripsi</label>
          <input class="input" name="description" maxlength="500" value="${esc(it?.description || '')}" placeholder="Spesifikasi, warna, merek..." /></div>
      </div>

      <div class="field"><label>Catatan</label>
        <textarea class="input" name="notes" maxlength="2000" placeholder="Garansi, kondisi, tips nyimpen...">${esc(it?.notes || '')}</textarea></div>

      <div class="field">
        <label>Foto barang</label>
        <div class="dropzone" id="dropzone">
          <div style="font-size:26px">📷</div>
          <div style="font-weight:650;margin-top:4px">Klik atau seret foto ke sini</div>
          <div class="hint">JPG/PNG/WEBP/GIF — otomatis dikompres, maks 10 foto</div>
          <input type="file" id="file-input" accept="image/*" multiple hidden />
        </div>
        <div class="photo-previews" id="photo-previews"></div>
      </div>

      <hr class="divider" />
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <a class="btn btn-outline" href="${editing ? `#/items/${id}` : '#/items'}">Batal</a>
        <button class="btn btn-primary btn-lg" type="submit" id="save-btn">${editing ? 'Simpan Perubahan' : 'Simpan Barang'}</button>
      </div>
    </form>`;

  function renderPreviews() {
    $('#photo-previews').innerHTML = draft.map((d, i) => `
      <div class="photo-preview" data-key="${d.key}">
        <img src="${esc(d.src)}" alt="" />
        ${d.isPrimary ? '<span class="pp-badge">★ Utama</span>' : ''}
        <div class="pp-actions">
          ${!d.isPrimary ? `<button type="button" class="pp-btn" data-act="primary" data-i="${i}">★</button>` : ''}
          <button type="button" class="pp-btn danger" data-act="remove" data-i="${i}">✕</button>
        </div>
      </div>`).join('');

    $$('#photo-previews .pp-btn').forEach((btn) => btn.addEventListener('click', () => {
      const i = Number(btn.dataset.i);
      const d = draft[i];
      if (btn.dataset.act === 'primary') {
        draft.forEach((x) => { x.isPrimary = false; });
        d.isPrimary = true;
      } else {
        if (d.file) URL.revokeObjectURL(d.src);
        draft.splice(i, 1);
      }
      renderPreviews();
    }));
  }
  renderPreviews();

  async function addFiles(fileList) {
    const room = 10 - draft.length;
    const files = [...fileList].slice(0, room);
    if (!files.length) return toast('Maksimal 10 foto per barang.', 'error');
    for (const raw of files) {
      if (!raw.type.startsWith('image/')) continue;
      const file = await processFile(raw);
      const src = URL.createObjectURL(file);
      draft.push({ key: `n${Date.now()}${Math.random()}`, file, src, isPrimary: draft.length === 0 });
    }
    renderPreviews();
  }
  $('#dropzone').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  $('#dropzone').addEventListener('dragover', (e) => { e.preventDefault(); $('#dropzone').classList.add('drag'); });
  $('#dropzone').addEventListener('dragleave', () => $('#dropzone').classList.remove('drag'));
  $('#dropzone').addEventListener('drop', (e) => {
    e.preventDefault(); $('#dropzone').classList.remove('drag');
    addFiles(e.dataTransfer.files);
  });

  const valueInput = $('#value-input');
  valueInput.addEventListener('input', () => {
    const digits = valueInput.value.replace(/\D/g, '');
    valueInput.value = digits ? Number(digits).toLocaleString('id-ID') : '';
    updateTotal();
  });
  function updateTotal() {
    const qty = Number($('input[name="qty"]').value) || 0;
    const val = Number(valueInput.value.replace(/\D/g, '')) || 0;
    $('#total-preview').textContent = fmtIDR(qty * val);
  }
  $('input[name="qty"]').addEventListener('input', updateTotal);
  if (it) valueInput.value = Number(it.value).toLocaleString('id-ID');

  $('#add-cat').addEventListener('click', async () => {
    const name = await inputModal({ title: 'Kategori baru', label: 'Nama kategori', placeholder: 'mis. Elektronik' });
    if (!name) return;
    try {
      const r = await addCategory(name);
      state.categories.push({ id: r.id, name });
      $('#sel-cat').insertAdjacentHTML('beforeend', `<option value="${esc(name)}" selected>${esc(name)}</option>`);
      $('#sel-cat').value = name;
      toast('Kategori ditambahkan.');
    } catch (e) { toast(friendlyError(e), 'error'); }
  });
  $('#add-loc').addEventListener('click', async () => {
    const name = await inputModal({ title: 'Lokasi baru', label: 'Nama lokasi', placeholder: 'mis. Lemari Kamar' });
    if (!name) return;
    try {
      const r = await addLocation(name);
      state.locations.push({ id: r.id, name });
      $('#sel-loc').insertAdjacentHTML('beforeend', `<option value="${esc(name)}" selected>${esc(name)}</option>`);
      $('#sel-loc').value = name;
      toast('Lokasi ditambahkan.');
    } catch (e) { toast(friendlyError(e), 'error'); }
  });

  $('#item-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      name: String(fd.get('name') || '').trim(),
      description: fd.get('description') || '',
      category: fd.get('category') || '',
      location: fd.get('location') || '',
      qty: Number(fd.get('qty') ?? 1),
      unit: fd.get('unit') || 'pcs',
      value: Number(String(fd.get('value')).replace(/\D/g, '')) || 0,
      condition: fd.get('condition'),
      purchaseDate: fd.get('purchaseDate') || null,
      notes: fd.get('notes') || '',
    };
    const saveBtn = $('#save-btn');
    saveBtn.disabled = true;
    try {
      const itemId = editing ? id : await createItem(payload);
      if (editing) await updateItem(id, payload);

      // ---- sinkron foto: upload baru, hapus yang dihapus, set foto utama ----
      const oldUrls = it?.photoURLs || [];
      const keptUrls = draft.filter((d) => d.url).map((d) => d.url);
      const deletedUrls = oldUrls.filter((u) => !keptUrls.includes(u));
      const newDrafts = draft.filter((d) => d.file);

      let uploadedUrls = [];
      if (newDrafts.length) {
        uploadedUrls = await uploadItemPhotos(itemId, newDrafts.map((d) => d.file));
      }
      const finalURLs = [];
      let primaryIndex = 0;
      let upIdx = 0;
      for (const d of draft) {
        const url = d.url || uploadedUrls[upIdx++];
        if (!url) continue;
        if (d.isPrimary) primaryIndex = finalURLs.length;
        finalURLs.push(url);
      }
      if (deletedUrls.length) await removePhotoFiles(deletedUrls);
      await updateItem(itemId, { photoURLs: finalURLs, primaryPhotoIndex: primaryIndex });

      await refreshMeta();
      toast(editing ? 'Perubahan tersimpan.' : 'Barang ditambahkan!');
      navigate(`#/items/${itemId}`);
    } catch (err) {
      toast(friendlyError(err), 'error');
      saveBtn.disabled = false;
    }
  });
}

// ---------------- settings ----------------
async function viewSettings() {
  const items = state.items;
  const catCount = (name) => items.filter((i) => i.category === name).length;
  const locCount = (name) => items.filter((i) => i.location === name).length;

  const catRows = state.categories.map((c) => `
    <div class="manage-row">
      <div class="grow">${esc(c.name)}</div>
      <span class="count">${catCount(c.name)} item</span>
      <button class="btn btn-ghost btn-sm" data-cat-edit="${esc(c.name)}">Ubah</button>
      <button class="btn btn-ghost btn-sm" style="color:var(--danger)" data-cat-del="${esc(c.name)}">Hapus</button>
    </div>`).join('');

  const locRows = state.locations.map((l) => `
    <div class="manage-row">
      <div class="grow">${esc(l.name)}${l.description ? `<div class="count">${esc(l.description)}</div>` : ''}</div>
      <span class="count">${locCount(l.name)} item</span>
      <button class="btn btn-ghost btn-sm" data-loc-edit="${esc(l.name)}">Ubah</button>
      <button class="btn btn-ghost btn-sm" style="color:var(--danger)" data-loc-del="${esc(l.name)}">Hapus</button>
    </div>`).join('');

  $('#app').innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Pengaturan</h1>
        <p class="page-sub">Kelola kategori, lokasi, backup data, dan akun.</p>
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card card-pad">
        <h3 class="card-title">Kategori 🏷️</h3>
        ${catRows || '<p class="page-sub">Belum ada kategori.</p>'}
        <hr class="divider" />
        <form id="add-cat-form" style="display:flex;gap:8px">
          <input class="input" name="name" placeholder="Kategori baru..." required />
          <button class="btn btn-primary" type="submit">Tambah</button>
        </form>
      </div>

      <div class="card card-pad">
        <h3 class="card-title">Lokasi Penyimpanan 📍</h3>
        ${locRows || '<p class="page-sub">Belum ada lokasi.</p>'}
        <hr class="divider" />
        <form id="add-loc-form" style="display:flex;gap:8px">
          <input class="input" name="name" placeholder="Lokasi baru..." required />
          <button class="btn btn-primary" type="submit">Tambah</button>
        </form>
      </div>
    </div>

    <div class="grid grid-2 section-gap">
      <div class="card card-pad">
        <h3 class="card-title">Backup & Transfer Data 💾</h3>
        <p class="page-sub" style="margin-top:0">Export rutin biar data aman. File JSON memuat semua data + foto (base64).</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
          <button class="btn btn-primary" id="export-csv">⬇️ Export CSV</button>
          <button class="btn btn-primary" id="export-json">⬇️ Backup JSON (lengkap)</button>
          <button class="btn btn-outline" id="import-btn">⬆️ Import JSON</button>
          <input type="file" id="import-file" accept="application/json,.json" hidden />
        </div>
        <hr class="divider" />
        <button class="btn btn-outline" id="seed-btn">✨ Muat Data Contoh</button>
      </div>

      <div class="card card-pad">
        <h3 class="card-title">Akun 🔐</h3>
        <p class="page-sub" style="margin-top:0">Login sebagai <b>${esc(state.user.displayName || state.user.email || '')}</b>${state.user.email ? ` · ${esc(state.user.email)}` : ''}</p>
        <p class="page-sub">Data tersimpan di project Firebase <b>dimonitor-1c806</b> dan hanya bisa diakses akun Google lo.</p>
        <hr class="divider" />
        <button class="btn btn-danger" id="logout-settings">Keluar dari akun</button>
      </div>
    </div>`;

  // kategori
  $('#add-cat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await addCategory(String(new FormData(e.target).get('name')).trim());
      await refreshMeta();
      toast('Kategori ditambahkan.');
      viewSettings();
    } catch (err) { toast(friendlyError(err), 'error'); }
  });
  $$('[data-cat-edit]').forEach((b) => b.addEventListener('click', async () => {
    const oldName = b.dataset.catEdit;
    const name = await inputModal({ title: 'Ubah kategori', label: 'Nama kategori', value: oldName });
    if (!name || name === oldName) return;
    try {
      await renameCategory(oldName, name, state.items);
      await refreshMeta();
      toast('Kategori diubah (item ikut ter-update).');
      viewSettings();
    } catch (err) { toast(friendlyError(err), 'error'); }
  }));
  $$('[data-cat-del]').forEach((b) => b.addEventListener('click', async () => {
    const name = b.dataset.catDel;
    if (!await confirmModal({ title: 'Hapus kategori?', message: `"${name}" akan dihapus. Barang di kategori ini jadi tanpa kategori.` })) return;
    try {
      await deleteCategory(name, state.items);
      await refreshMeta();
      toast('Kategori dihapus.');
      viewSettings();
    } catch (err) { toast(friendlyError(err), 'error'); }
  }));

  // lokasi
  $('#add-loc-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await addLocation(String(new FormData(e.target).get('name')).trim());
      await refreshMeta();
      toast('Lokasi ditambahkan.');
      viewSettings();
    } catch (err) { toast(friendlyError(err), 'error'); }
  });
  $$('[data-loc-edit]').forEach((b) => b.addEventListener('click', async () => {
    const oldName = b.dataset.locEdit;
    const name = await inputModal({ title: 'Ubah lokasi', label: 'Nama lokasi', value: oldName });
    if (!name || name === oldName) return;
    try {
      await renameLocation(oldName, name, state.items);
      await refreshMeta();
      toast('Lokasi diubah (item ikut ter-update).');
      viewSettings();
    } catch (err) { toast(friendlyError(err), 'error'); }
  }));
  $$('[data-loc-del]').forEach((b) => b.addEventListener('click', async () => {
    const name = b.dataset.locDel;
    if (!await confirmModal({ title: 'Hapus lokasi?', message: `"${name}" akan dihapus. Barang di lokasi ini jadi tanpa lokasi.` })) return;
    try {
      await deleteLocation(name, state.items);
      await refreshMeta();
      toast('Lokasi dihapus.');
      viewSettings();
    } catch (err) { toast(friendlyError(err), 'error'); }
  }));

  // export CSV
  $('#export-csv').addEventListener('click', () => {
    const header = ['ID', 'Nama', 'Kategori', 'Lokasi', 'Qty', 'Satuan', 'Nilai Satuan (Rp)',
      'Total Nilai (Rp)', 'Kondisi', 'Tanggal Beli', 'Deskripsi', 'Catatan', 'Jumlah Foto', 'Dibuat', 'Diubah'];
    const csvEscape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [header.map(csvEscape).join(',')];
    for (const r of state.items) {
      lines.push([
        r.id, r.name, r.category, r.location, r.qty, r.unit, r.value, r.total_value,
        r.condition, r.purchaseDate || '', r.description, r.notes,
        r.photoURLs?.length || 0, r.createdAt || '', r.updatedAt || '',
      ].map(csvEscape).join(','));
    }
    downloadFile('\uFEFF' + lines.join('\r\n'),
      `inventory-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8');
    toast('CSV di-download.');
  });

  // export JSON backup (dengan foto base64)
  $('#export-json').addEventListener('click', async () => {
    try {
      toast('Menyiapkan backup (termasuk foto)...');
      const items = [];
      for (const r of state.items) {
        const photos = [];
        for (const url of r.photoURLs || []) {
          try {
            photos.push({ filename: `foto-${photos.length + 1}.jpg`, is_primary: photos.length === r.primaryPhotoIndex, data: await photoToBase64(url) });
          } catch { /* foto gagal diambil, skip */ }
        }
        items.push({
          name: r.name, description: r.description, category: r.category, location: r.location,
          qty: r.qty, unit: r.unit, value: r.value, condition: r.condition,
          purchase_date: r.purchaseDate, notes: r.notes, photos,
          created_at: r.createdAt, updated_at: r.updatedAt,
        });
      }
      const backup = {
        app: 'inventory', version: 2, exported_at: new Date().toISOString(),
        categories: state.categories.map((c) => ({ name: c.name })),
        locations: state.locations.map((l) => ({ name: l.name, description: l.description || '' })),
        items,
      };
      downloadFile(JSON.stringify(backup, null, 2),
        `inventory-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
      toast('Backup JSON di-download.');
    } catch (e) {
      toast(friendlyError(e), 'error');
    }
  });

  // import JSON
  $('#import-btn').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!await confirmModal({
      title: 'Import backup?', danger: false, confirmText: 'Import',
      message: `Data dari "${file.name}" akan digabungkan dengan data yang ada. Lanjutkan?`,
    })) return;
    try {
      toast('Mengimport data...');
      const json = JSON.parse(await file.text());
      const r = await importBackup(json);
      await refreshMeta();
      toast(`Import berhasil: ${r.itemsImported} item, ${r.photosImported} foto.`);
      viewSettings();
    } catch (err) {
      toast(err instanceof SyntaxError ? 'File backup tidak valid.' : friendlyError(err), 'error');
    }
    e.target.value = '';
  });

  // seed
  $('#seed-btn').addEventListener('click', async () => {
    if (!await confirmModal({
      title: 'Muat data contoh?', danger: false, confirmText: 'Muat',
      message: '8 item contoh + kategori & lokasi akan ditambahkan ke akun lo. Bisa dihapus kapan aja.',
    })) return;
    try {
      toast('Memuat data contoh...');
      await loadSampleData();
      await refreshMeta();
      toast('Data contoh dimuat!');
      viewSettings();
    } catch (e) { toast(friendlyError(e), 'error'); }
  });

  $('#logout-settings').addEventListener('click', logout);
}

// ---------------- boot ----------------
async function logout() {
  try { await fbLogout(); } catch { /* abaikan */ }
  state.user = null;
  state.items = [];
  toast('Sudah keluar. Sampai jumpa!');
  navigate('#/login');
  router();
}

window.addEventListener('hashchange', router);

watchAuth(async (user) => {
  state.user = user;
  setTopbar(!!user);
  if (user) {
    try {
      await refreshMeta();
    } catch (e) {
      toast(friendlyError(e), 'error');
    }
  }
  router();
});
