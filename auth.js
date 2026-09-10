const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const { pool } = require('./db');

// =============================================
// QR 로그인 - MR/AR 공용.
//   QR 배지 = user_info.user_id (JSON {"id":"..."} 또는 통짜 텍스트)
//   서버가 user_info 에서 검증 → JWT 발급 + login_hist 기록.
//   .env JWT_SECRET 없으면 개발용 기본값 사용.
// =============================================
const JWT_SECRET = process.env.JWT_SECRET || 'ocean-dev-secret-change-me';
const TOKEN_TTL  = process.env.JWT_TTL || '12h';   // 근무 1교대

function parseQr(qr) {
    if (!qr) return null;
    const s = String(qr).trim();
    try {
        const o = JSON.parse(s);
        if (o && (o.id || o.user_id)) return String(o.id || o.user_id).trim();
    } catch (_) { /* JSON 아님 → 통짜 텍스트를 id 로 */ }
    return s;
}

async function findUser(userId) {
    const { rows } = await pool.query(
        'SELECT user_id, user_nm, company FROM user_info WHERE user_id = $1', [userId]);
    return rows[0] || null;
}

// POST /api/auth/qr-login   body: { qr }
router.post('/qr-login', async (req, res) => {
    const userId = parseQr(req.body && req.body.qr);
    if (!userId) return res.status(400).json({ success: false, message: 'qr 값이 필요합니다.' });
    try {
        const user = await findUser(userId);
        if (!user) return res.status(401).json({ success: false, message: '등록되지 않은 사용자입니다.' });

        await pool.query('INSERT INTO login_hist (login_dt, user_id) VALUES (CURRENT_DATE, $1)', [user.user_id]);

        const token = jwt.sign(
            { user_id: user.user_id, user_nm: user.user_nm },
            JWT_SECRET, { expiresIn: TOKEN_TTL });

        console.log('[AUTH] qr-login:', user.user_id, user.user_nm);
        return res.json({ success: true, data: { token, user } });
    } catch (err) {
        console.error('[AUTH] qr-login 오류:', err.message);
        return res.status(500).json({ success: false, message: '서버 오류' });
    }
});

// POST /api/auth/logout   Authorization: Bearer <token>  또는  body: { user_id }
router.post('/logout', async (req, res) => {
    let userId = (req.body && req.body.user_id) || null;
    const auth = req.headers.authorization || '';
    if (!userId && auth.startsWith('Bearer ')) {
        try { userId = jwt.verify(auth.slice(7), JWT_SECRET).user_id; } catch (_) { /* 무시 */ }
    }
    if (!userId) return res.status(400).json({ success: false, message: 'user_id 또는 토큰이 필요합니다.' });
    try {
        await pool.query(
            'UPDATE login_hist SET logout_dt = CURRENT_DATE WHERE user_id = $1 AND logout_dt IS NULL', [userId]);
        return res.json({ success: true });
    } catch (err) {
        console.error('[AUTH] logout 오류:', err.message);
        return res.status(500).json({ success: false, message: '서버 오류' });
    }
});

// GET /api/auth/me   Authorization: Bearer <token>
router.get('/me', async (req, res) => {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return res.status(401).json({ success: false, message: '토큰이 없습니다.' });
    let payload;
    try { payload = jwt.verify(auth.slice(7), JWT_SECRET); }
    catch (_) { return res.status(401).json({ success: false, message: '토큰이 유효하지 않습니다.' }); }
    try {
        const user = await findUser(payload.user_id);
        if (!user) return res.status(401).json({ success: false, message: '사용자를 찾을 수 없습니다.' });
        return res.json({ success: true, data: { user } });
    } catch (err) {
        console.error('[AUTH] me 오류:', err.message);
        return res.status(500).json({ success: false, message: '서버 오류' });
    }
});

// 옵트인 인증 미들웨어 - 보호할 라우터에만 개별 적용 (전역 아님).
//   예)  app.use('/api/maintenances', requireAuth, maintenanceRouter);
//   통과 시 req.user = { user_id, user_nm }
function requireAuth(req, res, next) {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return res.status(401).json({ success: false, message: '인증이 필요합니다.' });
    try { req.user = jwt.verify(auth.slice(7), JWT_SECRET); return next(); }
    catch (_) { return res.status(401).json({ success: false, message: '토큰이 유효하지 않습니다.' }); }
}

module.exports = router;
module.exports.requireAuth = requireAuth;
