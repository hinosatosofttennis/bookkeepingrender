// server.js - Render.com backend server with Workload Identity (Refactored)
const express = require('express');
const multer = require('multer');
const vision = require('@google-cloud/vision');
const cors = require('cors');
const { GoogleAuth } = require('google-auth-library');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS設定
app.use(cors({
    origin: [
        'https://render.com/docs/web-services',
        'https://hinosatosofttennis.github.io',
        'https://finance-rejk.onrender.com',
        // Claude.ai関連ドメイン
        'https://claude.ai',
        'https://artifacts.claude.ai',
        'https://claude.anthropic.com',
        // 開発・テスト用
        'http://localhost:3000',
        'http://localhost:8080',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:8080',
        // ファイルシステムからの実行（file://プロトコル）
        'null', // file:// protocol shows as null origin
    ],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: false
}));

app.use(express.json());

// Multer設定
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB制限
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('画像ファイルのみアップロード可能です'), false);
        }
    }
});

// Google Cloud Vision APIクライアントの変数
let visionClient;

// --- Improvement #2: API呼び出しを共通化 ---
const detectTextFromBuffer = async (imageBuffer) => {
    const [result] = await visionClient.textDetection({
        image: { content: imageBuffer }
    });
    return result;
};

// 認証テスト関数
const testAuthentication = async () => {
    try {
        // 1x1の透明なPNG画像のBuffer
        const testImageBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
        await detectTextFromBuffer(testImageBuffer);
        console.log('✅ Vision API接続テスト成功');
    } catch (error) {
        console.warn('⚠️ Vision API接続テスト失敗:', error.message);
    }
};

// --- Improvement #3: Google Cloud認証の簡素化 ---
const initializeGoogleCloudAuth = async () => {
    try {
        console.log('Google Cloud Vision API認証を初期化中...');
        
        if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
            throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON 環境変数が設定されていません');
        }
        if (!process.env.GOOGLE_CLOUD_PROJECT_ID) {
            throw new Error('GOOGLE_CLOUD_PROJECT_ID 環境変数が設定されていません');
        }

        // クライアントを初期化（認証情報は環境変数から自動で読み込まれる）
        visionClient = new vision.ImageAnnotatorClient();

        console.log('✅ Google Cloud Vision APIクライアントが初期化されました');
        
        await testAuthentication();
        
    } catch (error) {
        console.error('❌ Google Cloud認証エラー:', error.message);
        throw error;
    }
};

// OCR処理関数
const processOCR = async (imageBuffer) => {
    try {
        const result = await detectTextFromBuffer(imageBuffer);
        const detections = result.textAnnotations;
        
        if (!detections || detections.length === 0) {
            return {
                success: true,
                text: '',
                parsedData: { date: null, amount: null, notes: null }
            };
        }

        const fullText = detections[0].description;
        console.log('📝 検出されたテキスト:\n---', `\n${fullText}\n`, '---');

        const parsedData = parseReceiptText(fullText);
        console.log('📊 解析後のデータ:', parsedData);
        
        return {
            success: true,
            text: fullText,
            parsedData: parsedData
        };

    } catch (error) {
        console.error('❌ OCR処理エラー:', error);
        throw new Error(`OCR処理に失敗しました: ${error.message}`);
    }
};

// --- Improvement #1: parseReceiptText関数の効率化 ---
const parseReceiptText = (text) => {
    const result = { date: null, amount: null, notes: null };
    if (!text || typeof text !== 'string') {
        return result;
    }

    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);

    const dateFormats = [
        { group: 'YYYY年MM月DD日', regex: /(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/, formatter: m => `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` },
        { group: 'YYYY/MM/DD', regex: /(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/, formatter: m => `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` },
        { group: 'MM/DD/YYYY', regex: /(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/, formatter: m => `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` },
        { group: 'YY/MM/DD', regex: /\b(\d{2})[/.-](\d{1,2})[/.-](\d{1,2})\b/, formatter: m => `${(parseInt(m[1], 10) > 50 ? 1900 : 2000) + parseInt(m[1], 10)}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` },
        { group: 'MM/DD', regex: /\b(\d{1,2})[/.-](\d{1,2})\b/, formatter: m => `${new Date().getFullYear()}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` }
    ];

    const amountRegex = /(?:合計|小計|ご請求額)[\s]*[¥\\#￥]?[\s]*([0-9,]{2,})|[¥\\#￥][\s]*([0-9,]{3,})|([0-9,]{3,})[\s]*円/;
    const storeKeywords = /店|施設|（株）|株式会社|商店|食堂|マート|ストア/;
    const exclusionKeywords = /領収書|領収証|[0-9]{2,}[/-年.]|[¥\\#￥]?[0-9,]{3,}/;

    let maxAmount = 0;
    lines.forEach((line, index) => {
        if (!result.date) {
            for (const format of dateFormats) {
                const match = line.match(format.regex);
                if (match) {
                    result.date = format.formatter(match);
                    break; 
                }
            }
        }

        const amountMatch = line.match(amountRegex);
        if (amountMatch) {
            const amountStr = amountMatch[1] || amountMatch[2] || amountMatch[3];
            if (amountStr) {
                const currentAmount = parseInt(amountStr.replace(/,/g, ''), 10);
                if (currentAmount > maxAmount) {
                    maxAmount = currentAmount;
                }
            }
        }

        if (!result.notes && index < 6) {
            if (line.length > 1 && line.length < 30 && storeKeywords.test(line) && !exclusionKeywords.test(line)) {
                result.notes = line;
            }
        }
    });

    if (maxAmount > 0) {
        result.amount = maxAmount;
    }
    if (!result.date) {
        result.date = new Date().toISOString().slice(0, 10);
    }

    return result;
};


// --- Endpoints ---

// ルートエンドポイント
app.get('/', (req, res) => {
    res.json({
        status: 'OK',
        service: 'Bookkee OCR API',
        timestamp: new Date().toISOString(),
        authentication: visionClient ? 'Initialized' : 'Not initialized'
    });
});

// ヘルスチェックエンドポイント
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        visionClient: !!visionClient
    });
});

// OCR APIエンドポイント
app.post('/api/ocr', upload.single('file'), async (req, res) => {
    try {
        if (!visionClient) {
            return res.status(503).json({ error: 'Vision APIクライアントが初期化されていません', code: 'CLIENT_NOT_INITIALIZED' });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'ファイルがアップロードされていません', code: 'NO_FILE_UPLOADED' });
        }

        console.log(`OCR処理開始: ファイルサイズ ${req.file.size} bytes`);
        const result = await processOCR(req.file.buffer);

        res.json({
            success: true,
            date: result.parsedData.date,
            amount: result.parsedData.amount,
            notes: result.parsedData.notes,
            rawText: result.text,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ OCRエンドポイントエラー:', error);
        res.status(500).json({ error: 'OCR処理中にエラーが発生しました', details: error.message, code: 'OCR_PROCESSING_ERROR' });
    }
});

// --- Error Handling ---

// エラーハンドリングミドルウェア
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'ファイルサイズが大きすぎます（最大10MB）', code: 'FILE_TOO_LARGE' });
    }
    console.error('❌ 予期しないエラー:', error);
    res.status(500).json({ error: '内部サーバーエラー', code: 'INTERNAL_SERVER_ERROR' });
});

// 404ハンドラー
app.use((req, res) => {
    res.status(404).json({ error: 'エンドポイントが見つかりません', code: 'ENDPOINT_NOT_FOUND' });
});


// --- Server Startup ---

const startServer = async () => {
    try {
        await initializeGoogleCloudAuth();
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 サーバーがポート ${PORT} で起動しました`);
            console.log(`   - ヘルスチェック: http://localhost:${PORT}/health`);
            console.log(`   - OCR API: http://localhost:${PORT}/api/ocr`);
        });
    } catch (error) {
        console.error('❌ サーバー起動エラー:', error.message);
        process.exit(1);
    }
};

// プロセス終了時のクリーンアップ
const gracefulShutdown = (signal) => {
    console.log(`${signal}受信、サーバーを停止します...`);
    // ここでDB接続の切断など、クリーンアップ処理を追加できます
    process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startServer();
