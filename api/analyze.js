import formidable from "formidable";
import fs from "fs/promises";
import pdf from "pdf-parse";
import mammoth from "mammoth";
import Tesseract from "tesseract.js";
import axios from "axios";

export const config = {
  api: {
    bodyParser: false, // penting supaya bisa upload file
  },
};

async function extractText(filePath, name) {
  const ext = name.split(".").pop().toLowerCase();
  if (ext === "pdf") {
    const data = await fs.readFile(filePath);
    return (await pdf(data)).text;
  } else if (ext === "docx") {
    return (await mammoth.extractRawText({ path: filePath })).value;
  } else if (ext === "txt") {
    return await fs.readFile(filePath, "utf8");
  } else if (["png", "jpg", "jpeg"].includes(ext)) {
    const { data } = await Tesseract.recognize(filePath, "eng+ind");
    return data.text;
  }
  return "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const form = formidable({});
  const [fields, files] = await form.parse(req);

  const caseDesc = fields.caseDescription?.[0] || "";
  const uploadedFiles = files.files || [];

  const extracted = [];
  for (const file of uploadedFiles) {
    const text = await extractText(file.filepath, file.originalFilename);
    extracted.push({ filename: file.originalFilename, text });
  }

  const prompt = `
You are AsGuJu Pro, an Indonesian legal assistant...
Case: ${caseDesc}
Files: ${extracted.map(f => f.filename).join(", ")}
`;

  const endpoint = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const body = { contents: [{ role: "user", parts: [{ text: prompt }] }] };
  const r = await axios.post(endpoint, body, { headers: { "Content-Type": "application/json" } });
  const text = r.data?.candidates?.[0]?.content?.parts?.[0]?.text || "No response";

  res.json({ success: true, result: text, extracted });
}
