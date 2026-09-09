const express = require('express');
const router = express.Router();
const { pool } = require('./db');

// 지원 요청(AR이 걸고 MR이 받는 화상통화) - 기존 video_call 테이블을 그대로 쓴다
// (initiator/receiver platform이 이미 AR/MR/monitoring 뭐든 되게 설계돼 있었는데 실제로 쓰인 적은
// 없었음). MR이 항상 헤드셋을 쓰고 있는 게 아니라서 1회성 팝업 알림 대신, 수락되기 전까지
// status='ringing'으로 DB에 남아있는 큐 방식으로 구현한다 - MR은 아무 때나 목록을 열어 확인 가능.

const LIST_QUERY =
    `SELECT vc.id, vc.initiator_id, vc.receiver_id, vc.initiator_platform, vc.receiver_platform,
        vc.status, vc.channel_name, vc.created_at, vc.started_at, vc.ended_at, vc.maintenance_log_id,
        m.description AS maintenance_description, m.work_type,
        e.id AS equipment_id, e.name AS equipment_name,
        t.name AS initiator_name
     FROM video_call vc
     LEFT JOIN maintenance_log m ON m.id = vc.maintenance_log_id
     LEFT JOIN equipment e ON e.id = m.equipment_id
     LEFT JOIN technician t ON t.id = vc.initiator_id
     WHERE vc.receiver_platform = 'MR'`;

// 2026-08-26: "이미 끝난 지원요청 말고 새로 수신된 지원요청이 1페이지에 떠야 해" - started_at은
// 수락(accept)돼야만 채워져서, 정렬 기준으로 쓰면 아직 응답 안 한(ringing) 새 요청이 NULL이라
// 맨 뒤로 밀려버렸다(started_at이 있는 지나간 통화들이 먼저 나옴). id는 gen_random_uuid()라
// 생성 순서와 무관해서 대체할 수도 없다 - 생성 시각을 담는 created_at 컬럼을 추가하고, 상태
// 우선순위(대기중 > 진행중 > 종료/거절) 다음에 최신순으로 정렬한다.
const ORDER_BY =
    `ORDER BY
        CASE vc.status
            WHEN 'ringing' THEN 0
            WHEN 'active' THEN 1
            ELSE 2
        END,
        vc.created_at DESC`;

function toRow(row) {
    return {
        id: row.id,
        initiator_id: row.initiator_id,
        initiator_name: row.initiator_name,
        receiver_id: row.receiver_id,
        initiator_platform: row.initiator_platform,
        receiver_platform: row.receiver_platform,
        status: row.status,
        channel_name: row.channel_name,
        created_at: row.created_at,
        started_at: row.started_at,
        ended_at: row.ended_at,
        maintenance_log_id: row.maintenance_log_id,
        // MR이 수락 시 이 설비의 디지털 트윈(EquipmentMarker.equipmentId) 앞으로 텔레포트하기 위해 필요
        equipment_id: row.equipment_id,
        equipment_name: row.equipment_name,
        maintenance_description: row.maintenance_description,
        work_type: row.work_type,
    };
}

// 1. POST /api/support-calls - AR이 지원 요청을 건다
router.post('/', async (req, res) => {
    const { initiator_id, maintenance_log_id } = req.body;

    if (!initiator_id) {
        return res.status(400).json({ success: false, message: 'initiator_id는 필수입니다.' });
    }

    try {
        const { rows } = await pool.query(
            `INSERT INTO video_call
                (id, initiator_id, receiver_id, initiator_platform, receiver_platform, status, channel_name, maintenance_log_id)
             VALUES
                (gen_random_uuid(), $1, 'ANY', 'AR', 'MR', 'ringing', 'support_' || gen_random_uuid(), $2)
             RETURNING *`,
            [initiator_id, maintenance_log_id || null]
        );

        const row = rows[0];

        try {
            const { sendTo } = require('./ws');
            sendTo('MR', { type: 'support_call_request', id: row.id });
        } catch (wsErr) {
            console.warn('[SUPPORT_CALL] WS 알림 실패(MR 미접속 등):', wsErr.message);
        }

        console.log('[SUPPORT_CALL] 지원 요청 생성:', row.id);
        return res.status(201).json({ success: true, data: toRow(row) });
    } catch (err) {
        console.error('[SUPPORT_CALL] 생성 오류:', err.message);
        return res.status(500).json({ success: false, message: '서버 오류' });
    }
});

// 2. GET /api/support-calls?status=ringing - MR이 대기 중인 요청 목록 조회 (기본: ringing만)
router.get('/', async (req, res) => {
    const { status } = req.query;

    try {
        const query = status
            ? `${LIST_QUERY} AND vc.status = $1 ${ORDER_BY}`
            : `${LIST_QUERY} ${ORDER_BY}`;
        const { rows } = status ? await pool.query(query, [status]) : await pool.query(query);

        return res.status(200).json({ success: true, data: rows.map(toRow) });
    } catch (err) {
        console.error('[SUPPORT_CALL] 목록 조회 오류:', err.message);
        return res.status(500).json({ success: false, message: '서버 오류' });
    }
});

// 3. GET /api/support-calls/:id - AR이 자기 요청이 수락/거절됐는지 폴링으로 확인
router.get('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const { rows } = await pool.query(`${LIST_QUERY.replace('WHERE', 'WHERE vc.id = $1 AND')}`, [id]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: '해당 요청을 찾을 수 없습니다.' });
        }
        return res.status(200).json({ success: true, data: toRow(rows[0]) });
    } catch (err) {
        console.error('[SUPPORT_CALL] 상세 조회 오류:', err.message);
        return res.status(500).json({ success: false, message: '서버 오류' });
    }
});

// 4. PATCH /api/support-calls/:id/accept - MR이 수락
router.patch('/:id/accept', async (req, res) => {
    const { id } = req.params;
    const { receiver_id } = req.body;

    try {
        const { rows } = await pool.query(
            `UPDATE video_call SET status = 'active', started_at = NOW(), receiver_id = COALESCE($2, receiver_id)
             WHERE id = $1 AND status = 'ringing' RETURNING *`,
            [id, receiver_id || null]
        );

        if (rows.length === 0) {
            return res.status(409).json({ success: false, message: '이미 처리된 요청이거나 찾을 수 없습니다.' });
        }

        const row = rows[0];
        try {
            const { sendTo } = require('./ws');
            sendTo('AR', { type: 'support_call_accepted', id: row.id, channel_name: row.channel_name });
        } catch (wsErr) {
            console.warn('[SUPPORT_CALL] WS 알림 실패:', wsErr.message);
        }

        return res.status(200).json({ success: true, data: toRow(row) });
    } catch (err) {
        console.error('[SUPPORT_CALL] 수락 오류:', err.message);
        return res.status(500).json({ success: false, message: '서버 오류' });
    }
});

// 5. PATCH /api/support-calls/:id/reject - MR이 거절
router.patch('/:id/reject', async (req, res) => {
    const { id } = req.params;

    try {
        const { rows } = await pool.query(
            `UPDATE video_call SET status = 'missed' WHERE id = $1 AND status = 'ringing' RETURNING *`,
            [id]
        );

        if (rows.length === 0) {
            return res.status(409).json({ success: false, message: '이미 처리된 요청이거나 찾을 수 없습니다.' });
        }

        const row = rows[0];
        try {
            const { sendTo } = require('./ws');
            sendTo('AR', { type: 'support_call_rejected', id: row.id });
        } catch (wsErr) {
            console.warn('[SUPPORT_CALL] WS 알림 실패:', wsErr.message);
        }

        return res.status(200).json({ success: true, data: toRow(row) });
    } catch (err) {
        console.error('[SUPPORT_CALL] 거절 오류:', err.message);
        return res.status(500).json({ success: false, message: '서버 오류' });
    }
});

// 6. PATCH /api/support-calls/:id/end - 통화 종료 (AR/MR 어느 쪽이든)
router.patch('/:id/end', async (req, res) => {
    const { id } = req.params;

    try {
        const { rows } = await pool.query(
            `UPDATE video_call SET status = 'ended', ended_at = NOW() WHERE id = $1 RETURNING *`,
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: '해당 요청을 찾을 수 없습니다.' });
        }

        return res.status(200).json({ success: true, data: toRow(rows[0]) });
    } catch (err) {
        console.error('[SUPPORT_CALL] 종료 오류:', err.message);
        return res.status(500).json({ success: false, message: '서버 오류' });
    }
});

// 7. PATCH /api/support-calls/:id/result - MR이 원격지원 결과 저장
router.patch('/:id/result', async (req, res) => {
    const { id } = req.params;
    const { support_result, support_note } = req.body;
    const ALLOWED = ['RESOLVED', 'CANCELED', 'RESUPPORT', 'ETC'];
    if (!ALLOWED.includes(support_result))
        return res.status(400).json({ success: false, message: 'support_result 값이 올바르지 않습니다.' });
    try {
        const { rows } = await pool.query(
            `UPDATE video_call
                SET support_result = $2, support_note = $3, support_saved_at = NOW(),
                    status   = CASE WHEN status <> 'ended' THEN 'ended' ELSE status END,
                    ended_at = COALESCE(ended_at, NOW())
              WHERE id = $1 RETURNING *`,
            [id, support_result, support_note || null]
        );
        if (rows.length === 0)
            return res.status(404).json({ success: false, message: '해당 통화를 찾을 수 없습니다.' });
        return res.status(200).json({ success: true, data: toRow(rows[0]) });
    } catch (err) {
        console.error('[SUPPORT_CALL] 결과 저장 오류:', err.message);
        return res.status(500).json({ success: false, message: '서버 오류' });
    }
});

module.exports = router;
