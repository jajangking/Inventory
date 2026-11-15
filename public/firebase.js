/**
 * Layer Firebase — Auth (Google) + Firestore (data & foto).
 * SDK modular v10 dari CDN resmi (gstatic), tanpa build step.
 *
 * Kenapa foto di Firestore, bukan Cloud Storage?
 * → Sejak 3 Feb 2026 Cloud Storage wajib plan Blaze (berbayar). Foto disimpan
 *   sebagai base64 di dokumen Firestore (masih gratis di plan Spark).
 *
 * Struktur data di Firestore (per user, privat):
 *   users/{uid}/items/{itemId}       — barang: name, category, location, qty, unit,
 *                                      value, condition, purchaseDate, notes,
 *                                      photoRefs[], primaryPhotoIndex,
 *                                      createdAt, updatedAt
 *   users/{uid}/photos/{photoId}     — { itemId, data (dataURL base64), createdAt }
 *   users/{uid}/categories/{id}      — { name, createdAt }
 *   users/{uid}/locations/{id}       — { name, description, createdAt }
 *
 * Catatan: foto disimpan di dokumen terpisah (bukan di dokumen item) supaya
 * list barang tetap ringan; foto diambil on-demand + di-cache di browser.
 * Batas dokumen Firestore 1MB → foto dikompres client-side maks ~850KB base64.
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  onAuthStateChanged, signOut,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc,
  writeBatch, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

export const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Analytics opsional — gagal diam-diam kalau diblokir browser/adblock
try {
  const { getAnalytics } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-analytics.js');
  getAnalytics(app);
} catch { /* analytics tidak wajib */ }

// ---------------- helpers ----------------
export function ts(v) {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  return v;
}

function requireUser() {
  const u = auth.currentUser;
  if (!u) throw new Error('Belum login. Silakan masuk dengan Google dulu.');
  return u;
}

function col(name) {
  return collection(db, 'users', requireUser().uid, name);
}

const FIREBASE_ERRORS = {
  'auth/popup-blocked': 'Popup diblokir browser. Akan dicoba via redirect...',
  'auth/popup-closed-by-user': 'Login dibatalkan.',
  'auth/unauthorized-domain': 'Domain ini belum terdaftar di Firebase Console → Authentication → Authorized domains.',
  'auth/operation-not-allowed': 'Metode login Google belum diaktifkan di Firebase Console → Authentication → Sign-in method.',
  'auth/network-request-failed': 'Koneksi ke Firebase gagal. Cek internet kamu.',
  'permission-denied': 'Akses ditolak — cek Firestore Security Rules di Firebase Console.',
};

export function friendlyError(err) {
  if (err?.code === 'permission-denied') {
    return 'Akses ditolak — kemungkinan besar Firestore Security Rules belum disetup di Firebase Console (lihat langkah di README), atau kamu belum login.';
  }
  return FIREBASE_ERRORS[err?.code] || err?.message || 'Terjadi kesalahan.';
}

/** Balut promise dengan timeout supaya loading tidak menggantung selamanya */
export function withTimeout(promise, ms = 20000, message = 'Koneksi ke Firebase lambat atau terputus. Cek internet kamu, lalu coba lagi.') {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

/** Ambil hasil signInWithRedirect (jika ada) untuk menampilkan error login */
export async function checkRedirectResult() {
  try {
    await getRedirectResult(auth);
    return null;
  } catch (err) {
    return friendlyError(err);
  }
}

// ---------------- auth ----------------
export function watchAuth(cb) {
  return onAuthStateChanged(auth, cb);
}

export async function googleSignIn() {
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    if (err.code === 'auth/popup-blocked' || err.code === 'auth/cancelled-popup-request') {
      // popup ditolak → fallback redirect (ramah mobile)
      await signInWithRedirect(auth, provider);
      return;
    }
    if (err.code === 'auth/popup-closed-by-user') return;
    err.friendly = friendlyError(err);
    throw err;
  }
}

export async function logout() {
  return signOut(auth);
}

// ---------------- data: items ----------------
function itemFromDoc(d) {
  const x = d.data();
  return {
    id: d.id,
    name: x.name || '',
    description: x.description || '',
    category: x.category || '',
    location: x.location || '',
    qty: Number(x.qty ?? 1),
    unit: x.unit || 'pcs',
    value: Number(x.value ?? 0),
    condition: x.condition || 'baik',
    purchaseDate: x.purchaseDate || null,
    notes: x.notes || '',
    photoRefs: Array.isArray(x.photoRefs) ? x.photoRefs : [],
    primaryPhotoIndex: Number(x.primaryPhotoIndex ?? 0),
    createdAt: ts(x.createdAt),
    updatedAt: ts(x.updatedAt),
    total_value: Number(x.qty ?? 1) * Number(x.value ?? 0),
  };
}

function listFromSnap(snap) {
  return snap.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: ts(d.data().createdAt) }));
}

export async function fetchAll() {
  const [itemsSnap, catsSnap, locsSnap] = await withTimeout(Promise.all([
    getDocs(col('items')), getDocs(col('categories')), getDocs(col('locations')),
  ]));
  return {
    items: itemsSnap.docs.map(itemFromDoc),
    categories: listFromSnap(catsSnap),
    locations: listFromSnap(locsSnap),
  };
}

export async function createItem(data) {
  const payload = {
    ...data,
    photoRefs: [],
    primaryPhotoIndex: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const r = await withTimeout(addDoc(col('items'), payload));
  return r.id;
}

export async function updateItem(id, data) {
  await withTimeout(updateDoc(doc(db, 'users', requireUser().uid, 'items', id), {
    ...data,
    updatedAt: serverTimestamp(),
  }));
}

export async function deleteItem(id) {
  const snap = await withTimeout(getDoc(doc(db, 'users', requireUser().uid, 'items', id)));
  const refs = snap.data()?.photoRefs || [];
  if (refs.length) await deletePhotos(refs);
  await withTimeout(deleteDoc(doc(db, 'users', requireUser().uid, 'items', id)));
}

// ---------------- riwayat stok (stock movements) ----------------
/** Catat satu pergerakan stok (tanpa mengubah qty item) */
export async function logMovement({ itemId, itemName, type = 'set', delta = 0, qtyBefore = 0, qtyAfter = 0, reason = '', createdAt = null }) {
  return withTimeout(addDoc(col('stock_movements'), {
    itemId: itemId || '',
    itemName: itemName || '',
    type,
    delta: Number(delta),
    qtyBefore: Number(qtyBefore),
    qtyAfter: Number(qtyAfter),
    reason: String(reason || ''),
    createdAt: createdAt || serverTimestamp(),
  }));
}

/** Ubah qty item + catat riwayatnya secara otomatis. newQty di-clamp minimal 0. */
export async function adjustQty(item, newQty, { type = 'set', reason = '' } = {}) {
  const before = Number(item.qty ?? 0);
  const after = Math.max(0, Number(newQty ?? 0));
  await withTimeout(updateDoc(doc(db, 'users', requireUser().uid, 'items', item.id), {
    qty: after,
    updatedAt: serverTimestamp(),
  }));
  await logMovement({
    itemId: item.id, itemName: item.name,
    type, delta: after - before,
    qtyBefore: before, qtyAfter: after,
    reason,
  });
  return after;
}

// ---------------- foto (base64 di Firestore) ----------------
/** Simpan array dataURL sebagai dokumen foto → return array photoId */
export async function createPhotos(itemId, dataUrls) {
  const ids = [];
  for (const data of dataUrls) {
    const r = await withTimeout(addDoc(col('photos'), {
      itemId,
      data,
      createdAt: serverTimestamp(),
    }));
    ids.push(r.id);
  }
  return ids;
}

/** Ambil isi foto berdasarkan id → Map<photoId, dataURL> */
export async function getPhotos(photoIds) {
  const out = new Map();
  await withTimeout(Promise.all((photoIds || []).map(async (id) => {
    try {
      const snap = await getDoc(doc(db, 'users', requireUser().uid, 'photos', id));
      out.set(id, snap.data()?.data || null);
    } catch {
      out.set(id, null);
    }
  })));
  return out;
}

/** Hapus dokumen foto */
export async function deletePhotos(photoIds) {
  await Promise.all((photoIds || []).map(async (id) => {
    try { await withTimeout(deleteDoc(doc(db, 'users', requireUser().uid, 'photos', id))); } catch { /* abaikan */ }
  }));
}

// ---------------- categories & locations ----------------
export async function addCategory(name) {
  return withTimeout(addDoc(col('categories'), { name, createdAt: serverTimestamp() }));
}
export async function addLocation(name, description = '') {
  return withTimeout(addDoc(col('locations'), { name, description, createdAt: serverTimestamp() }));
}

export async function renameCategory(oldName, newName, items) {
  const snap = await getDocs(col('categories'));
  const target = snap.docs.find((d) => d.data().name === oldName);
  const batch = writeBatch(db);
  if (target) batch.update(doc(db, 'users', requireUser().uid, 'categories', target.id), { name: newName });
  for (const it of items.filter((i) => i.category === oldName)) {
    batch.update(doc(db, 'users', requireUser().uid, 'items', it.id), { category: newName, updatedAt: serverTimestamp() });
  }
  await withTimeout(batch.commit());
}

export async function renameLocation(oldName, newName, items) {
  const snap = await getDocs(col('locations'));
  const target = snap.docs.find((d) => d.data().name === oldName);
  const batch = writeBatch(db);
  if (target) batch.update(doc(db, 'users', requireUser().uid, 'locations', target.id), { name: newName });
  for (const it of items.filter((i) => i.location === oldName)) {
    batch.update(doc(db, 'users', requireUser().uid, 'items', it.id), { location: newName, updatedAt: serverTimestamp() });
  }
  await withTimeout(batch.commit());
}

export async function deleteCategory(name, items) {
  const snap = await getDocs(col('categories'));
  const batch = writeBatch(db);
  for (const d of snap.docs.filter((x) => x.data().name === name)) {
    batch.delete(doc(db, 'users', requireUser().uid, 'categories', d.id));
  }
  for (const it of items.filter((i) => i.category === name)) {
    batch.update(doc(db, 'users', requireUser().uid, 'items', it.id), { category: '', updatedAt: serverTimestamp() });
  }
  await withTimeout(batch.commit());
}

export async function deleteLocation(name, items) {
  const snap = await getDocs(col('locations'));
  const batch = writeBatch(db);
  for (const d of snap.docs.filter((x) => x.data().name === name)) {
    batch.delete(doc(db, 'users', requireUser().uid, 'locations', d.id));
  }
  for (const it of items.filter((i) => i.location === name)) {
    batch.update(doc(db, 'users', requireUser().uid, 'items', it.id), { location: '', updatedAt: serverTimestamp() });
  }
  await withTimeout(batch.commit());
}

// ---------------- import backup ----------------
export async function importBackup(json) {
  // kompatibel dengan format export v1 (id-based) & v2 (name-based)
  const catById = new Map((json.categories || []).map((c) => [c.id, c.name]));
  const locById = new Map((json.locations || []).map((l) => [l.id, l.name]));
  const cats = new Set(), locs = new Set();
  let itemsImported = 0, photosImported = 0, movesImported = 0;
  const idByName = new Map(); // itemName -> itemId baru (buat relink riwayat stok)

  for (const raw of json.items || []) {
    const category = raw.category || catById.get(raw.category_id) || '';
    const location = raw.location || locById.get(raw.location_id) || '';
    if (category) cats.add(category);
    if (location) locs.add(location);

    const itemName = String(raw.name || '').trim();
    const itemId = await createItem({
      name: itemName,
      description: raw.description || '',
      category,
      location,
      qty: Number(raw.qty ?? 1),
      unit: raw.unit || 'pcs',
      value: Number(raw.value ?? 0),
      condition: raw.condition || 'baik',
      purchaseDate: raw.purchase_date || raw.purchaseDate || null,
      notes: raw.notes || '',
    });
    itemsImported += 1;
    if (itemName && !idByName.has(itemName)) idByName.set(itemName, itemId);

    const dataUrls = (raw.photos || [])
      .filter((p) => p.data)
      .map((p) => String(p.data).startsWith('data:') ? String(p.data) : `data:image/jpeg;base64,${p.data}`);
    if (dataUrls.length) {
      const ids = await createPhotos(itemId, dataUrls);
      const primaryIdx = Math.max(0, (raw.photos || []).findIndex((p) => p.is_primary));
      await updateItem(itemId, { photoRefs: ids, primaryPhotoIndex: primaryIdx });
      photosImported += ids.length;
    }
  }

  // pastikan kategori/lokasi unik ada di daftar kelola
  await ensureNames('categories', cats);
  await ensureNames('locations', locs);

  // riwayat stok — relink ke item baru berdasarkan nama
  for (const m of json.stock_movements || []) {
    try {
      await logMovement({
        itemId: idByName.get(m.itemName) || '',
        itemName: m.itemName || '',
        type: m.type || 'set',
        delta: Number(m.delta ?? 0),
        qtyBefore: Number(m.qtyBefore ?? 0),
        qtyAfter: Number(m.qtyAfter ?? 0),
        reason: m.reason || '',
        createdAt: m.created_at || m.createdAt || null,
      });
      movesImported += 1;
    } catch { /* satu riwayat gagal tidak menggagalkan import */ }
  }

  return { itemsImported, photosImported, movesImported };
}

async function ensureNames(kind, names) {
  const snap = await getDocs(col(kind));
  const existing = new Set(snap.docs.map((d) => d.data().name));
  for (const name of names) {
    if (existing.has(name)) continue;
    if (kind === 'categories') await addCategory(name);
    else await addLocation(name);
    existing.add(name);
  }
}

// ---------------- data contoh (demo) ----------------
const SAMPLE = {
  categories: ['Elektronik', 'Perabot', 'Perkakas', 'Kendaraan & Aksesori', 'Dokumen & Berharga', 'Hobi & Olahraga', 'Pakaian'],
  locations: [
    ['Kamar Utama', 'Kamar tidur utama'],
    ['Ruang Tamu', 'Area ruang tamu & keluarga'],
    ['Dapur', 'Dapur & area makan'],
    ['Gudang', 'Gudang / penyimpanan belakang'],
    ['Lemari Kerja', 'Meja & lemari kerja'],
  ],
  items: [
    ['Laptop ASUS VivoBook 14', 'Laptop kerja harian, RAM 16GB SSD 512GB.', 'Elektronik', 'Lemari Kerja', 1, 'unit', 8500000, 'bekas_baik', '2024-03-12', 'Garansi toko sampai Maret 2025. Charger + tas included.', 'seed-laptop.jpg'],
    ['Helm Bogo Retro', 'Helm half-face gaya retro, warna hitam doff.', 'Kendaraan & Aksesori', 'Kamar Utama', 1, 'pcs', 450000, 'baik', '2024-07-01', 'Sudah bersegel SNI.', 'seed-helm.jpg'],
    ['Kursi Kerja Ergonomis', 'Kursi kerja dengan sandaran lumbar.', 'Perabot', 'Kamar Utama', 1, 'pcs', 1250000, 'baik', '2023-11-20', '', null],
    ['Kompor Gas 2 Tungku', 'Kompor gas stainless, api biru.', 'Perabot', 'Dapur', 1, 'pcs', 750000, 'baik', '2023-05-08', 'Regulator baru diganti.', null],
    ['Power Bank 20000mAh', 'Power bank fast charging, 2 unit.', 'Elektronik', 'Kamar Utama', 2, 'pcs', 350000, 'baik', '2024-01-15', 'Satu unit cadangan untuk traveling.', null],
    ['Set Kunci Inggris & Obeng', 'Set perkakas lengkap 24 pcs.', 'Perkakas', 'Gudang', 1, 'set', 180000, 'baik', '2022-09-30', 'Kotak kuning, taruh di rak paling atas.', null],
    ['Sepeda Lipat 20 inch', 'Sepeda lipat untuk olahraga pagi.', 'Hobi & Olahraga', 'Gudang', 1, 'unit', 2100000, 'rusak_ringan', '2023-02-14', 'Rantai perlu diservis.', null],
    ['Map Dokumen Penting', 'Sertifikat, KTP, akta, dan polis asuransi.', 'Dokumen & Berharga', 'Lemari Kerja', 1, 'map', 0, 'baik', null, 'Tidak ternilai — simpan di brankas laci bawah.', null],
  ],
};

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

export async function loadSampleData() {
  for (const name of SAMPLE.categories) await addCategory(name);
  for (const [name, description] of SAMPLE.locations) await addLocation(name, description);

  for (const [name, description, category, location, qty, unit, value, condition, purchaseDate, notes, photo] of SAMPLE.items) {
    const itemId = await createItem({ name, description, category, location, qty, unit, value, condition, purchaseDate, notes });
    if (photo) {
      try {
        const res = await fetch(`/assets/seed/${photo}`);
        const dataUrl = await blobToDataURL(await res.blob());
        const ids = await createPhotos(itemId, [dataUrl]);
        await updateItem(itemId, { photoRefs: ids, primaryPhotoIndex: 0 });
      } catch { /* foto contoh opsional */ }
    }
  }
}
