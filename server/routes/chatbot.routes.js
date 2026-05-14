const express = require('express');

const serverConfig = require('../config/server.config');
const verifyToken = require('../middleware/auth.middleware');
const { chatbotLimiter } = require('../middleware/security.middleware');
const Disease = require('../mongodb/models/Disease');

const router = express.Router();

const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY_ITEMS = 12;
const DISEASE_SUMMARY_TTL_MS = 10 * 60 * 1000;

let diseaseSummaryCache = {
    value: '',
    expiresAt: 0
};

function createChatbotServiceError(statusCode, userMessage, code) {
    const error = new Error(userMessage);
    error.statusCode = statusCode;
    error.userMessage = userMessage;
    error.code = code;
    return error;
}

function buildSystemPrompt(diseaseSummary) {
    const summarySection = diseaseSummary
        ? `Danh sach benh cay tham chieu:\n${diseaseSummary}`
        : 'Khong co du lieu tham chieu benh cay tam thoi.';

    return [
        'Ban la chuyen gia benh cay trong he thong AgriDoctorAI.',
        'Chi tra loi ve cay trong, nong nghiep, sau benh, dinh duong va cham soc cay.',
        'Luon tra loi bang tieng Viet, ngan gon, thuc te va danh cho nguoi dung Viet Nam.',
        'Khi thong tin chua du, hay neu ro chan doan chua chac chan va hoi them trieu chung, loai cay, dieu kien nuoc, dat, thoi tiet, phan bon.',
        'Khong tra loi cac noi dung ngoai chu de cay trong.',
        summarySection
    ].join('\n\n');
}

function normalizeHistory(history) {
    if (!Array.isArray(history)) {
        return [];
    }

    return history
        .slice(-MAX_HISTORY_ITEMS)
        .map(item => {
            const text = typeof item?.text === 'string' ? item.text.trim() : '';
            const role = item?.isUser ? 'Nguoi dung' : 'Tro ly';
            return text ? `${role}: ${text.slice(0, MAX_MESSAGE_LENGTH)}` : null;
        })
        .filter(Boolean);
}

async function getDiseaseSummary() {
    if (diseaseSummaryCache.value && diseaseSummaryCache.expiresAt > Date.now()) {
        return diseaseSummaryCache.value;
    }

    const diseases = await Disease.find({}, 'diseaseId diseaseName symptoms')
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(8)
        .lean();

    const summary = diseases
        .map(disease => {
            const symptomSnippet = typeof disease.symptoms === 'string'
                ? disease.symptoms
                    .replace(/\s+/g, ' ')
                    .split(/[,.]/)
                    .map(part => part.trim())
                    .filter(Boolean)
                    .slice(0, 2)
                    .join(', ')
                    .slice(0, 80)
                : '';

            return `- ${disease.diseaseName || disease.diseaseId} (${disease.diseaseId || 'N/A'}): ${symptomSnippet}`;
        })
        .join('\n')
        .slice(0, 1000);

    diseaseSummaryCache = {
        value: summary,
        expiresAt: Date.now() + DISEASE_SUMMARY_TTL_MS
    };

    return summary;
}

function mapChatbotError(error) {
    if (error?.statusCode && error?.userMessage) {
        return {
            statusCode: error.statusCode,
            userMessage: error.userMessage,
            code: error.code || 'CHATBOT_SERVICE_ERROR'
        };
    }

    const normalizedMessage = String(error?.message || '').toLowerCase();

    if (
        normalizedMessage.includes('api key expired') ||
        normalizedMessage.includes('api key not valid') ||
        normalizedMessage.includes('invalid api key') ||
        normalizedMessage.includes('permission denied') ||
        normalizedMessage.includes('expired')
    ) {
        return {
            statusCode: 503,
            userMessage: 'Dich vu chatbot tam dung do khoa AI tren may chu da het han hoac khong hop le.',
            code: 'CHATBOT_KEY_INVALID'
        };
    }

    if (
        normalizedMessage.includes('quota') ||
        normalizedMessage.includes('resource exhausted') ||
        normalizedMessage.includes('rate limit')
    ) {
        return {
            statusCode: 503,
            userMessage: 'Dich vu chatbot dang qua tai hoac da vuot gioi han su dung. Vui long thu lai sau.',
            code: 'CHATBOT_QUOTA_EXCEEDED'
        };
    }

    if (error?.name === 'AbortError' || normalizedMessage.includes('timed out')) {
        return {
            statusCode: 504,
            userMessage: 'Dich vu chatbot phan hoi qua cham. Vui long thu lai sau.',
            code: 'CHATBOT_TIMEOUT'
        };
    }

    return {
        statusCode: 502,
        userMessage: 'Dich vu chatbot tam thoi khong kha dung.',
        code: 'CHATBOT_UPSTREAM_ERROR'
    };
}

async function requestGeminiResponse(prompt) {
    const apiKey = serverConfig.DEFAULT_GEMINI_KEY;
    if (!apiKey) {
        throw createChatbotServiceError(
            503,
            'Dich vu chatbot chua duoc cau hinh tren may chu.',
            'CHATBOT_KEY_MISSING'
        );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(serverConfig.GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [
                        {
                            parts: [
                                {
                                    text: prompt
                                }
                            ]
                        }
                    ]
                }),
                signal: controller.signal
            }
        );

        const payload = await response.json().catch(() => null);

        if (!response.ok) {
            const upstreamMessage = payload?.error?.message || 'Gemini request failed';
            throw new Error(upstreamMessage);
        }

        const text = payload?.candidates?.[0]?.content?.parts
            ?.map(part => part?.text || '')
            .join('\n')
            .trim();

        if (!text) {
            throw new Error('Gemini response was empty');
        }

        return text.replace(/\*/g, '');
    } finally {
        clearTimeout(timeout);
    }
}

router.post('/api/chatbot', verifyToken, chatbotLimiter, async (req, res) => {
    try {
        const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
        const history = normalizeHistory(req.body?.history);

        if (!message) {
            return res.status(400).json({
                success: false,
                error: 'Tin nhan khong duoc de trong.'
            });
        }

        if (message.length > MAX_MESSAGE_LENGTH) {
            return res.status(400).json({
                success: false,
                error: 'Tin nhan qua dai.'
            });
        }

        const diseaseSummary = await getDiseaseSummary();
        const prompt = [
            buildSystemPrompt(diseaseSummary),
            history.length ? `Lich su hoi thoai:\n${history.join('\n')}` : '',
            `Cau hoi hien tai:\nNguoi dung: ${message}`
        ]
            .filter(Boolean)
            .join('\n\n');

        const answer = await requestGeminiResponse(prompt);

        return res.json({
            success: true,
            data: {
                text: answer
            }
        });
    } catch (error) {
        console.error('Chatbot Error:', error);
        const mappedError = mapChatbotError(error);
        return res.status(mappedError.statusCode).json({
            success: false,
            error: mappedError.userMessage,
            code: mappedError.code
        });
    }
});

module.exports = router;
