const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_ISSUER = 'agridoctorai-api';
const JWT_AUDIENCE = 'agridoctorai-mobile';

if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is not defined in environment variables. Please set JWT_SECRET in your .env file or environment.');
}

const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Access denied.'
        });
    }

    try {
        const verified = jwt.verify(token, JWT_SECRET, {
            issuer: JWT_ISSUER,
            audience: JWT_AUDIENCE
        });

        req.user = verified;
        next();
    } catch (error) {
        return res.status(403).json({
            success: false,
            message: 'Invalid token.'
        });
    }
};

module.exports = verifyToken;
