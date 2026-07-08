const express = require('express');
const router  = require('express').Router();
const { pool } = require('./db');

// GET /api/technician — 작업자 목록 조회
router.get('/', async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT id, name, role, department FROM ttt.technician ORDER BY name ASC'
        );
        return res.status(200).json({ success: true, data: rows });
    } catch (err) {
        console.error('[TECHNICIAN] 조회 오류:', err.message);
        return res.status(500).json({ success: false, message: '서버 오류' });
    }
});

module.exports = router;