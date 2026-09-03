const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const FormData = require('form-data');
const fetch    = require('node-fetch');

// =============================================
// POST /api/stt  (프록시)
// body: multipart/form-data { file: 오디오(wav/mp3/ogg) }
// 응답: { success: true, text: "인식된 문장" }  /  { success: false, error: "..." }
//
// 실제 전사는 내부 faster-whisper 서비스(stt_service.py, 127.0.0.1:8900)가 한다. 외부(Unity/
// INMO 글래스)엔 이 3000 포트만 노출하고 8900은 localhost 전용 → 방화벽에 포트 하나 안 열어도 됨.
// stt_service.py는 index.js(stt_autostart.js)가 서버와 함께 자동으로 띄운다.
// =============================================
const STT_INTERNAL_URL = process.env.STT_INTERNAL_URL || 'http://127.0.0.1:8900/api/stt';

const upload = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: 25 * 1024 * 1024 },
});

router.post('/', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'file 필드가 없습니다.' });
    }

    try {
        const form = new FormData();
        form.append('file', req.file.buffer, {
            filename:    req.file.originalname || 'audio.wav',
            contentType: req.file.mimetype || 'audio/wav',
        });

        const upstream = await fetch(STT_INTERNAL_URL, {
            method:  'POST',
            headers: form.getHeaders(),
            body:    form,
        });

        const data = await upstream.json().catch(() => ({}));
        if (data && data.text) {
            console.log('[STT] 전사 완료:', String(data.text).slice(0, 50) + '...');
        }
        return res.status(upstream.status).json(data);

    } catch (err) {
        console.error('[STT] 프록시 오류:', err.message);
        return res.status(502).json({
            success: false,
            error: `STT 서비스(8900) 연결 실패: ${err.message}. stt_service.py 실행 여부 확인.`,
        });
    }
});

module.exports = router;
