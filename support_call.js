const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { pipeline } = require('stream/promises');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { pool } = require('./db');

// 원격지원 녹화 mp4 저장 폴더 - index.js의 /uploads 정적 서빙 아래라 /uploads/recordings/... 로 바로 재생 가능
const RECORDING_DIR = path.join(__dirname, 'uploads', 'recordings');
// 영상과 합쳐지기 전의 음성(.aac)/수신 중인 영상이 잠깐 머무는 곳 - 정적 서빙 대상이지만 목록엔 안 나옴
const RECORDING_TMP_DIR = path.join(RECORDING_DIR, 'tmp');
fs.mkdirSync(RECORDING_TMP_DIR, { recursive: true });
const RECORDING_SOURCES = ['mr_view', 'ar_local'];

// 영상+음성 합치기용 ffmpeg - npm의 ffmpeg-static(바이너리 동봉)을 우선 쓰고, 없으면 FFMPEG_PATH 또는 PATH의 ffmpeg.
const FFMPEG = (() => {
    try { return require('ffmpeg-static'); } catch { return process.env.FFMPEG_PATH || 'ffmpeg'; }
})();
const execFileAsync = promisify(execFile);

// 지원 요청(AR이 걸고 MR이 받는 원격지원 통화) - remote_support 테이블 사용 (구 video_call)
// (initiator/receiver platform이 이미 AR/MR/monitoring 뭐든 되게 설계돼 있었는데 실제로 쓰인 적은
// 없었음). MR이 항상 헤드셋을 쓰고 있는 게 아니라서 1회성 팝업 알림 대신, 수락되기 전까지
// status='ringing'으로 DB에 남아있는 큐 방식으로 구현한다 - MR은 아무 때나 목록을 열어 확인 가능.

const LIST_QUERY =
    `SELECT vc.id, vc.initiator_id, vc.receiver_id, vc.initiator_platform, vc.receiver_platform,
        vc.status, vc.channel_name, vc.created_at, vc.started_at, vc.ended_at, vc.maintenance_log_id,
        m.description AS maintenance_description, m.work_type, m.manual_id,
        mn.title AS manual_title,
        e.id AS equipment_id, e.name AS equipment_name,
        t.user_nm AS initiator_name
     FROM remote_support vc
     LEFT JOIN maintenance m ON m.id = vc.maintenance_log_id
     LEFT JOIN manual mn ON mn.id = m.manual_id
     LEFT JOIN equipment e ON e.id = m.equipment_id
     LEFT JOIN user_info t ON t.user_id = vc.initiator_id
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
        // 작업 가이드(WorkGuidePanel)가 이 매뉴얼의 스텝 목록을 불러오는 데 씀
        manual_id: row.manual_id,
        manual_title: row.manual_title,
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
            `INSERT INTO remote_support
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

// (원격지원 결과 선택지 조회는 GET /api/codes?group=RESP11 으로 이동)

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
            `UPDATE remote_support SET status = 'active', started_at = NOW(), receiver_id = COALESCE($2, receiver_id)
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
            `UPDATE remote_support SET status = 'missed' WHERE id = $1 AND status = 'ringing' RETURNING *`,
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
            `UPDATE remote_support SET status = 'ended', ended_at = NOW() WHERE id = $1 RETURNING *`,
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
    const ALLOWED = ['RSUP01', 'RSUP02', 'RSUP03', 'RSUP04']; // system_code RESP11 (원격지원결과 구분)
    if (!ALLOWED.includes(support_result))
        return res.status(400).json({ success: false, message: 'support_result 값이 올바르지 않습니다.' });
    try {
        const { rows } = await pool.query(
            `UPDATE remote_support
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

// ── 원격지원 녹화 (MR: MrCallRecorder.cs / AR: InmoCallRecorder.cs) ──
// body = 파일 바이너리 그대로(멀티파트 아님). 수백 MB가 될 수 있어서 multer/메모리 버퍼 없이 요청
// 스트림을 바로 파일로 흘려 쓴다.
//
// 각 기기는 영상(mp4)과 통화 음성 전체(aac, 양쪽 목소리 믹스)를 따로 녹화해서 음성 → 영상 순서로
// 같은 파일명(stem)으로 올린다. Agora 로컬 영상 녹화엔 자기 마이크만 들어가서, 대화 전체를 영상에
// 넣으려면 서버에서 합쳐야 하기 때문.
//   ?part=audio      → tmp에 보관만 하고 202 (DB 기록 없음)
//   (영상, offset_ms) → 같은 stem의 음성이 tmp에 있으면 ffmpeg로 음성 트랙을 바꿔 끼워 mp4 하나로 저장.
//                       offset_ms = 음성이 영상보다 먼저 시작된 시간 - 그만큼 음성 앞을 잘라 싱크를 맞춘다.
// 합치기에 실패하면(ffmpeg 없음 등) 영상은 그대로, 음성은 별도 행(.aac)으로 남긴다 - 파일은 절대 안 버림.
async function saveRecording(req, res, supportId, channelName, maintenanceId = null) {
    const { source, filename, part } = req.query;
    if (!RECORDING_SOURCES.includes(source))
        return res.status(400).json({ success: false, message: 'source 값이 올바르지 않습니다.' });

    const isAudio = part === 'audio';
    const base = path.basename(filename || `${source}${isAudio ? '.aac' : '.mp4'}`).replace(/[^\w.\-]/g, '_');
    // 같은 통화(+같은 stem)의 음성/영상이 서로를 찾을 수 있게 tmp 파일명에 통화 키를 붙인다.
    const callKey = String(supportId || maintenanceId || channelName).replace(/[^\w\-]/g, '_');
    const stem = path.parse(base).name;
    const tmpPath = path.join(RECORDING_TMP_DIR, `${callKey}__${base}`);

    try {
        await pipeline(req, fs.createWriteStream(tmpPath));
    } catch (err) {
        console.error('[SUPPORT_CALL] 녹화 수신 오류:', err.message);
        fs.promises.unlink(tmpPath).catch(() => {});
        return res.status(500).json({ success: false, message: '파일 수신 실패' });
    }
    if ((await fs.promises.stat(tmpPath)).size === 0) {
        fs.promises.unlink(tmpPath).catch(() => {});
        return res.status(400).json({ success: false, message: '빈 파일입니다.' });
    }

    if (isAudio) {
        console.log(`[SUPPORT_CALL] 녹화 음성 수신 (${source}) - 영상 대기:`, base);
        return res.status(202).json({ success: true, pending: true });
    }

    try {
        const audioTmp = path.join(RECORDING_TMP_DIR, `${callKey}__${stem}.aac`);
        const hasAudio = fs.existsSync(audioTmp);
        const stored = `${Date.now()}_${base}`;
        const finalPath = path.join(RECORDING_DIR, stored);
        let merged = false;

        if (hasAudio) {
            const offsetSec = Math.max(0, Number(req.query.offset_ms) || 0) / 1000;
            try {
                await execFileAsync(FFMPEG, [
                    '-y', '-loglevel', 'error',
                    '-i', tmpPath,
                    '-ss', offsetSec.toFixed(3), '-i', audioTmp,
                    '-map', '0:v:0', '-map', '1:a:0',
                    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '96k',
                    '-movflags', '+faststart',
                    finalPath,
                ]);
                merged = true;
                await fs.promises.unlink(tmpPath);
                await fs.promises.unlink(audioTmp);
            } catch (err) {
                console.error('[SUPPORT_CALL] 영상+음성 합치기 실패 - 따로 저장:', err.message);
                fs.promises.unlink(finalPath).catch(() => {});
            }
        }

        if (!merged) {
            await fs.promises.rename(tmpPath, finalPath);
            if (hasAudio) {
                const audioStored = `${Date.now()}_${stem}.aac`;
                await fs.promises.rename(audioTmp, path.join(RECORDING_DIR, audioStored));
                await insertRecording(supportId, channelName, maintenanceId, source, `${stem}.aac`, audioStored);
            }
        }

        const row = await insertRecording(supportId, channelName, maintenanceId, source, base, stored);
        console.log(`[SUPPORT_CALL] 녹화 저장 (${source}, ${merged ? '음성 합침' : hasAudio ? '음성 별도' : '음성 없음'}, ${row.size} bytes):`, stored);
        return res.status(201).json({ success: true, data: row });
    } catch (err) {
        console.error('[SUPPORT_CALL] 녹화 저장 오류:', err.message);
        return res.status(500).json({ success: false, message: '서버 오류' });
    }
}

async function insertRecording(supportId, channelName, maintenanceId, source, fileName, stored) {
    const size = (await fs.promises.stat(path.join(RECORDING_DIR, stored))).size;
    const { rows } = await pool.query(
        `INSERT INTO remote_support_recording (remote_support_id, channel_name, maintenance_id, source, file_name, url, size)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [supportId, channelName, maintenanceId, source, fileName, `/uploads/recordings/${stored}`, size]
    );
    return rows[0];
}

// 8. POST /api/support-calls/recordings?maintenance_id=&source=&filename= - AR
// 유지보수 시작~결과 저장 전체 녹화(MaintenanceTutorialDemo). 통화 전부터 녹화라 call id가 없다 - 그
// 유지보수로 걸었던 가장 최근 원격지원 통화에 연결하고, 통화 없이 끝났으면 유지보수 id로만 남긴다.
router.post('/recordings', async (req, res) => {
    const { maintenance_id } = req.query;
    if (!maintenance_id)
        return res.status(400).json({ success: false, message: 'maintenance_id는 필수입니다.' });
    try {
        const { rows } = await pool.query(
            `SELECT id, channel_name FROM remote_support WHERE maintenance_log_id::text = $1 ORDER BY created_at DESC LIMIT 1`,
            [maintenance_id]
        );
        return saveRecording(req, res, rows[0]?.id || null, rows[0]?.channel_name || null, maintenance_id);
    } catch (err) {
        console.error('[SUPPORT_CALL] 녹화 통화 조회 오류:', err.message);
        return res.status(500).json({ success: false, message: '서버 오류' });
    }
});

// 9. POST /api/support-calls/:id/recordings?source=&filename= - MR
router.post('/:id/recordings', async (req, res) => {
    const { id } = req.params;
    try {
        const { rows } = await pool.query(`SELECT channel_name FROM remote_support WHERE id = $1`, [id]);
        if (rows.length === 0)
            return res.status(404).json({ success: false, message: '해당 통화를 찾을 수 없습니다.' });
        return saveRecording(req, res, id, rows[0].channel_name);
    } catch (err) {
        console.error('[SUPPORT_CALL] 녹화 통화 조회 오류:', err.message);
        return res.status(500).json({ success: false, message: '서버 오류' });
    }
});

// 10. GET /api/support-calls/:id/recordings - 통화별 녹화 목록 (url은 /uploads/recordings/... 로 바로 재생)
router.get('/:id/recordings', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT id, source, file_name, url, size, created_at FROM remote_support_recording
              WHERE remote_support_id = $1 ORDER BY created_at`,
            [req.params.id]
        );
        return res.status(200).json({ success: true, data: rows });
    } catch (err) {
        console.error('[SUPPORT_CALL] 녹화 목록 오류:', err.message);
        return res.status(500).json({ success: false, message: '서버 오류' });
    }
});

module.exports = router;
