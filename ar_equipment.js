// AR 장비 정보 조회 라우터

const express = require('express');
const router = express.Router();
const { pool } = require('./db');

// AR 장비 정보 조회 쿼리
const AR_EQUIPMENT_QUERY =
  'SELECT id, name, equipment_type, model, serial_no, status' +
  ' FROM equipment' +
  ' WHERE id = $1';
  

// GET /api/ar/device/:uuid
router.get('/:uuid', async (req, res) => {
  const { uuid } = req.params;

  // UUID 형식 간단 검증
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_REGEX.test(uuid)) {
    return res.status(400).json({ success: false, message: '유효한 UUID 형식이 아닙니다' });
  }

  // 
  try {
    const { rows } = await pool.query(AR_EQUIPMENT_QUERY, [uuid]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '해당 장비를 찾을 수 없습니다' });
    }

    const row = rows[0];

    // AR 장비 정보 응답
    return res.status(200).json({
      success: true, // 응답 성공여부
      data: {        // 응답 데이터
        equipmentId:   row.id,            // 장비ID
        equipmentName: row.name,          // 장비명
        equipmentType: row.equipment_type,// 장비유형
        status:        row.status,      // 장비상태
      }
    });
  } catch (err) {
    console.error('[AR] 쿼리 오류:', err.message);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다' });
  }
});

module.exports = router;