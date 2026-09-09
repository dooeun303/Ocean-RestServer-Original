const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const fs       = require('fs');
const path     = require('path');
const FormData = require('form-data');
const fetch    = require('node-fetch');
const { pool } = require('./db');

const UPLOAD_DIR = path.join(__dirname, 'uploads/audio');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename:    (req, file, cb) => cb(null, `audio_${Date.now()}.wav`)
});
const upload = multer({ storage });

console.log('[SUMMARY] API KEY:', process.env.OPENAI_API_KEY?.slice(0, 10));

// =============================================
// POST /api/summary
// body: multipart/form-data { audio: wav파일 }
// 1. Whisper로 음성 → 텍스트
// 2. GPT로 텍스트 → 요약
// =============================================
router.post('/', upload.single('audio'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: '오디오 파일이 없습니다.' });
    }

    const { maintenance_id } = req.body;  // 유지보수 ID
    const filePath = req.file.path;
    const apiKey   = process.env.OPENAI_API_KEY;

    try {
        // ── 1. Whisper STT ──
        console.log('[SUMMARY] Whisper 변환 시작...');
        const formData = new FormData();
        formData.append('file', fs.createReadStream(filePath), {
            filename:    'audio.wav',
            contentType: 'audio/wav',
        });
        formData.append('model', 'whisper-1');
        formData.append('language', 'ko');

        const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method:  'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                ...formData.getHeaders(),
            },
            body: formData,
        });

        const whisperData = await whisperRes.json();
        if (!whisperRes.ok) throw new Error(`Whisper 오류: ${JSON.stringify(whisperData)}`);

        const transcript = whisperData.text;
        console.log('[SUMMARY] 변환 완료:', transcript.slice(0, 50) + '...');

        // ── 2. GPT 요약 ──
        console.log('[SUMMARY] GPT 요약 시작...');
        const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method:  'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type':  'application/json',
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role:    'system',
                        content: '당신은 해수담수화 플랜트 유지보수 전문가입니다. 화상통화 내용을 핵심만 간결하게 요약해주세요. 요약은 3~5줄로 작성하고, 중요한 조치사항이 있으면 별도로 표시해주세요.'
                    },
                    {
                        role:    'user',
                        content: `다음 화상통화 내용을 요약해주세요:\n\n${transcript}`
                    }
                ],
                max_tokens:  500,
                temperature: 0.3,
            }),
        });

        const gptData = await gptRes.json();
        if (!gptRes.ok) throw new Error(`GPT 오류: ${JSON.stringify(gptData)}`);

        const summary = gptData.choices[0].message.content;
        console.log('[SUMMARY] 요약 완료');

        // 오디오 파일 삭제
        fs.unlinkSync(filePath);

        // maintenance_id 있으면 DB에 저장
        if (maintenance_id) {
            await pool.query(
                'UPDATE ttt.maintenance SET ai_summary = $1 WHERE id = $2',
                [summary, maintenance_id]
            );
            console.log('[SUMMARY] DB 저장 완료:', maintenance_id);
        }

        return res.status(200).json({
            success:    true,
            transcript, // 원문
            summary,    // 요약
        });

    } catch (err) {
        console.error('[SUMMARY] 오류:', err.message);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;