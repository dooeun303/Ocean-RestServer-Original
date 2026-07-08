const { Pool, Client } = require('pg');

// DB 연결 설정
const DB_CONFIG = {
  host:     process.env.DB_HOST     || 'localhost', // 호스트
  port:     process.env.DB_PORT     || 5433,        // DB 포트
  database: process.env.DB_NAME     || 'test',      // 데이터베이스 이름
  user:     process.env.DB_USER     || 'postgres',  // 사용자
  password: process.env.DB_PASSWORD || '0000',      // 비밀번호
  options:  `-c search_path=${process.env.DB_SCHEMA || 'ttt'}`, // DB 스키마명
};

// DB 풀, 리스너 생성
const pool     = new Pool(DB_CONFIG);
const listener = new Client(DB_CONFIG);

// 알람 쿼리
const ALARM_QUERY =
  'SELECT a.id AS alarm_id, a.alarm_code, a.severity, a.description, a.triggered_at,' +
  ' e.id AS equipment_id, e.name AS equipment_name, e.mr_space_id' +
  ' FROM alarm a JOIN equipment e ON e.id = a.equipment_id' +
  ' WHERE a.id = $1';

// DB 리스너 연결
async function startListening(onNotify) {
  try {
    await listener.connect();
  } catch (err) {
    console.error('[DB] PostgreSQL 연결 실패:', err.message);
    process.exit(1);
  }

  // 리슨 시작
  await listener.query('LISTEN new_alarm');
  console.log('[DB] LISTEN new_alarm 시작');

  // 알람 notification 이벤트 발생시, 
  listener.on('notification', async (msg) => {
    
    // alarmID 추출
    const alarmId = msg.payload;
    console.log('[DB] pg_notify 수신 — alarm_id:', alarmId);

    // 알람 쿼리
    try {
      console.log('[DB] 알람 쿼리 시작...');
      const { rows } = await pool.query(ALARM_QUERY, [alarmId]);
      console.log('[DB] 쿼리 결과 rows 수:', rows.length);

      if (rows.length === 0) {
        console.log('[DB] 알람 데이터 없음 — equipment JOIN 실패 가능성');
        // JOIN 없이 alarm만 조회해서 확인
        const { rows: alarmOnly } = await pool.query(
          'SELECT * FROM alarm WHERE id = $1', [alarmId]
        );
        console.log('[DB] alarm 단독 조회:', JSON.stringify(alarmOnly));
        return;
      }

      console.log('[DB] onNotify 호출:', rows[0].alarm_code);
      onNotify(rows[0]);
    } catch (err) {
      console.error('[DB] 쿼리 오류:', err.message);
    }
  });

  // 리스너 오류
  listener.on('error', (err) => {
    console.error('[DB] listener 오류:', err.message);
  });
}

// 모듈 내보내기
module.exports = { pool, startListening };