// 必要なライブラリをインポート
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { ImageAnnotatorClient } = require('@google-cloud/vision');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager'); // Secret Managerクライアントを追加

// Expressアプリケーションを作成
const app = express();
const PORT = process.env.PORT || 3001;

// CORSを有効にする
app.use(cors());

// Multerの設定
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// --- SECRET MANAGERから認証情報を取得する部分 ---
const projectId = process.env.GOOGLE_PROJECT_ID; // 環境変数から取得
const secretName = process.env.SECRET_NAME; // 環境変数から取得
const secretManagerClient = new SecretManagerServiceClient();

let visionClient; // Visionクライアントをグローバルスコープで宣言

/**
 * Secret ManagerからVision APIの認証情報を非同期で取得し、
 * Vision APIクライアントを初期化する関数
 */
async function initializeVisionClient() {
  try {
    if (!projectId || !secretName) {
      throw new Error('環境変数 GOOGLE_PROJECT_ID または SECRET_NAME が設定されていません。');
    }
    
    // Secret Managerから最新バージョンのシークレットを取得
    const [version] = await secretManagerClient.accessSecretVersion({
      name: `projects/${projectId}/secrets/${secretName}/versions/latest`,
    });

    // ペイロード（シークレットの値）はBase64でエンコードされているのでデコードする
    const payload = version.payload.data.toString('utf8');
    const credentials = JSON.parse(payload);

    // 取得した認証情報を使ってVision APIクライアントを初期化
    visionClient = new ImageAnnotatorClient({ credentials });
    console.log('Vision API client successfully initialized using credentials from Secret Manager.');

  } catch (error) {
    console.error('Failed to initialize Vision API client:', error);
    // エラーが発生した場合、アプリケーションを正常に動作させないためにプロセスを終了する
    process.exit(1);
  }
}

/**
 * OCR処理を行うメインのAPIエンドポイント
 */
app.post('/api/ocr', upload.single('file'), async (req, res) => {
  if (!visionClient) {
    // クライアントが初期化されていない場合はエラーを返す
    return res.status(500).json({ error: 'サーバーが正しく初期化されていません。管理者に連絡してください。' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'ファイルがアップロードされていません。' });
  }

  try {
    const imageBuffer = req.file.buffer;
    const [result] = await visionClient.textDetection({
      image: { content: imageBuffer },
    });
    
    const detections = result.textAnnotations;
    if (!detections || detections.length === 0) {
      return res.status(404).json({ error: '画像からテキストを検出できませんでした。' });
    }

    const fullText = detections[0].description;
    
    // --- OCRテキストから情報を抽出するロジック (変更なし) ---
    let extractedData = {
      date: null,
      amount: null,
      notes: fullText.split('\n')[0] || ''
    };
    const dateRegex = /(\d{4})[/-年](\d{1,2})[/-月](\d{1,2})日?/;
    const dateMatch = fullText.match(dateRegex);
    if (dateMatch) {
      extractedData.date = `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`;
    }
    const amountRegex = /(?:合計|請求額|TOTAL)\s?[:|：]?\s?[¥|￥]?\s*([\d,]+)/i;
    const amountMatch = fullText.match(amountRegex);
    if (amountMatch) {
      extractedData.amount = parseInt(amountMatch[1].replace(/,/g, ''), 10);
    }

    res.status(200).json(extractedData);

  } catch (error) {
    console.error('OCR処理中にエラーが発生しました:', error);
    res.status(500).json({ error: 'サーバー内部でエラーが発生しました。' });
  }
});

// サーバーを起動する前にVisionクライアントを初期化する
initializeVisionClient().then(() => {
  app.listen(PORT, () => {
    console.log(`OCR Server is running on port ${PORT}`);
  });
});
