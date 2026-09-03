# 음성 STT 프록시 + 로컬 LLM 요약

> 마지막 업데이트: 2026-09-03
> 커밋: `30ef114` (Ocean-RestServer-Original@master)

AR 글래스에서 유지보수 작업자가 조치사항·특이사항을 **구술** → **전사(STT)** → **로컬 LLM 요약** →
작업기록으로 저장. 유료 API 없이 사내 자체호스팅만 사용 (`.env` 의 기존 OpenAI 키는 만료).

## 아키텍처

```
Unity  ──WAV(16kHz/16-bit)──▶  :3000
                                 ├─ POST /api/stt        stt.js  ─▶  faster-whisper  127.0.0.1:8900 (localhost 전용)
                                 └─ POST /api/summarize   summarize.js  ─▶  Ollama  127.0.0.1:11434 (GPU) + EXAONE 3.5
```

- 외부(글래스)엔 **:3000 하나만** 노출. 8900은 localhost 전용이라 방화벽 불필요.
- `npm run dev` 하나로 Node + faster-whisper 동시 기동 (`stt_autostart.js`). Ollama는 Windows 설치 시 상시.

## 파일

| 파일 | 상태 | 역할 |
|---|---|---|
| `stt_service.py` | 신규 | FastAPI + faster-whisper(CTranslate2). `POST /api/stt` (multipart `file`) → `{ success, text, duration }`. `model.transcribe(language="ko", vad_filter=True, beam_size=5)` |
| `requirements-stt.txt` | 신규 | faster-whisper==1.0.3, fastapi, uvicorn[standard], python-multipart, requests, huggingface-hub |
| `stt.js` | 신규 | `/api/stt` 프록시 → `STT_INTERNAL_URL || http://127.0.0.1:8900/api/stt` (multer memoryStorage → form-data 재구성) |
| `stt_autostart.js` | 신규 | `startSttService()` — `.venv-stt/Scripts/python.exe` 확인, 8900 포트 확인 후 없으면 `uvicorn stt_service:app` 자식 프로세스 spawn. Node 종료/SIGINT/SIGTERM 시 kill |
| `summarize.js` | 신규 | `POST /api/summarize` (JSON `{ text, jobTitle? }`) → Ollama `/api/chat` → `{ success, summary, model }` |
| `.gitignore` | 신규 | `.venv-stt/`, `__pycache__/`, `*.pyc` |
| `support_call.js` | 신규 | AR→MR 지원요청(화상통화) 큐 라우터 |
| `index.js` | 수정 | 위 라우터 require + `app.use('/api/stt' | '/api/summarize' | '/api/support-calls')` + `startSttService()` + CORS `PATCH, DELETE` 허용 |
| `maintenance.js` | 수정 | 목록 쿼리 `ORDER BY m.scheduled_at ASC` (기존 DESC) |
| `ws.js` | 수정 | `guide_step_control`(AR→MR), `model_rotate`/`model_point`/`model_view`/`model_explode`(MR→AR), `maintenance_complete`(AR→MR) 포워딩 추가 |

## 환경변수

| 변수 | 기본 | 설명 |
|---|---|---|
| `WHISPER_MODEL` | `small` | faster-whisper 모델 크기 (`medium`/`large-v3` 로 정확도↑) |
| `WHISPER_DEVICE` | `cpu` | `cuda` 로 GPU (별도 CUDA 라이브러리 필요) |
| `WHISPER_COMPUTE` | `int8` | GPU면 `float16` |
| `STT_INTERNAL_URL` | `http://127.0.0.1:8900/api/stt` | 프록시 대상 |
| `OLLAMA_MODEL` | `exaone3.5:7.8b` | 요약 모델. `:2.4b` 로 경량화(환각↑) |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama 주소 |

## summarize.js — 프롬프트

- `jobTitle` 이 오면 **작업내용을 그 값으로 고정**하고 구술에서 조치사항/특이사항만 추출 → 작업내용 환각 0
  - 출력 3줄: `작업내용: <jobTitle>` / `조치사항: …` / `특이사항: …` (없으면 "없음")
- `jobTitle` 없으면 조치사항/특이사항 2줄만
- 구술 `MIN_TEXT_LEN`(10)자 미만이면 LLM 호출 안 하고 `success:false` (짧은 입력 환각 방지)
- system 프롬프트: "구술한 내용만 근거, 지어내지 말 것", temperature 0.2, stream false

### 실측 예시 (`exaone3.5:7.8b`, jobTitle 전달)

| 구술 | 조치사항 | 특이사항 |
|---|---|---|
| "베어링 분해·세척 후 재조립, 유격 0.4mm 허용치 이내, 커플링 미세 오일 누유, 다음 점검 때 개스킷 교체 필요, 시운전 정상" | 커플링 개스킷 교체 예정 | 베어링 유격 허용치 이내, 커플링 쪽 미세 오일 누출 확인 |
| "ERD 로터 금속성 소음, 진동 6.5 기준 초과. 로터·씰 마모 분해 점검 필요해서 정비팀에 계획정비 요청함." | 로터·씰 분해 점검 및 정비 요청 | 금속성 소음 발생, 진동값 6.5로 기준 초과 |
| "커플링 볼트 재체결하고 그리스 주입. 특이사항 없어요." | 커플링 볼트 재체결 및 그리스 주입 | 없음 |

## 실행 사전조건

```
# 1. Python STT venv (최초 1회)
python -m venv .venv-stt
.venv-stt\Scripts\pip install -r requirements-stt.txt

# 2. Ollama + 요약 모델
ollama pull exaone3.5:7.8b   # 및/또는 :2.4b

# 3. 서버 (Node 3000 + faster-whisper 8900 자동 기동)
npm run dev
```

## 클라이언트

- **AR** (`Ocean-Desalination-newAR`): `VoiceTranscription.cs` 유틸, 메뉴 1 `MaintenanceTutorialDemo`
  작업완료 단계 / 메뉴 3 `SpeechToTextTestDemo` / 메뉴 4 `MaintenanceCompleteDemo`.
  자세한 건 그 저장소 `docs/voice-stt-summary.md`.
- **MR** (`Ocean-Desalination`): `ws.js` 포워딩 대상. `support_call.js` 큐 ↔ MR `SupportCallList.cs`.

## 남은 것 / TODO

- [ ] `git status` 상 `uploads/*` 런타임 업로드 파일이 다수 추적됨 — `.gitignore` 에 `uploads/` 추가 검토
- [ ] `.env` 의 만료된 `OPENAI_API_KEY` 정리 (현재 미사용, 이미 커밋 이력에 있음)
- [ ] STT 정확도: `small` 이 "해수담수화"→"해수담수와" 오인식. `medium` 또는 GPU `large-v3`
- [ ] 저장 시 실제 DB 반영: `PATCH /api/maintenance/:id` 로 `result` / `ai_summary`
- [ ] 사외 접속: `192.168.0.66` LAN 전용. Tailscale/터널 도입 여부 결정
