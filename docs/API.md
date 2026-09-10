# Ocean REST Server — API 목록

- Base URL: `http://<host>:3000` (Unity 쪽은 `ServerConfig.BaseUrl`)
- 모든 응답: `{ "success": true, "data": ... }` 또는 `{ "success": false, "message": "..." }`
- CORS: 전체 허용. 인증 없음(현재).
- 2026-09 리팩터링 후 기준. 구 경로는 문서 맨 아래 "변경 매핑" 참고.

---

## Equipment — 설비

| Method | Path | 설명 | 파라미터 |
|---|---|---|---|
| GET | `/api/equipment/:id` | 설비 상세 (id = UUID) | — |
| GET | `/api/equipment/:id/sensors` | 설비 센서 최신값 + 정상범위 판정 | — |
| GET | `/api/ar/device/:uuid` | 설비 상세 (AR 전용 응답 포맷: `equipmentId`, `equipmentName` …) | — |

`/sensors` 응답 각 항목: `sensor_id, sensor_type, sensor_name, unit, min_threshold, max_threshold, value, measured_at, status(normal|warning|critical)`

## Alarms — 알람

| Method | Path | 설명 | 파라미터 |
|---|---|---|---|
| GET | `/api/alarms` | 알람 목록 | `?active=true` → 활성만 |
| POST | `/api/alarms` | 알람 주기 발생 시작 (20초 간격, 랜덤 설비) | — |
| DELETE | `/api/alarms/active` | 알람 주기 발생 정지 | — |
| GET | `/api/alarms/trigger-status` | 주기 발생 상태 (`running`, `interval_sec`) | — |

알람 INSERT 시 DB 트리거가 `notification` 3행 생성 + `pg_notify('new_alarm')` → 서버가 WebSocket 으로 `type:"ALARM"` 푸시.

## Maintenances — 유지보수 이력

| Method | Path | 설명 | 파라미터 / body |
|---|---|---|---|
| GET | `/api/maintenances` | 정비 이력 목록 | `?status=scheduled\|in_progress\|completed\|cancelled` |
| GET | `/api/maintenances/:id` | 정비 상세 | — |
| POST | `/api/maintenances` | 정비 등록 | body: `equipment_id`, `work_type`, `scheduled_at` (필수), `description`, `ar_user_id`, `manual_id` |
| PATCH | `/api/maintenances/:id` | 상태/결과 저장 | body: `status`, `result`, `ai_summary`(선택) |

## Manuals — 매뉴얼

| Method | Path | 설명 | 파라미터 |
|---|---|---|---|
| GET | `/api/manuals` | 매뉴얼 목록 | `?equipment_id=&category=` |
| GET | `/api/manuals/equipment` | 설비 드롭다운 목록 | — |
| GET | `/api/manuals/:id/steps` | 작업 가이드 스텝 (`step_no`, `title`, `description`, `model_url`) | — |

## Support Calls — 원격지원 요청

| Method | Path | 설명 | body |
|---|---|---|---|
| POST | `/api/support-calls` | AR이 지원 요청 생성 | `initiator_id` (필수), `maintenance_log_id` |
| GET | `/api/support-calls` | MR 대기 목록 | `?status=ringing\|active\|ended\|missed` |
| GET | `/api/support-calls/:id` | 상세 (수락/거절 폴링용, `manual_id`/`manual_title` 포함) | — |
| PATCH | `/api/support-calls/:id/accept` | MR 수락 | `receiver_id`(선택) |
| PATCH | `/api/support-calls/:id/reject` | MR 거절 | — |
| PATCH | `/api/support-calls/:id/end` | 통화 종료 (AR/MR 공용) | — |
| PATCH | `/api/support-calls/:id/result` | 원격지원 결과 저장 | `support_result` (RSUP01~04), `support_note` |

## Inspections — 원격점검

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/inspections/today` | 오늘 점검 대상 목록 |
| PATCH | `/api/inspections/:id` | 점검 결과 저장. body: `equipment_id`, `inspector_id`, `result`(normal\|issue_found), `note`. `issue_found` 시 알람 자동 생성 |

## Files — 정보공유 파일

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/files` | 파일 목록 (`?type=`) |
| POST | `/api/files` | 파일 업로드 (multipart) |
| DELETE | `/api/files/:id` | 파일 삭제 |
| POST | `/api/files/instruction` | 작업지시 이미지 업로드 (multipart) |
| GET | `/uploads/<name>` | 정적 파일 (glb 모델, 이미지 등) |

## Users — 사용자

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/users` | 사용자(작업자/전문가) 목록. 내부는 `user_info` 조회 → `{ id, name, role(null), department }` |

## Codes — 공통코드

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/codes?group=<group_cd>` | `system_code` 그룹 조회 → `{ id: code, name: code_nm, name_en: code_enm }` |

| group_cd | 용도 |
|---|---|
| `RESP08` | 유지관리작업 구분 (점검/보수/교체) |
| `RESP10` | 유지관리결과 구분 (정비 결과 대분류) |
| `RESP11` | 원격지원결과 구분 (RSUP01~04) |
| `DISA10` | 담수화 설비코드 |

## AI

| Method | Path | 설명 | 입력 |
|---|---|---|---|
| POST | `/api/ai/transcribe` | 오디오 → 텍스트 (faster-whisper, :8900 프록시) | multipart `file` |
| POST | `/api/ai/summarize` | 텍스트 → 요약 (Ollama, :11434) | JSON `{ text, jobTitle? }` |
| POST | `/api/ai/voice-summary` | 오디오 → 전사 + 요약 (OpenAI Whisper + GPT) | multipart `audio`, `{ maintenance_id? }` |

## RTC — Agora

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/rtc/:channel/:uid` | Agora RTC 토큰 발급 → `{ token }` |

## WebSocket

`ws://<host>:3000?platform=MR` 또는 `?platform=AR`

- 서버 → 클라: `ALARM` (알람 푸시)
- AR ↔ MR 릴레이: `support_call_request`, `call_request/response/end`, `file_share`, `guide_step_control`,
  `draw_start/point/end`, `model_rotate/point/view/explode`, `maintenance_complete`

---

## 구 → 신 경로 매핑 (2026-09 리팩터링)

| 구 | 신 |
|---|---|
| `/rtc/:ch/:uid` | `/api/rtc/:ch/:uid` |
| `/api/alarm` | `/api/alarms` |
| `/api/alarm/trigger/start` (POST) | `/api/alarms` (POST) |
| `/api/alarm/trigger/stop` (POST) | `/api/alarms/active` (DELETE) |
| `/api/alarm/trigger/status` | `/api/alarms/trigger-status` |
| `/api/maintenance*` | `/api/maintenances*` |
| `/api/maintenance/result-categories` | `/api/codes?group=RESP10` |
| `/api/manual*` | `/api/manuals*` |
| `/api/technician` | `/api/users` |
| `/api/inspections/equipment/:id/sensors` | `/api/equipment/:id/sensors` |
| `/api/support-calls/result-options` | `/api/codes?group=RESP11` |
| `/api/stt` | `/api/ai/transcribe` |
| `/api/summarize` | `/api/ai/summarize` |
| `/api/summary` | `/api/ai/voice-summary` |

변경 없음: `/api/support-calls/:id/(accept\|reject\|end\|result)`, `/api/files/*`, `/api/inspections/today`, `/api/inspections/:id`, `/api/ar/device/:uuid`
