const express = require('express');
const router  = express.Router();
const { pool } = require('./db');

// =============================================
// GET /api/codes?group=RESP10
//   system_code 공통코드 그룹 조회
//   응답: { success, data: [{ id: code, name: code_nm, name_en: code_enm }] }
//   (구 /api/maintenance/result-categories, /api/support-calls/result-options 통합)
// =============================================
router.get('/', async (req, res) => {
    const { group } = req.query;
    if (!group) {
        return res.status(400).json({ success: false, message: 'group 파라미터가 필요합니다.' });
    }
    try {
        const { rows } = await pool.query(
            'SELECT code AS id, code_nm AS name, code_enm AS name_en FROM system_code WHERE group_cd = $1 ORDER BY code ASC',
            [group]
        );
        return res.status(200).json({ success: true, data: rows });
    } catch (err) {
        console.error('[CODES] 조회 오류:', err.message);
        return res.status(500).json({ success: false, message: '서버 오류' });
    }
});

module.exports = router;
