// Server entry point - force reload to read updated .env variables
import express from 'express';
import multer from 'multer';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import session from 'express-session';
import { fileURLToPath } from 'url';
import { initDatabase, db } from './database.js';
import { GoogleGenAI } from '@google/genai';
import { WebSocketServer } from 'ws';

// docx library import
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType, Header, Footer } from 'docx';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// Setup directories
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Multer storage for uploaded recordings
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.wav';
    cb(null, `${crypto.randomUUID()}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } }); // 100MB max limit

app.use(express.json());

// Session Configuration
const sessionParser = session({
  secret: process.env.SESSION_SECRET || 'runguaksara-secret-key-1234567890',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: 'auto', // Set secure automatically based on HTTPS detection
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
});
app.use(sessionParser);

// Route Protection Middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    next();
  } else {
    res.status(401).json({ error: 'Akses ditolak. Silakan login terlebih dahulu.' });
  }
}

// Intercept index.html to force login
app.get('/', (req, res) => {
  if (req.session && req.session.userId) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    res.redirect('/login.html');
  }
});

app.get('/index.html', (req, res) => {
  if (req.session && req.session.userId) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    res.redirect('/login.html');
  }
});

// Serve static assets EXCEPT index.html (which is intercepted above)
app.use(express.static(path.join(__dirname, 'public')));
// Password Hashing and Verification Helpers using PBKDF2
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedPassword) {
  if (!storedPassword || !storedPassword.includes(':')) return false;
  const [salt, hash] = storedPassword.split(':');
  const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return hash === verifyHash;
}

// Initialize DB on server start
await initDatabase();

// Seed default admin user if no users exist in database
try {
  const userCount = await db.countUsers();
  if (userCount === 0) {
    const defaultAdminUsername = process.env.ADMIN_USERNAME || 'admin';
    const defaultAdminPass = process.env.ADMIN_PASSWORD || 'adminrunguaksara';
    const hashedPassword = hashPassword(defaultAdminPass);
    await db.createUser({
      id: crypto.randomUUID(),
      username: defaultAdminUsername,
      password: hashedPassword,
      fullname: 'Administrator',
      email: 'admin@runguaksara.ai',
      role: 'admin'
    });
    console.log('Seeded default admin user successfully.');
  }
} catch (err) {
  console.error('Error seeding default admin user:', err.message);
}

// Simple memory-based rate limiter middleware
const rateLimitStore = new Map();
function rateLimiter(limit, windowMs, message = 'Terlalu banyak permintaan, silakan coba lagi nanti.') {
  return (req, res, next) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip;
    const key = `${req.path}:${ip}`;
    const now = Date.now();
    
    if (!rateLimitStore.has(key)) {
      rateLimitStore.set(key, {
        count: 1,
        resetTime: now + windowMs
      });
      return next();
    }
    
    const record = rateLimitStore.get(key);
    if (now > record.resetTime) {
      record.count = 1;
      record.resetTime = now + windowMs;
      return next();
    }
    
    record.count++;
    if (record.count > limit) {
      return res.status(429).json({ error: message });
    }
    
    next();
  };
}

// Clean up expired rate limit records periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    if (now > record.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

const loginRateLimiter = rateLimiter(5, 60 * 1000, 'Terlalu banyak percobaan masuk. Silakan coba lagi setelah 1 menit.');
const registerRateLimiter = rateLimiter(3, 5 * 60 * 1000, 'Terlalu banyak pendaftaran akun dari IP ini. Silakan coba lagi setelah 5 menit.');

// --- Auth Endpoints ---

// Login Endpoint (Database verified)
app.post('/api/login', loginRateLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username dan password wajib diisi.' });
  }

  try {
    const user = await db.getUserByUsername(username);
    if (user && verifyPassword(password, user.password)) {
      req.session.userId = user.id;
      req.session.username = user.username;
      return res.json({ success: true, username: user.username, fullname: user.fullname || user.username });
    }
    res.status(401).json({ error: 'Username atau password salah.' });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Terjadi kesalahan sistem saat masuk.' });
  }
});

// Register Endpoint
app.post('/api/register', registerRateLimiter, async (req, res) => {
  const { username, password, fullname, email } = req.body;
  if (!username || !password || !fullname || !email) {
    return res.status(400).json({ error: 'Semua kolom wajib diisi.' });
  }

  if (username.length < 3) {
    return res.status(400).json({ error: 'Username minimal 3 karakter.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password minimal 6 karakter.' });
  }

  try {
    const existingUser = await db.getUserByUsername(username);
    if (existingUser) {
      return res.status(400).json({ error: 'Username sudah digunakan.' });
    }

    const hashedPassword = hashPassword(password);
    const newUser = {
      id: crypto.randomUUID(),
      username: username,
      password: hashedPassword,
      fullname: fullname,
      email: email,
      role: 'user'
    };

    await db.createUser(newUser);
    res.json({ success: true, message: 'Registrasi berhasil. Silakan login.' });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Terjadi kesalahan sistem saat registrasi.' });
  }
});

// Get User Profile Endpoint
app.get('/api/profile', requireAuth, async (req, res) => {
  try {
    const user = await db.getUser(req.session.userId);
    if (!user) {
      return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
    }
    res.json({
      id: user.id,
      username: user.username,
      fullname: user.fullname,
      email: user.email,
      role: user.role
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Terjadi kesalahan sistem saat memuat profil.' });
  }
});

// Update User Profile Endpoint
app.put('/api/profile', requireAuth, async (req, res) => {
  const { fullname, email, currentPassword, newPassword } = req.body;
  if (!fullname || !email) {
    return res.status(400).json({ error: 'Nama Lengkap dan Email wajib diisi.' });
  }

  try {
    const user = await db.getUser(req.session.userId);
    if (!user) {
      return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
    }

    const updates = {
      fullname,
      email
    };

    if (currentPassword && newPassword) {
      if (!verifyPassword(currentPassword, user.password)) {
        return res.status(400).json({ error: 'Kata sandi saat ini tidak cocok.' });
      }
      if (newPassword.length < 6) {
        return res.status(400).json({ error: 'Kata sandi baru minimal 6 karakter.' });
      }
      updates.password = hashPassword(newPassword);
    }

    await db.updateUser(req.session.userId, updates);
    res.json({ success: true, message: 'Profil berhasil diperbarui.' });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Terjadi kesalahan sistem saat memperbarui profil.' });
  }
});

// Logout Endpoint
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Gagal log out.' });
    }
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

// Get User Status
app.get('/api/auth/status', (req, res) => {
  if (req.session && req.session.userId) {
    res.json({ authenticated: true, username: req.session.username });
  } else {
    res.json({ authenticated: false });
  }
});

async function transcribeAudio(audioFilePath) {
  const openrouterKey = process.env.OPENROUTER_API_KEY?.replace(/^["']|["']$/g, '');
  const groqKey = process.env.GROQ_API_KEY?.replace(/^["']|["']$/g, '');
  const openaiKey = process.env.OPENAI_API_KEY?.replace(/^["']|["']$/g, '');

  if (!openrouterKey && !groqKey && !openaiKey) {
    console.log('No API keys configured. Using Mock Transcription.');
    return mockTranscription();
  }

  try {
    if (groqKey) {
      console.log('Transcribing using Groq API...');
      const fileBuffer = fs.readFileSync(audioFilePath);
      const blob = new Blob([fileBuffer], { type: 'audio/wav' });
      const formData = new FormData();
      formData.append('file', blob, 'audio.wav');
      formData.append('language', 'id');
      formData.append('model', 'whisper-large-v3');
      const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${groqKey}`
        },
        body: formData
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Groq Whisper error: ${response.status} - ${errorText}`);
      }
      const data = await response.json();
      return data.text;
    } else if (openaiKey) {
      console.log('Transcribing using OpenAI API...');
      const fileBuffer = fs.readFileSync(audioFilePath);
      const blob = new Blob([fileBuffer], { type: 'audio/wav' });
      const formData = new FormData();
      formData.append('file', blob, 'audio.wav');
      formData.append('language', 'id');
      formData.append('model', 'whisper-1');
      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiKey}`
        },
        body: formData
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI Whisper error: ${response.status} - ${errorText}`);
      }
      const data = await response.json();
      return data.text;
    } else if (openrouterKey) {
      console.log('Transcribing using OpenRouter API...');
      const fileBuffer = fs.readFileSync(audioFilePath);
      const base64Audio = fileBuffer.toString('base64');
      const format = path.extname(audioFilePath).substring(1) || 'wav';
      
      const payload = {
        model: process.env.WHISPER_MODEL || 'openai/whisper-large-v3',
        input_audio: {
          data: base64Audio,
          format: format === 'blob' ? 'webm' : format
        },
        language: 'id'
      };

      const response = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openrouterKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter Whisper error: ${response.status} - ${errorText}`);
      }
      const data = await response.json();
      return data.text;
    }
  } catch (error) {
    console.error('STT API failure:', error.message);
    throw error;
  }
}

function mockTranscription() {
  const samples = [
    "Selamat sore bapak dan ibu sekalian. Terima kasih sudah hadir dalam rapat koordinasi hari ini mengenai pembangunan infrastruktur wilayah timur.",
    "Untuk agenda pertama, kita perlu meninjau progress pembangunan jalan tol di Trans Papua yang saat ini mengalami kendala teknis dan pembebasan lahan.",
    "Iya benar, untuk Trans Papua kendala utamanya ada di segmen 4. Kami membutuhkan koordinasi lebih lanjut dengan pemerintah daerah setempat serta Kementerian LHK terkait izin kawasan hutan.",
    "Baik, tolong dicatat agar kita jadwalkan pertemuan tripartit minggu depan dengan Pemda Papua dan Kementerian LHK. Pak Budi tolong siapkan dokumen teknisnya.",
    "Siap Pak, dokumen rancangan dan berkas perizinan akan kami siapkan sebelum hari Kamis depan agar bisa dipelajari terlebih dahulu oleh unit terkait.",
    "Selanjutnya untuk alokasi anggaran infrastruktur wilayah prioritas tahun 2026, kita harus memastikan sinkronisasi data dengan sistem KRISNA Bappenas. Batas waktu penginputan adalah akhir bulan ini.",
    "Terkait sistem KRISNA, tim kami sudah mulai melakukan inputing data, namun ada beberapa kendala sinkronisasi pagu anggaran. Kami akan berkoordinasi dengan Biro Perencanaan besok pagi.",
    "Bagus. Pastikan semua pagu anggaran sudah klop dan tidak ada duplikasi program. Kita tidak ingin ada catatan dari BPK di kemudian hari. Rapat koordinasi teknis internal kita jadwalkan kembali hari Jumat.",
    "Baik Pak, akan segera kami tindaklanjuti seluruh poin penting hari ini agar terdokumentasi dengan baik."
  ];
  return samples.join(' ');
}

async function translateAndCorrectToIndonesian(text) {
  const geminiKey = process.env.GEMINI_API_KEY?.replace(/^["']|["']$/g, '');
  if (!geminiKey || !text || !text.trim()) return text;

  try {
    const ai = new GoogleGenAI({ apiKey: geminiKey });
    const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

    const systemPrompt = `Anda adalah asisten penerjemah dan penyelaras transkrip rapat profesional untuk RunguAksara.
Tugas Anda adalah memproses teks transkrip suara berikut:
1. Jika teks transkrip tertulis dalam bahasa asing (seperti Inggris, Jepang, dll.) atau bahasa daerah, terjemahkan secara utuh dan akurat ke dalam Bahasa Indonesia yang formal dan santun.
2. Jika teks transkrip sudah dalam Bahasa Indonesia, cukup perbaiki ejaan, tata bahasa, kata yang salah tangkap (typo) minor agar menjadi kalimat yang padu dan mudah dibaca tanpa mengubah maksud pembicara.
3. Hanya kembalikan teks hasil akhir penerjemahan/perbaikan tersebut. Jangan menambahkan penjelasan, kata pengantar, penutup, atau membungkusnya dalam tanda kutip.`;

    const response = await ai.models.generateContent({
      model: modelName,
      contents: `${systemPrompt}\n\nTeks transkrip:\n"${text}"`
    });

    const resultText = response.text?.trim();
    if (resultText) {
      return resultText;
    }
  } catch (err) {
    console.error('Translation/Correction helper failure:', err.message);
  }
  return text;
}

// --- LLM Notulensi Helper ---
async function generateMinutesWithAI(transcriptText, sessionData, participants) {
  const geminiKey = process.env.GEMINI_API_KEY?.replace(/^["']|["']$/g, '');
  const openrouterKey = process.env.OPENROUTER_API_KEY?.replace(/^["']|["']$/g, '');
  const groqKey = process.env.GROQ_API_KEY?.replace(/^["']|["']$/g, '');
  const openaiKey = process.env.OPENAI_API_KEY?.replace(/^["']|["']$/g, '');

  const participantsList = participants.map(p => `- ${p.name} (${p.position || 'Staf'} - ${p.unit || 'Internal'})`).join('\n');
  const systemPrompt = `Anda adalah sekretaris dan asisten AI profesional untuk RunguAksara.
Tugas Anda adalah membuat Notulensi Rapat resmi secara terstruktur dari transkrip percakapan yang diberikan.

Berikut adalah detail rapat:
Judul Rapat: ${sessionData.title}
Tanggal: ${sessionData.date || 'Tidak ditentukan'}
Lokasi: ${sessionData.location || 'Kantor Pusat'}
Agenda: ${sessionData.agenda || 'Koordinasi Internal'}
Peserta Rapat:
${participantsList || '- Tidak ada peserta terdaftar'}

Format output harus berupa JSON yang valid dengan struktur berikut:
{
  "summary": "Ringkasan eksekutif singkat dari jalannya rapat dalam 1-2 paragraf.",
  "discussion_points": [
    "Poin pembahasan detail 1...",
    "Poin pembahasan detail 2..."
  ],
  "decisions": [
    "Keputusan penting rapat 1...",
    "Keputusan penting rapat 2..."
  ],
  "action_items": [
    {
      "description": "Deskripsi tugas konkret yang harus dikerjakan",
      "pic": "Nama orang yang bertanggung jawab (ambil dari daftar peserta rapat jika relevan, atau nama posisi)",
      "due_date": "Tenggat waktu pengerjaan (contoh: 'Kamis depan', 'Akhir Juni 2026', atau tanggal spesifik)"
    }
  ]
}

Ketentuan Khusus:
1. Pastikan output hanya berupa JSON valid tanpa teks pengantar atau penutup apapun di luar tag JSON.
2. Gunakan Bahasa Indonesia formal (EYD).
3. Gunakan informasi pembicara dari teks transkrip (misal jika ada penyebutan nama pembicara) untuk memperjelas keputusan dan action items.`;

  const userPrompt = `Transkrip Rapat:
"${transcriptText}"`;

  if (!geminiKey && !openrouterKey && !groqKey && !openaiKey) {
    console.log('No API keys configured. Using Mock AI Notulensi.');
    return mockMinutesJSON(sessionData, participants);
  }

  if (geminiKey) {
    try {
      console.log('Calling Gemini API via native SDK...');
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
      
      const schema = {
        type: "OBJECT",
        properties: {
          summary: { type: "STRING" },
          discussion_points: { type: "ARRAY", items: { type: "STRING" } },
          decisions: { type: "ARRAY", items: { type: "STRING" } },
          action_items: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                description: { type: "STRING" },
                pic: { type: "STRING" },
                due_date: { type: "STRING" }
              },
              required: ["description", "pic", "due_date"]
            }
          }
        },
        required: ["summary", "discussion_points", "decisions", "action_items"]
      };

      const response = await ai.models.generateContent({
        model: modelName,
        contents: [
          { role: 'user', parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: schema
        }
      });

      let content = response.text?.trim() || '{}';
      
      if (content.startsWith('```json')) {
        content = content.replace(/^```json/, '').replace(/```$/, '').trim();
      } else if (content.startsWith('```')) {
        content = content.replace(/^```/, '').replace(/```$/, '').trim();
      }

      return JSON.parse(content);
    } catch (error) {
      console.error('Gemini API native SDK failure, checking other fallbacks:', error.message);
      if (!openrouterKey && !groqKey && !openaiKey) {
        console.log('No other keys available. Using Mock AI Notulensi.');
        return mockMinutesJSON(sessionData, participants);
      }
    }
  }

  try {
    let response;
    let url;
    let headers = { 'Content-Type': 'application/json' };
    let bodyPayload = {};

    if (groqKey) {
      console.log('Calling Groq LLM API...');
      url = 'https://api.groq.com/openai/v1/chat/completions';
      headers['Authorization'] = `Bearer ${groqKey}`;
      bodyPayload = {
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1
      };
    } else if (openaiKey) {
      console.log('Calling OpenAI Chat API...');
      url = 'https://api.openai.com/v1/chat/completions';
      headers['Authorization'] = `Bearer ${openaiKey}`;
      bodyPayload = {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1
      };
    } else if (openrouterKey) {
      console.log('Calling OpenRouter Chat API...');
      url = 'https://openrouter.ai/api/v1/chat/completions';
      headers['Authorization'] = `Bearer ${openrouterKey}`;
      headers['HTTP-Referer'] = 'https://runguaksara.ai';
      bodyPayload = {
        model: process.env.LLM_MODEL || 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1
      };
    }

    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyPayload)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`LLM API error: ${response.status} - ${errText}`);
    }

    const data = await response.json();
    let content = data.choices[0].message.content.trim();
    
    if (content.startsWith('```json')) {
      content = content.replace(/^```json/, '').replace(/```$/, '').trim();
    } else if (content.startsWith('```')) {
      content = content.replace(/^```/, '').replace(/```$/, '').trim();
    }

    return JSON.parse(content);
  } catch (error) {
    console.error('LLM API failure, falling back to mock:', error.message);
    return mockMinutesJSON(sessionData, participants);
  }
}

function mockMinutesJSON(sessionData, participants) {
  const names = participants.map(p => p.name);
  const pic1 = names[0] || 'Pak Budi';
  const pic2 = names[1] || 'Tim Perencanaan';
  
  return {
    summary: `Rapat koordinasi internal membahas progres perizinan dan kendala teknis pembangunan jalan tol Trans Papua segmen 4. Selain itu, rapat membahas persiapan sinkronisasi anggaran pembangunan infrastruktur wilayah prioritas tahun anggaran 2026 ke dalam sistem KRISNA milik Bappenas.`,
    discussion_points: [
      "Pembangunan jalan tol Trans Papua segmen 4 menghadapi hambatan teknis di lapangan serta isu pembebasan lahan yang memerlukan keterlibatan aktif Pemerintah Daerah setempat.",
      "Terdapat kebutuhan perizinan kawasan hutan dari Kementerian Lingkungan Hidup dan Kehutanan (LHK) agar pekerjaan fisik dapat dilanjutkan di segmen 4.",
      "Input data anggaran infrastruktur tahun 2026 ke dalam aplikasi KRISNA Bappenas harus disinkronkan untuk menghindari ketidaksesuaian pagu anggaran program."
    ],
    decisions: [
      "Menjadwalkan koordinasi tripartit dengan Pemerintah Daerah Papua dan Kementerian LHK pada minggu depan untuk membahas percepatan izin pinjam pakai kawasan hutan.",
      "Koordinasi teknis dengan Biro Perencanaan dilaksanakan besok pagi untuk rekonsiliasi pagu program di sistem KRISNA."
    ],
    action_items: [
      {
        description: "Menyiapkan berkas perizinan kehutanan dan dokumen teknis Trans Papua segmen 4 sebelum Kamis depan.",
        pic: pic1,
        due_date: "Kamis depan"
      },
      {
        description: "Melakukan rekonsiliasi data pagu program pembangunan wilayah dengan Biro Perencanaan di aplikasi KRISNA.",
        pic: pic2,
        due_date: "Besok pagi"
      },
      {
        description: "Melaksanakan rapat koordinasi teknis internal lanjutan untuk evaluasi hasil rapat perizinan dan KRISNA.",
        pic: "Seluruh Tim",
        due_date: "Jumat depan"
      }
    ]
  };
}

// --- Protected API Routes ---

// 0. Get global statistics (partitioned/scoped to the authenticated user for safety)
app.get('/api/stats', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const [sessions, transcripts, doneItems, totalItems] = await Promise.all([
      db.countSessions(userId),
      db.countTranscripts(userId),
      db.countActionItems(userId, 'done'),
      db.countActionItems(userId)
    ]);

    res.json({
      sessions,
      transcripts,
      actionItems: {
        done: doneItems,
        total: totalItems
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Disk Cleanup Endpoint: Only admin role can run
app.post('/api/admin/cleanup', requireAuth, async (req, res) => {
  try {
    const user = await db.getUser(req.session.userId);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Akses ditolak. Hanya Administrator yang dapat menjalankan pembersihan disk.' });
    }

    const files = await fs.promises.readdir(uploadsDir);
    let deletedCount = 0;
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;

    for (const file of files) {
      const filePath = path.join(uploadsDir, file);
      const stats = await fs.promises.stat(filePath);
      if (stats.isFile() && stats.mtimeMs < tenMinutesAgo) {
        await fs.promises.unlink(filePath);
        deletedCount++;
      }
    }

    res.json({ success: true, message: `Pembersihan berhasil. ${deletedCount} file sampah audio berhasil dihapus.`, deletedCount });
  } catch (err) {
    console.error('Disk cleanup error:', err);
    res.status(500).json({ error: 'Gagal melakukan pembersihan disk.' });
  }
});

// 1. Get all sessions
app.get('/api/sessions', requireAuth, async (req, res) => {
  try {
    const sessions = await db.getSessions(req.session.userId);
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Create new session
app.post('/api/sessions', requireAuth, async (req, res) => {
  const { title, date, location, agenda, participants } = req.body;
  if (!title) return res.status(400).json({ error: 'Judul rapat wajib diisi.' });

  const sessionId = crypto.randomUUID();
  const session = {
    id: sessionId,
    title,
    date: date || new Date().toISOString().split('T')[0],
    location: location || '',
    agenda: agenda || '',
    status: 'draft'
  };

  try {
    await db.createSession(session, req.session.userId);
    
    // Save participants
    if (participants && Array.isArray(participants)) {
      const participantsList = participants.map(p => ({
        id: crypto.randomUUID(),
        session_id: sessionId,
        name: p.name,
        position: p.position || '',
        unit: p.unit || ''
      }));
      await db.saveParticipants(sessionId, participantsList);
    }
    
    res.status(201).json({ id: sessionId, ...session });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Get single session details
app.get('/api/sessions/:id', requireAuth, async (req, res) => {
  try {
    const session = await db.getSession(req.params.id, req.session.userId);
    if (!session) return res.status(404).json({ error: 'Sesi rapat tidak ditemukan atau akses ditolak.' });

    const participants = await db.getParticipants(session.id);
    const transcripts = await db.getTranscripts(session.id);
    const minutes = await db.getMinutes(session.id);
    
    let actionItems = [];
    if (minutes) {
      actionItems = await db.getActionItems(minutes.id);
    }

    res.json({
      session,
      participants,
      transcripts,
      minutes: minutes ? { ...minutes, actionItems } : null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Delete session
app.delete('/api/sessions/:id', requireAuth, async (req, res) => {
  try {
    const success = await db.deleteSession(req.params.id, req.session.userId);
    if (!success) {
      return res.status(404).json({ error: 'Sesi rapat tidak ditemukan atau akses ditolak.' });
    }
    res.json({ success });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4_edit. Update session metadata
app.put('/api/sessions/:id', requireAuth, async (req, res) => {
  const sessionId = req.params.id;
  const { title, date, location, agenda } = req.body;
  if (!title) return res.status(400).json({ error: 'Judul rapat wajib diisi.' });

  try {
    const session = await db.getSession(sessionId, req.session.userId);
    if (!session) return res.status(404).json({ error: 'Sesi rapat tidak ditemukan atau akses ditolak.' });

    session.title = title.trim();
    session.date = date || new Date().toISOString().split('T')[0];
    session.location = (location || '').trim();
    session.agenda = (agenda || '').trim();

    await db.createSession(session, req.session.userId);
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4a. Add a participant to an existing session
app.post('/api/sessions/:id/participants', requireAuth, async (req, res) => {
  const sessionId = req.params.id;
  const { name, position, unit } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Nama peserta wajib diisi.' });
  }
  try {
    const session = await db.getSession(sessionId, req.session.userId);
    if (!session) return res.status(404).json({ error: 'Sesi rapat tidak ditemukan atau akses ditolak.' });

    const participant = {
      id: crypto.randomUUID(),
      session_id: sessionId,
      name: name.trim(),
      position: (position || '').trim(),
      unit: (unit || '').trim()
    };
    await db.addParticipant(participant);
    res.status(201).json(participant);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4b. Remove a participant from a session
app.delete('/api/sessions/:id/participants/:pid', requireAuth, async (req, res) => {
  try {
    const session = await db.getSession(req.params.id, req.session.userId);
    if (!session) return res.status(404).json({ error: 'Sesi rapat tidak ditemukan atau akses ditolak.' });

    await db.removeParticipant(req.params.pid);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Upload audio file and transcribe
app.post('/api/sessions/:id/transcribe', requireAuth, upload.single('audio'), async (req, res) => {
  const sessionId = req.params.id;
  if (!req.file) {
    return res.status(400).json({ error: 'File audio tidak ditemukan.' });
  }

  const audioPath = req.file.path;

  try {
    const session = await db.getSession(sessionId, req.session.userId);
    if (!session) {
      return res.status(404).json({ error: 'Sesi rapat tidak ditemukan atau akses ditolak.' });
    }

    console.log(`Processing audio transcription for session: ${session.title}...`);
    const transcriptionText = await transcribeAudio(audioPath);
    const correctedText = await translateAndCorrectToIndonesian(transcriptionText);

    // Split text into readable segment paragraphs as transcripts
    const existingTranscripts = await db.getTranscripts(sessionId);
    const chunkIndex = existingTranscripts.length;
    
    const newTranscript = {
      id: crypto.randomUUID(),
      session_id: sessionId,
      chunk_index: chunkIndex,
      text: correctedText,
      timestamp: new Date().toLocaleTimeString('id-ID'),
      speaker_label: '' // Label pembicara kosong di awal
    };

    await db.addTranscript(newTranscript);

    // Cleanup temp uploaded file
    fs.unlink(audioPath, (err) => {
      if (err) console.error('Failed to delete uploaded file:', err.message);
    });

    res.json(newTranscript);
  } catch (err) {
    // Cleanup file in case of error
    if (fs.existsSync(audioPath)) {
      fs.unlinkSync(audioPath);
    }
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 6. Update speaker label for a transcript chunk
app.put('/api/transcripts/:id/speaker', requireAuth, async (req, res) => {
  const { speaker_label } = req.body;
  try {
    await db.updateTranscriptSpeaker(req.params.id, speaker_label || '');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6b. Update transcript text chunk manually
app.put('/api/transcripts/:id/text', requireAuth, async (req, res) => {
  const { text } = req.body;
  try {
    await db.updateTranscriptText(req.params.id, text || '');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6c. Delete transcript chunk
app.delete('/api/transcripts/:id', requireAuth, async (req, res) => {
  try {
    await db.deleteTranscript(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6a. Update action item status
app.put('/api/action-items/:id/status', requireAuth, async (req, res) => {
  const { status } = req.body;
  if (!['pending', 'done'].includes(status)) {
    return res.status(400).json({ error: 'Status tidak valid.' });
  }
  try {
    await db.updateActionItemStatus(req.params.id, status);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Generate Minutes (Notulensi) using AI
app.post('/api/sessions/:id/generate-minutes', requireAuth, async (req, res) => {
  const sessionId = req.params.id;

  try {
    const session = await db.getSession(sessionId, req.session.userId);
    if (!session) return res.status(404).json({ error: 'Sesi rapat tidak ditemukan atau akses ditolak.' });

    const participants = await db.getParticipants(sessionId);
    const transcripts = await db.getTranscripts(sessionId);

    if (transcripts.length === 0) {
      return res.status(400).json({ error: 'Transkrip kosong. Harap merekam audio atau mengunggah rekaman terlebih dahulu.' });
    }

    // Combine transcripts with speaker labels
    const combinedTranscriptText = transcripts.map(t => {
      const speaker = t.speaker_label ? `${t.speaker_label}: ` : 'Pembicara: ';
      return `${speaker}${t.text}`;
    }).join('\n\n');

    console.log('Generating AI minutes...');
    const aiOutput = await generateMinutesWithAI(combinedTranscriptText, session, participants);

    // Save to Database
    const minutesId = crypto.randomUUID();
    
    // Format rich text html for browser preview
    const discussionHtml = aiOutput.discussion_points.map(p => `<li>${p}</li>`).join('');
    const decisionsHtml = aiOutput.decisions.map(d => `<li>${d}</li>`).join('');
    const notesHtml = `
      <div class="prose max-w-none">
        <h3 class="text-xl font-bold text-slate-800 border-b pb-2 mb-3">I. Ringkasan Rapat</h3>
        <p class="text-slate-650 leading-relaxed mb-6">${aiOutput.summary}</p>
        
        <h3 class="text-xl font-bold text-slate-800 border-b pb-2 mb-3">II. Poin Pembahasan</h3>
        <ul class="list-disc pl-5 space-y-2 text-slate-650 mb-6">${discussionHtml}</ul>
        
        <h3 class="text-xl font-bold text-slate-800 border-b pb-2 mb-3">III. Keputusan Rapat</h3>
        <ul class="list-decimal pl-5 space-y-2 text-slate-650 mb-6">${decisionsHtml}</ul>
      </div>
    `;

    const minutes = {
      id: minutesId,
      session_id: sessionId,
      summary: aiOutput.summary,
      content_json: JSON.stringify(aiOutput),
      notes_html: notesHtml
    };

    const actionItemsList = aiOutput.action_items.map(a => ({
      id: crypto.randomUUID(),
      minutes_id: minutesId,
      description: a.description,
      pic: a.pic || 'Tidak ditentukan',
      due_date: a.due_date || '-',
      status: 'pending'
    }));

    await db.saveMinutes(minutes, actionItemsList);

    // Update session status to completed
    session.status = 'completed';
    await db.createSession(session, req.session.userId); // Will overwrite/update in custom helper or DB

    res.json({
      ...minutes,
      actionItems: actionItemsList
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 8. Update minutes content manually (editor save)
app.put('/api/sessions/:id/minutes', requireAuth, async (req, res) => {
  const sessionId = req.params.id;
  const { notes_html, actionItems } = req.body;

  try {
    const session = await db.getSession(sessionId, req.session.userId);
    if (!session) return res.status(404).json({ error: 'Sesi rapat tidak ditemukan atau akses ditolak.' });

    const existingMinutes = await db.getMinutes(sessionId);
    if (!existingMinutes) return res.status(404).json({ error: 'Notulensi belum dibuat.' });

    // Build manual minutes update
    const updatedMinutes = {
      ...existingMinutes,
      notes_html
    };

    const actionItemsList = (actionItems || []).map(a => ({
      id: a.id || crypto.randomUUID(),
      minutes_id: existingMinutes.id,
      description: a.description,
      pic: a.pic,
      due_date: a.due_date,
      status: a.status || 'pending'
    }));

    await db.saveMinutes(updatedMinutes, actionItemsList);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Export to DOCX
app.get('/api/sessions/:id/export', requireAuth, async (req, res) => {
  const sessionId = req.params.id;

  try {
    const session = await db.getSession(sessionId, req.session.userId);
    if (!session) return res.status(404).json({ error: 'Sesi rapat tidak ditemukan atau akses ditolak.' });

    const participants = await db.getParticipants(sessionId);
    const transcripts = await db.getTranscripts(sessionId);
    const minutes = await db.getMinutes(sessionId);
    
    if (!minutes) return res.status(400).json({ error: 'Notulensi belum digenerate. Tidak dapat mengekspor.' });

    const actionItems = await db.getActionItems(minutes.id);
    const data = JSON.parse(minutes.content_json);

    // Styled cell helper to reduce boilerplate, apply standard fonts, padding, and backgrounds
    function createStyledCell({ text, bold = false, size = 20, color = "334155", fill = null, widthPercent, align = AlignmentType.LEFT }) {
      const cellOptions = {
        width: { size: widthPercent, type: WidthType.PERCENTAGE },
        margins: { top: 120, bottom: 120, left: 150, right: 150 },
        children: [
          new Paragraph({
            alignment: align,
            spacing: { before: 40, after: 40 },
            children: [
              new TextRun({
                text,
                bold,
                size,
                color,
                font: bold ? "Arial" : "Calibri"
              })
            ]
          })
        ]
      };
      
      if (fill) {
        cellOptions.shading = {
          fill: fill
        };
      }
      
      return new TableCell(cellOptions);
    }

    // Build professional document using docx.js library matching PUPR-BPIW administrative guidelines
    const doc = new Document({
      sections: [{
        properties: {
          page: {
            margin: {
              top: 1700,      // ~3cm (3/2.54 * 1440 = 1700 twips)
              bottom: 1134,   // ~2cm
              left: 1700,     // ~3cm
              right: 1134     // ~2cm
            }
          }
        },
        children: [
          // Kop Surat RunguAksara Branding
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "RUNGUAKSARA", bold: true, size: 28, font: "Arial", color: "1A365D" }),
            ]
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "Sistem Dokumentasi, Transkripsi & Notulensi Rapat Otomatis", size: 16, font: "Arial", color: "475569" }),
            ],
            border: {
              bottom: {
                style: BorderStyle.SINGLE,
                size: 12, // 1.5 pt
                color: "1A365D",
                space: 10
              }
            },
            spacing: { after: 300 }
          }),

          // Document Title
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "NOTULENSI RAPAT", bold: true, size: 28, font: "Arial", color: "1A365D" }),
            ],
            spacing: { before: 200, after: 300 }
          }),

          // Section A: METADATA RAPAT
          new Paragraph({
            children: [
              new TextRun({ text: "A. METADATA RAPAT", bold: true, size: 22, font: "Arial", color: "1A365D" })
            ],
            spacing: { before: 200, after: 120 }
          }),

          // Clean, aligned metadata block using a borderless table
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: {
              top: { style: BorderStyle.NONE },
              bottom: { style: BorderStyle.NONE },
              left: { style: BorderStyle.NONE },
              right: { style: BorderStyle.NONE },
              insideHorizontal: { style: BorderStyle.NONE },
              insideVertical: { style: BorderStyle.NONE }
            },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    width: { size: 20, type: WidthType.PERCENTAGE },
                    margins: { top: 60, bottom: 60, left: 0, right: 100 },
                    children: [new Paragraph({ children: [new TextRun({ text: "Judul Rapat", bold: true, font: "Arial", size: 20 })] })]
                  }),
                  new TableCell({
                    width: { size: 80, type: WidthType.PERCENTAGE },
                    margins: { top: 60, bottom: 60, left: 0, right: 0 },
                    children: [new Paragraph({ children: [new TextRun({ text: `: ${session.title}`, font: "Calibri", size: 20 })] })]
                  })
                ]
              }),
              new TableRow({
                children: [
                  new TableCell({
                    width: { size: 20, type: WidthType.PERCENTAGE },
                    margins: { top: 60, bottom: 60, left: 0, right: 100 },
                    children: [new Paragraph({ children: [new TextRun({ text: "Hari, Tanggal", bold: true, font: "Arial", size: 20 })] })]
                  }),
                  new TableCell({
                    width: { size: 80, type: WidthType.PERCENTAGE },
                    margins: { top: 60, bottom: 60, left: 0, right: 0 },
                    children: [new Paragraph({ children: [new TextRun({ text: `: ${session.date}`, font: "Calibri", size: 20 })] })]
                  })
                ]
              }),
              new TableRow({
                children: [
                  new TableCell({
                    width: { size: 20, type: WidthType.PERCENTAGE },
                    margins: { top: 60, bottom: 60, left: 0, right: 100 },
                    children: [new Paragraph({ children: [new TextRun({ text: "Tempat / Media", bold: true, font: "Arial", size: 20 })] })]
                  }),
                  new TableCell({
                    width: { size: 80, type: WidthType.PERCENTAGE },
                    margins: { top: 60, bottom: 60, left: 0, right: 0 },
                    children: [new Paragraph({ children: [new TextRun({ text: `: ${session.location || '-'}`, font: "Calibri", size: 20 })] })]
                  })
                ]
              }),
              new TableRow({
                children: [
                  new TableCell({
                    width: { size: 20, type: WidthType.PERCENTAGE },
                    margins: { top: 60, bottom: 60, left: 0, right: 100 },
                    children: [new Paragraph({ children: [new TextRun({ text: "Agenda Rapat", bold: true, font: "Arial", size: 20 })] })]
                  }),
                  new TableCell({
                    width: { size: 80, type: WidthType.PERCENTAGE },
                    margins: { top: 60, bottom: 60, left: 0, right: 0 },
                    children: [new Paragraph({ children: [new TextRun({ text: `: ${session.agenda || '-'}`, font: "Calibri", size: 20 })] })]
                  })
                ]
              })
            ]
          }),
          new Paragraph({ text: "", spacing: { after: 200 } }),

          // Section B: DAFTAR HADIR PESERTA
          new Paragraph({
            children: [
              new TextRun({ text: "B. DAFTAR HADIR PESERTA", bold: true, size: 22, font: "Arial", color: "1A365D" })
            ],
            spacing: { before: 200, after: 120 }
          }),
          ...participants.map((p, idx) => new Paragraph({
            children: [
              new TextRun({ text: `${idx + 1}.  ${p.name}`, bold: true, font: "Arial", size: 20 }),
              new TextRun({ text: ` - ${p.position || 'Staf'} (${p.unit || 'Internal'})`, font: "Calibri", size: 20 })
            ],
            spacing: { after: 60 }
          })),
          ...(participants.length === 0 ? [new Paragraph({ children: [new TextRun({ text: "- Tidak ada peserta terdaftar -", font: "Calibri", size: 20, italic: true })] })] : []),
          new Paragraph({ text: "", spacing: { after: 200 } }),

          // Section C: RINGKASAN JALANNYA RAPAT
          new Paragraph({
            children: [
              new TextRun({ text: "C. RINGKASAN JALANNYA RAPAT", bold: true, size: 22, font: "Arial", color: "1A365D" })
            ],
            spacing: { before: 200, after: 120 }
          }),
          new Paragraph({
            children: [
              new TextRun({ text: data.summary, font: "Calibri", size: 20 })
            ],
            spacing: { after: 200, line: 276, lineRule: "auto" } // 1.15 line spacing
          }),

          // Section D: POIN-POIN PEMBAHASAN RAPAT
          new Paragraph({
            children: [
              new TextRun({ text: "D. POIN-POIN PEMBAHASAN RAPAT", bold: true, size: 22, font: "Arial", color: "1A365D" })
            ],
            spacing: { before: 200, after: 120 }
          }),
          ...data.discussion_points.map((pt) => new Paragraph({
            children: [
              new TextRun({ text: "•  ", bold: true, font: "Arial", size: 20, color: "1A365D" }),
              new TextRun({ text: pt, font: "Calibri", size: 20 })
            ],
            spacing: { after: 80, line: 276, lineRule: "auto" }
          })),
          new Paragraph({ text: "", spacing: { after: 200 } }),

          // Section E: KEPUTUSAN RAPAT
          new Paragraph({
            children: [
              new TextRun({ text: "E. KEPUTUSAN RAPAT", bold: true, size: 22, font: "Arial", color: "1A365D" })
            ],
            spacing: { before: 200, after: 120 }
          }),
          ...data.decisions.map((dec, idx) => new Paragraph({
            children: [
              new TextRun({ text: `${idx + 1}.  `, bold: true, font: "Arial", size: 20, color: "1A365D" }),
              new TextRun({ text: dec, font: "Calibri", size: 20 })
            ],
            spacing: { after: 80, line: 276, lineRule: "auto" }
          })),
          new Paragraph({ text: "", spacing: { after: 200 } }),

          // Section F: TINDAK LANJUT / ACTION ITEMS
          new Paragraph({
            children: [
              new TextRun({ text: "F. TINDAK LANJUT / ACTION ITEMS", bold: true, size: 22, font: "Arial", color: "1A365D" })
            ],
            spacing: { before: 200, after: 120 }
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
              bottom: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
              left: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
              right: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
              insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
              insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" }
            },
            rows: [
              new TableRow({
                children: [
                  createStyledCell({ text: "Tindak Lanjut / Deskripsi Tugas", bold: true, size: 20, color: "FFFFFF", fill: "1A365D", widthPercent: 55 }),
                  createStyledCell({ text: "PIC / Penanggung Jawab", bold: true, size: 20, color: "FFFFFF", fill: "1A365D", widthPercent: 25 }),
                  createStyledCell({ text: "Tenggat Waktu", bold: true, size: 20, color: "FFFFFF", fill: "1A365D", widthPercent: 20 })
                ]
              }),
              ...actionItems.map((item, idx) => {
                const bgFill = idx % 2 === 0 ? "F8FAFC" : "FFFFFF"; // zebra striping
                return new TableRow({
                  children: [
                    createStyledCell({ text: item.description, size: 20, fill: bgFill, widthPercent: 55 }),
                    createStyledCell({ text: item.pic || '-', bold: true, size: 20, color: "1A365D", fill: bgFill, widthPercent: 25 }),
                    createStyledCell({ text: item.due_date || '-', size: 20, fill: bgFill, widthPercent: 20 })
                  ]
                });
              })
            ]
          }),
          new Paragraph({ text: "", spacing: { after: 200 } }),

          // Section G: TRANSKRIPSI RAPAT
          new Paragraph({
            children: [
              new TextRun({ text: "G. TRANSKRIPSI RAPAT", bold: true, size: 22, font: "Arial", color: "1A365D" })
            ],
            spacing: { before: 200, after: 120 }
          }),
          ...transcripts.map(t => {
            const speaker = t.speaker_label || "Pembicara";
            return new Paragraph({
              children: [
                new TextRun({ text: `[${t.timestamp || ''}] `, font: "Consolas", size: 18, color: "64748B" }),
                new TextRun({ text: `${speaker}: `, bold: true, font: "Arial", size: 20, color: "1A365D" }),
                new TextRun({ text: t.text, font: "Calibri", size: 20 })
              ],
              spacing: { before: 80, after: 80, line: 240 } // 1.0 line spacing for transcripts to look compact
            });
          })
        ]
      }]
    });

    const b64 = await Packer.toBuffer(doc);
    
    // Set headers to trigger docx download
    const filename = `RunguAksara_${session.title.replace(/\s+/g, '_')}.docx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(b64);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 10. Save live transcript segment
app.post('/api/sessions/:id/live-transcript', requireAuth, async (req, res) => {
  const sessionId = req.params.id;
  const { text, speaker_label } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Teks transkrip kosong.' });
  }

  try {
    const session = await db.getSession(sessionId, req.session.userId);
    if (!session) return res.status(404).json({ error: 'Sesi rapat tidak ditemukan atau akses ditolak.' });

    const existingTranscripts = await db.getTranscripts(sessionId);
    const chunkIndex = existingTranscripts.length;

    const correctedText = await translateAndCorrectToIndonesian(text);

    const newTranscript = {
      id: crypto.randomUUID(),
      session_id: sessionId,
      chunk_index: chunkIndex,
      text: correctedText,
      timestamp: new Date().toLocaleTimeString('id-ID'),
      speaker_label: speaker_label || ''
    };

    await db.addTranscript(newTranscript);
    res.status(201).json(newTranscript);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Run server
const server = app.listen(PORT, () => {
  console.log(`\n========================================================`);
  console.log(`🚀 RunguAksara Server running at:`);
  console.log(`   👉 http://localhost:${PORT}`);
  console.log(`========================================================\n`);
});

// --- WebSocket and Gemini Live API Setup ---
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', async (ws, request) => {
  const urlParts = request.url.split('/');
  const liveIndex = urlParts.indexOf('live');
  const sessionId = liveIndex > 0 ? urlParts[liveIndex - 1] : null;

  if (!sessionId) {
    ws.close(1008, 'Session ID not found in URL');
    return;
  }

  const geminiKey = process.env.GEMINI_API_KEY?.replace(/^["']|["']$/g, '');
  if (!geminiKey) {
    console.error('WebSocket connection attempt failed: GEMINI_API_KEY is missing');
    ws.close(1011, 'GEMINI_API_KEY is not configured on server');
    return;
  }

  console.log(`WebSocket client connected for session: ${sessionId}`);

  let geminiSession = null;
  try {
    const ai = new GoogleGenAI({ apiKey: geminiKey });
    const modelName = process.env.GEMINI_MODEL || 'gemini-3.1-flash-live-preview';

    console.log(`Connecting to Gemini Live API with model: ${modelName}...`);
    geminiSession = await ai.live.connect({
      model: modelName,
      config: {
        responseModalities: ['AUDIO'],
        inputAudioTranscription: {},
        systemInstruction: `Anda adalah RunguAksara, asisten pencatat transkrip dan notulensi rapat real-time.
Tugas utama Anda adalah menyimak data audio yang masuk secara real-time dan menuliskan kembali teks transkrip kata-demi-kata (speech-to-text) HANYA dalam Bahasa Indonesia yang formal dan mudah dibaca.
KUNCI TRANSKRIPSI KE BAHASA INDONESIA SAJA. Jika pembicara berbicara dalam bahasa asing atau bahasa daerah, segera terjemahkan atau transkripsikan langsung ke Bahasa Indonesia.
JANGAN PERNAH MENJAWAB, MERESPONS, ATAU MENANGGAPI pembicaraan rapat. Tugas Anda murni hanya melakukan transkripsi (speech-to-text). Jangan menghasilkan model turn, teks tanggapan, atau suara balasan apapun.`,
      },
      callbacks: {
        onopen: () => {
          console.log('Gemini Live API WebSocket connection established successfully');
          ws.send(JSON.stringify({ type: 'status', status: 'connected', message: 'Terhubung ke Gemini Live API' }));
        },
        onmessage: (msg) => {
          if (msg.serverContent?.inputTranscription) {
            const trans = msg.serverContent.inputTranscription;
            ws.send(JSON.stringify({
              type: 'transcript',
              text: trans.text || '',
              finished: trans.finished === true
            }));
          }
          if (msg.serverContent?.modelTurn?.parts) {
            const text = msg.serverContent.modelTurn.parts.map(p => p.text || '').join('');
            if (text) {
              console.log('Gemini response turn:', text);
            }
          }
        },
        onclose: (ev) => {
          console.log('Gemini Live API WebSocket closed:', ev);
          ws.send(JSON.stringify({ type: 'status', status: 'disconnected', message: 'Koneksi Gemini ditutup' }));
          try {
            ws.close();
          } catch (e) {
            console.error('Error closing client WebSocket:', e.message);
          }
        },
        onerror: (err) => {
          console.error('Gemini Live API WebSocket error:', err);
          ws.send(JSON.stringify({ type: 'error', message: err.message || 'Gemini API Error' }));
        }
      }
    });
  } catch (err) {
    console.error('Failed to connect to Gemini Live API:', err.message);
    ws.send(JSON.stringify({ type: 'error', message: `Gagal inisialisasi Gemini: ${err.message}` }));
    ws.close(1011, err.message);
    return;
  }

  ws.on('message', async (message, isBinary) => {
    if (isBinary) {
      if (geminiSession) {
        try {
          const base64Audio = message.toString('base64');
          geminiSession.sendRealtimeInput({
            audio: {
              data: base64Audio,
              mimeType: 'audio/pcm;rate=16000'
            }
          });
        } catch (e) {
          console.error('Error forwarding audio to Gemini:', e.message);
        }
      }
    } else {
      try {
        const payload = JSON.parse(message.toString());
        if (payload.type === 'stop') {
          console.log(`Received stop command from browser for session ${sessionId}`);
          ws.close();
        }
      } catch (err) {
        console.error('Error parsing JSON message from browser client:', err.message);
      }
    }
  });

  ws.on('close', () => {
    console.log(`WebSocket client disconnected for session: ${sessionId}`);
    if (geminiSession) {
      try {
        geminiSession = null;
      } catch (err) {
        console.error('Error closing Gemini session:', err.message);
      }
    }
  });
});

server.on('upgrade', (request, socket, head) => {
  sessionParser(request, {}, async () => {
    if (!request.session || !request.session.userId) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
    if (pathname.includes('/live')) {
      const urlParts = pathname.split('/');
      const liveIndex = urlParts.indexOf('live');
      const sessionId = liveIndex > 0 ? urlParts[liveIndex - 1] : null;

      if (!sessionId) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }

      try {
        const session = await db.getSession(sessionId, request.session.userId);
        if (!session) {
          socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
          socket.destroy();
          return;
        }
      } catch (err) {
        socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });
});
