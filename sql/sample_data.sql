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
-- 2-1. 펌프 P-101 베어링 마모 점검 매뉴얼 (9dec81a9…) - 6스텝
INSERT INTO ttt.manual_step (manual_id, step_no, title, description) VALUES
('9dec81a9-60dc-4736-abc9-6f7700d7e880', 1, '펌프 외관을 확인하세요',
 '고압펌프 #1 - AI가 베어링 마모 의심 징후를 감지했습니다. 케이싱 및 배관 연결부에 누유, 균열, 이물질 부착 여부를 육안으로 확인하세요.'),
('9dec81a9-60dc-4736-abc9-6f7700d7e880', 2, '전원을 차단하고 안전 조치를 하세요',
 '펌프를 정지하고 전원을 차단(LOTO)한 후, 배관 잔압이 해제됐는지 확인하세요.'),
('9dec81a9-60dc-4736-abc9-6f7700d7e880', 3, '커플링 분리 후 하우징 커버를 개방하세요',
 '모터-펌프 커플링을 분리하고, 베어링 하우징 고정 볼트를 해체해 커버를 분리하세요.'),
('9dec81a9-60dc-4736-abc9-6f7700d7e880', 4, '베어링을 인출해 육안 검사하세요',
 '축에서 베어링을 조심스럽게 분리한 뒤, 볼/궤도면의 피팅, 스코어링, 변색 여부를 확인하세요.'),
('9dec81a9-60dc-4736-abc9-6f7700d7e880', 5, '유격을 측정해 판정하세요',
 '베어링 유격(clearance)을 측정하여 마모 허용치 초과 여부를 판단하고 교체 여부를 결정하세요.'),
('9dec81a9-60dc-4736-abc9-6f7700d7e880', 6, '재조립 후 결과를 기록하세요',
 '재조립 후 시운전으로 이상 여부를 재확인하고, 점검 결과를 기록하세요.')
ON CONFLICT (manual_id, step_no) DO UPDATE
    SET title = EXCLUDED.title, description = EXCLUDED.description;

-- 2-2. 펌프 P-101 정기 점검 매뉴얼 (f1e14556…) - 4스텝
INSERT INTO ttt.manual_step (manual_id, step_no, title, description) VALUES
('f1e14556-3148-4214-80a6-5294ace22d57', 1, '펌프 외관을 확인하세요',
 '케이싱 및 배관 연결부에 누유나 부식 흔적이 있는지 육안으로 확인하세요.'),
('f1e14556-3148-4214-80a6-5294ace22d57', 2, '진동과 소음을 확인하세요',
 '펌프 가동 중 비정상적인 진동이나 소음이 있는지 확인합니다. 이상이 감지되면 정도를 기록하세요.'),
('f1e14556-3148-4214-80a6-5294ace22d57', 3, '베어링 온도를 측정하세요',
 '베어링 하우징 표면 온도를 측정합니다. 정상 범위(70도 이하)를 초과하는지 확인하세요.'),
('f1e14556-3148-4214-80a6-5294ace22d57', 4, '점검 결과를 전문가에게 보고하세요',
 '점검한 항목과 이상 유무를 원격 전문가에게 보고하고, 필요 시 추가 조치 지시를 받으세요.')
ON CONFLICT (manual_id, step_no) DO UPDATE
    SET title = EXCLUDED.title, description = EXCLUDED.description;


-- 3. 유지보수 작업 (베어링 매뉴얼 연결) -------------------------------
INSERT INTO ttt.maintenance
    (id, equipment_id, manual_id, work_type, technician_id, description, status, scheduled_at)
VALUES
    ('d1000000-0000-0000-0000-000000000001',
     '05d469c3-673b-4fd9-9665-acf080511775',
     '9dec81a9-60dc-4736-abc9-6f7700d7e880',
     '정기점검', 'tech01',
     '고압펌프 P-101 베어링 마모 의심 - 이상 진동 패턴 감지, 현장 점검 필요',
     'in_progress', now())
ON CONFLICT (id) DO NOTHING;


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
