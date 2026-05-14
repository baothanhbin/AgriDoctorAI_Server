const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const serverConfig = require('../config/server.config');

function createHttpsServer(app) {
    const certPath = path.join(__dirname, '..', 'ssl', 'cert.pem');
    const keyPath = path.join(__dirname, '..', 'ssl', 'key.pem');

    if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
        console.error('Khong tim thay SSL certificate!');
        console.error('Vui long chay: npm run generate-cert');
        console.error('   hoac dat certificate tai: ssl/cert.pem va ssl/key.pem');
        return null;
    }

    try {
        const options = {
            cert: fs.readFileSync(certPath),
            key: fs.readFileSync(keyPath)
        };

        return https.createServer(options, app);
    } catch (error) {
        console.error('Loi doc SSL certificate:', error.message);
        return null;
    }
}

function handleServerError(server, port, protocol) {
    server.on('error', err => {
        if (err.code === 'EADDRINUSE') {
            console.error(`\nLoi: Port ${port} dang duoc su dung!`);
            console.error('\nGiai phap:');
            console.error(`   1. Tim va dung process dang su dung port ${port}:`);
            console.error(`      Windows: netstat -ano | findstr :${port}`);
            console.error('      Sau do: taskkill /PID <PID> /F');
            console.error('   2. Hoac thay doi port trong file .env');
            process.exit(1);
        }

        console.error(`\nLoi khoi dong ${protocol} server:`, err.message);
        process.exit(1);
    });
}

function startHttpServer(app) {
    const httpServer = http.createServer(app);
    handleServerError(httpServer, serverConfig.PORT, 'HTTP');
    httpServer.listen(serverConfig.PORT, '0.0.0.0', () => {
        console.log(`HTTP Server dang chay tai: http://localhost:${serverConfig.PORT}`);
        console.log(`Truy cap tu mang local: http://${serverConfig.LOCAL_IP}:${serverConfig.PORT}`);
        console.log(`API endpoint (Public): http://${serverConfig.PUBLIC_IP}:${serverConfig.PORT}/api/detect`);
        console.log(`API Base URL: http://${serverConfig.PUBLIC_IP}:${serverConfig.PORT}`);
    });
}

function startServers(app) {
    if (!serverConfig.USE_HTTPS) {
        startHttpServer(app);
        return;
    }

    const httpsServer = createHttpsServer(app);
    if (httpsServer) {
        handleServerError(httpsServer, serverConfig.HTTPS_PORT, 'HTTPS');
        httpsServer.listen(serverConfig.HTTPS_PORT, '0.0.0.0', () => {
            console.log(`HTTPS Server dang chay tai: https://localhost:${serverConfig.HTTPS_PORT}`);
            console.log(`Truy cap tu mang local: https://${serverConfig.LOCAL_IP}:${serverConfig.HTTPS_PORT}`);
            console.log(`API endpoint (Public): https://${serverConfig.PUBLIC_IP}:${serverConfig.HTTPS_PORT}/api/detect`);
            console.log(`API Base URL: https://${serverConfig.PUBLIC_IP}:${serverConfig.HTTPS_PORT}`);
        });
        return;
    }

    console.log('Khong the khoi dong HTTPS server, dang chay HTTP...');
    startHttpServer(app);
}

module.exports = {
    startServers
};
