const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const { pool } = require('./db');

// =============================================
// 업로드 폴더 설정
// =============================================
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// multer 설정
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename:    (req, file, cb) => {
        const ext      = path.extname(file.originalname);
        const basename = path.basename(file.originalname, ext);
        const unique   = Date.now();
        cb(null, `${basename}_${unique}${ext}`);
    }
});

const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'application/pdf'];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('허용되지 않는 파일 형식입니다.'));
    },
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});


// =============================================
// 1. GET /api/files?type=general — 파일 목록 조회 (type 필터링)
// =============================================
router.get('/', async (req, res) => {
    const { type } = req.query;
    try {
        const { rows } = type
            ? await pool.query(
                'SELECT id, name, url, mime_type, size, created_at FROM ttt.file WHERE type = $1 ORDER BY created_at DESC',
                [type]
              )
            : await pool.query(
                'SELECT id, name, url, mime_type, size, created_at FROM ttt.file ORDER BY created_at DESC'
              );
        return res.status(200).json({ success: true, data: rows });
    } catch (err) {
        console.error('[FILES] 목록 조회 오류:', err.message);
        return res.status(500).json({ success: false, message: '서버 오류' });
    }
});


// =============================================
// 2. POST /api/files — 파일 업로드
// =============================================
router.post('/', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: '파일이 없습니다.' });
    }

    const { originalname, mimetype, size, filename } = req.file;
    const url = `/uploads/${filename}`;

    try {
        const { rows } = await pool.query(
            `INSERT INTO ttt.file (id, name, url, mime_type, size)
             VALUES (gen_random_uuid(), $1, $2, $3, $4)
             RETURNING *`,
            [originalname, url, mimetype, size]
        );
        return res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
        console.error('[FILES] 업로드 오류:', err.message);
        return res.status(500).json({ success: false, message: '서버 오류' });
    }
});


// =============================================
// 3. DELETE /api/files/:id — 파일 삭제
// =============================================
router.delete('/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const { rows } = await pool.query(
            'DELETE FROM ttt.file WHERE id = $1 RETURNING *',
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: '파일을 찾을 수 없습니다.' });
        }

        // 로컬 파일도 삭제
        const filePath = path.join(__dirname, rows[0].url);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

        return res.status(200).json({ success: true });
    } catch (err) {
        console.error('[FILES] 삭제 오류:', err.message);
        return res.status(500).json({ success: false, message: '서버 오류' });
    }
});


// =============================================
// 4. POST /api/files/instruction
//    지시 이미지 업로드 후 AR로 WebSocket 전송
// =============================================
router.post('/instruction', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: '파일이 없습니다.' });
    }

    const { originalname, mimetype, size, filename } = req.file;
    const url = `/uploads/${filename}`;

    try {
        // DB 저장
        const { rows } = await pool.query(
            `INSERT INTO ttt.file (id, name, url, mime_type, size)
             VALUES (gen_random_uuid(), $1, $2, $3, $4)
             RETURNING *`,
            [originalname, url, mimetype, size]
        );

        // AR로 WebSocket 전송
        const { sendTo } = require('./ws');
        sendTo('AR', {
            type:     'file_share',
            file_id:  rows[0].id,
            file_url: url,
        });

        console.log('[FILES] 지시 이미지 AR 전송 완료:', url);
        return res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
        console.error('[FILES] 지시 이미지 업로드 오류:', err.message);
        return res.status(500).json({ success: false, message: '서버 오류' });
    }
});

module.exports = router;

