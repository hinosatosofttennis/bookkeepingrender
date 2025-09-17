  // server.js - Render.com backend server with Workload Identity
const express = require('express');
const multer = require('multer');
const vision = require('@google-cloud/vision');
const cors = require('cors');
const { GoogleAuth } = require('google-auth-library');
// server.js の冒頭部分
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json()); // JSONリクエストを扱えるようにする
app.use(cors()); // CORSを許可

// Renderが提供するDATABASE_URL環境変数を使ってデータベースに接続
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// server.js

const bcrypt = require('bcryptjs');

app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'メールアドレスとパスワードは必須です。' });
  }

  try {
    // パスワードをハッシュ化
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // データベースに新しいユーザーを保存
    const newUser = await pool.query(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email",
      [email, passwordHash]
    );

    res.status(201).json(newUser.rows[0]);

  } catch (error) {
    console.error('ユーザー登録エラー:', error);
    // メールアドレスが既に存在する場合など
    res.status(500).json({ error: 'ユーザー登録に失敗しました。' });
  }
});

// server.js

const jwt = require('jsonwebtoken');

// ★重要: このSECRETは、Renderの環境変数に設定してください
const JWT_SECRET = process.env.JWT_SECRET; 

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'メールアドレスとパスワードを入力してください。' });
  }

  try {
    // メールアドレスでユーザーを検索
    const userResult = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    const user = userResult.rows[0];

    if (!user) {
      return res.status(401).json({ error: '認証情報が無効です。' }); // ユーザーが見つからない
    }

    // 入力されたパスワードとDBのハッシュを比較
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({ error: '認証情報が無効です。' }); // パスワードが違う
    }

    // 認証成功！JWTトークンを生成して返す
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, {
      expiresIn: '1d', // トークンの有効期限 (例: 1日)
    });

    res.json({ message: 'ログイン成功', token: token });

  } catch (error) {
    console.error('ログインエラー:', error);
    res.status(500).json({ error: 'ログイン処理中にエラーが発生しました。' });
  }
});

// server.js (APIエンドポイントの例)

// ★認証チェックを行うミドルウェア（後で作成）
const { authenticateToken } = require('./authMiddleware'); 

// 全ての勘定科目を階層構造で取得するAPI
app.get('/api/accounts', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query("SELECT category, sub_category, account_name FROM master_accounts ORDER BY id");
        
        // 取得したデータを階層構造に整形して返す
        const structuredAccounts = structureAccounts(result.rows); // この整形関数は別途作成

        res.json(structuredAccounts);

    } catch (error) {
        console.error('勘定科目リストの取得エラー:', error);
        res.status(500).json({ error: '勘定科目の取得に失敗しました。' });
    }
});

// ユーザーがよく使う勘定科目トップ10を取得するAPI
app.get('/api/accounts/top10', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId; // 認証ミドルウェアからユーザーIDを取得

        const result = await pool.query(
            `SELECT m.account_name
             FROM user_account_usage u
             JOIN master_accounts m ON u.account_id = m.id
             WHERE u.user_id = $1
             ORDER BY u.usage_count DESC
             LIMIT 10`,
            [userId]
        );

        res.json(result.rows);

    } catch (error) {
        console.error('トップ10勘定科目の取得エラー:', error);
        res.status(500).json({ error: 'よく使う勘定科目の取得に失敗しました。' });
    }
});

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

// レシートテキストの解析関数（修正版）
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

// server.js (末尾に追加)

app.post('/api/transactions', authenticateToken, async (req, res) => {
    const { account_id, transaction_date, amount, notes } = req.body;
    const userId = req.user.userId;

    if (!account_id || !transaction_date || !amount) {
        return res.status(400).json({ error: '勘定科目、日付、金額は必須です。' });
    }

    const client = await pool.connect();
    try {
        // データベースのトランザクションを開始
        await client.query('BEGIN');

        // 1. transactionsテーブルに新しい取引を挿入
        const newTransaction = await client.query(
            `INSERT INTO transactions (user_id, account_id, transaction_date, amount, notes)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [userId, account_id, transaction_date, amount, notes]
        );

        // 2. user_account_usageテーブルの利用回数を更新（存在しない場合は新規作成）
        await client.query(
            `INSERT INTO user_account_usage (user_id, account_id, usage_count)
             VALUES ($1, $2, 1)
             ON CONFLICT (user_id, account_id)
             DO UPDATE SET usage_count = user_account_usage.usage_count + 1`,
            [userId, account_id]
        );

        // トランザクションをコミット（変更を確定）
        await client.query('COMMIT');

        res.status(201).json(newTransaction.rows[0]);

    } catch (error) {
        // エラーが発生した場合はロールバック（変更を取り消し）
        await client.query('ROLLBACK');
        console.error('取引登録エラー:', error);
        res.status(500).json({ error: '取引の登録に失敗しました。' });
    } finally {
        client.release();
    }
});

// server.js (末尾に追加)

app.get('/api/transactions', authenticateToken, async (req, res) => {
    const userId = req.user.userId;

    try {
        const transactions = await pool.query(
            `SELECT t.id, t.transaction_date, m.account_name, t.amount, t.notes, t.created_at
             FROM transactions t
             JOIN master_accounts m ON t.account_id = m.id
             WHERE t.user_id = $1
             ORDER BY t.transaction_date DESC, t.created_at DESC`,
            [userId]
        );

        res.json(transactions.rows);
    } catch (error) {
        console.error('取引一覧取得エラー:', error);
        res.status(500).json({ error: '取引の取得に失敗しました。' });
    }
});

startServer();
