# AsGuJu-Pro (demo)
AI Legal Assistant — Node.js demo project

## What is included
- Express server (`server.js`) that accepts file uploads, extracts text (PDF, DOCX, TXT, images via OCR), calls Gemini API and returns structured analysis.
- Frontend in `public/` (index.html, style.css, app.js) — upload UI and result display.
- `.env.example` for configuration.

## Installation
1. Copy the project to your machine.
2. Create `.env` file (copy `.env.example`) and fill `GEMINI_API_KEY`.
3. Install dependencies:
   ```
   npm install
   ```
4. Run the server:
   ```
   npm start
   ```
5. Open http://localhost:3000

## Notes
- This is a **demo**. For production: secure the API key, enable HTTPS, add file encryption, and consider cloud OCR (Google Cloud Vision) for better accuracy.
- The project uses `tesseract.js` for OCR which may be slow for large images; consider using a cloud OCR for production.



This version includes automatic pasal verification attempts using peraturan.bpk.go.id and putusan.mahkamahagung.go.id (best-effort; subject to site availability).
