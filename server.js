// Our Vocab Notebook — tiny zero-dependency server.
// Serves ./public, stores everything in ./data/db.json, and pushes live
// updates to every open page via long-polling (plain request/response, so it
// works through any proxy or tunnel — unlike SSE, which some buffer).
//
//   node server.js            (PORT env var to change port, default 3000)
//
// The API is protected by a secret access key (generated on first run and
// kept in db.json). The page carries it in the share link: /#k=<key>

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const LEGACY_FILE = path.join(DATA_DIR, "words.json");

const DAY_MS = 86_400_000;
// Leitner boxes: days until a word is due again after a correct answer.
const INTERVALS = [0, 1, 3, 7, 14, 30];
// Correct answers in a row before a word counts as mastered (auto-learned).
const MASTER_STREAK = 4;
const REACTIONS = ["❤️", "😂", "😮", "👍", "🔥"];

// ---------- Storage ----------
let db = { key: "", words: [], activity: {} };
fs.mkdirSync(DATA_DIR, { recursive: true });
try {
  db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, "utf8")) };
} catch {
  try { db.words = JSON.parse(fs.readFileSync(LEGACY_FILE, "utf8")); } catch {}
}
db.words = db.words.map(normalize);
if (!db.key) db.key = crypto.randomBytes(12).toString("base64url");
writeNow();

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

function writeNow() {
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE); // atomic replace
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeNow, 100);
}

// ---------- Live updates ----------
// GET /api/state?since=<version> answers immediately if the client is behind,
// otherwise holds the request until the next change (or 25s → 204).
let version = 1;
const waiters = new Set();
const publicState = () => JSON.stringify({ version, words: db.words, activity: db.activity });

function sendState(res) {
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(publicState());
}

function changed() {
  version++;
  save();
  for (const w of waiters) {
    clearTimeout(w.timer);
    sendState(w.res);
  }
  waiters.clear();
}

// ---------- Helpers ----------
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

function logActivity(day, who, field) {
  const d = (db.activity[dayKey(day)] ??= {});
  const p = (d[name(who)] ??= { added: 0, reviews: 0, correct: 0, learned: 0, reactions: 0 });
  p[field] = (p[field] || 0) + 1;
}

function setLearned(w, learned, who, day) {
  if (learned === w.learned) return;
  w.learned = learned;
  if (learned) {
    w.learnedBy = name(who);
    w.learnedAt = new Date().toISOString();
    logActivity(day, who, "learned");
  } else {
    w.learnedBy = "";
    w.learnedAt = null;
    w.srs.streak = 0;
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 20_000) reject(new Error("Body too large"));
    });
    req.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); } catch { reject(new Error("Invalid JSON")); }
    });
  });
}

function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

function keyOk(k) {
  const a = Buffer.from(String(k || ""));
  const b = Buffer.from(db.key);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- API ----------
async function api(req, res, url) {
  if (!keyOk(req.headers["x-key"] || url.searchParams.get("k"))) {
    return send(res, 401, { error: "Missing or wrong access key — ask your partner for the link." });
  }

  if (url.pathname === "/api/state" && req.method === "GET") {
    const since = Number(url.searchParams.get("since"));
    if (since !== version) return sendState(res);
    const w = { res, timer: setTimeout(() => { waiters.delete(w); res.writeHead(204).end(); }, 25_000) };
    waiters.add(w);
    req.on("close", () => { clearTimeout(w.timer); waiters.delete(w); });
    return;
  }

  if (url.pathname === "/api/words" && req.method === "POST") {
    const b = await readJson(req);
    const word = normalize({
      id: crypto.randomUUID(),
      ...wordFields(b),
      addedBy: name(b.by),
      createdAt: new Date().toISOString(),
    });
    if (!word.term || !word.meaning || !word.lang) {
      return send(res, 400, { error: "Word, meaning and language are required." });
    }
    db.words.unshift(word);
    logActivity(b.day, b.by, "added");
    changed();
    return send(res, 201, word);
  }

  const m = url.pathname.match(/^\/api\/words\/([\w-]+)(?:\/(learned|review|react))?$/);
  if (!m) return send(res, 404, { error: "Not found" });

  const w = db.words.find((x) => x.id === m[1]);
  if (!w) return send(res, 404, { error: "That word was deleted." });
  const action = m[2];

  if (!action && req.method === "PUT") {
    const b = await readJson(req);
    const fields = wordFields(b);
    if (!fields.term || !fields.meaning || !fields.lang) {
      return send(res, 400, { error: "Word, meaning and language are required." });
    }
    Object.assign(w, fields);
    changed();
    return send(res, 200, w);
  }

  if (!action && req.method === "DELETE") {
    db.words = db.words.filter((x) => x !== w);
    changed();
    return send(res, 200, { ok: true });
  }

  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  const b = await readJson(req);

  if (action === "learned") {
    if (typeof b.learned !== "boolean") return send(res, 400, { error: "learned must be true/false" });
    setLearned(w, b.learned, b.by, b.day);
    changed();
    return send(res, 200, w);
  }

  if (action === "review") {
    if (typeof b.correct !== "boolean") return send(res, 400, { error: "correct must be true/false" });
    const s = w.srs;
    const now = Date.now();
    s.reviews++;
    s.lastReviewed = new Date(now).toISOString();
    if (b.correct) {
      s.correct++;
      s.streak++;
      s.box = Math.min(s.box + 1, INTERVALS.length - 1);
      s.due = new Date(now + INTERVALS[s.box] * DAY_MS).toISOString();
      if (s.streak >= MASTER_STREAK) setLearned(w, true, b.by, b.day);
    } else {
      s.misses++;
      s.streak = 0;
      s.box = 0;
      s.due = new Date(now).toISOString();
      setLearned(w, false, b.by, b.day); // forgot it → back into rotation
    }
    logActivity(b.day, b.by, "reviews");
    if (b.correct) logActivity(b.day, b.by, "correct");
    changed();
    return send(res, 200, w);
  }

  if (action === "react") {
    const who = name(b.by);
    if (b.emoji === null || w.reactions[who] === b.emoji) {
      delete w.reactions[who];
    } else if (REACTIONS.includes(b.emoji)) {
      w.reactions[who] = b.emoji;
      logActivity(b.day, who, "reactions");
    } else {
      return send(res, 400, { error: "Unknown reaction" });
    }
    changed();
    return send(res, 200, w);
  }

  send(res, 404, { error: "Not found" });
}

// ---------- Static files ----------
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function serveStatic(req, res, url) {
  const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, { error: "Forbidden" });
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, { error: "Not found" });
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  });
}

// ---------- Server ----------
http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
      if (url.pathname.startsWith("/api/")) await api(req, res, url);
      else serveStatic(req, res, url);
    } catch (err) {
      send(res, 400, { error: err.message });
    }
  })
  .listen(PORT, "0.0.0.0", () => {
    console.log(`\n📒 Our Vocab Notebook is running\n`);
    console.log(`   On this computer:  http://localhost:${PORT}/#k=${db.key}`);
    for (const nets of Object.values(os.networkInterfaces())) {
      for (const n of nets || []) {
        if (n.family === "IPv4" && !n.internal) console.log(`   On your phone:     http://${n.address}:${PORT}/#k=${db.key}   (same Wi-Fi)`);
      }
    }
    console.log(`\n   Share the link *including* #k=… — it's the key to your notebook.\n`);
  });
