const express = require('express');
const router = express.Router();
const { pool } =require('./db');

// 전체 알람 조회 쿼리
const ALARM_LIST_QUERY =
  'SELECT a.id, a.alarm_code, a.severity, a.description, a.is_active, a.triggered_at,' +
  ' e.id AS equipment_id, e.name AS equipment_name, e.mr_space_id' +
  ' FROM alarm a JOIN equipment e ON e.id = a.equipment_id' +
  ' ORDER BY a.triggered_at DESC';
 
// 활성화된 알람 조회 쿼리
const ALARM_LIST_ACTIVE_QUERY =
  'SELECT a.id, a.alarm_code, a.severity, a.description, a.is_active, a.triggered_at,' +
  ' e.id AS equipment_id, e.name AS equipment_name, e.mr_space_id' +
  ' FROM alarm a JOIN equipment e ON e.id = a.equipment_id' +
  ' WHERE a.is_active = true' +
  ' ORDER BY a.triggered_at DESC';

// GET /api/alarm?active=true (활성화된 알람만 조회) 또는 GET /api/alarm (전체 알람 조회)
router.get('/', async (req, res) => {
    const activeOnly = req.query.active === 'true';

    // activeOnly가 true면 활성화된 알람만 조회, 아니면 전체 알람 조회
    try {
        const {rows} = await pool.query(
            activeOnly ? ALARM_LIST_ACTIVE_QUERY : ALARM_LIST_QUERY
        ); 

        // 알람 목록 응답 (json)
        return res.status(200).json({
            success: true,
            data: rows.map(row => ({
                id: row.id,
                alarm_code: row.alarm_code,
                severity: row.severity,
                description: row.description,
                is_active: row.is_active,
                triggered_at: row.triggered_at,
                equipment: {
                    id: row.equipment_id,
                    name: row.equipment_name,
                    mr_space_id: row.mr_space_id
                },
            })),
        });
    } catch (err) { // 쿼리오류 발생시 500 에러 응답
        console.error('[ALARM] 쿼리 오류', err.message);
        return res.status(500).json({success:false, message: '서버 오류 발생'});
    }
});


module.exports = router;