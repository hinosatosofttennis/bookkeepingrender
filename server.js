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
  　// ↓ この行を追加して、解析結果をログに出力する
   　console.log('解析後のデータ:', parsedData);
    
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

// レシートテキストの解析関数（デバッグ表示を強化）
const parseReceiptText = (text) => {
    const result = { date: null, amount: null, notes: '' };
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);

    // ▼▼▼ [デバッグ] 処理開始と解析対象の行配列を表示 ▼▼▼
    console.log('[開始] 解析対象の行:', lines);

    const dateFormats = [
        {
            group: 'YYYY/MM/DD',
            regex: /(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/,
            formatter: (match) => `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
        },
        {
            group: 'MM/DD/YYYY',
            regex: /(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/,
            formatter: (match) => `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`
        },
        {
            group: 'YY/MM/DD',
            regex: /\b(\d{2})[/.-](\d{1,2})[/.-](\d{1,2})\b/,
            formatter: (match) => {
                const year = parseInt(match[1], 10);
                const fullYear = year > 50 ? 1900 + year : 2000 + year;
                return `${fullYear}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
            }
        },
     　 {
            group: 'MM/DD/YY',
            regex: /(\d{1,2})[/.-](\d{1,2})[/.-](\d{2})\b/,
            formatter: (match) => {
                const year = parseInt(match[3], 10);
                const fullYear = year > 50 ? 1900 + year : 2000 + year;
                return `${fullYear}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
            }
        },
        {
            group: 'MM/DD',
            regex: /\b(\d{1,2})[/.-](\d{1,2})\b/,
            formatter: (match) => {
                const currentYear = new Date().getFullYear();
                return `${currentYear}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
            }
        }
    ];

    for (const line of lines) {
        // ▼▼▼ [デバッグ] どの行をチェックしているか表示 ▼▼▼
        console.log(`\n--- Line: "${line}" をチェック中 ---`);

        for (const format of dateFormats) {
            // ▼▼▼ [デバッグ] どのパターンを試しているか表示 ▼▼▼
            console.log(`  [試行] "${format.group}" のパターンを試します...`);
            
            const match = line.match(format.regex);
            if (match) {
                console.log(`  ✅ [成功] 日付を検出しました！ グループ: "${format.group}", マッチ: "${match[0]}"`);
                result.date = format.formatter(match);
                break;
            }
        }
        if (result.date) {
            break;
        }
    }
       // --- 金額の検出を強化 ---
        let maxAmount = 0;
        const amountRegexes = [
            // "合計" や "小計" が含まれる行を最優先で検索
            /(?:合計|小計|ご請求額)[\s]*[¥\\#￥]?[\s]*([0-9,]+)/,
            // ¥, \, #, ￥ などの記号と数字の組み合わせ
            /[¥\\#￥][\s]*([0-9,]{3,})/,
            // 数字と "円" の組み合わせ
            /([0-9,]{3,})[\s]*円/
        ];

        for (const line of lines) {
            for (const regex of amountRegexes) {
                const match = line.match(regex);
                if (match) {
                    const currentAmount = parseInt(match[1].replace(/,/g, ''), 10);
                    // レシート内で最も大きい金額を「合計金額」と判断する
                    if (currentAmount > maxAmount) {
                        maxAmount = currentAmount;
                    }
                }
            }
        }
        if (maxAmount > 0) {
            result.amount = maxAmount;
        }

        // --- 店舗名や摘要の検出 ---
        const storeNameCandidates = lines.slice(0, 6);
        // 優先度1: 「店」「施設」「（株）」など、店名らしいキーワードを含む行
        const priorityKeywords = /店|施設|（株）|株式会社|商店|食堂|マート|ストア/;
        for (const candidate of storeNameCandidates) {
            // "領収書" という単語や日付、金額を含まない行を摘要候補とする
            if (candidate.length > 1 && candidate.length < 30 &&
                priorityKeywords.test(candidate) &&
                !/領収書|領収証/.test(candidate) &&
                !/[0-9]{2,}[/-年.]/.test(candidate) &&
                !/[¥\\#￥]?[0-9,]{3,}/.test(candidate)) {
                result.notes = candidate;
                break;
            }
        }

    // ▼▼▼ [デバッグ] 最終結果を表示 ▼▼▼
    console.log('\n[終了] 解析結果:', result);
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
