/**
 * Layer Firebase — Auth (Google), Firestore (data), Storage (foto).
 * SDK modular v10 dari CDN resmi (gstatic), tanpa build step.
 *
 * Struktur data di Firestore (per user, privat):
 *   users/{uid}/items/{itemId}       — barang: name, category, location, qty, unit,
 *                                      value, condition, purchaseDate, notes,
 *                                      photoURLs[], primaryPhotoIndex,
 *                                      createdAt, updatedAt
 *   users/{uid}/categories/{id}      — { name, createdAt }
 *   users/{uid}/locations/{id}       — { name, description, createdAt }
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  onAuthStateChanged, signOut,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, collection, doc, getDocs, getDoc, addDoc, setDoc, updateDoc, deleteDoc,
  writeBatch, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {
  getStorage, ref, uploadBytes, getDownloadURL, deleteObject,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';
import { firebaseConfig } from './firebase-config.js';

export const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

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
  'auth/network-request-failed': 'Koneksi ke Firebase gagal. Cek internet lo.',
  'permission-denied': 'Akses ditolak — cek Firestore/Storage Security Rules di Firebase Console.',
  'storage/unauthorized': 'Akses Storage ditolak — cek Storage Security Rules di Firebase Console.',
};

export function friendlyError(err) {
  return FIREBASE_ERRORS[err?.code] || err?.message || 'Terjadi kesalahan.';
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
    photoURLs: Array.isArray(x.photoURLs) ? x.photoURLs : [],
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
  const [itemsSnap, catsSnap, locsSnap] = await Promise.all([
    getDocs(col('items')), getDocs(col('categories')), getDocs(col('locations')),
  ]);
  return {
    items: itemsSnap.docs.map(itemFromDoc),
    categories: listFromSnap(catsSnap),
    locations: listFromSnap(locsSnap),
  };
}

export async function createItem(data) {
  const payload = {
    ...data,
    photoURLs: [],
    primaryPhotoIndex: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const r = await addDoc(col('items'), payload);
  return r.id;
}

export async function updateItem(id, data) {
  await updateDoc(doc(db, 'users', requireUser().uid, 'items', id), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteItem(id) {
  const snap = await getDoc(doc(db, 'users', requireUser().uid, 'items', id));
  await deletePhotosByUrl(snap.data()?.photoURLs);
  await deleteDoc(doc(db, 'users', requireUser().uid, 'items', id));
}

// ---------------- storage: foto ----------------
async function deletePhotosByUrl(urls) {
  for (const url of urls || []) {
    try { await deleteObject(ref(storage, url)); } catch { /* file sudah hilang */ }
  }
}
export const removePhotoFiles = deletePhotosByUrl;

export async function uploadItemPhotos(itemId, files) {
  const itemDoc = doc(db, 'users', requireUser().uid, 'items', itemId);
  const urls = [];
  for (const file of files) {
    const ext = (file.name.match(/\.\w+$/) || ['.jpg'])[0].toLowerCase();
    const r = ref(storage, `users/${requireUser().uid}/photos/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    await uploadBytes(r, file, { contentType: file.type || 'image/jpeg' });
    urls.push(await getDownloadURL(r));
  }
  return urls;
}

export async function attachPhotos(item, newUrls, makePrimaryIdx = -1) {
  const photoURLs = [...(item.photoURLs || []), ...newUrls];
  let primaryPhotoIndex = item.primaryPhotoIndex ?? 0;
  if (makePrimaryIdx >= 0) primaryPhotoIndex = makePrimaryIdx;
  else if ((item.photoURLs || []).length === 0) primaryPhotoIndex = 0;
  await updateDoc(doc(db, 'users', requireUser().uid, 'items', item.id), {
    photoURLs,
    primaryPhotoIndex,
    updatedAt: serverTimestamp(),
  });
  return photoURLs;
}

export async function deleteItemPhoto(item, index) {
  const url = item.photoURLs[index];
  if (!url) return;
  try { await deleteObject(ref(storage, url)); } catch { /* abaikan */ }
  const photoURLs = item.photoURLs.filter((_, i) => i !== index);
  let primaryPhotoIndex = item.primaryPhotoIndex;
  if (index === item.primaryPhotoIndex) primaryPhotoIndex = 0;
  else if (index < item.primaryPhotoIndex) primaryPhotoIndex -= 1;
  await updateDoc(doc(db, 'users', requireUser().uid, 'items', item.id), {
    photoURLs, primaryPhotoIndex, updatedAt: serverTimestamp(),
  });
}

export async function setPrimaryPhoto(item, index) {
  await updateDoc(doc(db, 'users', requireUser().uid, 'items', item.id), {
    primaryPhotoIndex: index, updatedAt: serverTimestamp(),
  });
}

// ---------------- categories & locations ----------------
export async function addCategory(name) {
  return addDoc(col('categories'), { name, createdAt: serverTimestamp() });
}
export async function addLocation(name, description = '') {
  return addDoc(col('locations'), { name, description, createdAt: serverTimestamp() });
}

export async function renameCategory(oldName, newName, items) {
  const snap = await getDocs(col('categories'));
  const target = snap.docs.find((d) => d.data().name === oldName);
  const batch = writeBatch(db);
  if (target) batch.update(doc(db, 'users', requireUser().uid, 'categories', target.id), { name: newName });
  for (const it of items.filter((i) => i.category === oldName)) {
    batch.update(doc(db, 'users', requireUser().uid, 'items', it.id), { category: newName, updatedAt: serverTimestamp() });
  }
  await batch.commit();
}

export async function renameLocation(oldName, newName, items) {
  const snap = await getDocs(col('locations'));
  const target = snap.docs.find((d) => d.data().name === oldName);
  const batch = writeBatch(db);
  if (target) batch.update(doc(db, 'users', requireUser().uid, 'locations', target.id), { name: newName });
  for (const it of items.filter((i) => i.location === oldName)) {
    batch.update(doc(db, 'users', requireUser().uid, 'items', it.id), { location: newName, updatedAt: serverTimestamp() });
  }
  await batch.commit();
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
  await batch.commit();
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
  await batch.commit();
}

// ---------------- export / import ----------------
export async function photoToBase64(url) {
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).replace(/^data:[^,]+,/, ''));
    fr.readAsDataURL(blob);
  });
}

export function base64ToBlob(b64, type = 'image/jpeg') {
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type });
}

export async function importBackup(json) {
  // kompatibel dengan format export v1 (id-based) & v2 (name-based)
  const catById = new Map((json.categories || []).map((c) => [c.id, c.name]));
  const locById = new Map((json.locations || []).map((l) => [l.id, l.name]));
  const cats = new Set(), locs = new Set();
  let itemsImported = 0, photosImported = 0;

  for (const raw of json.items || []) {
    const category = raw.category || catById.get(raw.category_id) || '';
    const location = raw.location || locById.get(raw.location_id) || '';
    if (category) cats.add(category);
    if (location) locs.add(location);

    const itemId = await createItem({
      name: String(raw.name || '').trim(),
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

    const files = [];
    for (const p of raw.photos || []) {
      if (!p.data) continue;
      const b64 = String(p.data).replace(/^data:[^,]+,/, '');
      const name = p.filename || `foto-${files.length + 1}.jpg`;
      files.push(new File([base64ToBlob(b64)], name, { type: 'image/jpeg' }));
    }
    if (files.length) {
      const urls = await uploadItemPhotos(itemId, files);
      const primaryIdx = Math.max(0, (raw.photos || []).findIndex((p) => p.is_primary));
      await attachPhotos({ id: itemId, photoURLs: [], primaryPhotoIndex: 0 }, urls, primaryIdx);
      photosImported += urls.length;
    }
  }

  // pastikan kategori/lokasi unik ada di daftar kelola
  await ensureNames('categories', cats);
  await ensureNames('locations', locs);
  return { itemsImported, photosImported };
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

export async function loadSampleData() {
  for (const name of SAMPLE.categories) await addCategory(name);
  for (const [name, description] of SAMPLE.locations) await addLocation(name, description);

  for (const [name, description, category, location, qty, unit, value, condition, purchaseDate, notes, photo] of SAMPLE.items) {
    const itemId = await createItem({ name, description, category, location, qty, unit, value, condition, purchaseDate, notes });
    if (photo) {
      try {
        const res = await fetch(`/assets/seed/${photo}`);
        const file = new File([await res.blob()], photo, { type: 'image/jpeg' });
        const urls = await uploadItemPhotos(itemId, [file]);
        await attachPhotos({ id: itemId, photoURLs: [], primaryPhotoIndex: 0 }, urls);
      } catch { /* foto contoh opsional */ }
    }
  }
}
