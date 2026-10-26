// WebSocket 메시지 타입 목록 - 서버·AR·MR이 주고받는 { type: ... } 값은 전부 여기서 고른다.
// Unity 쪽 같은 목록: AR Assets/Scripts/Net/WsMessageType.cs, MR Assets/00Desalination/Scripts/Net/WsMessageType.cs
// 타입을 추가·변경할 때는 세 곳을 같이 고친다.
const MSG = {
    // 화상통화
    CALL_REQUEST:         'call_request',          // MR→AR 통화 요청 { channelName }
    CALL_RESPONSE:        'call_response',         // AR→MR 수락/거절 { channelName, accepted }
    CALL_END:             'call_end',              // 양방향(+서버) 통화 종료 { channelName, id? }

    // 원격지원 요청 큐(서버가 보냄)
    SUPPORT_CALL_REQUEST:  'support_call_request',  // 서버→MR 새 요청 { id }
    SUPPORT_CALL_ACCEPTED: 'support_call_accepted', // 서버→AR MR이 수락 { id, channel_name }
    SUPPORT_CALL_REJECTED: 'support_call_rejected', // 서버→AR MR이 거절 { id }

    // 작업 진행
    GUIDE_STEP_CONTROL:   'guide_step_control',    // AR→MR 작업가이드 단계 { stepIndex(1부터), stepCount }
    MAINTENANCE_COMPLETE: 'maintenance_complete',  // AR→MR 작업 결과 저장 완료
    FILE_SHARE:           'file_share',            // MR(또는 서버)→AR 파일 공유 { file_id, file_url }

    // 통화 중 실시간 지시(MR→AR)
    DRAW_START:           'draw_start',            // { strokeId, drawColor, drawWidth }
    DRAW_POINT:           'draw_point',            // { strokeId, drawX, drawY } 0..1 정규화
    DRAW_END:             'draw_end',              // { strokeId }
    MODEL_VIEW:           'model_view',            // 3D 모델 창 열림/닫힘 { modelViewOpen, modelUrl }
    MODEL_ROTATE:         'model_rotate',          // { rotX, rotY, rotZ, rotW }
    MODEL_POINT:          'model_point',           // { pointing, partName, pointX..Z, normX..Z }
    MODEL_EXPLODE:        'model_explode',         // { exploded }

    // AR 작업자 위치(AR→MR) - MR 쪽 표시(ArLocationSync)는 현재 씬에 연결돼 있지 않음
    AR_LOCATION:          'ar_location',           // { equipmentId }
    AR_POSE:              'ar_pose',               // { poseX, poseY, poseZ } AR 로컬 좌표

    // 고장예지 알람(서버→MR/AR, notify.js)
    ALARM:                'ALARM',
};

// 클라이언트가 보낸 메시지를 어디로 중계할지. to: 'AR' | 'MR' | 'OTHER'(보낸 쪽의 반대 플랫폼)
// log: 중계할 때 남길 한 줄(없으면 로그 생략 - 초당 여러 번 오는 스트리밍 메시지)
const RELAY = {
    [MSG.FILE_SHARE]:           { to: 'AR',    log: m => `파일 공유 file_id=${m.file_id}` },
    [MSG.CALL_REQUEST]:         { to: 'AR',    log: m => `통화 요청 channelName=${m.channelName}` },
    [MSG.CALL_RESPONSE]:        { to: 'MR',    log: m => `통화 응답 channelName=${m.channelName}, accepted=${m.accepted}` },
    [MSG.CALL_END]:             { to: 'OTHER', log: m => `통화 종료 channelName=${m.channelName}` },
    [MSG.GUIDE_STEP_CONTROL]:   { to: 'MR',    log: m => `작업가이드 단계 ${m.stepIndex}/${m.stepCount}` },
    [MSG.MAINTENANCE_COMPLETE]: { to: 'MR',    log: () => '작업 완료' },
    [MSG.AR_LOCATION]:          { to: 'MR',    log: m => `AR 위치 equipmentId=${m.equipmentId}` },
    [MSG.DRAW_START]:           { to: 'AR' },
    [MSG.DRAW_POINT]:           { to: 'AR' },
    [MSG.DRAW_END]:             { to: 'AR' },
    [MSG.MODEL_ROTATE]:         { to: 'AR' },
    [MSG.MODEL_POINT]:          { to: 'AR' },
    [MSG.MODEL_VIEW]:           { to: 'AR' },
    [MSG.MODEL_EXPLODE]:        { to: 'AR' },
    [MSG.AR_POSE]:              { to: 'MR' },
};

module.exports = { MSG, RELAY };
