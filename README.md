# 🎙️ RunguAksara

> **Filosofi**: Dalam bahasa Jawa/Sanskerta, **"Rungu"** berarti *mendengar* atau *pendengaran*. Digabungkan dengan **"Aksara"** (*tulisan/huruf*), nama ini secara harfiah menggambarkan fungsi utama aplikasi: **mendengar lalu menulis** (*speech-to-text*).

**RunguAksara** adalah platform web modern berbasis kecerdasan buatan (AI) untuk perekaman, transkripsi real-time (*live speech-to-text*), dan penyusunan notulensi rapat otomatis secara cerdas. 

---

## ✨ Fitur Utama

- 🔴 **Live Streaming Transcription**: Transkripsi suara langsung dari mikrofon browser secara real-time menggunakan Gemini Live API WebSocket.
- 📂 **Audio File Upload**: Unggah file rekaman rapat Anda (WAV, MP3, M4A) dan transkripsikan menggunakan teknologi Whisper API (Groq, OpenAI, atau OpenRouter).
- 🧠 **AI Smart Minutes**: Hasilkan ringkasan rapat eksekutif, poin pembahasan, keputusan penting, dan daftar tindak lanjut (*action items*) secara instan dengan dukungan LLM (Gemini, Llama, GPT).
- 🛡️ **Production-Grade Security**:
  - **Penghapusan IDOR**: Isolasi data ketat di mana pengguna hanya dapat melihat dan mengelola sesi rapat serta statistik miliknya sendiri.
  - **Rate Limiting**: Proteksi brute-force berbasis IP pada endpoint Login (maksimal 5x/menit) & Register (maksimal 3x/5 menit).
  - **Secure Cookies**: Mengaktifkan session secure flag otomatis (`secure: 'auto'`) ketika mendeteksi akses HTTPS.
- 🗄️ **Multi-Engine Database & Auto Fallback**: Menggunakan basis data **MySQL** di lingkungan produksi dengan kemampuan **fallback otomatis** ke file database JSON (`db.json`) lokal jika koneksi MySQL mengalami gangguan.
- 🔌 **Auto WebSocket Reconnect**: Pemulihan otomatis jika koneksi jaringan terputus tidak sengaja saat proses perekaman sedang aktif tanpa menghentikan rapat.
- 💾 **Disk Cleanup**: Tombol khusus pada menu profil admin untuk membersihkan berkas audio temporer di folder `uploads/` yang berusia lebih dari 10 menit.
- 📝 **Word Export**: Ekspor hasil notulensi ke dokumen formal Microsoft Word (.docx) secara instan.

---

## 🛠️ Arsitektur Teknologi

- **Backend**: Node.js & Express.js
- **Frontend**: HTML5, Vanilla JavaScript, CSS3 (Tailwind CSS v4)
- **Database**: MySQL (Utama) & JSON File (Fallback)
- **API AI / Transkripsi**:
  - Google GenAI SDK (Gemini Live API)
  - Groq Whisper / OpenAI Whisper / OpenRouter
  - Llama 3 / GPT-4o-mini / Gemini-2.5-flash

---

## 🚀 Instalasi & Konfigurasi Lokal

### 1. Prasyarat
Pastikan Anda sudah menginstal:
* [Node.js](https://nodejs.org/) (versi 18 ke atas)
* Server MySQL (bawaan [Laragon](https://laragon.org/) sangat direkomendasikan untuk Windows)

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
Buka file `.env` dan lengkapi konfigurasi Anda:
```env
# API Keys (Isi salah satu atau lebih untuk fitur transkripsi dan LLM)
GEMINI_API_KEY="kunci-api-gemini-anda"
GROQ_API_KEY="kunci-api-groq-anda"

# Pengaturan Database MySQL
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=runguaksara
```
> **Catatan**: Buat database kosong bernama `runguaksara` terlebih dahulu di MySQL lokal Anda.

### 5. Kompilasi Aset CSS
Jika Anda melakukan perubahan styling Tailwind:
```bash
npm run build:css
```

---

## 💻 Cara Menjalankan

### Mode Pengembangan (Watch Mode)
```bash
npm run dev
```

### Mode Produksi
```bash
npm start
```

Aplikasi akan berjalan di `http://localhost:3000`. Buka alamat tersebut di browser Anda.

---

## 🔑 Akun Administrator Default
Saat aplikasi pertama kali dijalankan dan basis data masih kosong, sistem akan otomatis melakukan *seeding* akun administrator bawaan:
* **Username**: `admin`
* **Password**: `adminrunguaksara`

---

## 📁 Struktur Direktori Penting

```text
├── public/                 # File statis frontend (HTML, CSS, JS)
│   ├── app.js              # Logika utama frontend (WebSocket & API requests)
│   ├── index.html          # Halaman dashboard rapat utama
│   └── login.html          # Halaman autentikasi login & register
├── uploads/                # Folder penyimpanan file audio sementara (diabaikan oleh Git)
├── database.js             # Skema & query database (MySQL & JSON DB fallback)
├── server.js               # Server utama Node/Express & handler Gemini Live WebSocket
├── .env.example            # Templat konfigurasi environment
├── .gitignore              # Konfigurasi pengecualian berkas git
├── package.json            # Daftar pustaka dependensi npm
└── README.md               # Dokumentasi proyek (berkas ini)
```

---

## 📝 Lisensi
Proyek ini dilindungi di bawah hak cipta internal pengembangan aplikasi RunguAksara.
