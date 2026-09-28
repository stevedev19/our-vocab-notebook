const handle = require("../_lib/handle");
const crypto = require("crypto");
const { loadDB, saveDB } = require("../_lib/store");
const { keyOk, wordFields, name, normalize, logActivity } = require("../_lib/logic");

module.exports = handle(async (req, res) => {
  const db = await loadDB();
  const key = req.headers["x-key"] || req.query.k;
  if (!keyOk(key, db.key)) {
    return res.status(401).json({ error: "Missing or wrong access key — ask your partner for the link." });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const b = req.body || {};
  const word = normalize({
    id: crypto.randomUUID(),
    ...wordFields(b),
    addedBy: name(b.by),
    createdAt: new Date().toISOString(),
  });
  if (!word.term || !word.meaning || !word.lang) {
    return res.status(400).json({ error: "Word, meaning and language are required." });
  }
  db.words.unshift(word);
  logActivity(db.activity, b.day, b.by, "added");
  await saveDB(db);
  res.status(201).json(word);
});
