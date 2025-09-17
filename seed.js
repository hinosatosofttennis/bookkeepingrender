const fs = require('fs');
const csv = require('csv-parser');
const { Pool } = require('pg');
require('dotenv').config();

// データベース接続設定
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function seedDatabase() {
  const accounts = [];
  
  // 1. CSVファイルを読み込んで、accounts配列にデータを格納
  fs.createReadStream('master_accounts.csv')
    .pipe(csv())
    .on('data', (row) => {
      accounts.push(row);
    })
    .on('end', async () => {
      console.log('CSVファイルの読み込みが完了しました。');
      
      const client = await pool.connect();
      try {
        // 2. データベースの既存データをクリア
        console.log('古いデータを削除しています...');
        await client.query('TRUNCATE TABLE master_accounts RESTART IDENTITY CASCADE');

        // 3. accounts配列のデータをデータベースに一括挿入
        console.log('新しいデータを挿入しています...');
        for (const acc of accounts) {
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
    });
}

seedDatabase();
 
