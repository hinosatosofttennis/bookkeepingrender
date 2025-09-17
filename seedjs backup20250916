const { Pool } = require('pg');
require('dotenv').config(); // 環境変数を読み込む

// 勘定科目マスターデータ（PDFから一部を抜粋・構造化）
// ★実際には、PDFの一般商工業(cai)シートから全ての科目をここに記述します
const accountsData = [
  // --- 資産 ---
  { category: 'assets', sub_category: '流動資産', account_name: '現金及び預金' },
  { category: 'assets', sub_category: '流動資産', account_name: '受取手形' },
  { category: 'assets', sub_category: '流動資産', account_name: '売掛金' },
  { category: 'assets', sub_category: '流動資産', account_name: '商品及び製品' },
  { category: 'assets', sub_category: '固定資産', account_name: '建物' },
  { category: 'assets', sub_category: '固定資産', account_name: '機械及び装置' },
  { category: 'assets', sub_category: '固定資産', account_name: '土地' },
  // --- 負債 ---
  { category: 'liabilities', sub_category: '流動負債', account_name: '支払手形' },
  { category: 'liabilities', sub_category: '流動負債', account_name: '買掛金' },
  { category: 'liabilities', sub_category: '流動負債', account_name: '短期借入金' },
  { category: 'liabilities', sub_category: '固定負債', account_name: '長期借入金' },
  // --- 純資産 ---
  { category: 'net_assets', sub_category: '株主資本', account_name: '資本金' },
  { category: 'net_assets', sub_category: '株主資本', account_name: '資本剰余金' },
  // --- 費用 ---
  { category: 'expenses', sub_category: '売上原価', account_name: '仕入' },
  { category: 'expenses', sub_category: '販売費及び一般管理費', account_name: '役員報酬' },
  { category: 'expenses', sub_category: '販売費及び一般管理費', account_name: '給料及び手当' },
  { category: 'expenses', sub_category: '販売費及び一般管理費', account_name: '旅費交通費' },
  { category: 'expenses', sub_category: '販売費及び一般管理費', account_name: '消耗品費' },
  { category: 'expenses', sub_category: '販売費及び一般管理費', account_name: '地代家賃' },
  // --- 収益 ---
  { category: 'revenues', sub_category: '売上高', account_name: '売上高' },
  { category: 'revenues', sub_category: '営業外収益', account_name: '受取利息' },
];

// データベース接続設定
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function seedDatabase() {
  const client = await pool.connect();
  try {
    console.log('古いデータを削除しています...');
    await client.query('TRUNCATE TABLE master_accounts RESTART IDENTITY CASCADE');

    console.log('新しいデータを挿入しています...');
    for (const acc of accountsData) {
      await client.query(
        'INSERT INTO master_accounts (category, sub_category, account_name) VALUES ($1, $2, $3)',
        [acc.category, acc.sub_category, acc.account_name]
      );
    }

    console.log('✅ データベースの初期データ投入が完了しました。');
  } catch (error) {
    console.error('データ投入中にエラーが発生しました:', error);
  } finally {
    client.release();
    pool.end();
  }
}

seedDatabase();
