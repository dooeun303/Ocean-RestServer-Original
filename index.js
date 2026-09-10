// 서버 진입점
require('dotenv').config(); // .env 파일에서 환경변수 로드

const http = require('http'); // HTTP 서버 모듈

// 모듈 및 라우터 임포트
const express = require('express');
const path = require('path');

const { startListening } = require('./db');
const { handleAlarm } = require('./notify');
const { initWebSocket } = require('./ws');
const equipmentRouter = require('./equipment');
const arRouter = require('./ar_equipment');          // AR QR 장비 정보
const agoraRouter = require('./agora');                 // 아고라 통신 라우터
const alarmTriggerRouter = require('./trigger_alarm'); // MR 알람 트리거 라우터
const alarmRouter = require('./alarm'); // MR 알람 전체 조회 라우터
const maintenanceRouter = require('./maintenance'); // 유지보수 이력 라우터
const inspectionRouter = require('./inspection'); // 원격점검 라우터
const fileRouter = require('./files'); // MR - AR 파일 전송(정보공유) 라우터
const summaryRouter = require('./summary'); // 화상통화 요약 라우터
const sttRouter = require('./stt'); // 음성 전사(STT) 프록시 라우터 → 내부 faster-whisper(8900)
const { startSttService } = require('./stt_autostart'); // faster-whisper 서비스 자동 실행
const summarizeRouter = require('./summarize'); // STT 원문 → 로컬 LLM(Ollama) 요약
const manualRouter = require('./manual');
const userRouter = require('./technician'); // 사용자(작업자/전문가) 목록 - 내부는 user_info 조회
const supportCallRouter = require('./support_call'); // AR→MR 지원 요청(원격지원) 큐 라우터
const codeRouter = require('./codes'); // system_code 공통코드 조회
const authRouter = require('./auth'); // QR 로그인 (MR/AR 공용) - JWT

const app = express();
const server = http.createServer(app);
app.use(express.json());

// CORS (Unity WebRequest 허용)
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// 라우터 등록
app.use('/api/auth', authRouter);                    // POST /qr-login · POST /logout · GET /me
app.use('/api/equipment', equipmentRouter);          // GET /:id, GET /:id/sensors
app.use('/api/ar/device', arRouter);                 // AR 전용 응답 포맷 (AR 앱이 소유)
app.use('/api/rtc', agoraRouter);                    // Agora 토큰
app.use('/api/alarms', alarmRouter);                 // GET /            (목록)
app.use('/api/alarms', alarmTriggerRouter);          // POST / · DELETE /active · GET /trigger-status
app.use('/api/maintenances', maintenanceRouter);
app.use('/api/inspections', inspectionRouter);       // GET /today · PATCH /:id
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/api/files', fileRouter);
app.use('/api/manuals', manualRouter);
app.use('/api/users', userRouter);
app.use('/api/support-calls', supportCallRouter);
app.use('/api/codes', codeRouter);                   // GET /?group=RESP10
app.use('/api/ai/voice-summary', summaryRouter);     // 오디오 → 전사+요약 (OpenAI)
app.use('/api/ai/transcribe', sttRouter);            // 오디오 → 전사 (faster-whisper)
app.use('/api/ai/summarize', summarizeRouter);       // 텍스트 → 요약 (Ollama)



// Websocket + DB 리스너
initWebSocket(server);
startListening(handleAlarm);

// faster-whisper STT 서비스(stt_service.py)를 함께 자동 실행 (없으면 조용히 건너뜀)
startSttService();

server.listen(3000, () => {
    console.log('[SERVER] 포트 3000 실행 중');
});

