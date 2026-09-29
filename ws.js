const {WebSocketServer} = require('ws');

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

        // MR에서 보낸 메시지 수신 → AR로 포워딩
        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data);
                console.log(`[WS] ${platform}에서 수신:`, msg.type);

                // file_share 메시지면 AR로 포워딩
                if (msg.type === 'file_share') {
                    console.log(`[WS] AR로 포워딩: file_id=${msg.file_id}`);
                    sendTo('AR', msg);
                }
                // 화상통화 요청(MR→AR)
                else if (msg.type === 'call_request') {
                    console.log(`[WS] AR로 통화요청 포워딩: channelName=${msg.channelName}`);
                    sendTo('AR', msg);
                }
                // 화상통화 응답(AR→MR)
                else if (msg.type === 'call_response') {
                    console.log(`[WS] MR로 통화응답 포워딩: channelName=${msg.channelName}, accepted=${msg.accepted}`);
                    sendTo('MR', msg);
                }
                // 화상통화 종료 (MR↔AR 어느 쪽이든 상대 플랫폼으로 전달)
                else if (msg.type === 'call_end') {
                    const target = platform === 'MR' ? 'AR' : 'MR';
                    console.log(`[WS] ${target}로 통화종료 포워딩: channelName=${msg.channelName}`);
                    sendTo(target, msg);
                }
                // 작업 가이드 단계 제어 (AR→MR, 2026-08-26: 방향 반전 - AR이 이전/다음을 눌러
                // 넘기면 MR(WorkGuidePanel, 자체 버튼 없음)이 그대로 따라간다)
                else if (msg.type === 'guide_step_control') {
                    console.log(`[WS] MR로 작업가이드 단계 포워딩: ${msg.stepIndex}/${msg.stepCount}`);
                    sendTo('MR', msg);
                }
                // 실시간 그리기 (MR→AR, MR이 통화 중 라이브 화면 위에 그린 선을 포인트 단위로 스트리밍, 편방향)
                else if (msg.type === 'draw_start' || msg.type === 'draw_point' || msg.type === 'draw_end') {
                    sendTo('AR', msg);
                }
                // 3D 모델 회전 스트리밍 (MR→AR, MR이 컨트롤러로 모델을 돌리면 그 회전을 실시간 전달, 편방향)
                else if (msg.type === 'model_rotate') {
                    sendTo('AR', msg);
                }
                // 3D 모델 위 포인팅/지시 (MR→AR, MR이 컨트롤러 레이로 모델을 가리키면 그 지점을 실시간 전달, 편방향)
                else if (msg.type === 'model_point') {
                    sendTo('AR', msg);
                }
                // 3D 모델 창 열림/닫힘 (MR→AR, MR이 "모델 회전 테스트"를 열거나 닫거나 탭을
                // 벗어나면 AR도 같이 모델을 띄우거나 지운다, 편방향)
                else if (msg.type === 'model_view') {
                    sendTo('AR', msg);
                }
                // 3D 모델 분해도 토글 (MR→AR, 부품을 흩어놓을지/모을지 편방향 전달 - 애니메이션 자체는 양쪽이 각자 재생)
                else if (msg.type === 'model_explode') {
                    sendTo('AR', msg);
                }
                // 유지보수 작업 저장 완료 (AR→MR, 통화 상태와 무관하게 항상 전달 - MR은 도크를
                // 닫고 깜빡이던 설비 하이라이트도 정리한다)
                else if (msg.type === 'maintenance_complete') {
                    console.log('[WS] MR로 작업 완료 포워딩');
                    sendTo('MR', msg);
                }
                // AR 위치 갱신 (AR→MR, 통화 상태와 무관하게 항상 전달 - AR이 QR로 설비를 인식할
                // 때마다 보내고, MR은 디지털 트윈에서 해당 설비에 "AR 작업자 위치" 표시를 옮긴다)
                else if (msg.type === 'ar_location') {
                    console.log(`[WS] MR로 AR 위치 포워딩: equipmentId=${msg.equipmentId}`);
                    sendTo('MR', msg);
                }
                // AR 6DoF 카메라 로컬 좌표 스트리밍 (AR→MR, 0.3초 간격 - 빈번해서 로그는 생략)
                else if (msg.type === 'ar_pose') {
                    sendTo('MR', msg);
                }
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