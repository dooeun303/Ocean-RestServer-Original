const express = require('express');
const router = express.Router();
const { pool } = require('./db');

// 테스트용 센서값 생성기 - 실제 플랜트 계측값이 통합 DB(sensor_reading)에 들어오기 전까지, 켜 두는 동안
// 모든 센서에 INTERVAL_SEC마다 새 측정값을 넣는다. MR 설비 정보 패널은 주기 조회로 최신값을 보여준다.
// 값은 켤 때의 마지막 측정값(기준값) 근처에서 흔들린다(기준값 쪽으로 당기는 랜덤 워크).
const INTERVAL_SEC = 3;
const NOISE = 0.02;   // 한 번에 기준값의 ±2% 정도
const PULL = 0.3;     // 기준값으로 돌아가는 세기

let intervalId = null;
let current = new Map(); // sensor_id → { base, value }

async function loadBaselines() {
  const { rows } = await pool.query(
    `SELECT s.id, COALESCE(sr.value, 0)::float AS value
     FROM sensor s
     LEFT JOIN LATERAL (
       SELECT value FROM sensor_reading WHERE sensor_id = s.id ORDER BY measured_at DESC LIMIT 1
     ) sr ON true`);
  current = new Map(rows.map(r => [r.id, { base: r.value, value: r.value }]));
}

async function tick() {
  const ids = [], values = [];
  for (const [id, s] of current) {
    const noise = (Math.random() * 2 - 1) * NOISE * Math.abs(s.base);
    s.value = Math.max(0, s.value + PULL * (s.base - s.value) + noise);
    ids.push(id);
    values.push(Math.round(s.value * 100) / 100);
  }
  try {
    await pool.query(
      `INSERT INTO sensor_reading (sensor_id, value) SELECT * FROM unnest($1::uuid[], $2::numeric[])`,
      [ids, values]);
  } catch (err) {
    console.error('[SENSOR-SIM] 측정값 저장 실패:', err.message);
  }
}

// POST /api/sensor-sim — 생성 시작
router.post('/', async (req, res) => {
  if (intervalId) return res.status(400).json({ success: false, message: '이미 실행 중입니다.' });
  try {
    await loadBaselines();
  } catch (err) {
    console.error('[SENSOR-SIM] 기준값 조회 실패:', err.message);
    return res.status(500).json({ success: false, message: '서버 오류' });
  }
  await tick();
  intervalId = setInterval(tick, INTERVAL_SEC * 1000);
  console.log(`[SENSOR-SIM] 시작 - 센서 ${current.size}개, ${INTERVAL_SEC}초 간격`);
  res.json({ success: true, message: `센서 ${current.size}개, ${INTERVAL_SEC}초마다 측정값 생성 시작` });
});

// DELETE /api/sensor-sim — 생성 정지
router.delete('/', (req, res) => {
  if (!intervalId) return res.status(400).json({ success: false, message: '실행 중이 아닙니다.' });
  clearInterval(intervalId);
  intervalId = null;
  console.log('[SENSOR-SIM] 정지');
  res.json({ success: true, message: '측정값 생성 정지' });
});

// GET /api/sensor-sim — 실행 여부
router.get('/', (req, res) => {
  res.json({ success: true, data: { running: !!intervalId, sensors: current.size, intervalSec: INTERVAL_SEC } });
});

module.exports = router;
