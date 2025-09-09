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

// 改善されたレシートテキストの解析関数
const parseReceiptText = (text) => {
    const result = { date: '', amount: null, notes: '' };

    try {
        const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);

        // ▼▼▼ 大幅に改善された日付検出 ▼▼▼
        const datePatterns = [
            // 優先度順に配列（より具体的なパターンを先に）
            {
                // YYYY年MM月DD日 (日本語)
                regex: /(\d{4})[年](\d{1,2})[月](\d{1,2})[日]/,
                format: 'jp',
                priority: 1
            },
            {
                // YYYY/MM/DD, YYYY-MM-DD, YYYY.MM.DD
                regex: /(?:^|[^\d])(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})(?:[^\d]|$)/,
                format: 'ymd',
                priority: 2
            },
            {
                // DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY (ヨーロッパ式)
                regex: /(?:^|[^\d])(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})(?:[^\d]|$)/,
                format: 'dmy',
                priority: 3,
                // 日と月が明らかに区別できる場合のみ
                validator: (d, m, y) => parseInt(d) > 12 || parseInt(m) <= 12
            },
            {
                // MM/DD/YYYY, MM-DD-YYYY, MM.DD.YYYY (アメリカ式)
                regex: /(?:^|[^\d])(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})(?:[^\d]|$)/,
                format: 'mdy',
                priority: 4
            },
            {
                // YY/MM/DD, YY-MM-DD, YY.MM.DD (2桁年)
                regex: /(?:^|[^\d])(\d{2})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})(?:[^\d]|$)/,
                format: 'ymd2',
                priority: 5,
                // 年が明らかに年である場合（月日より大きい、または特定の範囲）
                validator: (y, m, d) => {
                    const year = parseInt(y);
                    const month = parseInt(m);
                    const day = parseInt(d);
                    return year > 31 || (year >= 0 && year <= 99 && month <= 12 && day <= 31);
                }
            },
            {
                // MM/DD, MM-DD, MM.DD (年省略)
                regex: /(?:^|[^\d])(\d{1,2})[\/\-\.](\d{1,2})(?:[^\d:]|$)/,
                format: 'md',
                priority: 6,
                // 時刻ではないことを確認（:が後に続かない）
                validator: (m, d) => true
            }
        ];

        // 日付妥当性チェック関数
        const isValidDate = (year, month, day) => {
            const y = parseInt(year);
            const m = parseInt(month);
            const d = parseInt(day);
            
            // 基本的な範囲チェック
            if (m < 1 || m > 12 || d < 1 || d > 31) return false;
            
            // 月ごとの日数チェック
            const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
            
            // うるう年チェック
            const isLeapYear = (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
            if (m === 2 && isLeapYear) daysInMonth[1] = 29;
            
            return d <= daysInMonth[m - 1];
        };

        // 2桁年を4桁年に変換
        const expandYear = (twoDigitYear) => {
            const year = parseInt(twoDigitYear);
            const currentYear = new Date().getFullYear();
            const currentCentury = Math.floor(currentYear / 100) * 100;
            
            // 現在年の下2桁との差で判断
            const currentYearLastTwo = currentYear % 100;
            
            if (year <= currentYearLastTwo + 10) {
                return currentCentury + year; // 2000年代
            } else {
                return currentCentury - 100 + year; // 1900年代
            }
        };

        // 除外すべきパターン（時刻、電話番号、価格など）
        const excludePatterns = [
            /\d{1,2}:\d{2}/, // 時刻
            /\d{3,4}-\d{4}/, // 電話番号の一部
            /¥\s*\d+/, // 価格
            /\$\s*\d+/, // 価格
            /\d+\.\d{2}$/, // 小数点以下2桁（価格の可能性）
        ];

        let bestMatch = null;
        let bestPriority = Infinity;

        // 各行を検査
        for (const line of lines) {
            // 除外パターンに該当する行はスキップ
            if (excludePatterns.some(pattern => pattern.test(line))) {
                continue;
            }

            console.log(`検査中の行: "${line}"`); // デバッグ用

            // 各日付パターンをテスト
            for (const pattern of datePatterns) {
                const match = line.match(pattern.regex);
                
                if (match && pattern.priority < bestPriority) {
                    console.log(`パターンマッチ [${pattern.format}]:`, match); // デバッグ用
                    
                    let year, month, day;
                    let isValid = false;

                    // フォーマット別の処理
                    switch (pattern.format) {
                        case 'jp': // YYYY年MM月DD日
                            year = match[1];
                            month = match[2];
                            day = match[3];
                            isValid = isValidDate(year, month, day);
                            break;

                        case 'ymd': // YYYY/MM/DD
                            year = match[1];
                            month = match[2];
                            day = match[3];
                            isValid = isValidDate(year, month, day);
                            break;

                        case 'dmy': // DD/MM/YYYY
                            day = match[1];
                            month = match[2];
                            year = match[3];
                            // カスタムバリデータがある場合は実行
                            if (pattern.validator && !pattern.validator(day, month, year)) {
                                continue;
                            }
                            isValid = isValidDate(year, month, day);
                            break;

                        case 'mdy': // MM/DD/YYYY
                            month = match[1];
                            day = match[2];
                            year = match[3];
                            isValid = isValidDate(year, month, day);
                            break;

                        case 'ymd2': // YY/MM/DD
                            const rawYear = match[1];
                            month = match[2];
                            day = match[3];
                            // カスタムバリデータがある場合は実行
                            if (pattern.validator && !pattern.validator(rawYear, month, day)) {
                                continue;
                            }
                            year = expandYear(rawYear);
                            isValid = isValidDate(year, month, day);
                            break;

                        case 'md': // MM/DD
                            month = match[1];
                            day = match[2];
                            year = new Date().getFullYear();
                            isValid = isValidDate(year, month, day);
                            
                            // 過去の日付の場合、来年の可能性も考慮
                            if (isValid) {
                                const testDate = new Date(year, month - 1, day);
                                const today = new Date();
                                if (testDate < today && (today - testDate) > 30 * 24 * 60 * 60 * 1000) {
                                    // 30日以上前の場合、来年の日付とみなす
                                    year = year + 1;
                                }
                            }
                            break;
                    }

                    if (isValid) {
                        bestMatch = {
                            year: parseInt(year),
                            month: parseInt(month),
                            day: parseInt(day),
                            priority: pattern.priority,
                            format: pattern.format,
                            line: line
                        };
                        bestPriority = pattern.priority;
                        
                        console.log(`有効な日付発見:`, bestMatch); // デバッグ用
                        
                        // 最優先パターン（日本語形式）が見つかったら即座に終了
                        if (pattern.priority === 1) {
                            break;
                        }
                    }
                }
            }
            
            // 最優先パターンが見つかったらライン検索も終了
            if (bestMatch && bestMatch.priority === 1) {
                break;
            }
        }

        // 最適な日付が見つかった場合、フォーマットして設定
        if (bestMatch) {
            result.date = `${bestMatch.year}-${bestMatch.month.toString().padStart(2, '0')}-${bestMatch.day.toString().padStart(2, '0')}`;
            console.log(`最終決定日付: ${result.date} (形式: ${bestMatch.format})`); // デバッグ用
        } else {
            console.log('有効な日付が見つかりませんでした'); // デバッグ用
        }

        // 金額検出（既存のロジックを維持）
        for (const line of lines) {
            // 既存の金額検出ロジックをここに追加
            // ...
        }

        // ノート（既存のロジックを維持）
        result.notes = lines.join(' ');

    } catch (error) {
        console.error('レシート解析エラー:', error);
    }

    return result;
};

// テスト用のヘルパー関数
const testDateParsing = (testCases) => {
    console.log('=== 日付解析テスト開始 ===');
    
    testCases.forEach((testCase, index) => {
        console.log(`\nテストケース ${index + 1}: "${testCase}"`);
        const result = parseReceiptText(testCase);
        console.log(`結果: ${result.date || '日付なし'}`);
        console.log('---');
    });
};

// テストケース例
const testCases = [
    "2024年3月15日 ¥1,200",
    "2024/03/15 合計 1200円",
    "15.03.2024 Total: €12.50",
    "03/15/2024 $15.99",
    "24/03/15 1200円",
    "3/15 お買上げありがとうございます",
    "時間: 14:30 日付: 2024-03-15",
    "電話: 03-1234-5678 価格: ¥999.99",
    "無効な日付: 13/40/2024",
    "曖昧: 12/11/2024" // 12月11日 vs 11月12日
];

// テスト実行（必要に応じてコメントアウトを外す）
// testDateParsing(testCases);

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

        // 日付が検出されない場合は、今日の日付を使用
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
