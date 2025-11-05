// server.js
// npm i express node-fetch form-data dotenv fs
const express = require('express');
const fs = require('fs');
const fetch = require('node-fetch');
const FormData = require('form-data');
require('dotenv').config();
const path = require('path');

const app = express();
app.use(express.json({ limit: '20mb' }));

const OPENAI_KEY = process.env.OPENAI_KEY;
const ZALO_KEY = process.env.ZALO_KEY;
const PORT = process.env.PORT || 3000;

// Tạo thư mục tmp nếu chưa tồn tại
const tmpDir = path.join(__dirname, 'tmp');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

app.post('/api/process_base64', async (req, res) => {
  try {
    const audioB64 = req.body.audio_b64;
    if (!audioB64) return res.status(400).json({ error: 'No audio' });

    // Save file WAV tạm thời
    const tmpPath = path.join(tmpDir, `upload-${Date.now()}.wav`);
    const bin = Buffer.from(audioB64, 'base64');
    fs.writeFileSync(tmpPath, bin);

    // Prepare multipart form để gọi OpenAI STT
    const form = new FormData();
    form.append('file', fs.createReadStream(tmpPath));
    form.append('model', 'whisper-1');

    const sttResp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_KEY}`
      },
      body: form
    });

    if (!sttResp.ok) {
      const errText = await sttResp.text();
      throw new Error('OpenAI STT error: ' + errText);
    }

    const sttJson = await sttResp.json();
    const userText = sttJson.text || '';
    console.log('STT:', userText);

    // ChatCompletion
    const chatResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Bạn là trợ lý XiaoZhi, trả lời thân thiện bằng tiếng Việt.' },
          { role: 'user', content: userText }
        ],
        max_tokens: 400
      })
    });

    if (!chatResp.ok) {
      const errText = await chatResp.text();
      throw new Error('OpenAI Chat error: ' + errText);
    }

    const chatJson = await chatResp.json();
    const gptReply = (chatJson.choices?.[0]?.message?.content) || "Xin lỗi, tôi chưa hiểu.";

    // Zalo TTS
    const zaloResp = await fetch('https://api.zalo.ai/v1/tts/synthesize', {
      method: 'POST',
      headers: {
        'apikey': ZALO_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: gptReply,
        voice: 'banmai',
        format: 'wav',
        sample_rate: 16000
      })
    });

    if (!zaloResp.ok) {
      const errText = await zaloResp.text();
      throw new Error('Zalo TTS error: ' + errText);
    }

    const audioBuffer = await zaloResp.arrayBuffer();
    const audioBase64 = Buffer.from(audioBuffer).toString('base64');

    // Cleanup file tạm
    try { fs.unlinkSync(tmpPath); } catch (e) { console.warn('Tmp cleanup error:', e.message); }

    res.json({ text: userText, reply: gptReply, tts_base64: audioBase64 });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
