const express = require('express');
// Import config (Load env vars first)
const serverConfig = require('./config/server.config');
const multer = require('multer');
const connectDB = require('./mongodb/connect');
const authRouter = require('./routes/auth.routes');
const requestLogger = require('./middleware/request-logger.middleware');



// Import middlewares
const {
    helmetMiddleware,
    corsMiddleware,
    mongoSanitize,
    xss,
    generalLimiter
} = require('./middleware/security.middleware');

// Import routes
const indexRouter = require('./routes/index.routes');
const healthRouter = require('./routes/health.routes');
const diseasesRouter = require('./routes/diseases.routes');
const geminiRouter = require('./routes/gemini.routes');
const classifyRouter = require('./routes/classify.routes');
const detectRouter = require('./routes/detect.routes');

// Import server startup
const { startServers } = require('./utils/server.startup');

// Connect to MongoDB
connectDB();

// Khởi tạo Express app
const app = express();

// Cấu hình trust proxy
app.set('trust proxy', serverConfig.TRUST_PROXY ? 1 : false);

// ========== SECURITY MIDDLEWARES ==========
app.use(helmetMiddleware);
app.use(corsMiddleware);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(requestLogger);

// Sanitize data AFTER body parsing
// app.use(mongoSanitize()); // <--- TẠM TẮT ĐỂ DEMO NOSQL INJECTION
app.use(xss());
app.use(generalLimiter);

// ========== ROUTES ==========
app.use('/', indexRouter);
app.use('/', healthRouter);
app.use('/', diseasesRouter);
app.use('/', geminiRouter);
app.use('/', classifyRouter);
app.use('/', detectRouter);
app.use('/api/auth', authRouter);

// ========== ERROR HANDLER ==========
app.use((error, req, res, next) => {
    console.error('Server Error:', error);

    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                error: 'Kích thước file quá lớn (tối đa 10MB)'
            });
        }
        return res.status(400).json({
            success: false,
            error: 'Lỗi upload file'
        });
    }

    // Không expose stack trace hoặc chi tiết lỗi cho client
    res.status(500).json({
        success: false,
        error: 'Có lỗi xảy ra trên server. Vui lòng thử lại sau.'
    });
});

// ========== START SERVER ==========
startServers(app);
