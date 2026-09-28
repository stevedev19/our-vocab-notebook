const handle = require("../../_lib/handle");
const { loadDB, saveDB } = require("../../_lib/store");
const { keyOk, name, logActivity, REACTIONS } = require("../../_lib/logic");

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
  const who = name(b.by);
  if (b.emoji === null || w.reactions[who] === b.emoji) {
    delete w.reactions[who];
  } else if (REACTIONS.includes(b.emoji)) {
    w.reactions[who] = b.emoji;
    logActivity(db.activity, b.day, who, "reactions");
  } else {
    return res.status(400).json({ error: "Unknown reaction" });
  }
  await saveDB(db);
  res.status(200).json(w);
});
