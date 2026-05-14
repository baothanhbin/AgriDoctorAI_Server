const express = require('express');
const router = express.Router();
const fs = require('fs');
const verifyToken = require('../middleware/auth.middleware');
const { detectLimiter } = require('../middleware/security.middleware');
const { upload, validateUploadedImage } = require('../middleware/upload.middleware');
const { runModel } = require('../utils/python.executor');
const { getDiseaseInfoFromDB } = require('../utils/db.helpers');

router.post('/api/detect', verifyToken, detectLimiter, upload.single('image'), validateUploadedImage, async (req, res) => {
    const timestamp = new Date().toISOString();
    const clientIP = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';

    try {
        if (!req.file) {
            console.log(`\n[DETECT REQUEST FAILED] ${timestamp}`);
            console.log(`   IP: ${clientIP}`);
            console.log('   Loi: Khong co file anh duoc upload\n');
            return res.status(400).json({
                success: false,
                error: 'Vui lòng upload file ảnh.'
            });
        }

        const imagePath = req.file.path;
        const fileName = req.file.originalname;

        console.log(`\n[DETECT REQUEST] ${timestamp}`);
        console.log(`   IP: ${clientIP}`);
        console.log(`   File: ${fileName}`);
        console.log('   Dang xu ly (Nhan dien cay -> Chuan doan benh)...');

        const result = await runModel(imagePath);
        fs.unlinkSync(imagePath);

        if (!result.success) {
            console.log(`   Ket qua: Loi - ${result.error || 'Khong xac dinh'}\n`);
            return res.status(500).json({
                success: false,
                error: result.error || 'Có lỗi xảy ra khi xử lý ảnh.'
            });
        }

        console.log('   Buoc 1 - Nhan dien cay:');
        console.log(`      Cay: ${result.plant_vn || 'Khong xac dinh'} (${result.plant_name || 'Unknown'})`);
        if (result.cls_confidence) {
            console.log(`      Do tin cay: ${(result.cls_confidence * 100).toFixed(2)}%`);
        }

        if (result.unsupported) {
            const unsupportedResult = {
                plantName: result.plant_name || 'Unknown',
                plantNameVN: result.plant_vn || 'Không xác định',
                diseaseName: 'Chưa hỗ trợ chẩn đoán',
                possibleProblems: [],
                symptoms: 'Hệ thống hiện tại chưa có AI model để chẩn đoán bệnh cho loại cây này.',
                causes: 'Đang trong quá trình phát triển và cập nhật dữ liệu.',
                treatment: [],
                recoveryCare: [],
                detections: result.detections || []
            };

            return res.json({
                success: true,
                data: unsupportedResult
            });
        }

        if (result.success && result.detections && result.detections.length > 0) {
            const topDetection = result.detections.reduce((prev, current) =>
                (prev.confidence > current.confidence) ? prev : current
            );

            const diseaseInfo = await getDiseaseInfoFromDB(topDetection.name);

            const formattedResult = {
                plantName: result.plant_name,
                plantNameVN: result.plant_vn,
                diseaseName: diseaseInfo.diseaseName,
                possibleProblems: diseaseInfo.possibleProblems,
                symptoms: diseaseInfo.symptoms,
                causes: diseaseInfo.causes,
                treatment: diseaseInfo.treatment,
                recoveryCare: diseaseInfo.recoveryCare,
                detections: result.detections || []
            };

            return res.json({
                success: true,
                data: formattedResult
            });
        }

        const noDiseaseResult = {
            plantName: result.plant_name || 'Unknown',
            plantNameVN: result.plant_vn || 'Không xác định',
            diseaseName: 'Không phát hiện bệnh',
            possibleProblems: [],
            symptoms: 'Không phát hiện triệu chứng nào trong ảnh',
            causes: 'Không phát hiện bệnh',
            treatment: [],
            recoveryCare: [],
            detections: result.detections || []
        };

        return res.json({
            success: true,
            data: noDiseaseResult
        });
    } catch (error) {
        if (error.code === 'INFERENCE_QUEUE_FULL') {
            return res.status(503).json({
                success: false,
                error: 'He thong dang ban xu ly anh. Vui long thu lai sau it phut.'
            });
        }

        console.log(`   Loi xu ly: ${error.message}`);
        console.log('   Tra ve loi cho client\n');

        if (req.file && req.file.path) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (unlinkError) {
                console.error('   Loi xoa file:', unlinkError);
            }
        }

        return res.status(500).json({
            success: false,
            error: 'Có lỗi xảy ra khi xử lý ảnh.'
        });
    }
});

module.exports = router;
