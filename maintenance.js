const express = require('express');
const router = express.Router();
const { pool } = require('./db');

// 전체 유지보수 이력 조회
const LIST_QUERY = 'SELECT m.id, m.equipment_id, m.work_type, m.description, m.result, m.status, m.scheduled_at, m.completed_at, m.technician_id, t.name AS technician_name, ' +
    'e.name AS equipment_name, e.mr_space_id, ' +
    'mn.title AS manual_title, mn.category AS manual_category, mn.content_url, ' +
    'a.id AS alarm_id, a.alarm_code, a.severity, a.description AS alarm_desc, a.triggered_at' +
    ' FROM maintenance_log m' +
    ' JOIN equipment e ON e.id = m.equipment_id' +
    ' LEFT JOIN ttt.technician t ON t.id = m.technician_id' +
    ' LEFT JOIN manual mn ON mn.id = m.manual_id' +
    ' LEFT JOIN LATERAL (' +
    '   SELECT id, alarm_code, severity, description, triggered_at' +
    '   FROM alarm' +
    '   WHERE equipment_id = m.equipment_id AND is_active = true' +
    '   ORDER BY triggered_at DESC LIMIT 1' +
    ' ) a ON true' +
    ' ORDER BY m.scheduled_at ASC';

// 상태로 유지보수 이력 조회
const LIST_BY_STATUS_QUERY = 'SELECT m.id, m.equipment_id, m.work_type, m.description, m.result, m.status, m.scheduled_at, m.completed_at, m.technician_id, t.name AS technician_name, ' +
    'e.name AS equipment_name, e.mr_space_id, ' +
    'mn.title AS manual_title, mn.category AS manual_category, mn.content_url, ' +
    'a.id AS alarm_id, a.alarm_code, a.severity, a.description AS alarm_desc, a.triggered_at' +
    ' FROM maintenance_log m' +
    ' JOIN equipment e ON e.id = m.equipment_id' +
    ' LEFT JOIN ttt.technician t ON t.id = m.technician_id' +
    ' LEFT JOIN manual mn ON mn.id = m.manual_id' +
    ' LEFT JOIN LATERAL (' +
    '   SELECT id, alarm_code, severity, description, triggered_at' +
    '   FROM alarm' +
    '   WHERE equipment_id = m.equipment_id AND is_active = true' +
    '   ORDER BY triggered_at DESC LIMIT 1' +
    ' ) a ON true' +
    ' WHERE m.status = $1' +
    ' ORDER BY m.scheduled_at ASC';

// 유지보수 이력 상세 정보 쿼리
const DETAIL_QUERY = 'SELECT m.id, m.work_type, m.description, m.result, m.status,' +
    ' m.scheduled_at, m.completed_at, m.technician_id,' +
    ' e.id AS equipment_id, e.name AS equipment_name, e.mr_space_id,' +
    ' mn.id AS manual_id, mn.title AS manual_title,' +
    ' mn.category AS manual_category, mn.content_url,' +
    ' a.id AS alarm_id, a.alarm_code, a.severity, a.description AS alarm_desc,' +
    ' a.triggered_at' +
    ' FROM maintenance_log m' +
    ' JOIN equipment e ON e.id = m.equipment_id' +
    ' LEFT JOIN manual mn ON mn.id = m.manual_id' +
    ' LEFT JOIN alarm a ON a.equipment_id = m.equipment_id AND a.is_active = true' +
    ' WHERE m.id = $1' +
    ' LIMIT 1';

// 유지보수 이력 업데이트 쿼리
// ai_summary 컬럼이 있으면 같이 저장하고, 없는 DB(42703)면 자동으로 아래 축약 쿼리로 폴백한다.
const UPDATE_QUERY_WITH_SUMMARY = 'UPDATE maintenance_log ' +
    'SET status = $1, result = $2, ai_summary = $3, ' +
    'completed_at = CASE WHEN $1 = \'completed\' THEN NOW() ELSE completed_at END ' +
    'WHERE id = $4 ' +
    'RETURNING *';
const UPDATE_QUERY = 'UPDATE maintenance_log ' +
    'SET status = $1, result = $2, completed_at = CASE WHEN $1 = \'completed\' THEN NOW() ELSE completed_at END ' +
    'WHERE id = $3 ' +
    'RETURNING *';


// 1. GET /api/maintenance?status=scheduled (상태별 조회) 또는 GET /api/maintenance (전체 조회)
router.get('/', async (req, res) => {
    const { status } = req.query;

    try {
        const { rows } = status
            ? await pool.query(LIST_BY_STATUS_QUERY, [status])
            : await pool.query(LIST_QUERY);

        return res.status(200).json({
            success: true,
            data: rows.map(row => ({
                id:           row.id,
                work_type:    row.work_type,
                description:  row.description,
                result:       row.result,
                ai_summary:   row.ai_summary,
                status:       row.status,
                scheduled_at: row.scheduled_at,
                completed_at: row.completed_at,
                technician_id:    row.technician_id,
                technician_name:  row.technician_name,  // ← 이 줄 추가
                equipment: {
                    id:          row.equipment_id,
                    name:        row.equipment_name,
                    mr_space_id: row.mr_space_id,
                },
                manual: row.manual_title ? {
                    title:       row.manual_title,
                    category:    row.manual_category,
                    content_url: row.content_url,
                } : null,
                latest_alarm: row.alarm_id ? {
                    id:           row.alarm_id,
                    alarm_code:   row.alarm_code,
                    severity:     row.severity,
                    description:  row.alarm_desc,
                    triggered_at: row.triggered_at,
                } : null,
            })),
        });
    } catch (err) {
        console.error('[MAINTENANCE] 목록 조회 오류: ', err.message);
        return res.status(500).json({ success: false, message: '서버오류발생' });
    }
});



// =============================================
// 2. GET /api/maintenance/result-categories
//    대분류 전체 목록 조회
// =============================================
router.get('/result-categories', async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT id, name FROM ttt.result_category ORDER BY created_at ASC'
        );
        return res.status(200).json({ success: true, data: rows });
    } catch (err) {
        console.error('[MAINTENANCE] 대분류 조회 오류:', err.message);
        return res.status(500).json({ success: false, message: '서버 오류' });
    }
});

// =============================================
// 3. GET /api/maintenance/result-categories/:id/subcategories
//    특정 대분류의 소분류 목록 조회
// =============================================
router.get('/result-categories/:id/subcategories', async (req, res) => {
    const { id } = req.params;

    try {
        const { rows } = await pool.query(
            'SELECT id, name FROM ttt.result_subcategory WHERE category_id = $1 ORDER BY created_at ASC',
            [id]
        );
        return res.status(200).json({ success: true, data: rows });
    } catch (err) {
        console.error('[MAINTENANCE] 소분류 조회 오류:', err.message);
        return res.status(500).json({ success: false, message: '서버 오류' });
    }
});


// 4. GET /api/maintenance/:id (상세 조회)
router.get('/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const { rows } = await pool.query(DETAIL_QUERY, [id]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: '해당 유지보수 찾을 수 없음' });
        }

        const row = rows[0];
        return res.status(200).json({
            success: true,
            data: {
                id:            row.id,
                work_type:     row.work_type,
                description:   row.description,
                result:        row.result,
                status:        row.status,
                scheduled_at:  row.scheduled_at,
                completed_at:  row.completed_at,
                technician_id: row.technician_id,
                technician_name:  row.technician_name,  // ← 이 줄 추가
                equipment: {
                    id:          row.equipment_id,
                    name:        row.equipment_name,
                    mr_space_id: row.mr_space_id,
                },
                manual: row.manual_id ? {
                    id:          row.manual_id,
                    title:       row.manual_title,
                    category:    row.manual_category,
                    content_url: row.content_url,
                } : null,
                latest_alarm: row.alarm_id ? {
                    id:          row.alarm_id,
                    alarm_code:  row.alarm_code,
                    severity:    row.severity,
                    description: row.alarm_desc,
                    triggered_at: row.triggered_at,
                } : null,
            },
        });
    } catch (err) {
        console.error('[MAINTENANCE] 상세 조회 오류: ', err.message);
        return res.status(500).json({ success: false, message: '서버오류발생' });
    }
});




// 5. PATCH /api/maintenance/:id (상태/결과 업데이트)
//    body: { status, result?, ai_summary? }  - status='completed' 이면 completed_at = NOW()
router.patch('/:id', async (req, res) => {
    const { id } = req.params;
    const { status, result, ai_summary } = req.body;

    if (!status) {
        return res.status(400).json({ success: false, message: 'status 값 필요' });
    }

    try {
        let rows;
        try {
            ({ rows } = await pool.query(UPDATE_QUERY_WITH_SUMMARY,
                [status, result || null, ai_summary || null, id]));
        } catch (e) {
            if (e.code === '42703') { // ai_summary 컬럼 없음 → 요약 없이 저장
                console.warn('[MAINTENANCE] ai_summary 컬럼 없음 - 요약 제외하고 저장');
                ({ rows } = await pool.query(UPDATE_QUERY, [status, result || null, id]));
            } else {
                throw e;
            }
        }

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: '해당 유지보수를 찾을 수 없음' });
        }

        return res.status(200).json({ success: true, data: rows[0] });
    } catch (err) {
        console.error('[MAINTENANCE] 업데이트 오류: ', err.message);
        return res.status(500).json({ success: false, message: '서버오류발생' });
    }
});


// POST /api/maintenance — 유지보수 등록
router.post('/', async (req, res) => {
    const { equipment_id, work_type, description, scheduled_at, technician_id, manual_id } = req.body;

    // 빈 문자열을 null로 변환
    const manual_id_value      = manual_id      || null;
    const technician_id_value  = technician_id  || null;
    const description_value    = description    || null;

    if (!equipment_id || !work_type || !scheduled_at) {
        return res.status(400).json({
            success: false,
            message: 'equipment_id, work_type, scheduled_at 은 필수입니다.'
        });
    }

    try {
        const { rows } = await pool.query(
            `INSERT INTO ttt.maintenance_log
                (id, equipment_id, manual_id, work_type, description, scheduled_at, technician_id, status)
            VALUES
                (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'scheduled')
            RETURNING *`,
            [equipment_id, manual_id_value, work_type, description_value, scheduled_at, technician_id_value]
);

        return res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
        console.error('[MAINTENANCE] 등록 오류:', err.message);
        return res.status(500).json({ success: false, message: '서버 오류' });
    }
});

module.exports = router;