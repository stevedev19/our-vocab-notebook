// ---------- Constants ----------
const NAME_KEY = "vocab.name";
const ACCESS_KEY = "vocab.key";
const RECAP_KEY = "vocab.recapDismissed";

const LANG = {
  ko: { flag: "🇰🇷", label: "Korean 한국어", speech: "ko-KR", pron: "e.g. an-nyeong-ha-se-yo" },
  en: { flag: "🇺🇸", label: "English 영어", speech: "en-US", pron: "e.g. 세렌디피티 / ser-uhn-DIP-i-tee" },
};
const FILTER_LABEL = { all: "All 전체", ko: "Korean 한국어", en: "English 영어", learned: "Learned 외운 단어" };
const PRESET_TAGS = ["food", "travel", "work", "slang", "daily", "feelings", "family", "shopping"];
const REACTIONS = ["❤️", "😂", "😮", "👍", "🔥"];
const MASTER_STREAK = 4; // must match server.js
const SESSION_SIZE = 20;

// ---------- Access key ----------
// The server's secret key rides in the link hash (#k=…) and is remembered on
// this device, so the share link is the only thing a partner needs.
const hashKey = new URLSearchParams(location.hash.slice(1)).get("k");
const accessKey = hashKey || localStorage.getItem(ACCESS_KEY) || "";
if (accessKey) {
  localStorage.setItem(ACCESS_KEY, accessKey);
  history.replaceState(null, "", `#k=${accessKey}`);
}

// ---------- State ----------
let words = [];
let activity = {};
let filter = "all";
let tagFilter = "";
let pickerFor = null; // word id whose reaction picker is open
let myName = localStorage.getItem(NAME_KEY) || "";

const $ = (sel) => document.querySelector(sel);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c);
  return node;
}

function toast(msg) {
  const t = $("#toast");
  // Modal dialogs sit in the top layer, so show the toast inside the open one.
  const host = [...document.querySelectorAll("dialog")].find((d) => d.open) || document.body;
  if (t.parentElement !== host) host.append(t);
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2400);
}

// ---------- Dates ----------
const pad = (n) => String(n).padStart(2, "0");
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function weekStart(d = new Date()) {
  return addDays(d, -((d.getDay() + 6) % 7)); // Monday 00:00 local
}

function timeAgo(date) {
  if (!date) return "just now";
  const s = Math.round((Date.now() - date.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return date.toLocaleDateString();
}

// ---------- Derived data ----------
function matches(w, f = filter, t = tagFilter) {
  if (t && !w.tags.includes(t)) return false;
  if (f === "learned") return w.learned;
  if (f === "ko" || f === "en") return w.lang === f;
  return true;
}

function allTags() {
  const counts = new Map();
  for (const w of words) for (const t of w.tags) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function people() {
  const set = new Set();
  for (const w of words) if (w.addedBy) set.add(w.addedBy);
  for (const day of Object.values(activity)) for (const n of Object.keys(day)) set.add(n);
  set.delete("someone");
  return [...set];
}

/** Consecutive active days ending today (or yesterday, if today isn't done yet). */
function streakFor(who) {
  const active = (key) => {
    const day = activity[key];
    if (!day) return false;
    return who ? !!day[who] : Object.keys(day).length > 0;
  };
  let d = new Date();
  const today = active(dayKey(d));
  if (!today) d = addDays(d, -1);
  let n = 0;
  while (active(dayKey(d))) {
    n++;
    d = addDays(d, -1);
  }
  return { days: n, today };
}

function weekSummary() {
  const start = weekStart();
  const perPerson = {};
  let added = 0, mastered = 0, reviews = 0, correct = 0;
  for (const w of words) {
    if (w.createdAt >= start) {
      added++;
      perPerson[w.addedBy] ??= { added: 0, mastered: 0 };
      perPerson[w.addedBy].added++;
    }
    if (w.learned && w.learnedAt >= start) {
      mastered++;
      perPerson[w.learnedBy] ??= { added: 0, mastered: 0 };
      perPerson[w.learnedBy].mastered++;
    }
  }
  const activeDays = [];
  for (let i = 0; i < 7; i++) {
    const key = dayKey(addDays(start, i));
    const day = activity[key] || {};
    activeDays.push(Object.keys(day).length > 0);
    for (const p of Object.values(day)) {
      reviews += p.reviews || 0;
      correct += p.correct || 0;
    }
  }
  return { start, added, mastered, reviews, correct, perPerson, activeDays };
}

function coupleName() {
  const ps = people();
  return ps.length === 2 ? `${ps[0]} & ${ps[1]}` : "You two";
}

// ---------- Text-to-speech ----------
let voices = [];
function loadVoices() { voices = speechSynthesis.getVoices(); }
if ("speechSynthesis" in window) {
  loadVoices();
  speechSynthesis.addEventListener?.("voiceschanged", loadVoices);
}

function pickVoice(lang) {
  const want = LANG[lang].speech.toLowerCase();
  const prefix = want.slice(0, 2);
  const cands = voices.filter((v) => v.lang.replace("_", "-").toLowerCase().startsWith(prefix));
  const score = (v) =>
    (v.lang.replace("_", "-").toLowerCase() === want ? 4 : 0)
    + (/premium|enhanced|natural|neural|google|siri/i.test(v.name) ? 2 : 0)
    + (v.localService ? 1 : 0);
  return cands.sort((a, b) => score(b) - score(a))[0] || null;
}

function speak(text, lang) {
  if (!("speechSynthesis" in window)) return toast("This browser can't play audio pronunciation.");
  if (!voices.length) loadVoices();
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = LANG[lang].speech;
  const v = pickVoice(lang);
  if (v) u.voice = v;
  else if (voices.length) toast(`No ${LANG[lang].label} voice installed — check your phone's speech settings.`);
  u.rate = lang === "ko" ? 0.85 : 0.9;
  speechSynthesis.speak(u);
}

const speakBtn = (text, lang, label) =>
  el("button", {
    class: "speak-btn",
    type: "button",
    "aria-label": `Listen: ${label || text}`,
    onclick: (e) => { e.stopPropagation(); speak(text, lang); },
  }, "🔊");

const other = (lang) => (lang === "ko" ? "en" : "ko");

// ---------- API ----------
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { "X-Key": accessKey, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify({ by: myName, day: dayKey(), ...body }) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const run = (p, what) => p.catch((err) => toast(`Couldn't ${what}: ${err.message}`));

function setState(state) {
  words = state.words.map((w) => ({
    ...w,
    createdAt: w.createdAt ? new Date(w.createdAt) : null,
    learnedAt: w.learnedAt ? new Date(w.learnedAt) : null,
  }));
  activity = state.activity || {};
  render();
  if ($("#quizDialog").open) refreshQuizCard();
  if ($("#statsDialog").open) renderStats();
}

// Long-poll loop: the server holds each request until something changes.
async function connect() {
  const statusEl = $("#status");
  let version = 0;
  for (;;) {
    try {
      // The timeout guards against requests left hanging when a phone sleeps.
      const res = await fetch(`/api/state?since=${version}`, {
        headers: { "X-Key": accessKey },
        cache: "no-store",
        signal: AbortSignal.timeout(35_000),
      });
      if (res.status === 401) {
        // Don't keep retrying a wrong or outdated key on every visit.
        localStorage.removeItem(ACCESS_KEY);
        return showLocked();
      }
      if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
      statusEl.classList.remove("offline");
      statusEl.textContent = "● Live — synced with your partner · 실시간 동기화";
      if (res.status === 200) {
        const state = await res.json();
        version = state.version;
        setState(state);
      }
    } catch {
      statusEl.classList.add("offline");
      statusEl.textContent = "Reconnecting… · 다시 연결 중";
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

function showLocked() {
  $("#status").hidden = true;
  $("#locked").hidden = false;
  document.querySelector(".filters").hidden = true;
  document.querySelector(".bottom-bar").hidden = true;
  $("#streakBtn").hidden = true;
  $("#shareBtn").hidden = true;
}

$("#keyForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const raw = $("#keyInput").value.trim();
  const key = new URLSearchParams(raw.split("#")[1] || "").get("k") || raw;
  if (!key) return;
  localStorage.setItem(ACCESS_KEY, key);
  location.hash = `k=${key}`;
  location.reload();
});

// ---------- Rendering: list ----------
function render() {
  for (const f of ["all", "ko", "en", "learned"]) {
    document.querySelector(`[data-count="${f}"]`).textContent = words.filter((w) => matches(w, f, tagFilter)).length;
  }
  renderTagBar();
  renderStreakChip();
  renderRecap();

  const visible = words.filter((w) => matches(w));
  $("#wordList").replaceChildren(...visible.map(renderWord));

  const empty = visible.length === 0;
  $("#empty").hidden = !empty;
  if (empty) {
    const none = words.length === 0;
    $("#emptyTitle").textContent = none ? "Your notebook is empty" : filter === "learned" ? "Nothing learned yet" : "No words here yet";
    $("#emptyText").innerHTML = none
      ? "Add the first word you want to remember together.<br>함께 기억하고 싶은 첫 단어를 추가해 보세요."
      : filter === "learned"
        ? "Mark words as learned, or get one right 4 times in a row in the quiz.<br>퀴즈에서 4번 연속 맞히면 외운 단어가 돼요."
        : "Try another tab or tag, or add a new word.<br>다른 탭이나 태그를 선택해 보세요.";
    $("#emptyAdd").textContent = none ? "＋ Add first word · 첫 단어 추가" : "＋ Add a word · 단어 추가";
  }
}

function renderTagBar() {
  const tags = allTags();
  const bar = $("#tagBar");
  bar.hidden = tags.length === 0;
  if (tagFilter && !tags.some(([t]) => t === tagFilter)) tagFilter = "";
  const chip = (t, label) =>
    el("button", {
      class: "chip",
      "aria-pressed": String(tagFilter === t),
      onclick: () => setTag(tagFilter === t && t ? "" : t),
    }, label);
  bar.replaceChildren(chip("", "🏷️ All tags 전체"), ...tags.map(([t, n]) => chip(t, `#${t} ${n}`)));
}

function setTag(t) {
  tagFilter = t;
  render();
  if (t) toast(`Showing #${t}`);
}

function renderStreakChip() {
  const s = streakFor();
  $("#streakNum").textContent = s.days;
  $("#streakBtn").classList.toggle("active", s.today);
  $("#streakBtn").title = s.today ? `${s.days}-day streak!` : "Study or add a word today to keep your streak";
}

function renderRecap() {
  const box = $("#recap");
  const sum = weekSummary();
  const weekId = dayKey(sum.start);
  if (!sum.added && !sum.mastered && !sum.reviews || localStorage.getItem(RECAP_KEY) === weekId) {
    box.hidden = true;
    return;
  }
  const detail = Object.entries(sum.perPerson)
    .filter(([n]) => n && n !== "someone")
    .map(([n, p]) => `${n}: +${p.added} added, ${p.mastered} mastered`)
    .join(" · ");
  box.replaceChildren(
    el("h3", {}, "This week · 이번 주"),
    el("p", {}, `${coupleName()} added ${sum.added} word${sum.added === 1 ? "" : "s"}, mastered ${sum.mastered} this week ${sum.mastered ? "🎉" : "💪"}`),
    el("p", { class: "muted" }, detail || `${sum.reviews} flashcards reviewed`),
    el("button", {
      class: "icon-btn",
      "aria-label": "Hide this week's recap",
      onclick: () => { localStorage.setItem(RECAP_KEY, weekId); renderRecap(); },
    }, "✕"),
  );
  box.hidden = false;
}

function renderWord(w) {
  const L = LANG[w.lang];
  const mine = myName && w.addedBy === myName;
  const reactions = Object.entries(w.reactions || {});
  const myReaction = w.reactions?.[myName];

  return el("li", { class: "word", dataset: { lang: w.lang } },
    el("div", { class: "word-body" },
      el("div", { class: "word-head" },
        el("span", { class: "word-flag", title: L.label, "aria-label": L.label }, L.flag),
        el("p", { class: "word-term", lang: w.lang }, w.term),
        speakBtn(w.term, w.lang),
      ),
      w.pronunciation ? el("div", { class: "word-pron" }, `[${w.pronunciation}]`) : null,
      el("p", { class: "word-meaning", lang: other(w.lang) }, w.meaning),
      w.example
        ? el("p", { class: "word-example", lang: w.lang }, el("span", {}, w.example), speakBtn(w.example, w.lang, "example sentence"))
        : null,
      w.tags.length
        ? el("div", { class: "tags" }, w.tags.map((t) => el("button", { class: "tag", onclick: () => setTag(t) }, `#${t}`)))
        : null,
      el("div", { class: "word-meta" },
        el("span", {}, `${w.addedBy || "someone"} · ${timeAgo(w.createdAt)}`),
        w.learned
          ? el("span", {}, `✓ ${w.learnedBy || "learned"}`)
          : w.srs.reviews
            ? el("span", { class: "mastery", title: `${w.srs.streak}/${MASTER_STREAK} correct in a row` },
                Array.from({ length: MASTER_STREAK }, (_, i) => el("i", { class: i < w.srs.streak ? "on" : "" })))
            : null,
      ),
    ),
    el("div", { class: "word-side" },
      el("button", {
        class: "learn-btn",
        "aria-pressed": String(!!w.learned),
        "aria-label": w.learned ? `Mark "${w.term}" as not learned` : `Mark "${w.term}" as learned`,
        onclick: () => run(api("POST", `/api/words/${w.id}/learned`, { learned: !w.learned }), "update"),
      }, el("span", { class: "check", "aria-hidden": "true" }, w.learned ? "✅" : "⬜"), w.learned ? "Learned" : "Learn", el("br"), w.learned ? "외움" : "외우기"),
    ),
    el("div", { class: "word-foot" },
      el("div", { class: "reactions" },
        reactions.map(([who, emoji]) =>
          el("span", { class: `reaction${who === myName ? " mine" : ""}`, title: `${who} reacted ${emoji}` }, el("b", {}, emoji), who)),
      ),
      el("div", { class: "actions" },
        !mine
          ? el("button", {
              class: "act",
              "aria-label": "React to this word",
              "aria-expanded": String(pickerFor === w.id),
              onclick: () => {
                if (!myName) return openNameDialog("Set your name so your partner sees who reacted.");
                pickerFor = pickerFor === w.id ? null : w.id;
                render();
              },
            }, myReaction || "☺︎")
          : null,
        el("button", { class: "act", "aria-label": `Edit "${w.term}"`, onclick: () => openWordDialog(w) }, "✏️"),
        el("button", { class: "act", "aria-label": `Delete "${w.term}"`, onclick: () => removeWord(w) }, "🗑️"),
      ),
    ),
    pickerFor === w.id
      ? el("div", { class: "picker", role: "group", "aria-label": "Pick a reaction" },
          REACTIONS.map((emoji) =>
            el("button", {
              "aria-pressed": String(myReaction === emoji),
              "aria-label": `React ${emoji}`,
              onclick: () => {
                pickerFor = null;
                render();
                run(api("POST", `/api/words/${w.id}/react`, { emoji }), "react");
              },
            }, emoji)))
      : null,
  );
}

async function removeWord(w) {
  if (!confirm(`Delete "${w.term}" for both of you?\n"${w.term}"을(를) 삭제할까요?`)) return;
  await run(api("DELETE", `/api/words/${w.id}`).then(() => toast("Deleted · 삭제됨")), "delete");
}

// ---------- Tabs ----------
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    filter = tab.dataset.filter;
    document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
    render();
  });
});

// ---------- Dialog helpers ----------
document.querySelectorAll("dialog").forEach((d) => {
  d.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => d.close()));
  d.addEventListener("click", (e) => { if (e.target === d && d.classList.contains("sheet")) d.close(); });
  d.addEventListener("close", () => { if ($("#toast").parentElement === d) document.body.append($("#toast")); });
});

// ---------- Name ----------
function updateNameLabel() {
  $("#nameLabel").textContent = myName || "Name";
}

function openNameDialog(hint) {
  $("#nameForm").elements.name.value = myName;
  $("#nameDialog").showModal();
  if (typeof hint === "string") toast(hint);
}
$("#nameBtn").addEventListener("click", () => openNameDialog());

$("#nameForm").addEventListener("submit", () => {
  myName = $("#nameForm").elements.name.value.trim().slice(0, 40);
  localStorage.setItem(NAME_KEY, myName);
  updateNameLabel();
  render();
  if (myName) toast(`Hi, ${myName}! 👋`);
});

// ---------- Add / edit word ----------
const form = $("#wordForm");
const wordDialog = $("#wordDialog");
let editing = null;

function parseTags(s) {
  return [...new Set(s.split(/[,，、\n]/).map((t) => t.trim().toLowerCase().replace(/^#+/, "").replace(/\s+/g, "-")).filter(Boolean))].slice(0, 8);
}

function renderTagSuggest() {
  const current = parseTags(form.tags.value);
  const names = [...new Set([...allTags().map(([t]) => t), ...PRESET_TAGS])].slice(0, 14);
  $("#tagSuggest").replaceChildren(...names.map((t) =>
    el("button", {
      type: "button",
      class: "chip",
      "aria-pressed": String(current.includes(t)),
      onclick: () => {
        const tags = parseTags(form.tags.value);
        form.tags.value = (tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t]).join(", ");
        renderTagSuggest();
      },
    }, `#${t}`)));
}
form.tags.addEventListener("input", renderTagSuggest);

function updatePronPlaceholder() {
  form.pronunciation.placeholder = LANG[form.elements.lang.value].pron;
}
form.querySelectorAll('[name="lang"]').forEach((r) => r.addEventListener("change", updatePronPlaceholder));

function openWordDialog(w = null) {
  editing = w;
  $("#wordError").hidden = true;
  $("#wordDialogTitle").textContent = w ? "Edit word · 단어 수정" : "Add a word · 단어 추가";
  form.term.value = w?.term || "";
  form.meaning.value = w?.meaning || "";
  form.pronunciation.value = w?.pronunciation || "";
  form.example.value = w?.example || "";
  form.tags.value = w ? w.tags.join(", ") : tagFilter;
  const lang = w?.lang || (filter === "en" ? "en" : filter === "ko" ? "ko" : form.elements.lang.value);
  form.querySelector(`[name="lang"][value="${lang}"]`).checked = true;
  updatePronPlaceholder();
  renderTagSuggest();
  wordDialog.showModal();
  if (!w) form.term.focus();
}

$("#addBtn").addEventListener("click", () => openWordDialog());
$("#emptyAdd").addEventListener("click", () => openWordDialog());

// Korean IME: Enter while composing a syllable must not submit or jump fields.
form.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.target.tagName === "TEXTAREA" || e.target.type === "submit") return;
  e.preventDefault();
  if (e.isComposing || e.keyCode === 229) return;
  const order = [form.term, form.meaning, form.pronunciation, form.example, form.tags];
  const i = order.indexOf(e.target);
  if (i >= 0 && i < order.length - 1) order[i + 1].focus();
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {
    term: form.term.value.trim(),
    meaning: form.meaning.value.trim(),
    pronunciation: form.pronunciation.value.trim(),
    example: form.example.value.trim(),
    lang: form.elements.lang.value,
    tags: parseTags(form.tags.value),
  };
  if (!body.term || !body.meaning) {
    $("#wordError").textContent = "Please fill in the word and its meaning. · 단어와 뜻을 입력해 주세요.";
    $("#wordError").hidden = false;
    return;
  }

  const btn = $("#wordSubmit");
  btn.disabled = true;
  try {
    if (editing) await api("PUT", `/api/words/${editing.id}`, body);
    else await api("POST", "/api/words", body);
  } catch (err) {
    $("#wordError").textContent = "Couldn't save: " + err.message;
    $("#wordError").hidden = false;
    return;
  } finally {
    btn.disabled = false;
  }
  wordDialog.close();
  toast(editing ? "Saved · 저장됨" : `Added “${body.term}” · 추가됨`);
  if (!myName) setTimeout(() => toast("Tip: tap 👤 to set your name"), 2600);
});

// ---------- Share ----------
$("#shareBtn").addEventListener("click", async () => {
  const url = `${location.origin}/#k=${accessKey}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: "Our Vocab Notebook · 우리 단어장", text: "Our shared word list 📒", url });
      return;
    } catch (err) {
      if (err.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast("Link copied — send it to your partner! · 링크 복사됨");
  } catch {
    prompt("Copy this link and send it to your partner:", url);
  }
});

// ---------- Quiz (spaced repetition) ----------
// Each session draws up to SESSION_SIZE cards by weighted random sampling:
// words that are due and missed often weigh more; words on a correct streak
// weigh less, and after MASTER_STREAK in a row they're learned and leave the
// rotation (the server handles scheduling + mastery on each review).
const quizDialog = $("#quizDialog");
let deck = [];
let current = null;
let revealed = false;
let session = { total: 0, known: 0, missed: 0, reviewLearned: false, scope: "" };

function weight(w, now) {
  const s = w.srs;
  const due = !s.due || new Date(s.due).getTime() <= now;
  const neverSeen = s.reviews === 0;
  return (due ? 1 : 0.15) * (neverSeen ? 1.5 : 1) * (1 + 1.5 * Math.min(s.misses, 6)) / (1 + s.streak) ** 1.5;
}

function buildDeck(reviewLearned = false) {
  const learnedTab = filter === "learned";
  reviewLearned = reviewLearned || learnedTab;
  const langFilter = learnedTab ? "all" : filter;
  const pool = words.filter((w) => matches(w, langFilter, tagFilter) && (reviewLearned ? w.learned : !w.learned));
  const now = Date.now();
  // Efraimidis–Spirakis weighted sampling without replacement.
  deck = pool
    .map((w) => ({ id: w.id, k: Math.random() ** (1 / weight(w, now)) }))
    .sort((a, b) => b.k - a.k)
    .slice(0, SESSION_SIZE)
    .map((x) => x.id);
  const scope = [reviewLearned ? "Review 복습" : FILTER_LABEL[langFilter], tagFilter && `#${tagFilter}`].filter(Boolean).join(" · ");
  session = { total: deck.length, known: 0, missed: 0, reviewLearned, scope };
}

function startQuiz(reviewLearned = false) {
  buildDeck(reviewLearned);
  if (!quizDialog.open) quizDialog.showModal();
  nextCard();
}

function nextCard() {
  revealed = false;
  while (deck.length && !words.some((w) => w.id === deck[0])) deck.shift(); // skip deleted
  current = deck[0] ?? null;
  refreshQuizCard();
}

function refreshQuizCard() {
  const w = words.find((x) => x.id === current);
  const done = !w;

  $("#quizCard").hidden = done;
  $("#quizDone").hidden = !done;
  $("#revealBtn").hidden = done || revealed;
  $("#gradeBtns").hidden = done || !revealed;
  $("#doneBtns").hidden = !done;
  $("#quizMeta").textContent = `${session.scope} · ${session.known}/${session.total} known · ${deck.length} left`;
  $("#quizProgress").style.width = session.total ? `${(session.known / session.total) * 100}%` : "0";

  if (done) {
    const learnedCount = words.filter((x) => x.learned && matches(x, filter === "learned" ? "all" : filter, tagFilter)).length;
    $("#reviewLearnedBtn").hidden = session.reviewLearned || learnedCount === 0;
    $("#quizDoneText").textContent =
      words.length === 0
        ? "Add some words first, then come back to practise! · 먼저 단어를 추가해 주세요."
        : session.total === 0
          ? session.reviewLearned
            ? "No learned words in this set yet. · 아직 외운 단어가 없어요."
            : "Everything here is learned! 🎓 Review learned words, or pick another tab/tag."
          : `Session done! ${session.known} known, ${session.missed} to practise again. 잘했어요!`;
    return;
  }

  const L = LANG[w.lang];
  $("#quizLang").className = `badge ${w.lang}`;
  $("#quizLang").textContent = `${L.flag} ${L.label}`;
  $("#quizTerm").textContent = w.term;
  $("#quizTerm").lang = w.lang;
  $("#quizPron").textContent = w.pronunciation ? `[${w.pronunciation}]` : "";
  $("#quizPron").hidden = !w.pronunciation;
  $("#quizHint").hidden = revealed;
  $("#quizMeaning").textContent = w.meaning;
  $("#quizExample").textContent = w.example || "";
  $("#quizExample").hidden = !w.example;
  const s = w.srs;
  $("#quizSrs").textContent = s.reviews
    ? `Streak ${s.streak}/${MASTER_STREAK} · missed ${s.misses}× · reviewed ${s.reviews}×`
    : "New word · 새 단어";
  $("#quizAnswer").hidden = !revealed;
}

function reveal() {
  if (!current || revealed) return;
  revealed = true;
  refreshQuizCard();
}

function grade(correct) {
  const w = words.find((x) => x.id === current);
  if (!w) return nextCard();
  run(api("POST", `/api/words/${w.id}/review`, { correct }), "save review");
  deck.shift();
  if (correct) {
    session.known++;
    if (w.srs.streak + 1 >= MASTER_STREAK && !w.learned) toast(`🎓 Mastered “${w.term}”!`);
  } else {
    session.missed++;
    // Missed cards come back a few cards later in the same session.
    deck.splice(Math.min(3, deck.length), 0, w.id);
  }
  nextCard();
}

$("#quizBtn").addEventListener("click", () => startQuiz());
$("#revealBtn").addEventListener("click", reveal);
$("#quizCard").addEventListener("click", reveal);
$("#quizSpeak").addEventListener("click", (e) => {
  e.stopPropagation();
  const w = words.find((x) => x.id === current);
  if (w) speak(w.term, w.lang);
});
$("#knowBtn").addEventListener("click", () => grade(true));
$("#againBtn").addEventListener("click", () => grade(false));
$("#restartBtn").addEventListener("click", () => startQuiz(session.reviewLearned));
$("#reviewLearnedBtn").addEventListener("click", () => startQuiz(true));

// ---------- Stats ----------
function renderStats() {
  const s = streakFor();
  const sum = weekSummary();
  const ps = people();
  const learned = words.filter((w) => w.learned).length;
  let reviews = 0, correct = 0;
  const perPerson = Object.fromEntries(ps.map((p) => [p, { added: 0, learned: 0, reviews: 0, reactions: 0 }]));
  for (const w of words) {
    if (perPerson[w.addedBy]) perPerson[w.addedBy].added++;
    if (w.learned && perPerson[w.learnedBy]) perPerson[w.learnedBy].learned++;
  }
  for (const day of Object.values(activity)) {
    for (const [n, p] of Object.entries(day)) {
      reviews += p.reviews || 0;
      correct += p.correct || 0;
      if (perPerson[n]) {
        perPerson[n].reviews += p.reviews || 0;
        perPerson[n].reactions += p.reactions || 0;
      }
    }
  }
  const tile = (n, label) => el("div", { class: "tile" }, el("strong", {}, String(n)), el("span", {}, label));
  const tags = allTags();
  const maxTag = tags[0]?.[1] || 1;
  const tricky = words.filter((w) => w.srs.misses > 0).sort((a, b) => b.srs.misses - a.srs.misses).slice(0, 5);
  const dayNames = ["M", "T", "W", "T", "F", "S", "S"];

  $("#statsBody").replaceChildren(
    el("div", { class: "stat-hero" },
      el("span", { class: "big", "aria-hidden": "true" }, s.today ? "🔥" : "🕯️"),
      el("div", {},
        el("strong", {}, `${s.days}-day streak`),
        el("p", { class: "muted" }, s.today
          ? todayMessage(ps)
          : s.days ? "Add or study a word today to keep it going! 오늘도 이어가요!" : "Add or study a word to start a streak. 오늘 시작해요!"),
        ps.length ? el("p", { class: "muted" }, ps.map((p) => `${p}: ${streakFor(p).days}d`).join(" · ")) : null,
      ),
    ),

    el("section", { class: "panel" },
      el("h3", {}, "Weekly recap · 주간 요약"),
      el("p", {}, `${coupleName()} added ${sum.added} word${sum.added === 1 ? "" : "s"}, mastered ${sum.mastered} this week.${sum.mastered ? " 🎉" : ""}`),
      el("p", { class: "muted", style: "margin-top:4px" },
        `${sum.reviews} flashcards reviewed${sum.reviews ? ` · ${Math.round((sum.correct / sum.reviews) * 100)}% correct` : ""}`),
      el("div", { class: "week-days", style: "margin-top:12px" },
        sum.activeDays.map((on, i) => el("div", {}, dayNames[i], el("i", { class: on ? "on" : "" }, on ? "✓" : "")))),
    ),

    el("div", { class: "tiles" },
      tile(words.length, "Total words · 전체"),
      tile(learned, "Learned · 외움"),
      tile(reviews ? `${Math.round((correct / reviews) * 100)}%` : "–", "Quiz accuracy · 정답률"),
      tile(words.filter((w) => w.lang === "ko").length, "🇰🇷 Korean 한국어"),
      tile(words.filter((w) => w.lang === "en").length, "🇺🇸 English 영어"),
      tile(reviews, "Reviews · 복습"),
    ),

    ps.length
      ? el("section", { class: "panel" },
          el("h3", {}, "By person · 사람별"),
          el("table", { class: "people" },
            el("thead", {}, el("tr", {}, el("th", {}, "Name"), el("th", {}, "Added"), el("th", {}, "Learned"), el("th", {}, "Reviews"), el("th", {}, "Reacts"))),
            el("tbody", {}, ps.map((p) =>
              el("tr", {}, el("td", { style: p === myName ? "font-weight:700" : null }, p),
                el("td", {}, String(perPerson[p].added)), el("td", {}, String(perPerson[p].learned)),
                el("td", {}, String(perPerson[p].reviews)), el("td", {}, String(perPerson[p].reactions))))),
          ),
        )
      : null,

    tags.length
      ? el("section", { class: "panel" },
          el("h3", {}, "Tags · 태그 (tap to study)"),
          el("div", { class: "bars" }, tags.slice(0, 10).map(([t, n]) =>
            el("button", {
              class: "bar-row",
              onclick: () => { $("#statsDialog").close(); tagFilter = t; render(); startQuiz(); },
            }, el("span", {}, `#${t}`), el("div", { class: "bar" }, el("i", { style: `width:${(n / maxTag) * 100}%` })), el("b", {}, String(n))))),
        )
      : null,

    tricky.length
      ? el("section", { class: "panel" },
          el("h3", {}, "Trickiest words · 어려운 단어"),
          el("ul", { class: "tricky" }, tricky.map((w) =>
            el("li", {}, el("span", {}, `${LANG[w.lang].flag} ${w.term} — ${w.meaning}`), el("span", {}, `missed ${w.srs.misses}×`)))),
        )
      : null,
  );
}

function todayMessage(ps) {
  const done = ps.filter((p) => activity[dayKey()]?.[p]);
  const waiting = ps.filter((p) => !done.includes(p));
  if (ps.length > 1 && waiting.length === 0) return "You both showed up today. 오늘 둘 다 공부했어요!";
  if (done.length && waiting.length) return `${done.join(" & ")} studied today — your turn, ${waiting.join(" & ")}! 다음은 당신 차례!`;
  return "Streak kept for today. 오늘도 잘했어요!";
}

function openStats() {
  renderStats();
  $("#statsDialog").showModal();
}
$("#statsBtn").addEventListener("click", openStats);
$("#streakBtn").addEventListener("click", openStats);

// ---------- Go ----------
updateNameLabel();
if (!accessKey) {
  showLocked();
} else {
  connect();
  setInterval(render, 60_000); // keep "x minutes ago" and streak fresh
  if (!myName) setTimeout(() => openNameDialog(), 400);
}
