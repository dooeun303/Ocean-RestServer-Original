// faster-whisper STT 서비스(stt_service.py)를 Node 서버와 함께 자동으로 띄운다.
//  - .venv-stt(전용 파이썬 환경)가 없으면 조용히 건너뛴다(미설치 상태).
//  - 8900이 이미 열려 있으면(nodemon 재시작, 수동 실행 등) 새로 안 띄우고 재사용한다.
//  - Node 프로세스가 끝나면 자식 프로세스도 정리한다.
// 이로써 `npm run dev` 한 번으로 Node(3000) + STT(8900, localhost 전용)가 같이 뜬다.
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');

const PY = path.join(__dirname, '.venv-stt', 'Scripts', 'python.exe');
const PORT = 8900;

function portOpen(port) {
    return new Promise((resolve) => {
        const sock = net.createConnection({ port, host: '127.0.0.1' });
        sock.setTimeout(500);
        sock.on('connect', () => { sock.destroy(); resolve(true); });
        sock.on('timeout', () => { sock.destroy(); resolve(false); });
        sock.on('error', () => resolve(false));
    });
}

async function startSttService() {
    if (!fs.existsSync(PY)) {
        console.warn(`[STT] ${PY} 없음 - 자동 실행 건너뜀 (venv 미설치). requirements-stt.txt 참고.`);
        return;
    }
    if (await portOpen(PORT)) {
        console.log(`[STT] 포트 ${PORT} 이미 사용 중 - 기존 서비스 재사용`);
        return;
    }

    const proc = spawn(
        PY,
        ['-m', 'uvicorn', 'stt_service:app', '--host', '127.0.0.1', '--port', String(PORT)],
        { cwd: __dirname, env: process.env, windowsHide: true }
    );

    proc.stdout.on('data', (d) => process.stdout.write(`[STT] ${d}`));
    proc.stderr.on('data', (d) => process.stdout.write(`[STT] ${d}`));
    proc.on('exit', (code) => console.log(`[STT] 서비스 종료 (code ${code})`));

    const kill = () => { try { proc.kill(); } catch (_) { /* 이미 종료됨 */ } };
    process.on('exit', kill);
    process.on('SIGINT', () => { kill(); process.exit(0); });
    process.on('SIGTERM', () => { kill(); process.exit(0); });

    console.log('[STT] stt_service.py 자동 실행 (포트 8900, localhost 전용). 첫 실행 시 모델 다운로드로 잠시 걸림.');
}

module.exports = { startSttService };
