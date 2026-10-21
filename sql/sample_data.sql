-- =====================================================================
-- 예시 데이터 - 로컬 ttt 스키마. 재실행 가능(멱등).
-- 이미 있는 equipment / manual / plant 는 건드리지 않고, 그 위에
-- 작업가이드(manual_step) + 원격지원 흐름(user_info / maintenance / remote_support)만 얹는다.
--
-- 참조하는 기존 행 (사용자 제공):
--   equipment  05d469c3-673b-4fd9-9665-acf080511775  = 펌프 P-101
--   manual     9dec81a9-60dc-4736-abc9-6f7700d7e880  = 펌프 P-101 베어링 마모 점검 매뉴얼
--   manual     f1e14556-3148-4214-80a6-5294ace22d57  = 펌프 P-101 정기 점검 매뉴얼
-- =====================================================================

-- 0. 필요한 테이블 (없으면 생성) --------------------------------------
CREATE TABLE IF NOT EXISTS ttt.user_info (
    user_id  varchar(20)  NOT NULL PRIMARY KEY,
    user_pw  varchar(200),
    user_nm  varchar(20),
    company  varchar(20),
    mphone   varchar(30),
    email    varchar(30),
    reg_dt   date
);

CREATE TABLE IF NOT EXISTS ttt.manual_step (
    id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    manual_id   uuid NOT NULL REFERENCES ttt.manual(id) ON DELETE CASCADE,
    step_no     integer NOT NULL,
    title       varchar(200) NOT NULL,
    description text,
    model_url   text,
    created_at  timestamptz DEFAULT now(),
    UNIQUE (manual_id, step_no)
);
CREATE INDEX IF NOT EXISTS idx_manual_step_manual ON ttt.manual_step (manual_id);


-- 1. 사용자 (technician 스왑 후 user_info 사용) ------------------------
INSERT INTO ttt.user_info (user_id, user_nm, company, email) VALUES
    ('tech01', '김현수', '현장정비팀', 'tech01@example.com'),
    ('exp01',  '박전문', '원격지원팀', 'exp01@example.com')
ON CONFLICT (user_id) DO NOTHING;


-- 2. 작업 스텝 -------------------------------------------------------
-- 2-1. 펌프 P-101 베어링 마모 점검 매뉴얼 (9dec81a9…) - 3스텝
-- 2026-10-20: 시연 영상용으로 공구 없이 눈/귀/손으로 확인하는 3단계로 줄임(예전 6단계는 분해·측정 포함).
DELETE FROM ttt.manual_step
 WHERE manual_id = '9dec81a9-60dc-4736-abc9-6f7700d7e880' AND step_no > 3;
INSERT INTO ttt.manual_step (manual_id, step_no, title, description) VALUES
('9dec81a9-60dc-4736-abc9-6f7700d7e880', 1, '펌프 외관과 주변을 확인하세요',
 '고압펌프 #1 - AI가 베어링 마모 의심 징후를 감지했습니다. 베어링 하우징·배관 연결부와 바닥에 누유, 녹, 이물질이 없는지 육안으로 확인하세요.'),
('9dec81a9-60dc-4736-abc9-6f7700d7e880', 2, '소리와 진동을 확인하세요',
 '펌프 가동 중 베어링 쪽에서 덜컹거림, 끼익 소리 등 평소와 다른 소음이나 떨림이 있는지 확인하세요. 회전부에는 손대지 마세요.'),
('9dec81a9-60dc-4736-abc9-6f7700d7e880', 3, '고정 볼트 상태를 확인하세요',
 '펌프 받침대와 베어링 하우징 고정 볼트가 빠지거나 헐거워 보이지 않는지, 주변에 녹이나 틈이 없는지 육안으로 확인하세요.')
ON CONFLICT (manual_id, step_no) DO UPDATE
    SET title = EXCLUDED.title, description = EXCLUDED.description;

-- 2-2. 펌프 P-101 정기 점검 매뉴얼 (f1e14556…) - 3스텝
-- 2026-10-21: 시연용으로 정면 → 측면 → 흡입 배관 연결부 3단계(장비 불필요).
-- 3단계는 작업자가 위치를 몰라 원격지원을 요청하고, MR이 드로잉으로 연결부를 짚어주는 장면용.
DELETE FROM ttt.manual_step
 WHERE manual_id = 'f1e14556-3148-4214-80a6-5294ace22d57' AND step_no > 3;
INSERT INTO ttt.manual_step (manual_id, step_no, title, description) VALUES
('f1e14556-3148-4214-80a6-5294ace22d57', 1, '펌프 정면을 확인하세요',
 '펌프 정면의 케이싱과 명판을 확인하세요. 누유, 녹, 이물질이 없는지 봅니다.'),
('f1e14556-3148-4214-80a6-5294ace22d57', 2, '펌프 측면을 확인하세요',
 '펌프 측면의 배관 연결부와 고정 볼트를 확인하세요. 물이 새거나 볼트가 빠진 곳이 없는지 봅니다.'),
('f1e14556-3148-4214-80a6-5294ace22d57', 3, '흡입 배관 연결부를 확인하세요',
 '펌프로 물이 들어오는 흡입 배관의 연결부(플랜지)를 찾아, 손으로 눌러 흔들림이 없는지 확인하세요.')
ON CONFLICT (manual_id, step_no) DO UPDATE
    SET title = EXCLUDED.title, description = EXCLUDED.description;


-- 3. 유지보수 작업 (정기 점검 매뉴얼 연결) ----------------------------
-- 2026-10-21: 작업유형(정기점검)에 맞게 베어링 마모 점검 매뉴얼 → 정기 점검 매뉴얼로 변경.
INSERT INTO ttt.maintenance
    (id, equipment_id, manual_id, work_type, technician_id, description, status, scheduled_at)
VALUES
    ('d1000000-0000-0000-0000-000000000001',
     '05d469c3-673b-4fd9-9665-acf080511775',
     'f1e14556-3148-4214-80a6-5294ace22d57',
     '정기점검', 'tech01',
     '고압펌프 P-101 베어링 마모 의심 - 이상 진동 패턴 감지, 현장 점검 필요',
     'in_progress', now())
ON CONFLICT (id) DO NOTHING;
-- 이미 있는 행도 정기 점검 매뉴얼로 맞춘다(위 INSERT는 기존 행을 건드리지 않음).
UPDATE ttt.maintenance SET manual_id = 'f1e14556-3148-4214-80a6-5294ace22d57'
 WHERE id = 'd1000000-0000-0000-0000-000000000001';


-- 4. 원격지원 요청 (MR SupportCallList 에 뜨는 대기 건) --------------
INSERT INTO ttt.remote_support
    (id, initiator_id, receiver_id, initiator_platform, receiver_platform,
     status, channel_name, maintenance_log_id, created_at)
VALUES
    ('c1000000-0000-0000-0000-000000000001',
     'tech01', 'ANY', 'AR', 'MR',
     'ringing', 'support_sample_p101',
     'd1000000-0000-0000-0000-000000000001', now())
ON CONFLICT (id) DO NOTHING;
