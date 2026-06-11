# 🎙️ RunguAksara

> **Filosofi**: Dalam bahasa Jawa/Sanskerta, **"Rungu"** berarti *mendengar* atau *pendengaran*. Digabungkan dengan **"Aksara"** (*tulisan/huruf*), nama ini secara harfiah menggambarkan fungsi utama aplikasi: **mendengar lalu menulis** (*speech-to-text*).

**RunguAksara** adalah platform web modern berbasis kecerdasan buatan (AI) untuk perekaman suara, transkripsi real-time (*live speech-to-text*), serta penyusunan ringkasan dan notulensi rapat otomatis secara cerdas.

---

## ✨ Fitur Utama

- 🔴 **Transkripsi Real-time (Live Speech-to-Text)**: Mendokumentasikan pembicaraan rapat langsung dari mikrofon browser secara instan dan akurat.
- 📂 **Transkripsi Berkas Audio**: Unggah file rekaman rapat Anda (WAV, MP3, M4A, MP4) untuk diproses menjadi teks secara otomatis.
- 🧠 **Penyusunan Notulensi Cerdas (AI)**: Menghasilkan ringkasan rapat eksekutif, poin pembahasan utama, poin keputusan, dan daftar tindak lanjut (*action items*) secara instan.
- 👥 **Manajemen Peserta & Pembicara**: Pembagian dan pelabelan transkrip berdasarkan daftar hadir peserta rapat untuk hasil notulensi yang akurat.
- 📝 **Ekspor Dokumen Formal**: Unduh hasil notulensi rapat secara instan dalam format Microsoft Word (.docx) dengan gaya dokumen formal.
- 🛡️ **Keamanan Akses**: Proteksi autentikasi akun pengguna dan pembatasan akses data rapat yang ketat dan aman.

---

## 🛠️ Arsitektur Teknologi

- **Backend**: Node.js & Express.js
- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Penyimpanan**: Sistem basis data terintegrasi
- **Kecerdasan Buatan (AI)**: Integrasi model bahasa besar (LLM) untuk transkripsi dan analisis dokumen.

---

## 🚀 Instalasi & Konfigurasi Lokal

### 1. Prasyarat
Pastikan Anda sudah menginstal:
* [Node.js](https://nodejs.org/) (versi 18 ke atas)
* Server Basis Data (MySQL)

### 2. Kloning Repositori
```bash
git clone <URL_REPOSITORY_ANDA>
cd runguaksara
```

### 3. Instal Dependensi
```bash
npm install
```

### 4. Konfigurasi Lingkungan (`.env`)
Salin templat file `.env.example` ke `.env` baru:
```bash
cp .env.example .env
```
Buka file `.env` dan lengkapi konfigurasi API Keys serta koneksi basis data.

### 5. Kompilasi Aset
```bash
npm run build:css
```

---

## 💻 Cara Menjalankan

### Mode Pengembangan
```bash
npm run dev
```

### Mode Produksi
```bash
npm start
```

Aplikasi akan berjalan di `http://localhost:3000`. Buka alamat tersebut di browser Anda.

---

## 🔑 Akun Default Awal
Saat pertama kali dijalankan pada basis data kosong, sistem akan menyediakan pengguna bawaan:
* **Username**: `admin`
* **Password**: `adminrunguaksara`

---

## 📝 Lisensi
Proyek ini dilindungi di bawah hak cipta internal pengembangan aplikasi RunguAksara.
