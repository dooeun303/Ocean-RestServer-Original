const express = require('express');
const router = express.Router();
const { pool } = require('./db');

// 랜덤 알람 샘플 목록
const ALARM_SAMPLES = [
  { alarm_code: 'ALM001', severity: 'critical', description: '진동 이상' },
  { alarm_code: 'ALM002', severity: 'warning',  description: '온도 이상' },
  { alarm_code: 'ALM003', severity: 'info',     description: '압력 초과' },
  { alarm_code: 'ALM004', severity: 'critical', description: '유량 이상' },
  { alarm_code: 'ALM005', severity: 'warning',  description: '전류 이상' },
];

// 간격 설정 (20s)
const INTERVAL_SEC = 20;
let intervalId = null; // 현재 실행 중인 타이머 ID (null이면 정지 상태)

// 알람 1회 발생 함수
async function triggerAlarm() {

  // 클라이언트와 연결
  const client = await pool.connect();
  
  // equipment 테이블에서 랜덤으로 장비 1개 선택 (id 가져옴)
  try {
    const { rows: equipmentRows } = await client.query(
      'SELECT id FROM equipment ORDER BY RANDOM() LIMIT 1'
    );
    if (equipmentRows.length === 0) {
      console.error('[TRIGGER] equipment 테이블에 데이터가 없습니다.');
      return;
    }

    // 랜덤으로 선택된 장비의 id
    const equipmentId = equipmentRows[0].id;
    // 랜덤 알람 샘플 선택
    const sample = ALARM_SAMPLES[Math.floor(Math.random() * ALARM_SAMPLES.length)];

    // 알람 테이블에 새 알람 데이터 삽입 (장비id, 알람코드, 심각도, 설명, 발생시간) 
    await client.query(
      `INSERT INTO alarm (alarm_code, severity, description, equipment_id, triggered_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [sample.alarm_code, sample.severity, sample.description, equipmentId]
    );

    // 콘솔에 발생한 알람 정보 출력
    console.log(`[TRIGGER] 알람 발생 — ${sample.alarm_code} / ${sample.severity}`);
  } catch (err) {
    console.error('[TRIGGER] 알람 발생 실패:', err.message);
  } finally {
    client.release();
  }
}

// POST /api/alarms — 주기 발생 시작 (구 /api/alarm/trigger/start)
router.post('/', (req, res) => {
  if (intervalId) {
    return res.status(400).json({ success: false, message: '이미 실행 중입니다.' });
  }

  // 즉시 1회 실행 후 20초마다 반복
  triggerAlarm();
  intervalId = setInterval(triggerAlarm, INTERVAL_SEC * 1000);

  console.log(`[TRIGGER] 알람 주기 발생 시작 (${INTERVAL_SEC}초 간격)`);
  
  // 응답으로 주기 시작 메시지 반환
  res.json({ success: true, message: `${INTERVAL_SEC}초마다 알람 발생 시작` });
});

// DELETE /api/alarms/active — 주기 발생 정지 (구 /api/alarm/trigger/stop)
router.delete('/active', (req, res) => {
  if (!intervalId) {
    return res.status(400).json({ success: false, message: '실행 중이 아닙니다.' });
  }

  clearInterval(intervalId);
  intervalId = null;

  console.log('[TRIGGER] 알람 주기 발생 정지');
  res.json({ success: true, message: '알람 발생 정지' });
});

module.exports = router;