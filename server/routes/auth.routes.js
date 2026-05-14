const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');

const PendingUser = require('../mongodb/models/PendingUser');
const User = require('../mongodb/models/User');
const verifyToken = require('../middleware/auth.middleware');
const {
    authLimiter,
    otpVerifyLimiter,
    passwordResetLimiter
} = require('../middleware/security.middleware');
const sendEmail = require('../utils/sendEmail');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_ISSUER = 'agridoctorai-api';
const JWT_AUDIENCE = 'agridoctorai-mobile';
const PASSWORD_RESET_AUDIENCE = 'agridoctorai-password-reset';
const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
const EMAIL_REGEX = /^[A-Za-z0-9+_.-]+@[A-Za-z0-9.-]+$/;
const OTP_REGEX = /^\d{6}$/;
const OTP_TTL_MS = 5 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 10 * 60 * 1000;

function normalizeEmail(email) {
    return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function generateOtpCode() {
    return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function hashOtp(otp) {
    return crypto
        .createHmac('sha256', JWT_SECRET)
        .update(otp)
        .digest('hex');
}

function createToken(user) {
    return jwt.sign(
        { userId: user._id.toString(), email: user.email, name: user.name },
        JWT_SECRET,
        {
            expiresIn: '7d',
            issuer: JWT_ISSUER,
            audience: JWT_AUDIENCE,
            subject: user._id.toString()
        }
    );
}

function createResetToken(user, resetNonce) {
    return jwt.sign(
        {
            email: user.email,
            purpose: 'password-reset',
            nonce: resetNonce
        },
        JWT_SECRET,
        {
            expiresIn: Math.floor(RESET_TOKEN_TTL_MS / 1000),
            issuer: JWT_ISSUER,
            audience: PASSWORD_RESET_AUDIENCE,
            subject: user._id.toString()
        }
    );
}

function buildUserProfileResponse(user) {
    return {
        userId: user._id.toString(),
        name: user.name || '',
        email: user.email || '',
        phone: user.phone || '',
        address: user.address || '',
        createdAt: user.createdAt || null,
        updatedAt: user.updatedAt || null
    };
}

function buildSignupOtpResponse(email) {
    return {
        message: 'Ma OTP da duoc gui. Vui long nhap ma de xac thuc tai khoan.',
        email,
        isRegister: true
    };
}

function validatePasswordFormat(password) {
    if (typeof password !== 'string' || !PASSWORD_REGEX.test(password)) {
        return 'Mat khau phai co it nhat 8 ky tu, gom chu va so.';
    }

    return null;
}

function validateEmailFormat(email) {
    return EMAIL_REGEX.test(email);
}

function validateOtpFormat(otp) {
    return typeof otp === 'string' && OTP_REGEX.test(otp.trim());
}

async function assignOtp(target, purpose) {
    const otpCode = generateOtpCode();
    target.otp = hashOtp(otpCode);
    target.otpExpires = new Date(Date.now() + OTP_TTL_MS);
    target.otpPurpose = purpose;
    target.failedOtpAttempts = 0;
    await target.save();
    return otpCode;
}

function clearOtpState(target) {
    target.otp = null;
    target.otpExpires = null;
    target.failedOtpAttempts = 0;
    target.otpPurpose = 'login';
}

function invalidCredentials(res) {
    return res.status(400).json({
        message: 'Email hoac mat khau khong hop le.'
    });
}

function invalidOtp(res) {
    return res.status(400).json({
        message: 'Ma OTP khong hop le hoac da het han.'
    });
}

router.post('/signup', authLimiter, async (req, res) => {
    try {
        const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
        const normalizedEmail = normalizeEmail(req.body?.email);
        const password = req.body?.password;

        if (!name || !normalizedEmail || !password) {
            return res.status(400).json({ message: 'Vui long nhap day du ten, email va mat khau.' });
        }

        if (!validateEmailFormat(normalizedEmail)) {
            return res.status(400).json({ message: 'Email khong dung dinh dang.' });
        }

        const passwordError = validatePasswordFormat(password);
        if (passwordError) {
            return res.status(400).json({ message: passwordError });
        }

        const existingUser = await User.findOne({ email: normalizedEmail });
        if (existingUser) {
            return res.status(409).json({
                message: 'Email da duoc su dung. Vui long dang nhap.'
            });
        }

        const hashedPassword = await bcrypt.hash(password, 12);
        const otpCode = generateOtpCode();

        await PendingUser.findOneAndUpdate(
            { email: normalizedEmail },
            {
                name,
                email: normalizedEmail,
                password: hashedPassword,
                otp: hashOtp(otpCode),
                otpExpires: new Date(Date.now() + OTP_TTL_MS),
                failedOtpAttempts: 0
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        const emailSent = await sendEmail(normalizedEmail, otpCode);
        if (!emailSent) {
            return res.status(500).json({ message: 'Khong the gui email OTP. Vui long thu lai sau.' });
        }

        return res.status(200).json(buildSignupOtpResponse(normalizedEmail));
    } catch (error) {
        console.error('Signup Error:', error);
        return res.status(500).json({ message: 'Co loi xay ra khi dang ky.' });
    }
});

router.post('/login', authLimiter, async (req, res) => {
    try {
        const normalizedEmail = normalizeEmail(req.body?.email);
        const password = req.body?.password;

        if (!normalizedEmail || typeof password !== 'string') {
            return invalidCredentials(res);
        }

        const user = await User.findOne({ email: normalizedEmail });
        if (!user) {
            return invalidCredentials(res);
        }

        if (user.lockUntil && user.lockUntil > Date.now()) {
            return res.status(429).json({
                message: 'Tai khoan tam thoi bi khoa. Vui long thu lai sau.'
            });
        }

        const isMatch = await bcrypt.compare(password, user.password || '');
        if (!isMatch) {
            user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
            if (user.failedLoginAttempts >= 5) {
                user.lockUntil = new Date(Date.now() + 15 * 60 * 1000);
            }
            await user.save();
            return invalidCredentials(res);
        }

        user.failedLoginAttempts = 0;
        user.lockUntil = null;
        const otpCode = await assignOtp(user, 'login');

        const emailSent = await sendEmail(normalizedEmail, otpCode);
        if (!emailSent) {
            return res.status(500).json({ message: 'Khong the gui email OTP. Vui long thu lai sau.' });
        }

        return res.json({
            message: 'OTP sent successfully'
        });
    } catch (error) {
        console.error('Login Error:', error);
        return res.status(500).json({ message: 'Co loi xay ra khi dang nhap.' });
    }
});

router.post('/verify-otp', otpVerifyLimiter, async (req, res) => {
    try {
        const normalizedEmail = normalizeEmail(req.body?.email);
        const otp = typeof req.body?.otp === 'string' ? req.body.otp.trim() : '';

        if (!normalizedEmail || !validateOtpFormat(otp)) {
            return invalidOtp(res);
        }

        const user = await User.findOne({ email: normalizedEmail });

        if (user && user.otpPurpose === 'login' && user.otp && user.otpExpires) {
            if (user.otpExpires.getTime() < Date.now()) {
                clearOtpState(user);
                await user.save();
                return invalidOtp(res);
            }

            if (user.otp !== hashOtp(otp)) {
                user.failedOtpAttempts = (user.failedOtpAttempts || 0) + 1;
                if (user.failedOtpAttempts >= 5) {
                    clearOtpState(user);
                }
                await user.save();
                return invalidOtp(res);
            }

            clearOtpState(user);
            await user.save();

            return res.json({
                token: createToken(user),
                userId: user._id.toString(),
                name: user.name,
                email: user.email,
                message: 'Login Successful'
            });
        }

        const pendingUser = await PendingUser.findOne({ email: normalizedEmail });
        if (pendingUser && pendingUser.otp && pendingUser.otpExpires) {
            if (pendingUser.otpExpires.getTime() < Date.now()) {
                await PendingUser.deleteOne({ _id: pendingUser._id });
                return invalidOtp(res);
            }

            if (pendingUser.otp !== hashOtp(otp)) {
                pendingUser.failedOtpAttempts = (pendingUser.failedOtpAttempts || 0) + 1;
                if (pendingUser.failedOtpAttempts >= 5) {
                    await PendingUser.deleteOne({ _id: pendingUser._id });
                } else {
                    await pendingUser.save();
                }
                return invalidOtp(res);
            }

            const newUser = new User({
                name: pendingUser.name,
                email: pendingUser.email,
                password: pendingUser.password,
                otp: null,
                otpExpires: null,
                otpPurpose: 'login',
                failedLoginAttempts: 0,
                failedOtpAttempts: 0,
                lockUntil: null
            });

            await newUser.save();
            await PendingUser.deleteOne({ _id: pendingUser._id });

            return res.json({
                token: createToken(newUser),
                userId: newUser._id.toString(),
                name: newUser.name,
                email: newUser.email,
                message: 'Account Verified & Created Successfully'
            });
        }

        return invalidOtp(res);
    } catch (error) {
        console.error('Verify OTP Error:', error);
        return res.status(500).json({ message: 'Co loi xay ra khi xac thuc OTP.' });
    }
});

router.get('/me', verifyToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ message: 'Khong tim thay thong tin tai khoan.' });
        }

        return res.json(buildUserProfileResponse(user));
    } catch (error) {
        console.error('Get Profile Error:', error);
        return res.status(500).json({ message: 'Co loi xay ra khi lay thong tin tai khoan.' });
    }
});

router.put('/me', verifyToken, async (req, res) => {
    try {
        const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
        const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
        const address = typeof req.body?.address === 'string' ? req.body.address.trim() : '';

        if (!name) {
            return res.status(400).json({ message: 'Ten la truong bat buoc.' });
        }

        if (phone && !/^[0-9+\-\s]{9,15}$/.test(phone)) {
            return res.status(400).json({ message: 'So dien thoai khong dung dinh dang.' });
        }

        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ message: 'Khong tim thay thong tin tai khoan.' });
        }

        user.name = name;
        user.phone = phone;
        user.address = address;
        await user.save();

        return res.json({
            message: 'Cap nhat thong tin thanh cong.',
            user: buildUserProfileResponse(user)
        });
    } catch (error) {
        console.error('Update Profile Error:', error);
        return res.status(500).json({ message: 'Co loi xay ra khi cap nhat thong tin.' });
    }
});

router.post('/change-password', verifyToken, passwordResetLimiter, async (req, res) => {
    try {
        const { currentPassword, newPassword, confirmPassword } = req.body;

        if (!currentPassword || !newPassword || !confirmPassword) {
            return res.status(400).json({ message: 'Vui long nhap day du mat khau cu, mat khau moi va xac nhan mat khau moi.' });
        }

        if (newPassword !== confirmPassword) {
            return res.status(400).json({ message: 'Mat khau xac nhan khong khop.' });
        }

        const passwordError = validatePasswordFormat(newPassword);
        if (passwordError) {
            return res.status(400).json({ message: passwordError });
        }

        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ message: 'Khong tim thay tai khoan.' });
        }

        const isMatch = await bcrypt.compare(currentPassword, user.password || '');
        if (!isMatch) {
            return res.status(400).json({ message: 'Mat khau cu khong dung.' });
        }

        const isSamePassword = await bcrypt.compare(newPassword, user.password || '');
        if (isSamePassword) {
            return res.status(400).json({ message: 'Mat khau moi phai khac mat khau cu.' });
        }

        user.password = await bcrypt.hash(newPassword, 12);
        user.passwordResetNonce = null;
        user.forgotPasswordVerifiedUntil = null;
        await user.save();

        return res.json({ message: 'Doi mat khau thanh cong.' });
    } catch (error) {
        console.error('Change Password Error:', error);
        return res.status(500).json({ message: 'Co loi xay ra khi doi mat khau.' });
    }
});

router.post('/forgot-password', passwordResetLimiter, async (req, res) => {
    try {
        const normalizedEmail = normalizeEmail(req.body?.email);

        if (normalizedEmail && validateEmailFormat(normalizedEmail)) {
            const user = await User.findOne({ email: normalizedEmail });
            if (user) {
                const otpCode = await assignOtp(user, 'forgot-password');
                const emailSent = await sendEmail(user.email, otpCode);
                if (!emailSent) {
                    console.error(`Forgot Password Email Error: failed to send OTP to ${normalizedEmail}`);
                }
            }
        }

        return res.json({
            message: 'Neu email ton tai trong he thong, ma OTP dat lai mat khau se duoc gui.'
        });
    } catch (error) {
        console.error('Forgot Password Error:', error);
        return res.status(500).json({ message: 'Co loi xay ra khi xu ly yeu cau quen mat khau.' });
    }
});

router.post('/verify-forgot-otp', otpVerifyLimiter, async (req, res) => {
    try {
        const normalizedEmail = normalizeEmail(req.body?.email);
        const otp = typeof req.body?.otp === 'string' ? req.body.otp.trim() : '';

        if (!normalizedEmail || !validateOtpFormat(otp)) {
            return invalidOtp(res);
        }

        const user = await User.findOne({ email: normalizedEmail });
        if (!user || user.otpPurpose !== 'forgot-password' || !user.otp || !user.otpExpires) {
            return invalidOtp(res);
        }

        if (user.otpExpires.getTime() < Date.now()) {
            clearOtpState(user);
            await user.save();
            return invalidOtp(res);
        }

        if (user.otp !== hashOtp(otp)) {
            user.failedOtpAttempts = (user.failedOtpAttempts || 0) + 1;
            if (user.failedOtpAttempts >= 5) {
                clearOtpState(user);
            }
            await user.save();
            return invalidOtp(res);
        }

        clearOtpState(user);
        const resetNonce = crypto.randomBytes(32).toString('hex');
        user.passwordResetNonce = resetNonce;
        user.forgotPasswordVerifiedUntil = new Date(Date.now() + RESET_TOKEN_TTL_MS);
        await user.save();

        return res.json({
            message: 'Xac thuc OTP thanh cong.',
            resetToken: createResetToken(user, resetNonce)
        });
    } catch (error) {
        console.error('Verify Forgot OTP Error:', error);
        return res.status(500).json({ message: 'Co loi xay ra khi xac thuc OTP quen mat khau.' });
    }
});

router.post('/reset-password', passwordResetLimiter, async (req, res) => {
    try {
        const normalizedEmail = normalizeEmail(req.body?.email);
        const { resetToken, newPassword, confirmPassword } = req.body;

        if (!normalizedEmail || !resetToken || !newPassword || !confirmPassword) {
            return res.status(400).json({ message: 'Vui long nhap day du email, reset token, mat khau moi va xac nhan mat khau.' });
        }

        if (newPassword !== confirmPassword) {
            return res.status(400).json({ message: 'Mat khau xac nhan khong khop.' });
        }

        const passwordError = validatePasswordFormat(newPassword);
        if (passwordError) {
            return res.status(400).json({ message: passwordError });
        }

        const user = await User.findOne({ email: normalizedEmail });
        if (!user) {
            return res.status(400).json({ message: 'Phien dat lai mat khau khong hop le hoac da het han.' });
        }

        let verifiedResetToken;
        try {
            verifiedResetToken = jwt.verify(resetToken, JWT_SECRET, {
                issuer: JWT_ISSUER,
                audience: PASSWORD_RESET_AUDIENCE
            });
        } catch (error) {
            return res.status(400).json({ message: 'Phien dat lai mat khau khong hop le hoac da het han.' });
        }

        if (
            verifiedResetToken.purpose !== 'password-reset' ||
            verifiedResetToken.email !== user.email ||
            verifiedResetToken.sub !== user._id.toString() ||
            !user.passwordResetNonce ||
            verifiedResetToken.nonce !== user.passwordResetNonce ||
            !user.forgotPasswordVerifiedUntil ||
            user.forgotPasswordVerifiedUntil.getTime() < Date.now()
        ) {
            return res.status(400).json({ message: 'Phien dat lai mat khau khong hop le hoac da het han.' });
        }

        user.password = await bcrypt.hash(newPassword, 12);
        user.failedLoginAttempts = 0;
        user.lockUntil = null;
        clearOtpState(user);
        user.passwordResetNonce = null;
        user.forgotPasswordVerifiedUntil = null;
        await user.save();

        return res.json({ message: 'Dat lai mat khau thanh cong.' });
    } catch (error) {
        console.error('Reset Password Error:', error);
        return res.status(500).json({ message: 'Co loi xay ra khi dat lai mat khau.' });
    }
});

module.exports = router;
