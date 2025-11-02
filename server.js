/**
 * server.js
 * - Upload files (pdf, docx, txt, png/jpg)
 * - Extract text (pdf-parse, mammoth, plain txt, Tesseract OCR for images)
 * - Build court-focused prompt
 * - Call Gemini (server-side) and return result
 *
 * Usage: create .env with GEMINI_API_KEY and GEMINI_MODEL (eg: models/gemini-2.5-flash)
 */

require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs').promises;
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const Tesseract = require('tesseract.js');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static('public'));
app.use(express.json());

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const upload = multer({ dest: UPLOAD_DIR });

// Ensure uploads dir exists
const ensureUploads = async () => {
  try { await fs.mkdir(UPLOAD_DIR); } catch (e) { /* exists */ }
};
ensureUploads();

// Helpers: extract text according to mimetype/extension
async function extractTextFromFile(filePath, originalName, mimeType) {
  const ext = path.extname(originalName).toLowerCase();

  try {
    if (ext === '.pdf') {
      const dataBuffer = await fs.readFile(filePath);
      const data = await pdfParse(dataBuffer);
      return data.text || '';
    } else if (ext === '.docx') {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value || '';
    } else if (ext === '.txt') {
      const content = await fs.readFile(filePath, 'utf8');
      return content;
    } else if (['.png', '.jpg', '.jpeg', '.bmp', '.tiff'].includes(ext)) {
      // OCR with tesseract.js
      const { data: { text } } = await Tesseract.recognize(filePath, 'eng+ind', {
        logger: m => {} // suppress logs
      });
      return text || '';
    } else {
      // try read as text fallback
      const content = await fs.readFile(filePath, 'utf8').catch(()=> '');
      return content || '';
    }
  } catch (err) {
    console.error('extractTextFromFile error', err);
    return '';
  }
}

// Build prompt for Gemini - court focused, fast & argumentative
function buildPrompt(caseDescription, fileTexts, options = {}) {
  // fileTexts: array of { filename, text }
  const filesSummary = fileTexts.map(f => `---\nFile: ${f.filename}\n${f.text.substring(0, 4000)}\n`).join('\n');

  const prompt = `
Kamu adalah AsGuJu, Asisten Hukum Digital untuk persidangan yang berjalan di Indonesia.
Tugas: dalam konteks pengadilan (cepat, argumentatif), gabungkan:
  - deskripsi kasus (dari hakim/penuntut/defense),
  - dan informasi pendukung dari file-file yang diupload (lihat ringkasan di bawah).
Hasil harus singkat, terstruktur, dan siap dipakai sebagai memo hukum dalam sidang.

Instruksi ketat:
1) Ambil fakta utama dari deskripsi kasus dan file pendukung.
2) Tentukan pasal-pasal KUHP/UU yang paling relevan (sebut pasal + ringkasan unsur).
3) Berikan argumen hukum yang kuat (point-by-point), setiap poin singkat dan sertakan 1-2 referensi resmi (mis. jurnal, putusan, atau UU) jika relevan — tuliskan nama dokumen + sumber (URL jika diketahui).
4) Jika ada indikasi gangguan jiwa, pembelaan diri, atau pembunuhan berencana, jelaskan alasan mengapa (atau mengapa tidak) secara forensik dan hukum.
5) Ringkas rekomendasi langkah hukum (mis. dakwaan yang sesuai, bukti yang perlu diperkuat, saksi yang direkomendasikan).
6) Output dalam MARKDOWN dengan struktur ini:

**Analisis Kasus: [judul singkat]**

### 1. Ringkasan Fakta
- ...

### 2. Bukti & Temuan dari File Pendukung
- File: filename1 — [ringkasan 1-2 kalimat]
- File: filename2 — [ringkasan 1-2 kalimat]

### 3. Pasal-Pasal Relevan
- Pasal X KUHP: [isi singkat & unsur]

### 4. Argumen Hukum Kuat (poin)
1. ...
   - Referensi: [judul, tahun] (URL jika ada)

### 5. Rekomendasi Proses Persidangan (prioritas)
- ...

Berikan jawaban singkat maksimal ~700 kata. Utamakan kecepatan dan kekuatan argumen untuk digunakan di persidangan. Jangan tulis disclaimer panjang tentang "AI", gunakan gaya formal akademik/hukum.
  
--- 
Deskripsi kasus:
${caseDescription}

File contents (potongan teratas, lebih lengkap di file):
${filesSummary}
`;

  return prompt;
}

// Endpoint: upload files + analyze
app.post('/api/analyze', upload.array('files', 8), async (req, res) => {
  try {
    const caseDescription = req.body.caseDescription || '';
    const files = req.files || [];

    // extract text concurrently
    const extracted = [];
    for (const file of files) {
      const text = await extractTextFromFile(file.path, file.originalname, file.mimetype);
      extracted.push({ filename: file.originalname, text: text || '(tidak ada teks yang diekstrak)' });
    }

    // build prompt
    const prompt = buildPrompt(caseDescription, extracted);

    // call Gemini (server-side). Use GEMINI_API_KEY and GEMINI_MODEL from env
    const API_KEY = process.env.GEMINI_API_KEY;
    const MODEL = process.env.GEMINI_MODEL || 'models/gemini-2.5-flash';
    if (!API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY not configured in .env' });

    // call generateContent
    const endpoint = `https://generativelanguage.googleapis.com/v1/${MODEL}:generateContent?key=${API_KEY}`;

    const body = {
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ],
      // set temperature/controls if supported
    };

    const r = await axios.post(endpoint, body, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 45000
    });

    const data = r.data;
    // parse typical response structure
    const resultText =
      data?.candidates?.[0]?.content?.parts?.[0]?.text
      || data?.output?.[0]?.content?.text
      || JSON.stringify(data).slice(0, 3000);

    // cleanup uploaded files (optional) - keep for debugging? we remove to be tidy
    for (const file of files) {
      try { await fs.unlink(file.path); } catch (e) {}
    }

    return res.json({ success: true, result: resultText, extracted });
  } catch (err) {
    console.error(err?.response?.data || err.message || err);
    return res.status(500).json({ error: 'Server error', detail: err?.response?.data || err?.message });
  }
});

// start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AsGuJu server running on http://localhost:${PORT}`);
});
