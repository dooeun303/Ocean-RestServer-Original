-- =====================================================================
-- 시연용 - 펌프 P-101 설비 정보·센서 최신값을 정기점검(정상) 상태로 맞춘다.
-- AR QR 패널과 MR 설비 정보 패널이 둘 다 이 값(/api/equipment/{id}, /sensors)을 읽는다.
-- 기존 측정 기록은 지우지 않고 지금 시각으로 새 측정값을 추가한다(최신값만 바뀜).
-- 다시 실행하면 같은 값으로 측정 기록이 한 줄씩 더 쌓인다.
-- =====================================================================

UPDATE ttt.equipment
   SET model = 'HPP-SW300', serial_no = 'SN-HPP-2024-0101', status = 'normal'
 WHERE id = '05d469c3-673b-4fd9-9665-acf080511775';

INSERT INTO ttt.sensor_reading (sensor_id, value, measured_at)
SELECT s.id,
       CASE s.sensor_type
         WHEN 'temperature' THEN 25.0     -- °C   (기준 65 이하)
         WHEN 'pressure'    THEN 3.80     -- bar  (기준 3.5 ~ 4.5)
         WHEN 'vibration'   THEN 2.40     -- mm/s (기준 12 이하)
         WHEN 'rpm'         THEN 1500     -- rpm  (기준 1480 ~ 1520)
       END,
       now()
  FROM ttt.sensor s
 WHERE s.equipment_id = '05d469c3-673b-4fd9-9665-acf080511775'
   AND s.sensor_type IN ('temperature', 'pressure', 'vibration', 'rpm');
