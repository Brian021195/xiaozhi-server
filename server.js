// server.js
// npm i express node-fetch form-data dotenv
const express = require('express');
const fs = require('fs');
const fetch = require('node-fetch');
const FormData = require('form-data');
require('dotenv').config();

const app = express();
app.use(express.json({limit: '20mb'}));

const OPENAI_KEY = process.env.OPENAI_KEY;
const ZALO_KEY = process.env.ZALO_KEY; // theo Zalo doc
const PORT = process.env.PORT || 3000;

app.post('/api/process_base64', async (req, res) => {
  try {
    const audioB64 = req.body.audio_b64;
    if (!audioB64) return res.status(400).json({error:'no audio'});
    // save to temp wav
    const bin = Buffer.from(audioB64, 'base64');
    const tmpPath = './tmp/upload.wav';
    fs.writeFileSync(tmpPath, bin);
    // prepare multipart to OpenAI transcription
    const form = new FormData();
    form.append('file', fs.createReadStream(tmpPath));
    form.append('model', 'whisper-1');
    // call OpenAI transcription
    const sttResp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_KEY}`
      },
      body: form
    });
    const sttJson = await sttResp.json();
    const userText = sttJson.text || '';
    console.log('STT:', userText);
    // chat with OpenAI ChatCompletion
    const chatResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {role:'system', content: 'Bạn là trợ lý XiaoZhi, trả lời thân thiện bằng tiếng Việt.'},
          {role:'user', content: userText}
        ],
        max_tokens: 400
      })
    });
    const chatJson = await chatResp.json();
    const gptReply = (chatJson.choices && chatJson.choices[0] && chatJson.choices[0].message && chatJson.choices[0].message.content) || "Xin lỗi, tôi chưa hiểu.";

    // call Zalo TTS (example pseudo - follow Zalo doc for exact auth/endpoint)
    // Here assume ZALO returns binary audio (wav) directly
    const zaloResp = await fetch('https://api.zalo.ai/v1/tts/synthesize', {
      method: 'POST',
      headers: {
        'apikey': ZALO_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: gptReply,
        voice: 'banmai', // example voice id
        format: 'wav',
        sample_rate: 16000
      })
    });
    const audioBuffer = await zaloResp.arrayBuffer();
    const audioBase64 = Buffer.from(audioBuffer).toString('base64');

    // cleanup
    try { fs.unlinkSync(tmpPath); } catch(e){}

    res.json({ text: userText, reply: gptReply, tts_base64: audioBase64 });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

app.listen(PORT, () => console.log('Server listening', PORT));
