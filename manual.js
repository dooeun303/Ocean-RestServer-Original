const express = require('express');
const router  = express.Router();
const { pool } = require('./db');

// =============================================
// 1. GET /api/manual?equipment_id=xxx&category=REGULAR
//    장비 + 작업타입(category)으로 매뉴얼 필터링
// =============================================
router.get('/', async (req, res) => {
    const { equipment_id, category } = req.query;

    try {
        let query  = 'SELECT id, title, category, content_url FROM ttt.manual WHERE 1=1';
        let params = [];
        let idx    = 1;

        if (equipment_id) {
            query += ` AND equipment_id = $${idx++}`;
            params.push(equipment_id);
        }

        if (category) {
            query += ` AND category = $${idx++}`;
            params.push(category);
        }

        query += ' ORDER BY title ASC';

        const { rows } = await pool.query(query, params);
        return res.status(200).json({ success: true, data: rows });
    } catch (err) {
        console.error('[MANUAL] 조회 오류:', err.message);
        return res.status(500).json({ success: false, message: '서버 오류' });
    }
});


// =============================================
// 2. GET /api/manual/equipment
//    장비 목록 조회 (드롭다운용)
// =============================================
router.get('/equipment', async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT id, name FROM ttt.equipment ORDER BY name ASC'
        );
        return res.status(200).json({ success: true, data: rows });
    } catch (err) {
        console.error('[MANUAL] 장비 조회 오류:', err.message);
        return res.status(500).json({ success: false, message: '서버 오류' });
    }
});

module.exports = router;