const mongoose = require('mongoose');

const PendingUserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true }, // Hashed password
    otp: { type: String, required: true },
    otpExpires: { type: Date, required: true },
    failedOtpAttempts: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now, expires: 600 } // Auto-delete after 10 minutes
});

module.exports = mongoose.model('PendingUser', PendingUserSchema);
