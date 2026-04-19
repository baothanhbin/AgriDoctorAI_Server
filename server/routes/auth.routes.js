const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const User = require('../mongodb/models/User');
const PendingUser = require('../mongodb/models/PendingUser');
const sendEmail = require('../utils/sendEmail');
const verifyToken = require('../middleware/auth.middleware');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

const generateOtpCode = () => Math.floor(100000 + Math.random() * 900000).toString();

const createToken = (user) => jwt.sign(
    { userId: user._id, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: '30d' }
);

const buildUserProfileResponse = (user) => ({
    userId: user._id.toString(),
    name: user.name || '',
    email: user.email || '',
    phone: user.phone || '',
    address: user.address || '',
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null
});

const validatePasswordFormat = (password) => {
    if (typeof password !== 'string' || !PASSWORD_REGEX.test(password)) {
        return 'Mật khẩu phải có ít nhất 8 ký tự, gồm chữ và số.';
    }
    return null;
};

router.post('/signup', async (req, res) => {
    try {
        const { name, email, password } = req.body;

        if (!email || !password || !name) {
            return res.status(400).json({ message: 'Vui lòng nhập đầy đủ tên, email và mật khẩu.' });
        }

        const passwordError = validatePasswordFormat(password);
        if (passwordError) {
            return res.status(400).json({ message: passwordError });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const user = await User.findOne({ email: normalizedEmail });
        if (user) {
            return res.status(400).json({ message: 'Email đã được sử dụng. Vui lòng đăng nhập.' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const otpCode = generateOtpCode();
        const otpExpires = Date.now() + 5 * 60 * 1000;

        await PendingUser.findOneAndUpdate(
            { email: normalizedEmail },
            {
                name: name.trim(),
                email: normalizedEmail,
                password: hashedPassword,
                otp: otpCode,
                otpExpires
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        const emailSent = await sendEmail(normalizedEmail, otpCode);
        if (!emailSent) {
            return res.status(500).json({ message: 'Lỗi gửi email OTP. Vui lòng thử lại.' });
        }

        return res.status(200).json({
            message: 'Mã OTP xác thực đã được gửi đến email.',
            email: normalizedEmail,
            isRegister: true
        });
    } catch (error) {
        console.error('Signup Error:', error);
        return res.status(500).json({ message: error.message });
    }
});

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: 'Vui lòng nhập email và mật khẩu.' });
        }

        if (typeof email !== 'string' || typeof password !== 'string') {
            return res.status(400).json({ message: 'Dữ liệu không hợp lệ (Email/Password phải là chuỗi).' });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const user = await User.findOne({ email: normalizedEmail });

        if (!user) {
            return res.status(404).json({
                message: 'Tài khoản không tồn tại. Vui lòng đăng ký trước.',
                needRegister: true
            });
        }

        if (user.lockUntil && user.lockUntil > Date.now()) {
            const waitMinutes = Math.ceil((user.lockUntil - Date.now()) / 60000);
            return res.status(403).json({
                message: `Tài khoản đã bị khóa tạm thời do nhập sai quá 5 lần. Vui lòng thử lại sau ${waitMinutes} phút.`
            });
        }

        const isMatch = await bcrypt.compare(password, user.password || '');
        if (!isMatch) {
            user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;

            if (user.failedLoginAttempts >= 5) {
                user.lockUntil = Date.now() + 15 * 60 * 1000;
                console.log(`[SECURITY] Blocked Account: ${normalizedEmail} - IP: ${req.ip} - Reason: 5 Failed Attempts`);
            }

            await user.save();
            return res.status(400).json({
                message: `Mật khẩu không đúng. Số lần sai: ${user.failedLoginAttempts}/5`
            });
        }

        if (user.failedLoginAttempts > 0 || user.lockUntil) {
            user.failedLoginAttempts = 0;
            user.lockUntil = null;
        }

        user.otp = generateOtpCode();
        user.otpExpires = Date.now() + 5 * 60 * 1000;
        user.otpPurpose = 'login';
        user.failedOtpAttempts = 0;
        await user.save();

        const emailSent = await sendEmail(normalizedEmail, user.otp);
        if (!emailSent) {
            return res.status(500).json({ message: 'Lỗi gửi email OTP. Vui lòng thử lại.' });
        }

        return res.json({
            message: 'OTP sent successfully',
            token: ''
        });
    } catch (error) {
        console.error('Login Error:', error);
        return res.status(500).json({ message: error.message });
    }
});

router.post('/verify-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;

        if (!email || !otp) {
            return res.status(400).json({ message: 'Email and OTP are required' });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const user = await User.findOne({ email: normalizedEmail });

        if (user) {
            if (user.otpPurpose !== 'login') {
                return res.status(400).json({ message: 'OTP không hợp lệ cho đăng nhập.' });
            }

            if (user.otp !== otp) {
                user.failedOtpAttempts = (user.failedOtpAttempts || 0) + 1;

                if (user.failedOtpAttempts >= 5) {
                    user.otp = null;
                    user.otpExpires = null;
                    user.otpPurpose = 'login';
                    await user.save();
                    return res.status(400).json({ message: 'Bạn đã nhập sai OTP quá 5 lần. Mã OTP đã bị hủy. Vui lòng đăng nhập lại.' });
                }

                await user.save();
                return res.status(400).json({ message: `Mã OTP không đúng. (Sai ${user.failedOtpAttempts}/5 lần)` });
            }

            if (!user.otpExpires || Date.now() > user.otpExpires) {
                return res.status(400).json({ message: 'Mã OTP đã hết hạn.' });
            }

            user.otp = null;
            user.otpExpires = null;
            user.otpPurpose = 'login';
            user.failedOtpAttempts = 0;
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
        if (pendingUser) {
            if (pendingUser.otp !== otp) {
                return res.status(400).json({ message: 'Mã OTP không đúng (Register).' });
            }

            if (Date.now() > pendingUser.otpExpires) {
                return res.status(400).json({ message: 'Mã OTP đã hết hạn. Vui lòng đăng ký lại.' });
            }

            const newUser = new User({
                name: pendingUser.name,
                email: pendingUser.email,
                password: pendingUser.password,
                otp: null,
                otpExpires: null,
                otpPurpose: 'login'
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

        return res.status(404).json({ message: 'User not found or Registration session expired.' });
    } catch (error) {
        console.error('Verify OTP Error:', error);
        return res.status(500).json({ message: error.message });
    }
});

router.get('/me', verifyToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ message: 'Không tìm thấy thông tin tài khoản.' });
        }

        return res.json(buildUserProfileResponse(user));
    } catch (error) {
        console.error('Get Profile Error:', error);
        return res.status(500).json({ message: error.message });
    }
});

router.put('/me', verifyToken, async (req, res) => {
    try {
        const { name, phone, address } = req.body;

        if (!name || typeof name !== 'string' || !name.trim()) {
            return res.status(400).json({ message: 'Tên là trường bắt buộc.' });
        }

        if (phone != null && typeof phone !== 'string') {
            return res.status(400).json({ message: 'Số điện thoại không hợp lệ.' });
        }

        if (address != null && typeof address !== 'string') {
            return res.status(400).json({ message: 'Địa chỉ không hợp lệ.' });
        }

        const normalizedPhone = (phone || '').trim();
        if (normalizedPhone && !/^[0-9+\-\s]{9,15}$/.test(normalizedPhone)) {
            return res.status(400).json({ message: 'Số điện thoại không đúng định dạng.' });
        }

        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ message: 'Không tìm thấy thông tin tài khoản.' });
        }

        user.name = name.trim();
        user.phone = normalizedPhone;
        user.address = (address || '').trim();
        await user.save();

        return res.json({
            message: 'Cập nhật thông tin thành công.',
            user: buildUserProfileResponse(user)
        });
    } catch (error) {
        console.error('Update Profile Error:', error);
        return res.status(500).json({ message: error.message });
    }
});

router.post('/change-password', verifyToken, async (req, res) => {
    try {
        const { currentPassword, newPassword, confirmPassword } = req.body;

        if (!currentPassword || !newPassword || !confirmPassword) {
            return res.status(400).json({ message: 'Vui lòng nhập đầy đủ mật khẩu cũ, mật khẩu mới và xác nhận mật khẩu mới.' });
        }

        if (newPassword !== confirmPassword) {
            return res.status(400).json({ message: 'Mật khẩu xác nhận không khớp.' });
        }

        const passwordError = validatePasswordFormat(newPassword);
        if (passwordError) {
            return res.status(400).json({ message: passwordError });
        }

        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ message: 'Không tìm thấy tài khoản.' });
        }

        const isMatch = await bcrypt.compare(currentPassword, user.password || '');
        if (!isMatch) {
            return res.status(400).json({ message: 'Mật khẩu cũ không đúng.' });
        }

        const isSamePassword = await bcrypt.compare(newPassword, user.password || '');
        if (isSamePassword) {
            return res.status(400).json({ message: 'Mật khẩu mới phải khác mật khẩu cũ.' });
        }

        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);
        await user.save();

        return res.json({ message: 'Đổi mật khẩu thành công.' });
    } catch (error) {
        console.error('Change Password Error:', error);
        return res.status(500).json({ message: error.message });
    }
});

router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email || typeof email !== 'string') {
            return res.status(400).json({ message: 'Email không hợp lệ.' });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const user = await User.findOne({ email: normalizedEmail });
        if (!user) {
            return res.status(404).json({ message: 'Email không tồn tại trong hệ thống.' });
        }

        user.otp = generateOtpCode();
        user.otpExpires = Date.now() + 5 * 60 * 1000;
        user.otpPurpose = 'forgot-password';
        user.failedOtpAttempts = 0;
        user.forgotPasswordVerifiedUntil = null;
        await user.save();

        const emailSent = await sendEmail(user.email, user.otp);
        if (!emailSent) {
            return res.status(500).json({ message: 'Lỗi gửi email OTP. Vui lòng thử lại.' });
        }

        return res.json({
            message: 'Mã OTP đặt lại mật khẩu đã được gửi qua email.',
            email: user.email
        });
    } catch (error) {
        console.error('Forgot Password Error:', error);
        return res.status(500).json({ message: error.message });
    }
});

router.post('/verify-forgot-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;

        if (!email || !otp) {
            return res.status(400).json({ message: 'Email và OTP là bắt buộc.' });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const user = await User.findOne({ email: normalizedEmail });
        if (!user) {
            return res.status(404).json({ message: 'Email không tồn tại trong hệ thống.' });
        }

        if (user.otpPurpose !== 'forgot-password') {
            return res.status(400).json({ message: 'OTP không hợp lệ cho chức năng quên mật khẩu.' });
        }

        if (user.otp !== otp) {
            user.failedOtpAttempts = (user.failedOtpAttempts || 0) + 1;

            if (user.failedOtpAttempts >= 5) {
                user.otp = null;
                user.otpExpires = null;
                user.otpPurpose = 'login';
                await user.save();
                return res.status(400).json({ message: 'Bạn đã nhập sai OTP quá 5 lần. Vui lòng gửi lại mã mới.' });
            }

            await user.save();
            return res.status(400).json({ message: `Mã OTP không đúng. (Sai ${user.failedOtpAttempts}/5 lần)` });
        }

        if (!user.otpExpires || Date.now() > user.otpExpires) {
            return res.status(400).json({ message: 'Mã OTP đã hết hạn.' });
        }

        user.failedOtpAttempts = 0;
        user.forgotPasswordVerifiedUntil = Date.now() + 10 * 60 * 1000;
        await user.save();

        return res.json({ message: 'Xác thực OTP thành công.' });
    } catch (error) {
        console.error('Verify Forgot OTP Error:', error);
        return res.status(500).json({ message: error.message });
    }
});

router.post('/reset-password', async (req, res) => {
    try {
        const { email, newPassword, confirmPassword } = req.body;

        if (!email || !newPassword || !confirmPassword) {
            return res.status(400).json({ message: 'Vui lòng nhập đầy đủ email, mật khẩu mới và xác nhận mật khẩu.' });
        }

        if (newPassword !== confirmPassword) {
            return res.status(400).json({ message: 'Mật khẩu xác nhận không khớp.' });
        }

        const passwordError = validatePasswordFormat(newPassword);
        if (passwordError) {
            return res.status(400).json({ message: passwordError });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const user = await User.findOne({ email: normalizedEmail });
        if (!user) {
            return res.status(404).json({ message: 'Email không tồn tại trong hệ thống.' });
        }

        if (!user.forgotPasswordVerifiedUntil || Date.now() > user.forgotPasswordVerifiedUntil) {
            return res.status(400).json({ message: 'Phiên đặt lại mật khẩu đã hết hạn. Vui lòng xác thực OTP lại.' });
        }

        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);
        user.otp = null;
        user.otpExpires = null;
        user.otpPurpose = 'login';
        user.failedOtpAttempts = 0;
        user.forgotPasswordVerifiedUntil = null;
        user.failedLoginAttempts = 0;
        user.lockUntil = null;
        await user.save();

        return res.json({ message: 'Đặt lại mật khẩu thành công.' });
    } catch (error) {
        console.error('Reset Password Error:', error);
        return res.status(500).json({ message: error.message });
    }
});

router.post('/login-vulnerable', async (req, res) => {
    try {
        const { email, password } = req.body;

        console.log('Vulnerable Login Params:', { email, password });
        const user = await User.collection.findOne({ email: email });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Wrong Password' });
        }

        return res.json({
            message: 'LOGIN VULNERABLE SUCCESS!',
            user: user
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

module.exports = router;
