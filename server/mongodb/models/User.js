const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    name: String,
    phone: { type: String, default: '' },
    address: { type: String, default: '' },
    password: String, // Optional if using OTP only
    otp: String,      // Current OTP
    otpExpires: Date,  // OTP Expiration time
    otpPurpose: { type: String, default: 'login' },
    failedLoginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date },
    failedOtpAttempts: { type: Number, default: 0 },
    forgotPasswordVerifiedUntil: { type: Date, default: null }
}, {
    timestamps: true
});

module.exports = mongoose.model('User', UserSchema);
