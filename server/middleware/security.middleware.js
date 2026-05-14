const helmet = require('helmet');
const cors = require('cors');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const mongoSanitizeLib = require('express-mongo-sanitize');
const { clean: cleanXss } = require('xss-clean/lib/xss');
const serverConfig = require('../config/server.config');

function isMutableObject(value) {
    return typeof value === 'object' && value !== null;
}

function replaceMutableValue(target, source) {
    if (Array.isArray(target) && Array.isArray(source)) {
        target.splice(0, target.length, ...source);
        return target;
    }

    if (isMutableObject(target) && isMutableObject(source)) {
        Object.keys(target).forEach((key) => {
            if (!(key in source)) {
                delete target[key];
            }
        });

        Object.assign(target, source);
        return target;
    }

    return source;
}

function mongoSanitize(options = {}) {
    const hasOnSanitize = typeof options.onSanitize === 'function';

    return (req, res, next) => {
        ['body', 'params', 'headers', 'query'].forEach((key) => {
            const value = req[key];

            if (!isMutableObject(value)) {
                return;
            }

            const isSanitized = mongoSanitizeLib.has(value, options.allowDots);
            mongoSanitizeLib.sanitize(value, options);

            if (isSanitized && hasOnSanitize) {
                options.onSanitize({ req, key });
            }
        });

        next();
    };
}

function xss() {
    return (req, res, next) => {
        ['body', 'query', 'params'].forEach((key) => {
            const value = req[key];

            if (value === undefined) {
                return;
            }

            const sanitizedValue = cleanXss(value);

            if (key === 'query' && isMutableObject(value) && isMutableObject(sanitizedValue)) {
                replaceMutableValue(value, sanitizedValue);
                return;
            }

            req[key] = sanitizedValue;
        });

        next();
    };
}

const helmetMiddleware = helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", 'data:', 'https:'],
        },
    },
    crossOriginEmbedderPolicy: false,
});

const corsMiddleware = cors({
    origin(origin, callback) {
        if (!origin) {
            return callback(null, true);
        }

        if (serverConfig.ALLOW_ALL_ORIGINS) {
            return callback(null, true);
        }

        if (serverConfig.ALLOWED_ORIGINS.includes(origin)) {
            return callback(null, true);
        }

        return callback(new Error('Origin not allowed by CORS'));
    },
    credentials: false,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
});

const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    skip(req) {
        return req.path === '/health';
    },
    message: {
        success: false,
        error: 'Qua nhieu requests tu IP nay, vui long thu lai sau 15 phut.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

const geminiKeyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: {
        success: false,
        error: 'Qua nhieu requests den endpoint nhay cam, vui long thu lai sau.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

const detectLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: {
        success: false,
        error: 'Qua nhieu requests den endpoint xu ly anh, vui long thu lai sau 15 phut.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

const healthLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    message: {
        success: false,
        error: 'Qua nhieu requests den health endpoint.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    keyGenerator(req) {
        const email =
            typeof req.body?.email === 'string'
                ? req.body.email.trim().toLowerCase()
                : '';

        return `${ipKeyGenerator(req.ip || '')}:${email}`;
    },
    message: {
        success: false,
        error: 'Qua nhieu yeu cau xac thuc. Vui long thu lai sau.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

const otpVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    keyGenerator(req) {
        const email =
            typeof req.body?.email === 'string'
                ? req.body.email.trim().toLowerCase()
                : '';

        return `${ipKeyGenerator(req.ip || '')}:${email}`;
    },
    message: {
        success: false,
        error: 'Qua nhieu lan xac thuc OTP. Vui long thu lai sau.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

const passwordResetLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 8,
    keyGenerator(req) {
        const email =
            typeof req.body?.email === 'string'
                ? req.body.email.trim().toLowerCase()
                : '';

        return `${ipKeyGenerator(req.ip || '')}:${email}`;
    },
    message: {
        success: false,
        error: 'Qua nhieu yeu cau dat lai mat khau. Vui long thu lai sau.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

const chatbotLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 40,
    keyGenerator(req) {
        return `${ipKeyGenerator(req.ip || '')}:${req.user?.userId || 'anonymous'}`;
    },
    message: {
        success: false,
        error: 'Qua nhieu yeu cau chatbot. Vui long thu lai sau.'
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
    healthLimiter,
    authLimiter,
    otpVerifyLimiter,
    passwordResetLimiter,
    chatbotLimiter
};
