import axios from "axios";
import formidable from "formidable";
import fs from "fs";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import Tesseract from "tesseract.js";

export const config = {
  api: { bodyParser: false }
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const form = formidable({ multiples: true });
    const [fields, files] = await form.parse(req);

    const caseDescription = fields.caseDescription?.[0] || "";
    let extractedText = "";

    for (const key in files) {
      const file = files[key][0];
      const fileBuffer = fs.readFileSync(file.filepath);
      const fileType = file.originalFilename.split(".").pop().toLowerCase();

      if (["pdf"].includes(fileType)) {
        const data = await pdfParse(fileBuffer);
        extractedText += `\n\n[${file.originalFilename}]\n${data.text}`;
      } else if (["docx"].includes(fileType)) {
        const data = await mammoth.extractRawText({ buffer: fileBuffer });
        extractedText += `\n\n[${file.originalFilename}]\n${data.value}`;
      } else if (["png", "jpg", "jpeg"].includes(fileType)) {
        const { data: { text } } = await Tesseract.recognize(fileBuffer, "eng");
        extractedText += `\n\n[${file.originalFilename}]\n${text}`;
      } else if (["txt"].includes(fileType)) {
        extractedText += `\n\n[${file.originalFilename}]\n${fs.readFileSync(file.filepath, "utf-8")}`;
      }
    }

    const geminiPrompt = `
Kamu adalah AsGuJu — Asisten Cerdas Penunjang Keputusan Hukum.
Gunakan dasar hukum Indonesia (KUHP, KUHAP, Putusan MA, dan jurnal hukum resmi).
Analisis ringkas, berstruktur, dan relevan dengan fakta serta bukti.

Kasus:
${caseDescription}

File pendukung:
${extractedText}
`;

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${process.env.GEMINI_API_KEY}`,
      { contents: [{ parts: [{ text: geminiPrompt }] }] },
      { headers: { "Content-Type": "application/json" } }
    );

    const output = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "Tidak ada hasil.";
    res.status(200).json({ result: output });
  } catch (err) {
    console.error("API Error:", err);
    res.status(500).json({ error: "Terjadi kesalahan di server.", details: err.message });
  }
}
