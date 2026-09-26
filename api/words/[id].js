const { loadDB, saveDB } = require("../_lib/store");
const { keyOk, wordFields } = require("../_lib/logic");

module.exports = async (req, res) => {
  const db = await loadDB();
  const key = req.headers["x-key"] || req.query.k;
  if (!keyOk(key, db.key)) {
    return res.status(401).json({ error: "Missing or wrong access key — ask your partner for the link." });
  }

  const { id } = req.query;
  const w = db.words.find((x) => x.id === id);
  if (!w) return res.status(404).json({ error: "That word was deleted." });

  if (req.method === "PUT") {
    const fields = wordFields(req.body || {});
    if (!fields.term || !fields.meaning || !fields.lang) {
      return res.status(400).json({ error: "Word, meaning and language are required." });
    }
    Object.assign(w, fields);
    await saveDB(db);
    return res.status(200).json(w);
  }

  if (req.method === "DELETE") {
    db.words = db.words.filter((x) => x !== w);
    await saveDB(db);
    return res.status(200).json({ ok: true });
  }

  res.status(405).json({ error: "Method not allowed" });
};
