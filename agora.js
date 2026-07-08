// 아고라 통화 연결 토큰 생성 라우터
const express = require('express');
const { RtcTokenBuilder, RtcRole } = require('agora-token');

// 라우터 및 app_id, app_certificate 설정
const router = express.Router();
const APP_ID = process.env.APP_ID;
const APP_CERTIFICATE = process.env.APP_CERTIFICATE;

// 채널이름/UID로 토큰 생성 라우터
router.get('/:channelName/:uid', (req, res) => {
    const { channelName, uid } = req.params;

    const expirationTime = 3600; // 1시간
    const currentTime = Math.floor(Date.now() / 1000);
    const expirationTimeStamp = currentTime + expirationTime;

    const token = RtcTokenBuilder.buildTokenWithUid(
        APP_ID,
        APP_CERTIFICATE,
        channelName,
        uid,
        RtcRole.PUBLISHER,
        expirationTimeStamp,
        expirationTimeStamp
    );

    res.json({ token });
});

module.exports = router;