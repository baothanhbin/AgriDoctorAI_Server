const express = require('express');
const router = express.Router();
const fs = require('fs');
const verifyToken = require('../middleware/auth.middleware');
const { detectLimiter } = require('../middleware/security.middleware');
const { upload, validateUploadedImage } = require('../middleware/upload.middleware');
const { runClassify } = require('../utils/python.executor');
const { getPlantInfoFromDB } = require('../utils/db.helpers');

router.post('/api/classify', verifyToken, detectLimiter, upload.single('image'), validateUploadedImage, async (req, res) => {
    const timestamp = new Date().toISOString();
    const clientIP = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';

    try {
        if (!req.file) {
            console.log(`\n[CLASSIFY REQUEST FAILED] ${timestamp}`);
            console.log(`   IP: ${clientIP}`);
            console.log('   Loi: Khong co file anh duoc upload\n');
            return res.status(400).json({
                success: false,
                error: 'Vui lòng upload file ảnh.'
            });
        }

        const imagePath = req.file.path;
        const fileName = req.file.originalname;

        console.log(`\n[CLASSIFY REQUEST] ${timestamp}`);
        console.log(`   IP: ${clientIP}`);
        console.log(`   File: ${fileName}`);
        console.log('   Dang nhan dien cay...');

        const result = await runClassify(imagePath);
        fs.unlinkSync(imagePath);

        if (!result.success) {
            console.log(`   Ket qua: Loi - ${result.error || 'Khong xac dinh'}\n`);
            return res.status(500).json({
                success: false,
                error: result.error || 'Có lỗi xảy ra khi nhận diện cây.'
            });
        }

        const plantInfo = await getPlantInfoFromDB(result.plant_name);

        const responseData = {
            plantName: result.plant_name,
            plantNameVN: result.plant_vn,
            confidence: result.confidence,
            classificationStatus: 'Đã nhận diện thành công',
            icon: plantInfo.icon,
            description: plantInfo.description,
            scientificName: plantInfo.scientificName,
            family: plantInfo.family,
            commonNames: plantInfo.commonNames,
            growingRegions: plantInfo.growingRegions,
            season: plantInfo.season,
            careTips: plantInfo.careTips,
            commonDiseases: plantInfo.commonDiseases,
            possiblePlants: result.top_predictions ? result.top_predictions.map(prediction => ({
                name: prediction.name,
                nameVN: prediction.name_vn,
                confidence: prediction.confidence
            })) : [],
            topPredictions: result.top_predictions || []
        };

        return res.json({
            success: true,
            data: responseData
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
            error: 'Có lỗi xảy ra khi nhận diện cây.'
        });
    }
});

module.exports = router;
