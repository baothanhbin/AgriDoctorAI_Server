const express = require('express');

const router = express.Router();

router.use((req, res) => {
    return res.status(410).json({
        success: false,
        error: 'Dashboard public endpoint da bi vo hieu hoa.'
    });
});

module.exports = router;
