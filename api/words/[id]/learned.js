const handle = require("../../_lib/handle");
const { loadDB, saveDB } = require("../../_lib/store");
const { keyOk, setLearned } = require("../../_lib/logic");

module.exports = handle(async (req, res) => {
  const db = await loadDB();
  const key = req.headers["x-key"] || req.query.k;
  if (!keyOk(key, db.key)) {
    return res.status(401).json({ error: "Missing or wrong access key — ask your partner for the link." });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { id } = req.query;
  const w = db.words.find((x) => x.id === id);
  if (!w) return res.status(404).json({ error: "That word was deleted." });

  const b = req.body || {};
  if (typeof b.learned !== "boolean") return res.status(400).json({ error: "learned must be true/false" });
  setLearned(w, b.learned, b.by, b.day, db.activity);
  await saveDB(db);
  res.status(200).json(w);
});
