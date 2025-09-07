// server.js - Render.com backend server with Workload Identity
const express = require('express');
const multer = require('multer');
const vision = require('@google-cloud/vision');
const cors = require('cors');
const { GoogleAuth } = require('google-auth-library');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS設定（Claude.ai artifacts用に最適化）
app.use(cors({
  origin: [
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

// Multer設定（メモリストレージ使用）
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

// Render.com用のGoogle Cloud認証設定
let visionClient;

const initializeGoogleCloudAuth = async () => {
  try {
    console.log('Google Cloud Vision API認証を初期化中...');
    
    // 環境変数からサービスアカウントキーを取得
    const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
    
    if (!credentialsJson) {
      throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON 環境変数が設定されていません');
    }
    
    if (!projectId) {
      throw new Error('GOOGLE_CLOUD_PROJECT_ID 環境変数が設定されていません');
    }

    // JSONキーをパースして認証情報を作成
    let credentials;
    try {
      credentials = JSON.parse(credentialsJson);
    } catch (error) {
      throw new Error('サービスアカウントキーのJSONが無効です: ' + error.message);
    }

    // Vision APIクライアントを初期化
    visionClient = new vision.ImageAnnotatorClient({
      projectId: projectId,
      credentials: credentials
    });

    console.log('Google Cloud Vision API認証が完了しました');
    console.log('Project ID:', projectId);
    console.log('Service Account Email:', credentials.client_email);
    
    // 認証テスト
    await testAuthentication();
    
  } catch (error) {
    console.error('Google Cloud認証エラー:', error.message);
    throw error;
  }
};

const testAuthentication = async () => {
  try {
    // 簡単な認証テストを実行
    const [result] = await visionClient.textDetection({
      image: {
        content: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64')
      }
    });
    console.log('Vision API接続テスト成功');
  } catch (error) {
    console.warn('Vision API接続テスト失敗（本番では問題になる可能性があります）:', error.message);
  }
};

// OCR処理関数
const processOCR = async (imageBuffer) => {
  try {
    const [result] = await visionClient.textDetection({
      image: {
        content: imageBuffer
      }
    });

    const detections = result.textAnnotations;
    
    if (!detections || detections.length === 0) {
      return {
        success: true,
        text: '',
        parsedData: { date: '', amount: '', notes: '' }
      };
    }

    const fullText = detections[0].description;
    console.log('検出されたテキスト:', fullText);

    // テキストを解析して構造化データに変換
    const parsedData = parseReceiptText(fullText);
    
    return {
      success: true,
      text: fullText,
      parsedData: parsedData
    };

  } catch (error) {
    console.error('OCR処理エラー:', error);
    throw new Error(`OCR処理に失敗しました: ${error.message}`);
  }
};

// レシートテキストの解析関数
const parseReceiptText = (text) => {
  const result = { date: '', amount: '', notes: '' };
  
  try {
    // ▼▼▼ 【追加】文字正規化処理 ▼▼▼
    // OCRで誤認識された文字を修正
    const normalizeText = (text) => {
      return text
        .replace(/\\/g, '¥')        // バックスラッシュを円記号に変換
        .replace(/＼/g, '¥')        // 全角バックスラッシュも円記号に変換
        .replace(/￥/g, '¥');       // 全角円記号を半角円記号に変換
    };
    
    // テキストを正規化
    const normalizedText = normalizeText(text);
    console.log('正規化前テキスト:', text);
    console.log('正規化後テキスト:', normalizedText);
    // ▲▲▲ 【追加終了】 ▲▲▲
    
    // ▼▼▼ 【変更】normalizedTextを使用 ▼▼▼
    const lines = normalizedText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    // ▲▲▲ 【変更終了】 ▲▲▲
    
    // 日付の検出部分（変更なし）
    const dateRegexes = [
      /(\d{4})[/-](\d{1,2})[/-](\d{1,2})/,
      /(\d{1,2})[/-](\d{1,2})[/-](\d{4})/,
      /(\d{1,2})[/-](\d{1,2})/
    ];

    for (const line of lines) {
      for (const regex of dateRegexes) {
        const match = line.match(regex);
        if (match && !result.date) {
          if (match[3] && match[3].length === 4) { // YYYY-MM-DD形式
            result.date = `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
          } else if (match[1] && match[1].length === 4) { // YYYY/MM/DD形式
            result.date = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
          } else if (match[1] && match[2] && !match[3]) { // MM/DD形式
            const currentYear = new Date().getFullYear();
            result.date = `${currentYear}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
          }
          break;
        }
      }
    }

    // ▼▼▼ 【変更】金額検出の正規表現を改良 ▼▼▼
    const amountRegexes = [
      /[¥￥\\]?[\s]*([0-9,]+)[\s]*円/,        // 円記号＋円
      /合計[\s]*[¥￥\\]?[\s]*([0-9,]+)/,      // 合計行
      /小計[\s]*[¥￥\\]?[\s]*([0-9,]+)/,      // 小計行
      /[¥￥\\]([0-9,]+)/,                      // 記号付き金額
      /([0-9,]{3,})円/,                        // 3桁以上+円
      /\\([0-9,]+)/                            // \で始まる金額（念のため）
    ];

    for (const line of lines) {
      for (const regex of amountRegexes) {
        const match = line.match(regex);
        if (match && match[1] && !result.amount) {
          // ▼▼▼ 【変更】数値検証を追加 ▼▼▼
          const cleanAmount = match[1].replace(/,/g, '');
          if (!isNaN(cleanAmount) && cleanAmount !== '' && cleanAmount.length > 0) {
            result.amount = parseInt(cleanAmount, 10);
            console.log('検出された金額:', result.amount, '元の文字列:', match[0]);
            break;
          }
          // ▲▲▲ 【変更終了】 ▲▲▲
        }
      }
      if (result.amount) break; // 見つかったらループを抜ける
    }
    // ▲▲▲ 【変更終了】 ▲▲▲

    // 店舗名検出部分（変更なし）
    const storeNameCandidates = lines.slice(0, 3);
    for (const candidate of storeNameCandidates) {
      if (candidate.length > 1 && candidate.length < 30 && 
          !candidate.match(/[0-9]{4}[/-][0-9]{1,2}[/-][0-9]{1,2}/) && 
          !candidate.match(/[¥￥]?[0-9,]+/)) {
        result.notes = candidate;
        break;
      }
    }

    // 日付が検出されない場合は今日の日付を使用
    if (!result.date) {
      result.date = new Date().toISOString().slice(0, 10);
    }

  } catch (error) {
    console.error('テキスト解析エラー:', error);
  }

  return result;
};

// ヘルスチェックエンドポイント
app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    service: 'Bookkee OCR API',
    timestamp: new Date().toISOString(),
    authentication: visionClient ? 'Initialized' : 'Not initialized'
  });
});

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
      return res.status(503).json({
        error: 'Vision APIクライアントが初期化されていません',
        code: 'CLIENT_NOT_INITIALIZED'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: 'ファイルがアップロードされていません',
        code: 'NO_FILE_UPLOADED'
      });
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
    console.error('OCRエンドポイントエラー:', error);
    res.status(500).json({
      error: 'OCR処理中にエラーが発生しました',
      details: error.message,
      code: 'OCR_PROCESSING_ERROR'
    });
  }
});

// エラーハンドリングミドルウェア
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'ファイルサイズが大きすぎます（最大10MB）',
        code: 'FILE_TOO_LARGE'
      });
    }
  }
  
  console.error('予期しないエラー:', error);
  res.status(500).json({
    error: '内部サーバーエラー',
    code: 'INTERNAL_SERVER_ERROR'
  });
});

// 404ハンドラー
app.use((req, res) => {
  res.status(404).json({
    error: 'エンドポイントが見つかりません',
    code: 'ENDPOINT_NOT_FOUND'
  });
});

// サーバー起動
const startServer = async () => {
  try {
    // Google Cloud認証の初期化
    await initializeGoogleCloudAuth();
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 サーバーがポート ${PORT} で起動しました`);
      console.log(`📊 ヘルスチェック: http://localhost:${PORT}/health`);
      console.log(`🔍 OCR API: http://localhost:${PORT}/api/ocr`);
    });
  } catch (error) {
    console.error('サーバー起動エラー:', error);
    process.exit(1);
  }
};

// プロセス終了時のクリーンアップ
process.on('SIGTERM', () => {
  console.log('SIGTERM受信、サーバーを停止します...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT受信、サーバーを停止します...');
  process.exit(0);
});

startServer();
