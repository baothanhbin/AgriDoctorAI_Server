const fs = require('fs');
const multer = require('multer');
const path = require('path');
const { imageSize } = require('image-size');
const serverConfig = require('../config/server.config');

const MIME_TO_EXTENSION = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/bmp': '.bmp'
};

function createRequestError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function detectImageMime(fileBuffer) {
    if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length < 8) {
        return null;
    }

    if (fileBuffer[0] === 0xff && fileBuffer[1] === 0xd8 && fileBuffer[2] === 0xff) {
        return 'image/jpeg';
    }

    if (
        fileBuffer[0] === 0x89 &&
        fileBuffer[1] === 0x50 &&
        fileBuffer[2] === 0x4e &&
        fileBuffer[3] === 0x47 &&
        fileBuffer[4] === 0x0d &&
        fileBuffer[5] === 0x0a &&
        fileBuffer[6] === 0x1a &&
        fileBuffer[7] === 0x0a
    ) {
        return 'image/png';
    }

    const asciiHeader = fileBuffer.subarray(0, 6).toString('ascii');
    if (asciiHeader === 'GIF87a' || asciiHeader === 'GIF89a') {
        return 'image/gif';
    }

    if (fileBuffer[0] === 0x42 && fileBuffer[1] === 0x4d) {
        return 'image/bmp';
    }

    return null;
}

function removeUploadedFile(filePath) {
    if (!filePath) {
        return;
    }

    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch (error) {
        console.error('Failed to remove invalid upload:', error.message);
    }
}

if (!fs.existsSync(serverConfig.UPLOADS_DIR)) {
    fs.mkdirSync(serverConfig.UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, serverConfig.UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: 10 * 1024 * 1024
    },
    fileFilter: (req, file, cb) => {
        const hasAllowedExtension = /\.(jpeg|jpg|png|gif|bmp)$/i.test(path.extname(file.originalname).toLowerCase());
        const normalizedMimeType = String(file.mimetype || '').toLowerCase();
        const hasAllowedMimeType = Object.prototype.hasOwnProperty.call(MIME_TO_EXTENSION, normalizedMimeType);

        if (hasAllowedExtension && hasAllowedMimeType) {
            return cb(null, true);
        }

        return cb(new Error('Chi chap nhan file anh (jpg, jpeg, png, gif, bmp).'));
    }
});

function validateUploadedImage(req, res, next) {
    if (!req.file?.path) {
        return next();
    }

    try {
        const fileBuffer = fs.readFileSync(req.file.path);
        const detectedMimeType = detectImageMime(fileBuffer);
        if (!detectedMimeType) {
            removeUploadedFile(req.file.path);
            return next(createRequestError('File anh khong hop le hoac da bi gia mao dinh dang.'));
        }

        const dimensions = imageSize(fileBuffer);
        const width = Number(dimensions.width || 0);
        const height = Number(dimensions.height || 0);
        const totalPixels = width * height;
        if (!width || !height) {
            removeUploadedFile(req.file.path);
            return next(createRequestError('Khong the doc kich thuoc anh da upload.'));
        }

        if (
            width > serverConfig.MAX_IMAGE_WIDTH ||
            height > serverConfig.MAX_IMAGE_HEIGHT ||
            totalPixels > serverConfig.MAX_UPLOAD_PIXELS
        ) {
            removeUploadedFile(req.file.path);
            return next(createRequestError('Anh vuot qua gioi han kich thuoc xu ly an toan.'));
        }

        const normalizedDeclaredMimeType = String(req.file.mimetype || '').toLowerCase();
        if (normalizedDeclaredMimeType !== detectedMimeType) {
            removeUploadedFile(req.file.path);
            return next(createRequestError('MIME type cua file anh khong khop voi noi dung thuc te.'));
        }

        req.file.detectedMimeType = detectedMimeType;
        req.file.detectedExtension = MIME_TO_EXTENSION[detectedMimeType];
        req.file.imageDimensions = { width, height };
        return next();
    } catch (error) {
        removeUploadedFile(req.file?.path);
        return next(createRequestError('Khong the xac thuc file anh da upload.'));
    }
}

module.exports = {
    upload,
    validateUploadedImage
};
