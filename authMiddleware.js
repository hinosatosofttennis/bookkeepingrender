const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // "Bearer TOKEN" の形式

  if (token == null) {
    return res.sendStatus(401); // トークンがない場合は認証拒否
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.sendStatus(403); // トークンが無効な場合は認証拒否
    }
    req.user = user; // リクエストオブジェクトにユーザー情報を格納
    next(); // 次の処理へ
  });
}

module.exports = { authenticateToken };
