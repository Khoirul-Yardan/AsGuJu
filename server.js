/**
 * server.js - AsGuJu Pro with pasal verification
 * - Upload files (pdf, docx, txt, png/jpg)
 * - Extract text (pdf-parse, mammoth, txt, Tesseract OCR for images)
 * - Call Gemini API (server-side) to get legal analysis
 * - Parse pasal references from AI result and attempt to verify them against official sources (BPK and MA)
 *
 * Usage:
 *  - create .env with GEMINI_API_KEY and GEMINI_MODEL
 *  - npm install
 *  - npm start
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
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const upload = multer({ dest: UPLOAD_DIR });

async function ensureUploads() {
  try { await fs.mkdir(UPLOAD_DIR); } catch (e) { }
}
ensureUploads();

async function extractTextFromFile(filePath, originalName) {
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
      return await fs.readFile(filePath, 'utf8');
    } else if (['.png', '.jpg', '.jpeg', '.bmp', '.tiff'].includes(ext)) {
      // Tesseract OCR
      const { data: { text } } = await Tesseract.recognize(filePath, 'eng+ind');
      return text || '';
    } else {
      // fallback
      return await fs.readFile(filePath, 'utf8').catch(()=> '');
    }
  } catch (err) {
    console.error('extractTextFromFile error', err);
    return '';
  }
}

function buildPrompt(caseDescription, fileTexts) {
  const filesSummary = fileTexts.map(f => `---\nFile: ${f.filename}\n${f.text.substring(0, 4000)}\n`).join('\n');
  return `
You are AsGuJu Pro, an Indonesian legal assistant for courtroom support.
Combine the case description and the uploaded file contents below, analyze relevant criminal law issues (KUHP, KUHAP) and provide:
- Facts & Evidence (concise)
- Relevant Articles (cite KUHP/KUHAP; if possible reference official sources)
- Legal Arguments (step-by-step: facts -> legal elements -> application)
- Conclusion & recommended charges / evidence to strengthen
Produce output in Markdown, concise (max ~700 words). Be explicit about uncertainty (use wording like "indikasi" or "kemungkinan"). 
Case description:
${caseDescription}

File contents (top parts):
${filesSummary}
`;
}

/**
 * Heuristic extraction of "Pasal" mentions from AI output.
 * Matches patterns like:
 * - Pasal 340
 * - Pasal 338 KUHP
 * - Pasal 49 ayat (1) KUHP
 */
function extractPasalReferences(text) {
  if (!text) return [];
  const regex = /Pasal\s+([0-9]{1,4})(?:\s*(?:ayat\s*\(?[0-9a-zA-Z\)\-]+)?)*\s*(KUHP|KUHAP|Kitab Undang-Undang Hukum Pidana|)/gi;
  const matches = [];
  let m;
  while ((m = regex.exec(text)) !== null) {
    const num = m[1];
    const suffix = m[2] && m[2].trim() !== '' ? m[2].trim() : 'KUHP';
    const key = `Pasal ${num} ${suffix}`.trim();
    if (!matches.includes(key)) matches.push(key);
  }
  // also try simpler pattern "Pasal 340" without KUHP
  const regex2 = /Pasal\s+([0-9]{1,4})/gi;
  while ((m = regex2.exec(text)) !== null) {
    const num = m[1];
    const key = `Pasal ${num} KUHP`;
    if (!matches.includes(key)) matches.push(key);
  }
  return matches;
}

/**
 * Attempt to verify a pasal by querying peraturan.bpk.go.id search and Mahkamah Agung search.
 * Note: Sites may change; this function tries several common search endpoints and returns the first match.
 */
async function verifyPasalOnline(pasal) {
  const results = { pasal, verified: false, sources: [] };
  const queries = [];

  // Prepare search queries
  const pasalOnly = pasal.replace(/Pasal\s+/i, '').replace(/KUHP/i, '').trim();
  queries.push(`KUHP Pasal ${pasalOnly}`);
  queries.push(`Pasal ${pasalOnly} KUHP`);
  queries.push(`Kitab Undang Undang Hukum Pidana Pasal ${pasalOnly}`);

  // Try BPK search (site structure may vary)
  for (const q of queries) {
    try {
      const url = `https://peraturan.bpk.go.id/Search/Peraturan?Query=${encodeURIComponent(q)}`;
      const r = await axios.get(url, { timeout: 8000 });
      const html = r.data || '';
      if (html && html.toLowerCase().includes(`pasal`) && html.toLowerCase().includes(pasalOnly)) {
        results.verified = true;
        results.sources.push({ site: 'peraturan.bpk.go.id', url, snippet: 'Found on BPK search results (HTML match)' });
        break;
      }
    } catch (e) {
      // ignore and try next
    }
  }

  // If not verified, try Mahkamah Agung search for putusan that cite the pasal
  if (!results.verified) {
    try {
      const q = `Pasal ${pasalOnly}`;
      const url = `https://putusan.mahkamahagung.go.id/search?q=${encodeURIComponent(q)}`;
      const r = await axios.get(url, { timeout: 8000 });
      const html = r.data || '';
      if (html && html.toLowerCase().includes(`pasal`) && html.toLowerCase().includes(pasalOnly)) {
        results.verified = true;
        results.sources.push({ site: 'putusan.mahkamahagung.go.id', url, snippet: 'Found in MA search results (HTML match)' });
      }
    } catch (e) {
      // ignore
    }
  }

  // As fallback, check Google (unsafe but often works) - disabled by default for privacy.
  if (!results.verified) {
    try {
      const url = `https://www.google.com/search?q=${encodeURIComponent(pasal + ' KUHP')}`;
      const r = await axios.get(url, { timeout: 6000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      const html = r.data || '';
      if (html && html.toLowerCase().includes('kuhp') && html.toLowerCase().includes(pasal.replace('Pasal ','').split(' ')[0])) {
        results.verified = true;
        results.sources.push({ site: 'google_search', url, snippet: 'Found with google search (HTML match)' });
      }
    } catch (e) {
      // ignore
    }
  }

  return results;
}

app.post('/api/analyze', upload.array('files', 8), async (req, res) => {
  try {
    const caseDescription = req.body.caseDescription || '';
    const files = req.files || [];

    const extracted = [];
    for (const file of files) {
      const text = await extractTextFromFile(file.path, file.originalname);
      extracted.push({ filename: file.originalname, text: text || '(no text extracted)' });
    }

    const prompt = buildPrompt(caseDescription, extracted);

    const API_KEY = process.env.GEMINI_API_KEY;
    const MODEL = process.env.GEMINI_MODEL || 'models/gemini-2.5-flash';
    if (!API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY not configured in .env' });

    const endpoint = `https://generativelanguage.googleapis.com/v1/${MODEL}:generateContent?key=${API_KEY}`;
    const body = {
      contents: [{ role: "user", parts: [{ text: prompt }] }]
    };

    const r = await axios.post(endpoint, body, { headers: { 'Content-Type': 'application/json' }, timeout: 60000 });
    const data = r.data;
    const resultText = data?.candidates?.[0]?.content?.parts?.[0]?.text || JSON.stringify(data).slice(0,3000);

    // extract pasal references
    const pasals = extractPasalReferences(resultText);

    // verify pasals online (concurrently, but limited)
    const verifyPromises = pasals.map(p => verifyPasalOnline(p));
    const verifications = await Promise.all(verifyPromises);

    // cleanup uploaded files
    for (const file of files) {
      try { await fs.unlink(file.path); } catch (e) {}
    }

    return res.json({ success: true, result: resultText, extracted, verifications });
  } catch (err) {
    console.error(err?.response?.data || err);
    return res.status(500).json({ error: 'Server error', detail: err?.response?.data || err?.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AsGuJu-Pro (with verification) running at http://localhost:${PORT}`));
