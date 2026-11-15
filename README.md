# 📦 Inventory — Catatan Barang Pribadi

Web app buat mencatat semua barang yang lo punya: **nama, qty, nilai (Rp), tempat nyimpan, kondisi, tanggal beli, foto, dan timestamp** — lengkap dengan dashboard total nilai inventaris, pencarian/filter, export CSV, dan backup JSON.

Data tersimpan di **Firebase** (akun Google lo): login via **Google Sign-In**, data di **Firestore**, foto di **Firebase Storage**. Bisa dibuka dari HP maupun laptop.

## ✨ Fitur

- **Login Google** — privat per akun, tiap user cuma bisa akses datanya sendiri
- **CRUD barang** — nama, deskripsi, kategori, lokasi, qty + satuan, nilai satuan (Rp), kondisi, tanggal beli, catatan
- **Foto barang** — multi-foto (maks 10), otomatis dikompres, pilih foto utama, galeri + lightbox
- **Timestamp otomatis** — kapan barang dibuat & terakhir diubah
- **Dashboard** — total jenis barang, total qty, total nilai (Rp), rekap nilai per lokasi & per kategori, barang terbaru & termahal
- **Pencarian & filter** — cari nama/deskripsi/catatan, filter kategori & lokasi, sortir (terbaru, nama, nilai, qty)
- **Kategori & lokasi** — kelola bebas, rename/hapus otomatis menyesuaikan item
- **Export CSV** — ramah Excel (UTF-8 BOM)
- **Backup JSON** — seluruh data + foto (base64), bisa di-restore lewat Import
- **Data contoh** — tombol sekali-klik buat isi 8 item demo
- **Responsive** — nyaman di HP & desktop, dark mode otomatis

## 🚀 Cara Menjalankan

```bash
npm install
npm start
# buka http://localhost:3000
```

> Server-nya hanya static file server — semua data & auth ditangani Firebase dari sisi browser.

## 🔥 Setup Firebase Console (WAJIB, sekali saja)

App ini memakai Firebase project **`dimonitor-1c806`** (config ada di `public/firebase-config.js`). Supaya jalan, lakukan 3 langkah ini di [Firebase Console](https://console.firebase.google.com):

### 1. Aktifkan Google Sign-In
**Authentication → Sign-in method → Google → Enable → Save**

### 2. Daftarkan domain preview / domain lo
**Authentication → Settings → Authorized domains → Add domain**
- Kalau jalan lokal: `localhost` sudah terdaftar otomatis
- Kalau dibuka lewat preview Arena: tambahkan domain-nya persis seperti di address bar (format `xxxx-xxxxx.e2b.app`)

> ⚠️ Tanpa ini, login akan gagal dengan error `auth/unauthorized-domain`.

### 3. Buat Firestore + Storage Rules
**Firestore Database → Create database** (mode apa pun boleh), lalu paste rules ini di tab **Rules**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

**Storage → Get started**, lalu paste rules ini di tab **Rules**:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /users/{uid}/{allPaths=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

Rules ini memastikan tiap user **hanya bisa baca/tulis data miliknya sendiri** (`users/{uid}/...`).

## 🗂 Struktur Data

```
users/{uid}/
├── items/{itemId}        → name, category, location, qty, unit, value,
│                           condition, purchaseDate, notes,
│                           photoURLs[], primaryPhotoIndex,
│                           createdAt, updatedAt
├── categories/{id}       → name, createdAt
└── locations/{id}        → name, description, createdAt

Storage: users/{uid}/photos/{file}   → foto barang (sudah dikompres client-side)
```

- `category` & `location` disimpan sebagai **nama string** (hapus/rename kategori otomatis menyesuaikan item lewat batch write)
- `value` = nilai per satuan dalam Rupiah; **total nilai = qty × value**
- Timestamp disimpan sebagai Firestore Timestamp (ditampilkan dalam waktu lokal)

## 💾 Backup & Restore

| Aksi | Cara |
|---|---|
| Export CSV | Pengaturan → **Export CSV** (langsung download) |
| Backup lengkap | Pengaturan → **Backup JSON** (data + foto base64) |
| Restore / pindah device | Pengaturan → **Import JSON** (data digabung, tidak menimpa) |

## 🧱 Struktur Proyek

```
├── server/index.js        # static server (Express)
└── public/
    ├── index.html         # shell SPA
    ├── app.js             # semua view & logika (vanilla JS, ES module)
    ├── firebase.js        # layer Firebase: Auth, Firestore, Storage
    ├── firebase-config.js # config Firebase project
    ├── style.css          # design system (light + dark auto)
    └── assets/            # ilustrasi & foto data contoh
```

## 🔑 Catatan Keamanan

- `apiKey` pada config web Firebase **bersifat public by design** — bukan rahasia. Keamanan data diatur oleh:
  1. **Google Sign-In** (hanya user login yang bisa pakai app)
  2. **Security Rules** di atas (user hanya bisa akses `users/{uid}/...` miliknya)
- Jangan pernah menaruh service account key / private key di repo ini
