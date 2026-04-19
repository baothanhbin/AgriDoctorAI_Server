const SENSITIVE_KEYS = [
    'password',
    'currentPassword',
    'newPassword',
    'confirmPassword',
    'otp',
    'token',
    'authorization',
    'accessToken',
    'refreshToken'
];

const MAX_STRING_LENGTH = 160;

function maskValue(value) {
    if (value == null) {
        return value;
    }

    if (typeof value === 'string') {
        if (value.length <= 4) {
            return '***';
        }
        return `${value.slice(0, 2)}***${value.slice(-2)}`;
    }

    return '***';
}

function sanitizePayload(payload) {
    if (payload == null) {
        return payload;
    }

    if (Array.isArray(payload)) {
        return payload.map(sanitizePayload);
    }

    if (typeof payload === 'object') {
        return Object.fromEntries(
            Object.entries(payload).map(([key, value]) => {
                if (SENSITIVE_KEYS.includes(key)) {
                    return [key, maskValue(value)];
                }
                return [key, sanitizePayload(value)];
            })
        );
    }

    if (typeof payload === 'string' && payload.length > MAX_STRING_LENGTH) {
        return `${payload.slice(0, MAX_STRING_LENGTH)}...`;
    }

    return payload;
}

function buildHeaderSummary(req) {
    return {
        host: req.get('host') || '',
        origin: req.get('origin') || '',
        userAgent: req.get('user-agent') || '',
        contentType: req.get('content-type') || '',
        authorization: req.get('authorization') ? maskValue(req.get('authorization')) : ''
    };
}

function requestLogger(req, res, next) {
    const startTime = Date.now();
    const payload =
        req.method === 'GET' || req.method === 'DELETE'
            ? sanitizePayload(req.query)
            : sanitizePayload(req.body);

    console.log(
        `[API][REQ] ${req.method} ${req.originalUrl} | ip=${req.ip} | body=${JSON.stringify(payload)} | headers=${JSON.stringify(buildHeaderSummary(req))}`
    );

    res.on('finish', () => {
        const durationMs = Date.now() - startTime;
        console.log(
            `[API][RES] ${req.method} ${req.originalUrl} | status=${res.statusCode} | duration=${durationMs}ms`
        );
    });

    next();
}

module.exports = requestLogger;
