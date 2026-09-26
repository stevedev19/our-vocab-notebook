// Vercel functions can't hold a request open for 25s the way the old
// long-poll did (serverless invocations are meant to return quickly), so
// this just answers immediately with the current state every time. app.js
// calls this every couple of seconds instead (see the updated connect()).

const { loadDB } = require("./_lib/store");
const { keyOk } = require("./_lib/logic");

module.exports = async (req, res) => {
  const db = await loadDB();
  const key = req.headers["x-key"] || req.query.k;
  if (!keyOk(key, db.key)) {
    return res.status(401).json({ error: "Missing or wrong access key — ask your partner for the link." });
  }
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ version: db.version, words: db.words, activity: db.activity });
};
