-- =====================================================================
-- 시연 영상용 예시 데이터 - 노트북 외부 모니터 화면 미표시. 재실행 가능(멱등).
-- 설비(노트북) + 매뉴얼 + 작업 스텝 3개 + 유지보수 작업 1건.
-- plant_id 는 펌프 P-101 과 같은 플랜트로 붙인다.
-- =====================================================================

-- 1. 설비 -------------------------------------------------------------
INSERT INTO ttt.equipment (id, plant_id, name, equipment_type, model, status)
SELECT 'e2000000-0000-0000-0000-000000000001', plant_id, '노트북 NB-01', 'LAPTOP', '사무용 노트북', 'warning'
  FROM ttt.equipment WHERE id = '05d469c3-673b-4fd9-9665-acf080511775'
ON CONFLICT (id) DO NOTHING;


-- 2. 매뉴얼 -----------------------------------------------------------
INSERT INTO ttt.manual (id, equipment_id, title, category)
VALUES ('e2000000-0000-0000-0000-000000000002',
        'e2000000-0000-0000-0000-000000000001',
        '노트북 외부 모니터 화면 미표시 점검 매뉴얼', 'EMERGENCY')
ON CONFLICT (id) DO NOTHING;


-- 3. 작업 스텝 --------------------------------------------------------
INSERT INTO ttt.manual_step (manual_id, step_no, title, description) VALUES
-- description 은 AR 에 "지시문: 설명" 한 줄로 붙어 나가므로 짧고 구체적으로.
('e2000000-0000-0000-0000-000000000002', 1, '모니터 상태를 확인하세요',
 '노트북 화면 정상 여부, 외부 모니터 전원 표시등과 "신호 없음" 메시지 확인'),
('e2000000-0000-0000-0000-000000000002', 2, '케이블 연결 포트를 확인하세요',
 '모니터 뒷면 HDMI1/HDMI2 중 입력 설정(HDMI2)과 같은 포트에 꽂혔는지 확인'),
('e2000000-0000-0000-0000-000000000002', 3, '화면 출력을 확인하세요',
 '외부 모니터에 바탕화면 표시 확인, 안 나오면 Win + P → "복제" 선택')
ON CONFLICT (manual_id, step_no) DO UPDATE
    SET title = EXCLUDED.title, description = EXCLUDED.description;


-- 4. 유지보수 작업 ----------------------------------------------------
INSERT INTO ttt.maintenance
    (id, equipment_id, manual_id, work_type, ar_user_id, description, status, scheduled_at)
VALUES
    ('d1000000-0000-0000-0000-000000000002',
     'e2000000-0000-0000-0000-000000000001',
     'e2000000-0000-0000-0000-000000000002',
     '긴급점검', 'tech01',
     '노트북 NB-01 외부 모니터 화면 미표시 - 노트북 화면은 정상, 외부 모니터 "신호 없음"',
     'in_progress', now())
ON CONFLICT (id) DO NOTHING;
