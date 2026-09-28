// Replaces server.js's fs.readFileSync/writeFileSync(db.json), and later
// Vercel KV, with MongoDB. The whole database is still one JSON document —
// same shape as before — just stored as a single document in a MongoDB
// collection instead of a Redis key, so it works across serverless function
// invocations and survives deploys.

const { MongoClient } = require("mongodb");
const { normalize, generateKey } = require("./logic");

const DB_KEY = "vocab:db";
const DB_NAME = "vocabapp";
const COLLECTION_NAME = "store";

let clientPromise;

function getClient() {
  if (!clientPromise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error("MONGODB_URI environment variable is not set");
    }
    const client = new MongoClient(uri);
    clientPromise = client.connect();
  }
  return clientPromise;
}

async function getCollection() {
  const client = await getClient();
  return client.db(DB_NAME).collection(COLLECTION_NAME);
}

async function loadDB() {
  const collection = await getCollection();
  let doc = await collection.findOne({ _id: DB_KEY });
  let db = doc && doc.data;
  if (!db) {
    db = { key: generateKey(), words: [], activity: {}, version: 1 };
    await collection.updateOne(
      { _id: DB_KEY },
      { $set: { data: db } },
      { upsert: true }
    );
  }
  // ACCESS_KEY (a Vercel env var) lets you choose the notebook's key, since
  // there's no server console to print the generated one anymore.
  if (process.env.ACCESS_KEY) db.key = process.env.ACCESS_KEY.trim();
  db.words = (db.words || []).map(normalize);
  db.activity = db.activity || {};
  db.version = db.version || 1;
  return db;
}

// Last-write-wins, same as the original file-based version. With just two
// people using this, the odds of a true concurrent write are low, and a
// clobbered activity increment is cosmetic, not data loss of a whole word.
async function saveDB(db) {
  db.version = (db.version || 1) + 1;
  const collection = await getCollection();
  await collection.updateOne(
    { _id: DB_KEY },
    { $set: { data: db } },
    { upsert: true }
  );
  return db.version;
}

module.exports = { loadDB, saveDB };
