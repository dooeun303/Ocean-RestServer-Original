-- =====================================================================
-- 통합 마이그레이션 (2026-09 세션) - 로컬 ttt 스키마.
-- 전부 멱등: 여러 번 돌려도 안전. DBeaver 에서 전체 실행(Alt+X).
-- 회사 DB(다른 연결)는 절대 대상 아님.
-- =====================================================================

-- ── 1. 테이블 rename (video_call→remote_support, maintenance_log→maintenance) ──
DO $$ BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema='ttt' AND table_name='video_call')
   AND NOT EXISTS (SELECT FROM information_schema.tables WHERE table_schema='ttt' AND table_name='remote_support')
  THEN EXECUTE 'ALTER TABLE ttt.video_call RENAME TO remote_support'; END IF;

  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema='ttt' AND table_name='maintenance_log')
   AND NOT EXISTS (SELECT FROM information_schema.tables WHERE table_schema='ttt' AND table_name='maintenance')
  THEN EXECUTE 'ALTER TABLE ttt.maintenance_log RENAME TO maintenance'; END IF;
END $$;


-- ── 1b. plant → plant_info (타사 구조). 기존 uuid 데이터 버리고 재구성, equipment 는 PLT001 로 ──
ALTER TABLE ttt.equipment DROP CONSTRAINT IF EXISTS equipment_plant_id_fkey;

CREATE TABLE IF NOT EXISTS ttt.plant_info (
    plant_id   varchar(6)  NOT NULL PRIMARY KEY,
    plant_nm   varchar(30),
    plant_add  varchar(50),
    install_dt varchar(8),
    plant_sz   numeric,
    company    varchar(30),
    mphone     varchar(30),
    email      varchar(30),
    plant_cd   varchar(6)
);
COMMENT ON TABLE ttt.plant_info IS '플랜트 정보';

INSERT INTO ttt.plant_info (plant_id, plant_nm, plant_add, install_dt, plant_sz, company)
VALUES ('PLT001', '부산 기장 담수화 플랜트', '부산광역시 기장군', '20240101', 45000, '해담워터')
ON CONFLICT (plant_id) DO NOTHING;

DROP TABLE IF EXISTS ttt.plant CASCADE;

DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_schema='ttt' AND table_name='equipment' AND column_name='plant_id') <> 'character varying'
  THEN
    EXECUTE 'ALTER TABLE ttt.equipment ALTER COLUMN plant_id DROP NOT NULL';
    EXECUTE 'ALTER TABLE ttt.equipment ALTER COLUMN plant_id TYPE varchar(6) USING ''PLT001''';
  END IF;
END $$;
UPDATE ttt.equipment SET plant_id = 'PLT001'
 WHERE plant_id IS NULL OR plant_id NOT IN (SELECT plant_id FROM ttt.plant_info);
ALTER TABLE ttt.equipment ALTER COLUMN plant_id SET NOT NULL;
ALTER TABLE ttt.equipment ADD CONSTRAINT equipment_plant_id_fkey
    FOREIGN KEY (plant_id) REFERENCES ttt.plant_info(plant_id) ON DELETE RESTRICT;


-- ── 2. system_code (공통코드) + 데이터 ──
CREATE TABLE IF NOT EXISTS ttt.system_code (
    code      varchar(6)  NOT NULL PRIMARY KEY,
    code_nm   varchar(30) NOT NULL,
    code_enm  varchar(50) NOT NULL,
    group_cd  varchar(6),
    group_nm  varchar(30),
    group_enm varchar(50)
);
CREATE INDEX IF NOT EXISTS idx_system_code_group ON ttt.system_code (group_cd);

INSERT INTO ttt.system_code (code, code_nm, code_enm, group_cd, group_nm, group_enm) VALUES
    ('WRK001','점검','Inspection','RESP08','유지관리작업 구분',NULL),
    ('WRK002','보수','Repair','RESP08','유지관리작업 구분',NULL),
    ('WRK003','교체','Replacement','RESP08','유지관리작업 구분',NULL),
    ('RSLT01','정상','Normal','RESP10','유지관리결과 구분','Maintenance Result Type'),
    ('RSLT02','조치완료','Resolved','RESP10','유지관리결과 구분','Maintenance Result Type'),
    ('RSLT03','부품교체','Part Replaced','RESP10','유지관리결과 구분','Maintenance Result Type'),
    ('RSLT04','경과관찰','Under Observation','RESP10','유지관리결과 구분','Maintenance Result Type'),
    ('RSLT05','추가정비필요','Further Maintenance Needed','RESP10','유지관리결과 구분','Maintenance Result Type'),
    ('RSUP01','해결완료','Resolved','RESP11','원격지원결과 구분','Remote Support Result Type'),
    ('RSUP02','취소','Canceled','RESP11','원격지원결과 구분','Remote Support Result Type'),
    ('RSUP03','재지원필요','Re-support Needed','RESP11','원격지원결과 구분','Remote Support Result Type'),
    ('RSUP04','기타','Other','RESP11','원격지원결과 구분','Remote Support Result Type'),
    ('CHM001','스케일제거제','Antiscalant','RESP06','화학약품 구분',NULL),
    ('ROF001','RO 필터','RO Filter','RESP07','소모품구분',NULL),
    ('MAT001','그리스','Grease','RESP09','유지관리물품 구분',NULL),
    ('EQP101','고압펌프','High-Pressure Pump','DISA10','담수화 설비코드',NULL),
    ('EQP102','펌프','Pump','DISA10','담수화 설비코드',NULL),
    ('EQP103','화학약품 탱크','Chemical Storate Tank','DISA10','담수화 설비코드',NULL),
    ('EQP104','저장탱크','Storage Tank','DISA10','담수화 설비코드',NULL)
ON CONFLICT (code) DO NOTHING;


-- ── 3. user_info / login_hist (타사 구조 미러) ──
CREATE TABLE IF NOT EXISTS ttt.user_info (
    user_id  varchar(20)  NOT NULL PRIMARY KEY,
    user_pw  varchar(200),
    user_nm  varchar(20),
    company  varchar(20),
    mphone   varchar(30),
    email    varchar(30),
    reg_dt   date
);
CREATE TABLE IF NOT EXISTS ttt.login_hist (
    login_dt  date NOT NULL,
    logout_dt date,
    user_id   varchar(20)
);

-- technician → user_info 이관 후 technician 제거
DO $$ BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema='ttt' AND table_name='technician') THEN
    EXECUTE $q$
      INSERT INTO ttt.user_info (user_id, user_nm, company, reg_dt)
      SELECT id, name, department, created_at::date FROM ttt.technician
      ON CONFLICT (user_id) DO NOTHING $q$;
    EXECUTE 'DROP TABLE ttt.technician';
  END IF;
END $$;

-- 최소 테스트 사용자
INSERT INTO ttt.user_info (user_id, user_nm, company) VALUES
    ('tech01','김현수','현장정비팀'),
    ('exp01','박전문','원격지원팀')
ON CONFLICT (user_id) DO NOTHING;


-- ── 4. maintenance : technician_id → ar_user_id + 스펙 컬럼 추가 ──
DO $$ BEGIN
  IF EXISTS (SELECT FROM information_schema.columns
             WHERE table_schema='ttt' AND table_name='maintenance' AND column_name='technician_id')
   AND NOT EXISTS (SELECT FROM information_schema.columns
             WHERE table_schema='ttt' AND table_name='maintenance' AND column_name='ar_user_id')
  THEN EXECUTE 'ALTER TABLE ttt.maintenance RENAME COLUMN technician_id TO ar_user_id'; END IF;
END $$;

ALTER TABLE ttt.maintenance
    ADD COLUMN IF NOT EXISTS ar_user_id         varchar(200),
    ADD COLUMN IF NOT EXISTS mr_user_id         varchar(20),
    ADD COLUMN IF NOT EXISTS alarm_id           uuid,
    ADD COLUMN IF NOT EXISTS result_category_id varchar(6),
    ADD COLUMN IF NOT EXISTS created_at         timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_at         timestamptz NOT NULL DEFAULT now();

-- FK 걸기 전 매칭 안 되는 값 정리
UPDATE ttt.maintenance SET ar_user_id = NULL
 WHERE ar_user_id IS NOT NULL AND ar_user_id NOT IN (SELECT user_id FROM ttt.user_info);
UPDATE ttt.maintenance SET result_category_id = NULL
 WHERE result_category_id IS NOT NULL AND result_category_id NOT IN (SELECT code FROM ttt.system_code);

ALTER TABLE ttt.maintenance DROP CONSTRAINT IF EXISTS maintenance_ar_user_id_fkey;
ALTER TABLE ttt.maintenance ADD  CONSTRAINT maintenance_ar_user_id_fkey
    FOREIGN KEY (ar_user_id) REFERENCES ttt.user_info(user_id) ON DELETE SET NULL;
ALTER TABLE ttt.maintenance DROP CONSTRAINT IF EXISTS maintenance_mr_user_id_fkey;
ALTER TABLE ttt.maintenance ADD  CONSTRAINT maintenance_mr_user_id_fkey
    FOREIGN KEY (mr_user_id) REFERENCES ttt.user_info(user_id) ON DELETE SET NULL;
ALTER TABLE ttt.maintenance DROP CONSTRAINT IF EXISTS maintenance_alarm_id_fkey;
ALTER TABLE ttt.maintenance ADD  CONSTRAINT maintenance_alarm_id_fkey
    FOREIGN KEY (alarm_id) REFERENCES ttt.alarm(id) ON DELETE SET NULL;
ALTER TABLE ttt.maintenance DROP CONSTRAINT IF EXISTS maintenance_result_category_id_fkey;
ALTER TABLE ttt.maintenance ADD  CONSTRAINT maintenance_result_category_id_fkey
    FOREIGN KEY (result_category_id) REFERENCES ttt.system_code(code) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_maintenance_ar_user ON ttt.maintenance (ar_user_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_mr_user ON ttt.maintenance (mr_user_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_alarm   ON ttt.maintenance (alarm_id);

CREATE OR REPLACE FUNCTION ttt.fn_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_maintenance_updated_at ON ttt.maintenance;
CREATE TRIGGER trg_maintenance_updated_at
    BEFORE UPDATE ON ttt.maintenance FOR EACH ROW EXECUTE FUNCTION ttt.fn_touch_updated_at();


-- ── 5. remote_support : 원격지원 결과 컬럼 (system_code RESP11 참조) ──
ALTER TABLE ttt.remote_support
    ADD COLUMN IF NOT EXISTS support_result   varchar(6),
    ADD COLUMN IF NOT EXISTS support_note     text,
    ADD COLUMN IF NOT EXISTS support_saved_at timestamptz;

-- 구 자유값 → 코드 remap
UPDATE ttt.remote_support SET support_result = CASE support_result
    WHEN 'RESOLVED'  THEN 'RSUP01' WHEN 'CANCELED' THEN 'RSUP02'
    WHEN 'RESUPPORT' THEN 'RSUP03' WHEN 'ETC'      THEN 'RSUP04'
    WHEN 'RSUP01' THEN 'RSUP01' WHEN 'RSUP02' THEN 'RSUP02'
    WHEN 'RSUP03' THEN 'RSUP03' WHEN 'RSUP04' THEN 'RSUP04'
    ELSE NULL END
 WHERE support_result IS NOT NULL;

DO $$ BEGIN
  IF EXISTS (SELECT FROM information_schema.columns WHERE table_schema='ttt'
             AND table_name='remote_support' AND column_name='support_result'
             AND character_maximum_length <> 6)
  THEN EXECUTE 'ALTER TABLE ttt.remote_support ALTER COLUMN support_result TYPE varchar(6)'; END IF;
END $$;

ALTER TABLE ttt.remote_support DROP CONSTRAINT IF EXISTS remote_support_support_result_fkey;
ALTER TABLE ttt.remote_support ADD  CONSTRAINT remote_support_support_result_fkey
    FOREIGN KEY (support_result) REFERENCES ttt.system_code(code) ON DELETE SET NULL;


-- ── 6. manual_step (작업 가이드 스텝) ──
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


-- ── 7. ai_prediction (AI 이상징후 판단 이력) ──
CREATE TABLE IF NOT EXISTS ttt.ai_prediction (
    ai_prediction_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    equipment_id             uuid NOT NULL REFERENCES ttt.equipment(id) ON DELETE CASCADE,
    anomaly_risk_score       numeric(5,2) NOT NULL,
    anomaly_evidence_summary text,
    prediction_priority      varchar(20) NOT NULL DEFAULT 'medium',
    model_version            varchar(20),
    adapter_type             varchar(50),
    prediction_predicted_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ai_prediction_priority_check CHECK (prediction_priority IN ('low','medium','high','urgent')),
    CONSTRAINT ai_prediction_risk_score_range CHECK (anomaly_risk_score >= 0 AND anomaly_risk_score <= 100)
);
CREATE INDEX IF NOT EXISTS idx_ai_prediction_equipment    ON ttt.ai_prediction (equipment_id);
CREATE INDEX IF NOT EXISTS idx_ai_prediction_predicted_at ON ttt.ai_prediction (prediction_predicted_at DESC);


-- ── 8. remote_support_recording (원격지원 통화 녹화 mp4) ──
-- source: ar_stream(MR이 받은 AR 영상) · mr_view(MR 시점 화면) · ar_local(AR 기기 자체 녹화)
-- remote_support_id 는 NULL 허용 - 지원요청 큐를 안 거친 통화(시그널링 직접 호출)도 파일은 남긴다.
CREATE TABLE IF NOT EXISTS ttt.remote_support_recording (
    id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    remote_support_id uuid REFERENCES ttt.remote_support(id) ON DELETE SET NULL,
    channel_name      varchar(200),
    source            varchar(20) NOT NULL,
    file_name         varchar(255) NOT NULL,
    url               text NOT NULL,
    size              bigint,
    created_at        timestamptz DEFAULT now(),
    CONSTRAINT remote_support_recording_source_check CHECK (source IN ('ar_stream','mr_view','ar_local'))
);
CREATE INDEX IF NOT EXISTS idx_remote_support_recording_call ON ttt.remote_support_recording (remote_support_id);
-- AR 유지보수 전체 녹화(시작~결과 저장)는 통화 전부터라 유지보수 id로도 연결한다. 샘플 작업은 DB에 없는
-- 고정 UUID를 쓰기도 해서 FK 없이 문자열로 둔다.
ALTER TABLE ttt.remote_support_recording ADD COLUMN IF NOT EXISTS maintenance_id varchar(64);
CREATE INDEX IF NOT EXISTS idx_remote_support_recording_maint ON ttt.remote_support_recording (maintenance_id);
