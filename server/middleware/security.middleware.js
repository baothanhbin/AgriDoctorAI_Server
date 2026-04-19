const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const serverConfig = require('../config/server.config');

// Helmet - Security headers
const helmetMiddleware = helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
    crossOriginEmbedderPolicy: false, // Tắt để hỗ trợ upload files
});

// CORS Configuration
const corsMiddleware = cors({
    origin: serverConfig.ALLOWED_ORIGINS,
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
});

// Rate Limiters
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 phút
    max: 10, // 10 requests per window
    message: {
        success: false,
        error: 'Quá nhiều requests từ IP này, vui lòng thử lại sau 15 phút.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

const geminiKeyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 phút
    max: 10, // 10 requests per window
    message: {
        success: false,
        error: 'Quá nhiều requests đến API key endpoint, vui lòng thử lại sau 15 phút.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

const detectLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 phút
    max: 20, // 20 requests per window
    message: {
        success: false,
        error: 'Quá nhiều requests đến detect endpoint, vui lòng thử lại sau 15 phút.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

const healthLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 phút
    max: 100, // 100 requests per minute
    message: {
        success: false,
        error: 'Quá nhiều requests đến health endpoint.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

module.exports = {
    helmetMiddleware,
    corsMiddleware,
    mongoSanitize,
    xss,
    generalLimiter,
    geminiKeyLimiter,
    detectLimiter,
    healthLimiter
};

