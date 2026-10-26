const {WebSocketServer} = require('ws');
const { RELAY } = require('./ws_messages');

const clients = new Map();

// 웹소켓 초기화
function initWebSocket(server) {
    const wss = new WebSocketServer({server});

    // 클라이언트 연결 처리
    wss.on('connection', (ws, req) => {

        // 접속시 플랫폼 등록: ws://server?platform=MR
        const url = new URL(req.url, 'http://localhost');
        const platform = url.searchParams.get('platform');

        // 플랫폼이 없는 경우
        if (!clients.has(platform)) clients.set(platform, new Set());
        clients.get(platform).add(ws);
        console.log(`[WS연결]: ${platform} (현재 ${clients.get(platform).size}개)`);

        // 클라이언트가 보낸 메시지를 상대 플랫폼으로 중계
        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data);
                console.log(`[WS] ${platform}에서 수신:`, msg.type);

                // 어디로 보낼지는 ws_messages.js의 RELAY 표에 있다(메시지별 설명도 거기).
                const route = RELAY[msg.type];
                if (!route) {
                    console.warn(`[WS] 중계 대상이 아닌 메시지 무시: ${msg.type}`);
                    return;
                }
                const target = route.to === 'OTHER' ? (platform === 'MR' ? 'AR' : 'MR') : route.to;
                if (route.log) console.log(`[WS] ${target}로 포워딩 - ${route.log(msg)}`);
                sendTo(target, msg);
            } catch (err) {
                console.error('[WS] 메시지 파싱 오류:', err.message);
            }
        });

        // 웹소켓 종료
        ws.on('close', () => {
            clients.get(platform)?.delete(ws);
            console.log(`[WS] 해제: ${platform}`);
        });
    });
}

// 특정 플랫폼에 메시지 발송
function sendTo(platform, payload) {

    // 플랫폼에 연결된 클라이언트를 타겟으로 설정
    const targets = clients.get(platform);
    if (!targets || targets.size === 0) {
        console.log(`[WS] ${platform}에 연결된 클라이언트 없음`);
        return;
    }

    // 전송 알림 JSON으로 직렬화 해서 메시지 생성
    const message = JSON.stringify(payload);

    // 타겟에게 메시지 발송
    targets.forEach(ws => ws.send(message));
    console.log(`[WS] ${platform}로 발송 완료`);
}

module.exports = {initWebSocket, sendTo};