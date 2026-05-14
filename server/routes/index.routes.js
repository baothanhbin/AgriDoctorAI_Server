const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
    res.json({
        message: 'Plant Detection API',
        version: '1.0.0',
        endpoints: {
            'POST /api/classify': 'Upload ảnh để nhận diện loại cây',
            'POST /api/detect': 'Upload ảnh để phân tích bệnh cây trồng',
            'GET /api/diseases': 'Lấy danh sách bệnh cây',
            'POST /api/chatbot': 'Nhận câu trả lời chatbot chuyên về cây trồng',
            'GET /health': 'Kiểm tra trạng thái server'
        },
        security: {
            rateLimiting: 'enabled',
            helmet: 'enabled',
            cors: 'enabled',
            publicUploads: 'disabled',
            dashboard: 'disabled'
        }
    });
});

module.exports = router;
