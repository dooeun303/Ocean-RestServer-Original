const express = require('express');
const router = express.Router();
const {pool} = require('./db'); // pg Pool 인스턴스

// =============================================
// 1. 오늘의 원격점검 목록
//    GET /api/inspections/today
// =============================================
router.get('/today', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        e.id                  AS equipment_id,
        e.name                AS equipment_name,
        e.equipment_type,
        p.location,
        ri.id                 AS inspection_id,
        ri.result             AS inspection_result,
        ri.note               AS inspection_note,
        ri.scheduled_at,
        ri.completed_at,
        CASE
          WHEN ri.completed_at IS NOT NULL             THEN 'completed'
          WHEN ri.scheduled_at <= NOW()
           AND ri.completed_at IS NULL                 THEN 'pending'
          ELSE 'not_scheduled'
        END                   AS inspection_status,
        a.severity            AS latest_alarm_severity,
        a.triggered_at        AS latest_alarm_at
      FROM equipment e
      JOIN plant p ON e.plant_id = p.id
      LEFT JOIN LATERAL (
        SELECT id, result, note, scheduled_at, completed_at
        FROM remote_inspection
        WHERE equipment_id = e.id
        ORDER BY scheduled_at DESC
        LIMIT 1
      ) ri ON true
      LEFT JOIN LATERAL (
        SELECT severity, triggered_at
        FROM alarm
        WHERE equipment_id = e.id
          AND is_active = true
        ORDER BY triggered_at DESC
        LIMIT 1
      ) a ON true
      WHERE DATE(ri.scheduled_at) = CURRENT_DATE
      ORDER BY
        CASE a.severity
          WHEN 'critical' THEN 1
          WHEN 'warning'  THEN 2
          ELSE 3
        END
    `);

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[GET /inspections/today]', err);
    res.status(500).json({ success: false, message: '서버 오류' });
  }
});


// =============================================
// 2. 설비 센서 최신값 + 정상범위 비교
//    GET /api/inspections/equipment/:equipmentId/sensors
// =============================================
router.get('/equipment/:equipmentId/sensors', async (req, res) => {
  const { equipmentId } = req.params;

  try {
    const { rows } = await pool.query(`
      SELECT
        s.id            AS sensor_id,
        s.sensor_type,
        s.name          AS sensor_name,
        s.unit,
        s.min_threshold,
        s.max_threshold,
        sr.value,
        sr.measured_at,
        CASE
          WHEN s.max_threshold IS NOT NULL AND sr.value > s.max_threshold THEN 'critical'
          WHEN s.min_threshold IS NOT NULL AND sr.value < s.min_threshold THEN 'warning'
          ELSE 'normal'
        END             AS status
      FROM sensor s
      JOIN LATERAL (
        SELECT value, measured_at
        FROM sensor_reading
        WHERE sensor_id = s.id
        ORDER BY measured_at DESC
        LIMIT 1
      ) sr ON true
      WHERE s.equipment_id = $1
      ORDER BY s.sensor_type
    `, [equipmentId]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '설비를 찾을 수 없습니다.' });
    }

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[GET /inspections/equipment/:id/sensors]', err);
    res.status(500).json({ success: false, message: '서버 오류' });
  }
});


// =============================================
// 3. 원격점검 결과 저장 (기존 레코드 UPDATE)
//    PATCH /api/inspections/:inspectionId
//    body: { equipment_id, inspector_id, result, note }
// =============================================
router.patch('/:inspectionId', async (req, res) => {
  const { inspectionId } = req.params;
  const { equipment_id, inspector_id, result, note } = req.body;

  // 유효성 검사
  if (!inspectionId || !equipment_id || !inspector_id || !result) {
    return res.status(400).json({
      success: false,
      message: 'inspectionId, equipment_id, inspector_id, result 는 필수입니다.',
    });
  }

  if (!['normal', 'issue_found'].includes(result)) {
    return res.status(400).json({
      success: false,
      message: "result 는 'normal' 또는 'issue_found' 만 가능합니다.",
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // remote_inspection UPDATE
    const { rows: inspectionRows } = await client.query(`
      UPDATE remote_inspection
      SET
        result       = $1,
        note         = $2,
        inspector_id = $3,
        completed_at = NOW()
      WHERE id = $4
      RETURNING *
    `, [result, note ?? null, inspector_id, inspectionId]);

    if (inspectionRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: '점검 데이터를 찾을 수 없습니다.' });
    }

    const inspection = inspectionRows[0];

    // 이상 발견 시 알람 INSERT
    let alarm = null;
    if (result === 'issue_found') {
      const { rows: alarmRows } = await client.query(`
        INSERT INTO alarm (
          id, equipment_id, alarm_code,
          severity, description, is_active, triggered_at
        ) VALUES (
          gen_random_uuid(), $1, 'REMOTE_INSPECTION_ISSUE',
          'critical', $2, true, NOW()
        )
        RETURNING *
      `, [equipment_id, note ?? '원격점검 결과 이상 발견']);

      alarm = alarmRows[0];

      // 알람 로그 INSERT
      await client.query(`
        INSERT INTO alarm_log (id, alarm_id, event_type, handled_by, note, created_at)
        VALUES (gen_random_uuid(), $1, 'triggered', $2, '원격점검 중 이상 감지', NOW())
      `, [alarm.id, inspector_id]);

      // notification INSERT (MR, 모니터링, AR)
      await client.query(`
        INSERT INTO notification (id, alarm_id, platform, recipient_id, is_read, sent_at)
        VALUES
          (gen_random_uuid(), $1, 'MR',         $2, false, NOW()),
          (gen_random_uuid(), $1, 'monitoring', $2, false, NOW()),
          (gen_random_uuid(), $1, 'AR',         $2, false, NOW())
      `, [alarm.id, inspector_id]);
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      data: { inspection, alarm },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[PATCH /inspections/:id]', err);
    res.status(500).json({ success: false, message: '서버 오류' });
  } finally {
    client.release();
  }
});

module.exports = router;