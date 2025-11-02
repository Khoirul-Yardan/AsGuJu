const fileInput = document.getElementById('fileInput');
const fileList = document.getElementById('fileList');
const analyzeBtn = document.getElementById('analyzeBtn');
const clearBtn = document.getElementById('clearBtn');
const caseDesc = document.getElementById('caseDesc');
const resultArea = document.getElementById('resultArea');

let filesToUpload = [];

fileInput.addEventListener('change', (e) => {
  const files = Array.from(e.target.files);
  addFiles(files);
});

function addFiles(files) {
  files.forEach(f => {
    filesToUpload.push(f);
    const item = document.createElement('div');
    item.className = 'file-item';
    item.innerHTML = `<div class="meta">${f.name} • ${Math.round(f.size/1024)} KB</div>
                      <div><button data-name="${f.name}">Hapus</button></div>`;
    fileList.appendChild(item);
    item.querySelector('button').addEventListener('click', () => {
      filesToUpload = filesToUpload.filter(x => x.name !== f.name);
      fileList.removeChild(item);
    });
  });
}

clearBtn.addEventListener('click', () => {
  filesToUpload = [];
  fileList.innerHTML = '';
  caseDesc.value = '';
  resultArea.innerHTML = '<p class="hint">Hasil akan muncul di sini.</p>';
});

analyzeBtn.addEventListener('click', async () => {
  const description = caseDesc.value.trim();
  if (!description && filesToUpload.length === 0) {
    alert('Isi deskripsi kasus atau upload file pendukung terlebih dahulu.');
    return;
  }

  resultArea.innerHTML = `<div class="result-card"><h3>⏳ Mengirim ke AsGuJu...</h3><p>Mohon tunggu sebentar — fokus pada argumen persidangan.</p></div>`;

  try {
    const form = new FormData();
    form.append('caseDescription', description);
    filesToUpload.forEach(f => form.append('files', f, f.name));

    const res = await fetch('/api/analyze', { method: 'POST', body: form });
    const data = await res.json();

    if (!data.success) {
      resultArea.innerHTML = `<div class="result-card"><h3>⚠️ Error</h3><p>${data.error || 'Server error'}</p></div>`;
      return;
    }

    // display extracted file summaries
    let html = `<div class="result-card"><h3>📄 Bukti & Ekstraksi</h3>`;
    if (data.extracted && data.extracted.length) {
      html += '<ul>';
      data.extracted.forEach(f => {
        const snippet = (f.text || '').substring(0, 380).replace(/\n/g,'<br>');
        html += `<li><strong>${f.filename}:</strong> ${snippet}... </li>`;
      });
      html += '</ul>';
    } else {
      html += '<p class="meta">Tidak ada teks yang diekstrak dari file.</p>';
    }
    html += `</div>`;

    // Render Gemini result (markdown)
    const md = data.result || 'Tidak ada hasil dari AI.';
    html += `<div class="result-card"><h3>⚖️ Hasil Analisis (AsGuJu)</h3><div>${marked.parse(md)}</div></div>`;

    // Render verifications
    if (data.verifications && data.verifications.length) {
      html += `<div class="result-card"><h3>🔎 Verifikasi Pasal</h3><ul>`;
      data.verifications.forEach(v => {
        if (v.verified) {
          v.sources.forEach(s => {
            html += `<li><strong>${v.pasal}</strong> — Terverifikasi melalui ${s.site}: <a href="${s.url}" target="_blank">${s.url}</a> (${s.snippet})</li>`;
          });
        } else {
          html += `<li><strong>${v.pasal}</strong> — Tidak ditemukan verifikasi otomatis. Mohon cek manual di BPK/MA.</li>`;
        }
      });
      html += `</ul></div>`;
    }

    resultArea.innerHTML = html;
  } catch (err) {
    console.error(err);
    resultArea.innerHTML = `<div class="result-card"><h3>❌ Gagal</h3><p>Terjadi kesalahan saat meminta server.</p></div>`;
  }
});
