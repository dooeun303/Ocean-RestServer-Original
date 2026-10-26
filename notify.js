// 알람 발생 시 websocket으로 실시간 알림 보내는 모듈
const { sendTo } = require('./ws');
const { pool }   = require('./db');
const { MSG }    = require('./ws_messages');

// alarm 처리함수
// DB에서 알람과 연관된 notification 조회 → 플랫폼별로 payload 생성 → 해당 플랫폼에 메시지 발송
async function handleAlarm(alarm) {
  console.log('[NOTIFY] 알람 처리 시작:', alarm.alarm_code);
  console.log('[NOTIFY] alarm 객체:', JSON.stringify(alarm));

  try {
    // alarm ID 로 notification 조회 (읽지 않은 알람만)
    const { rows } = await pool.query(
      'SELECT platform FROM notification WHERE alarm_id = $1 AND is_read = false',
      [alarm.alarm_id]
    );

    console.log('[NOTIFY] notification 조회 결과:', rows);

    if (rows.length === 0) {
      console.log('[NOTIFY] 발송할 notification 없음 — alarm_id:', alarm.alarm_id);
      return;
    }

    // 플랫폼별로 payload 생성 후 발송
    for (const { platform } of rows) {
      console.log('[NOTIFY] 발송 시도 → platform:', platform);
      const payload = buildPayload(platform, alarm);
      sendTo(platform, payload); // 해당 플랫폼에 payload 발송
    }
  } catch (err) {
    console.error('[NOTIFY] 오류:', err.message);
  }
}

// 플랫폼과 알람데이터를 받아 payload 를 생성하는 함수
function buildPayload(platform, alarm) {
  const base = {
    type        : MSG.ALARM,
    alarm_id    : alarm.alarm_id,
    alarm_code  : alarm.alarm_code,
    severity    : alarm.severity,
    description : alarm.description,
    triggered_at: alarm.triggered_at,
    equipment: { // 장비데이터
      id  : alarm.equipment_id,
      name: alarm.equipment_name,
    },
  };

  // 플랫폼이 MR 이면 mr_space_id 추가
  if (platform === 'MR') {
    return { ...base, mr_space_id: alarm.mr_space_id };
  }

  return base;
}

module.exports = { handleAlarm };