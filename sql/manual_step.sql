-- =====================================================================
-- ttt.manual_step : 매뉴얼 1개에 작업 스텝 N개 (1:N)
--   title       = 짧은 지시문      (구 WorkGuidePanel Step.ar)
--   description = 전문가용 상세    (구 WorkGuidePanel Step.mr)
--   model_url   = 이 스텝에서 보여줄 3D 모델 glb (선택)
-- 로컬 ttt 스키마에서 실행. DDL만 - 예시 데이터는 sample_data.sql.
-- =====================================================================

CREATE TABLE IF NOT EXISTS ttt.manual_step (
    id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    manual_id   uuid NOT NULL REFERENCES ttt.manual(id) ON DELETE CASCADE,
    step_no     integer NOT NULL,                -- 1-based 순서
    title       varchar(200) NOT NULL,
    description text,
    model_url   text,
    created_at  timestamptz DEFAULT now(),
    UNIQUE (manual_id, step_no)
);
CREATE INDEX IF NOT EXISTS idx_manual_step_manual ON ttt.manual_step (manual_id);

COMMENT ON TABLE ttt.manual_step IS '매뉴얼 작업 스텝 (WorkGuidePanel 작업 가이드)';
