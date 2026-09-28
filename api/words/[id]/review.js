const handle = require("../../_lib/handle");
const { loadDB, saveDB } = require("../../_lib/store");
const { keyOk, setLearned, logActivity, INTERVALS, MASTER_STREAK, DAY_MS } = require("../../_lib/logic");

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
  if (typeof b.correct !== "boolean") return res.status(400).json({ error: "correct must be true/false" });

  const s = w.srs;
  const now = Date.now();
  s.reviews++;
  s.lastReviewed = new Date(now).toISOString();
  if (b.correct) {
    s.correct++;
    s.streak++;
    s.box = Math.min(s.box + 1, INTERVALS.length - 1);
    s.due = new Date(now + INTERVALS[s.box] * DAY_MS).toISOString();
    if (s.streak >= MASTER_STREAK) setLearned(w, true, b.by, b.day, db.activity);
  } else {
    s.misses++;
    s.streak = 0;
    s.box = 0;
    s.due = new Date(now).toISOString();
    setLearned(w, false, b.by, b.day, db.activity); // forgot it → back into rotation
  }
  logActivity(db.activity, b.day, b.by, "reviews");
  if (b.correct) logActivity(db.activity, b.day, b.by, "correct");
  await saveDB(db);
  res.status(200).json(w);
});
