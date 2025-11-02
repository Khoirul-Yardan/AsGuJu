const API_KEY = "AIzaSyCeLIo2cgnWybGFaz63VGbk-zV51Q7iR9A"; // Ganti dengan API Key kamu
const MODEL = "models/gemini-2.5-flash";

const chatBox = document.getElementById("chat-box");
const userInput = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");

sendBtn.addEventListener("click", sendMessage);

async function sendMessage() {
  const text = userInput.value.trim();
  if (!text) return;

  addMessage("user", text);
  userInput.value = "";

  const loading = addMessage("bot", "⏳ Sedang menganalisis berdasarkan KUHP...");

  const legalPrompt = `
Kamu adalah AsGuJu, Asisten Hukum Digital untuk Hakim Indonesia.
Analisis berikut berdasarkan KUHP dan hukum positif Indonesia.

${text}

Tulis hasil dalam format markdown yang rapi dengan struktur:

**Analisis Kasus: [judul kasus]**

### 1. Identifikasi Hukum
### 2. Pasal-Pasal Relevan
### 3. Unsur-Unsur Hukum
### 4. Argumentasi Hukum
### 5. Kesimpulan
`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${MODEL}:generateContent?key=${API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: legalPrompt }] }],
        }),
      }
    );

    const data = await res.json();
    chatBox.removeChild(loading);

    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || 
                  "⚠️ Tidak ada respons dari server.";
    addFormattedMessage("bot", reply);
  } catch (error) {
    chatBox.removeChild(loading);
    addMessage("bot", "⚠️ Terjadi kesalahan dalam koneksi API.");
    console.error(error);
  }
}

function addMessage(sender, text) {
  const msg = document.createElement("div");
  msg.className = `message ${sender}`;
  msg.textContent = text;
  chatBox.appendChild(msg);
  chatBox.scrollTop = chatBox.scrollHeight;
  return msg;
}

function addFormattedMessage(sender, markdownText) {
  const msg = document.createElement("div");
  msg.className = `message ${sender}`;
  msg.innerHTML = marked.parse(markdownText); // gunakan library markdown parser
  chatBox.appendChild(msg);
  chatBox.scrollTop = chatBox.scrollHeight;
}
