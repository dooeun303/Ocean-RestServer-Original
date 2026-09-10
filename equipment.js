const express = require('express');
const router = express.Router();
const { pool } = require('./db');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 장비정보 쿼리
const EQUIPMENT_QUERY =
  'SELECT id, name, equipment_type, model, serial_no, status' +
  ' FROM equipment' +
  ' WHERE id = $1';

// 설비 센서 최신값 + 정상범위 (구 GET /api/inspections/equipment/:id/sensors)
const SENSOR_QUERY = `
  SELECT s.id AS sensor_id, s.sensor_type, s.name AS sensor_name, s.unit,
         s.min_threshold, s.max_threshold, sr.value, sr.measured_at,
         CASE
           WHEN s.max_threshold IS NOT NULL AND sr.value > s.max_threshold THEN 'critical'
           WHEN s.min_threshold IS NOT NULL AND sr.value < s.min_threshold THEN 'warning'
           ELSE 'normal'
         END AS status
  FROM sensor s
  JOIN LATERAL (
    SELECT value, measured_at FROM sensor_reading
    WHERE sensor_id = s.id ORDER BY measured_at DESC LIMIT 1
  ) sr ON true
  WHERE s.equipment_id = $1
  ORDER BY s.sensor_type`;

// GET /api/equipment/:id/sensors
router.get('/:id/sensors', async (req, res) => {
  try {
    const { rows } = await pool.query(SENSOR_QUERY, [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '설비를 찾을 수 없습니다.' });
    }
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[EQUIPMENT] 센서 조회 오류:', err.message);
    return res.status(500).json({ success: false, message: '서버 오류' });
  }
});

// GET /api/equipment/:id
router.get('/:id', async (req, res) => {
  const uuid = req.params.id;

  if (!UUID_REGEX.test(uuid)) {
    return res.status(400).json({ success: false, message: '유효한 UUID 형식이 아닙니다' });
  }

  try {
    const { rows } = await pool.query(EQUIPMENT_QUERY, [uuid]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '해당 장비를 찾을 수 없습니다' });
    }

    // uuid로 불러온 장비정보 행
    const row = rows[0];

    // 결과 상태 200 (정상)
    return res.status(200).json({
      success: true,  // 성공 여부
      data: {
        id:            row.id, // 행 ID
        name:          row.name, // 행 이름
        equipment_type: row.equipment_type, // 장비 타입
        model:         row.model, // 모델
        serial_no:      row.serial_no, // 시리얼 번호
        status:        row.status, // 장비 상태
      }
      
    });
  } catch (err) {
    console.error('[EQUIPMENT] 쿼리 오류:', err.message);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다' });
  }
});

module.exports = router;

