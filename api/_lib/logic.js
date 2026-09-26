// Shared helpers used by every /api route. Ported directly from the
// original server.js — same validation, same SRS math, same activity log
// shape — just split out so each serverless function can import what it needs.

const crypto = require("crypto");

const DAY_MS = 86_400_000;
// Leitner boxes: days until a word is due again after a correct answer.
const INTERVALS = [0, 1, 3, 7, 14, 30];
// Correct answers in a row before a word counts as mastered (auto-learned).
const MASTER_STREAK = 4;
const REACTIONS = ["❤️", "😂", "😮", "👍", "🔥"];

function normalize(w) {
  return {
    pronunciation: "",
    example: "",
    tags: [],
    learned: false,
    learnedBy: "",
    learnedAt: null,
    reactions: {},
    ...w,
    srs: { box: 0, streak: 0, correct: 0, misses: 0, reviews: 0, due: null, lastReviewed: null, ...(w.srs || {}) },
  };
}

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const name = (v) => str(v, 40) || "someone";

// Days are the *client's* local date, so a partner in another time zone
// gets streaks that match their own calendar.
const dayKey = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : new Date().toISOString().slice(0, 10));

function tags(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const t of v) {
    const clean = str(t, 24).toLowerCase().replace(/^#+/, "").replace(/\s+/g, "-");
    if (clean && !out.includes(clean)) out.push(clean);
  }
  return out.slice(0, 8);
}

function wordFields(b) {
  return {
    term: str(b.term, 200),
    meaning: str(b.meaning, 500),
    pronunciation: str(b.pronunciation, 200),
    example: str(b.example, 1000),
    lang: b.lang === "ko" || b.lang === "en" ? b.lang : "",
    tags: tags(b.tags),
  };
}

function logActivity(activity, day, who, field) {
  const d = (activity[dayKey(day)] ??= {});
  const p = (d[name(who)] ??= { added: 0, reviews: 0, correct: 0, learned: 0, reactions: 0 });
  p[field] = (p[field] || 0) + 1;
}

function setLearned(w, learned, who, day, activity) {
  if (learned === w.learned) return;
  w.learned = learned;
  if (learned) {
    w.learnedBy = name(who);
    w.learnedAt = new Date().toISOString();
    logActivity(activity, day, who, "learned");
  } else {
    w.learnedBy = "";
    w.learnedAt = null;
    w.srs.streak = 0;
  }
}

function keyOk(provided, real) {
  const a = Buffer.from(String(provided || ""));
  const b = Buffer.from(String(real || ""));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function generateKey() {
  return crypto.randomBytes(12).toString("base64url");
}

module.exports = {
  DAY_MS, INTERVALS, MASTER_STREAK, REACTIONS,
  normalize, wordFields, tags, name, dayKey,
  logActivity, setLearned, keyOk, generateKey,
};
