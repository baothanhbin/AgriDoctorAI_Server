const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const os = require('os');

function parsePositiveInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOrigins(value) {
    if (!value || value === '*') {
        return [];
    }

    return value
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean);
}

function getLocalIPAddress() {
    const interfaces = os.networkInterfaces();
    const preferredAdapters = ['Wi-Fi', 'WLAN', 'wlan', 'eth0', 'en0'];

    for (const preferred of preferredAdapters) {
        if (interfaces[preferred]) {
            for (const iface of interfaces[preferred]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    return iface.address;
                }
            }
        }
    }

    const excludePatterns = ['VMware', 'VMnet', 'VirtualBox', 'Teredo', 'Bluetooth', 'WSL', 'vEthernet'];
    for (const name of Object.keys(interfaces)) {
        const isExcluded = excludePatterns.some(pattern => name.includes(pattern));
        if (!isExcluded) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    return iface.address;
                }
            }
        }
    }

    return 'localhost';
}

function getPublicIP() {
    if (process.env.PUBLIC_IP) {
        return process.env.PUBLIC_IP;
    }

    return getLocalIPAddress();
}

module.exports = {
    PORT: process.env.PORT || 3000,
    HTTPS_PORT: process.env.HTTPS_PORT || 3443,
    USE_HTTPS: process.env.USE_HTTPS === 'true' || process.env.USE_HTTPS === '1',
    TRUST_PROXY: process.env.TRUST_PROXY === 'true',
    ALLOW_ALL_ORIGINS: process.env.ALLOWED_ORIGINS === '*',
    ALLOWED_ORIGINS: parseOrigins(process.env.ALLOWED_ORIGINS),
    LOCAL_IP: getLocalIPAddress(),
    PUBLIC_IP: getPublicIP(),
    UPLOADS_DIR: path.join(__dirname, '..', 'uploads'),
    GEMINI_KEY_FILE: path.join(__dirname, '..', 'gemini-key.json'),
    DEFAULT_GEMINI_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    MAX_IMAGE_WIDTH: parsePositiveInt(process.env.MAX_IMAGE_WIDTH, 6000),
    MAX_IMAGE_HEIGHT: parsePositiveInt(process.env.MAX_IMAGE_HEIGHT, 6000),
    MAX_UPLOAD_PIXELS: parsePositiveInt(process.env.MAX_UPLOAD_PIXELS, 25_000_000),
    MAX_CONCURRENT_INFERENCE: parsePositiveInt(process.env.MAX_CONCURRENT_INFERENCE, 2),
    MAX_PENDING_INFERENCE: parsePositiveInt(process.env.MAX_PENDING_INFERENCE, 8)
};
