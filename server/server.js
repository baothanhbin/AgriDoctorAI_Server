const express = require('express');
const multer = require('multer');
const serverConfig = require('./config/server.config');
const connectDB = require('./mongodb/connect');
const authRouter = require('./routes/auth.routes');
const requestLogger = require('./middleware/request-logger.middleware');

const {
    helmetMiddleware,
    corsMiddleware,
    mongoSanitize,
    xss,
    generalLimiter
} = require('./middleware/security.middleware');

const indexRouter = require('./routes/index.routes');
const healthRouter = require('./routes/health.routes');
const diseasesRouter = require('./routes/diseases.routes');
const chatbotRouter = require('./routes/chatbot.routes');
const classifyRouter = require('./routes/classify.routes');
const detectRouter = require('./routes/detect.routes');

const { startServers } = require('./utils/server.startup');

connectDB();

const app = express();

app.set('trust proxy', serverConfig.TRUST_PROXY ? 1 : false);

app.use(helmetMiddleware);
app.use(corsMiddleware);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(requestLogger);
app.use(mongoSanitize());
app.use(xss());
app.use(generalLimiter);

app.use('/', indexRouter);
app.use('/', healthRouter);
app.use('/', diseasesRouter);
app.use('/', chatbotRouter);
app.use('/', classifyRouter);
app.use('/', detectRouter);
app.use('/api/auth', authRouter);

app.use((error, req, res, next) => {
    console.error('Server Error:', error);

    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                error: 'Kich thuoc file qua lon (toi da 10MB).'
            });
        }

        return res.status(400).json({
            success: false,
            error: 'Loi upload file.'
        });
    }

    if (error.message === 'Origin not allowed by CORS') {
        return res.status(403).json({
            success: false,
            error: 'Origin khong duoc phep.'
        });
    }

    if (error.statusCode) {
        return res.status(error.statusCode).json({
            success: false,
            error: error.message
        });
    }

    return res.status(500).json({
        success: false,
        error: 'Co loi xay ra tren server. Vui long thu lai sau.'
    });
});

startServers(app);
