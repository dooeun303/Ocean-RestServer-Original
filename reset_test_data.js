// 테스트 데이터 초기화 - 실기기로 유지보수 시나리오를 다시 돌리기 전에 실행한다.
//   node reset_test_data.js                 → 기본 테스트 건(펌프 P-101 · 정기점검)을 되돌림
//   node reset_test_data.js <maintenance id> [...]  → 지정한 유지보수 건들을 되돌림
//
// 하는 일 (한 트랜잭션):
//  1) 끝나지 않은 원격지원 요청/통화(ringing/active)를 전부 ended로 정리 - 그대로 두면 MR 원격지원 목록에
//     죽은 요청이 남아 수락하면 "연결 대기 중"에 멈춘다.
//  2) 지정한 유지보수 건을 예정(scheduled) 상태로 되돌리고 완료 때 채워진 값을 비움 - AR은 완료된 건을
//     다시 시작할 수 없어서(MaintenanceTutorialDemo.SelectJob) 시나리오를 끝까지 돌리면 매번 되돌려야 한다.
// 실제 운영 DB가 아니라 .env 의 DB(로컬 테스트용)를 대상으로 한다.
require('dotenv').config({ quiet: true });
const { pool } = require('./db');

const DEFAULT_TEST_MAINTENANCE = ['d1000000-0000-0000-0000-000000000001']; // 펌프 P-101 · 정기점검 (tech01)

(async () => {
    const ids = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_TEST_MAINTENANCE;
    console.log(`DB: ${process.env.DB_HOST}:${process.env.DB_PORT} / ${process.env.DB_NAME || process.env.DB_DATABASE} (schema ${process.env.DB_SCHEMA || 'ttt'})`);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const calls = await client.query(
            `UPDATE remote_support SET status = 'ended', ended_at = COALESCE(ended_at, NOW())
              WHERE status IN ('ringing', 'active') RETURNING id, status`
        );
        console.log(`원격지원 요청/통화 정리: ${calls.rowCount}건 → ended`);

        const m = await client.query(
            `UPDATE maintenance
                SET status = 'scheduled', result = NULL, ai_summary = NULL, completed_at = NULL,
                    result_category_id = NULL, updated_at = NOW()
              WHERE id::text = ANY($1)
              RETURNING id, work_type, description`,
            [ids]
        );
        for (const r of m.rows) console.log(`유지보수 되돌림: ${r.id} (${r.work_type} · ${r.description}) → scheduled`);
        const missing = ids.filter(id => !m.rows.some(r => r.id === id));
        if (missing.length) console.warn('없는 유지보수 id:', missing.join(', '));

        await client.query('COMMIT');
        console.log('완료');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('실패 - 아무것도 바뀌지 않음:', e.message);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
})();
