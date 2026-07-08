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
const manualRouter = require('./manual');
const technicianRouter = require('./technician');

const app = express();
const server = http.createServer(app);
app.use(express.json());

// CORS (Unity WebRequest 허용)
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// 라우터 등록
app.use('/api/equipment', equipmentRouter); // MR 장비 정보 라우터
app.use('/api/ar/device', arRouter);   // AR 장비 정보 라우터 (QR)
app.use('/rtc', agoraRouter); // ← 아고라 통신용 라우터 추가
app.use('/api/alarm/trigger', alarmTriggerRouter); // 알람 트리거(발생) 라우터 
app.use('/api/alarm', alarmRouter); // 알람 조회 라우터
app.use('/api/maintenance', maintenanceRouter); // 유지보수 이력 라우터
app.use('/api/inspections', inspectionRouter); // 원격점검 라우터
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/api/files', fileRouter);
app.use('/api/summary', summaryRouter);
app.use('/api/manual', manualRouter);
app.use('/api/technician', technicianRouter);



// Websocket + DB 리스너
initWebSocket(server);
startListening(handleAlarm);

server.listen(3000, () => {
    console.log('[SERVER] 포트 3000 실행 중');
});

