(() => {
  "use strict";
  const BANK = window.QUESTION_BANK || { lectures: [], questions: [] };
  const LEC = Object.fromEntries(BANK.lectures.map(l => [l.slug, l]));
  const TYPE_LABEL = { mcq: "Multiple choice", fill: "Fill in the blank", short: "Short answer" };
  const STORE_KEY = "mi-quiz-v1";
  const $ = id => document.getElementById(id);

  // ---------- storage ----------
  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch {}
  }
  const store = Object.assign({ stats: {}, history: [], theme: null }, load());
  // stats[id] = { seen, correct, lastWrong }

  if (store.theme) document.documentElement.dataset.theme = store.theme;
  $("themeBtn").onclick = () => {
    const dark = store.theme ? store.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    store.theme = dark ? "light" : "dark";
    document.documentElement.dataset.theme = store.theme;
    save();
  };

  // ---------- home ----------
  let exam = "midterm";
  let count = 30;

  function lecturesFor(ex) { return BANK.lectures.filter(l => l.exam === ex); }

  function renderHome() {
    document.querySelectorAll("#examSeg button").forEach(b => {
      b.classList.toggle("active", b.dataset.exam === exam);
      b.disabled = lecturesFor(b.dataset.exam).length === 0;
      if (b.disabled) b.title = "No questions available yet";
    });
    const list = $("lectureList");
    const lecs = lecturesFor(exam);
    list.innerHTML = lecs.length ? "" : '<p class="muted">No questions for this exam yet.</p>';
    for (const l of lecs) {
      const lab = document.createElement("label");
      lab.innerHTML = `<input type="checkbox" value="${l.slug}" checked><span class="wk">Week ${l.week}</span><span>${esc(l.title)}</span><span class="count">${l.count} Qs</span>`;
      list.appendChild(lab);
    }
    list.querySelectorAll("input").forEach(i => i.onchange = updatePoolInfo);
    updatePoolInfo();
    renderHistory();
  }

  function selectedLectures() { return [...$("lectureList").querySelectorAll("input:checked")].map(i => i.value); }
  function selectedTypes() { return [...$("typeList").querySelectorAll("input:checked")].map(i => i.value); }
  function pool() {
    const ls = new Set(selectedLectures()), ts = new Set(selectedTypes());
    return BANK.questions.filter(q => ls.has(q.lecture) && ts.has(q.type));
  }
  function wrongPool() {
    const ex = new Set(lecturesFor(exam).map(l => l.slug));
    return BANK.questions.filter(q => ex.has(q.lecture) && store.stats[q.id]?.lastWrong);
  }
  function updatePoolInfo() {
    const p = pool();
    $("poolInfo").textContent = `${p.length} questions match your selection.`;
    $("startBtn").disabled = p.length === 0;
    const w = wrongPool().length;
    $("wrongCount").textContent = w;
    $("wrongBtn").disabled = w === 0;
  }

  $("examSeg").onclick = e => {
    const b = e.target.closest("button"); if (!b || b.disabled) return;
    exam = b.dataset.exam; renderHome();
  };
  $("countSeg").onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    count = b.dataset.n === "all" ? Infinity : +b.dataset.n;
    document.querySelectorAll("#countSeg button").forEach(x => x.classList.toggle("active", x === b));
  };
  $("typeList").onchange = updatePoolInfo;
  $("selAll").onclick = e => { e.preventDefault(); $("lectureList").querySelectorAll("input").forEach(i => i.checked = true); updatePoolInfo(); };
  $("selNone").onclick = e => { e.preventDefault(); $("lectureList").querySelectorAll("input").forEach(i => i.checked = false); updatePoolInfo(); };
  $("homeLink").onclick = e => { e.preventDefault(); if (!quiz || quiz.done || confirm("Quit the current round?")) show("home"); };
  $("startBtn").onclick = () => startQuiz(pick(pool(), count, $("preferUnseen").checked));
  $("wrongBtn").onclick = () => startQuiz(shuffle(wrongPool()).slice(0, count));
  $("resetBtn").onclick = () => {
    if (!confirm("Delete all history and stats?")) return;
    store.stats = {}; store.history = []; save(); renderHome();
  };

  function renderHistory() {
    const ids = new Set(BANK.questions.map(q => q.id));
    const seen = Object.keys(store.stats).filter(id => ids.has(id)).length;
    const wrong = Object.entries(store.stats).filter(([id, s]) => ids.has(id) && s.lastWrong).length;
    const last = store.history.slice(-10);
    const avg = last.length ? Math.round(last.reduce((a, h) => a + h.pct, 0) / last.length) : null;
    $("stats").innerHTML =
      stat(`${seen}/${BANK.questions.length}`, "questions seen") +
      stat(wrong, "currently wrong") +
      stat(avg === null ? "–" : avg + "%", "avg. of last 10 rounds");
    $("history").innerHTML = store.history.slice(-8).reverse().map(h =>
      `<li>${new Date(h.t).toLocaleString("en-GB")} — <b>${h.pct}%</b> (${fmt(h.score)}/${h.n})</li>`).join("")
      || '<li class="muted">No rounds yet.</li>';
  }
  const stat = (v, l) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`;

  // ---------- picking ----------
  function shuffle(a) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function pick(p, n, prefer) {
    if (!prefer) return shuffle(p).slice(0, n);
    // weight: unseen & wrong first, then by fewest views; random within ties
    const w = q => {
      const s = store.stats[q.id];
      if (!s) return 0;
      if (s.lastWrong) return 1;
      return 2 + s.seen;
    };
    return shuffle(p).map(q => [w(q) + Math.random() * 1.5, q]).sort((a, b) => a[0] - b[0]).slice(0, n).map(x => x[1]);
  }

  // ---------- quiz ----------
  let quiz = null; // {items:[{q, order, resp, score(null|0|0.5|1), checked}], i, done}

  function startQuiz(qs) {
    if (!qs.length) return;
    quiz = {
      done: false, i: 0,
      items: shuffle(qs).map(q => ({ q, order: q.type === "mcq" ? shuffle(q.options.map((_, k) => k)) : null, resp: null, score: null, checked: false })),
    };
    show("quiz"); renderQ();
  }

  function renderQ() {
    const it = quiz.items[quiz.i], q = it.q, n = quiz.items.length;
    $("qCounter").textContent = `Question ${quiz.i + 1}/${n}`;
    const answered = quiz.items.filter(x => x.checked).length;
    const sc = quiz.items.reduce((a, x) => a + (x.score || 0), 0);
    $("qScore").textContent = `Correct ${fmt(sc)}/${answered}`;
    $("progressBar").style.width = (answered / n * 100) + "%";
    $("dots").innerHTML = quiz.items.map((x, k) =>
      `<button data-k="${k}" class="${k === quiz.i ? "cur " : ""}${x.checked ? cls(x.score) : ""}">${k + 1}</button>`).join("");
    $("qType").textContent = TYPE_LABEL[q.type];
    $("qLecture").textContent = `Week ${LEC[q.lecture]?.week} · ${LEC[q.lecture]?.title}`;
    $("qText").textContent = q.q;

    const body = $("qBody"); body.innerHTML = "";
    if (q.type === "mcq") {
      const box = document.createElement("div"); box.className = "options";
      it.order.forEach((orig, k) => {
        const b = document.createElement("button");
        b.className = "opt"; b.dataset.orig = orig;
        b.innerHTML = `<span class="letter">${"ABCDEFG"[k]}</span><span>${esc(q.options[orig])}</span>`;
        if (it.resp === orig) b.classList.add("sel");
        if (it.checked) {
          b.disabled = true;
          if (orig === q.answer) b.classList.add("correct");
          else if (orig === it.resp) b.classList.add("wrong");
        }
        b.onclick = () => { it.resp = orig; check(); };
        box.appendChild(b);
      });
      body.appendChild(box);
    } else if (q.type === "fill") {
      const inp = document.createElement("input");
      inp.type = "text"; inp.placeholder = "Type your answer and press Enter…"; inp.value = it.resp || "";
      inp.disabled = it.checked; inp.autocomplete = "off"; inp.spellcheck = false;
      inp.oninput = () => it.resp = inp.value;
      inp.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); it.checked ? next() : check(); } };
      body.appendChild(inp);
      if (!it.checked) setTimeout(() => inp.focus(), 0);
    } else {
      const ta = document.createElement("textarea");
      ta.placeholder = "Write a short answer (bullet points are fine), then click 'Show answer' and grade yourself."; ta.value = it.resp || "";
      ta.disabled = it.checked && it.score !== null;
      ta.oninput = () => it.resp = ta.value;
      body.appendChild(ta);
    }
    renderFeedback();

    $("prevBtn").disabled = quiz.i === 0;
    $("checkBtn").textContent = q.type === "short" ? "Show answer" : "Check";
    $("checkBtn").classList.toggle("hidden", it.checked || q.type === "mcq");
    $("nextBtn").classList.toggle("hidden", !(it.checked || q.type === "mcq"));
    $("nextBtn").textContent = quiz.i === n - 1 ? "See results" : "Next →";
    $("nextBtn").disabled = q.type === "short" && it.checked && it.score === null;
  }

  function renderFeedback() {
    const it = quiz.items[quiz.i], q = it.q, fb = $("feedback");
    if (!it.checked) { fb.className = "feedback hidden"; fb.innerHTML = ""; return; }
    const expl = q.explanation ? `<div class="muted small" style="margin-top:6px">${esc(q.explanation)}</div>` : "";
    if (q.type === "mcq") {
      fb.className = "feedback " + cls(it.score);
      fb.innerHTML = `<div class="verdict">${it.score ? "✓ Correct" : "✗ Wrong — answer: " + esc(q.options[q.answer])}</div>${expl}`;
    } else if (q.type === "fill") {
      fb.className = "feedback " + cls(it.score);
      fb.innerHTML = `<div class="verdict">${it.score ? "✓ Correct" : "✗ Not quite"}</div>
        <div>Answer: <b>${esc(q.answer[0])}</b>${q.answer.length > 1 ? ` <span class="muted small">(also accepted: ${q.answer.slice(1).map(esc).join(", ")})</span>` : ""}</div>${expl}
        ${it.score ? "" : `<div class="selfgrade"><button class="btn small" id="overrideBtn">Mark mine as correct</button></div>`}`;
      const ob = $("overrideBtn");
      if (ob) ob.onclick = () => { grade(1); };
    } else {
      const text = norm(it.resp || "");
      const kws = (q.keywords || []).map(k => `<span class="kw ${text.includes(norm(k)) ? "hit" : ""}">${esc(k)}</span>`).join("");
      fb.className = "feedback " + (it.score === null ? "" : cls(it.score));
      fb.innerHTML = `<div class="verdict">Model answer</div><div class="model">${esc(q.answer)}</div>
        ${kws ? `<div style="margin-top:8px"><span class="muted small">Key points (green = mentioned in your answer): </span>${kws}</div>` : ""}${expl}
        <div class="selfgrade">${it.score === null ? '<span class="muted small" style="align-self:center">Self-grade:</span>' : ""}
          <button class="btn small" data-g="1">✓ Correct</button>
          <button class="btn small" data-g="0.5">½ Partial</button>
          <button class="btn small" data-g="0">✗ Wrong</button></div>`;
      fb.querySelectorAll("[data-g]").forEach(b => {
        if (it.score !== null && +b.dataset.g === it.score) b.classList.add("primary");
        b.onclick = () => grade(+b.dataset.g);
      });
    }
  }

  function check() {
    const it = quiz.items[quiz.i], q = it.q;
    if (it.checked) return;
    if (q.type === "mcq") {
      it.checked = true; record(it, it.resp === q.answer ? 1 : 0);
    } else if (q.type === "fill") {
      if (!(it.resp || "").trim()) return;
      const r = norm(it.resp);
      const ok = q.answer.some(a => { const n = norm(a); return n === r || (n.length > 4 && lev(n, r) <= Math.floor(n.length / 8)); });
      it.checked = true; record(it, ok ? 1 : 0);
    } else {
      it.checked = true; // wait for self grade
    }
    renderQ();
  }

  function grade(g) {
    const it = quiz.items[quiz.i];
    record(it, g);
    renderQ();
  }

  function record(it, score) {
    const prev = it.score;
    it.score = score;
    const s = store.stats[it.q.id] || { seen: 0, correct: 0 };
    if (prev === null) s.seen++;
    s.correct = (s.correct || 0) - (prev === 1 ? 1 : 0) + (score === 1 ? 1 : 0);
    s.lastWrong = score < 1;
    store.stats[it.q.id] = s; save();
  }

  function next() {
    if (quiz.i < quiz.items.length - 1) { quiz.i++; renderQ(); window.scrollTo(0, 0); }
    else finish();
  }
  $("nextBtn").onclick = next;
  $("prevBtn").onclick = () => { if (quiz.i > 0) { quiz.i--; renderQ(); } };
  $("checkBtn").onclick = check;
  $("dots").onclick = e => { const b = e.target.closest("button"); if (b) { quiz.i = +b.dataset.k; renderQ(); } };
  $("finishBtn").onclick = () => {
    const left = quiz.items.filter(x => !x.checked || x.score === null).length;
    if (left && !confirm(`${left} question(s) unanswered/ungraded (counted as wrong). Finish anyway?`)) return;
    finish();
  };

  document.addEventListener("keydown", e => {
    if ($("quiz").classList.contains("hidden") || e.target.matches("input,textarea")) return;
    const it = quiz.items[quiz.i];
    if (it.q.type === "mcq" && !it.checked && /^[1-4a-dA-D]$/.test(e.key)) {
      const k = /\d/.test(e.key) ? +e.key - 1 : "abcd".indexOf(e.key.toLowerCase());
      if (it.order[k] !== undefined) { it.resp = it.order[k]; check(); }
    } else if (e.key === "Enter" || e.key === "ArrowRight") { if (!$("nextBtn").classList.contains("hidden") && !$("nextBtn").disabled) next(); }
    else if (e.key === "ArrowLeft") $("prevBtn").click();
  });

  // ---------- result ----------
  function finish() {
    quiz.done = true;
    const items = quiz.items;
    items.forEach(x => { if (x.score === null) x.score = 0; });
    const score = items.reduce((a, x) => a + x.score, 0), n = items.length;
    const pct = Math.round(score / n * 100);
    store.history.push({ t: Date.now(), score, n, pct, exam }); store.history = store.history.slice(-100); save();

    $("bigScore").textContent = pct + "%";
    $("scoreLine").textContent = `${fmt(score)} / ${n} correct`;
    $("retryWrongBtn").disabled = !items.some(x => x.score < 1);

    const by = {};
    for (const x of items) { const b = by[x.q.lecture] ||= { s: 0, n: 0 }; b.s += x.score; b.n++; }
    $("byLecture").innerHTML = Object.entries(by).sort((a, b) => LEC[a[0]].week - LEC[b[0]].week).map(([slug, b]) => {
      const p = Math.round(b.s / b.n * 100);
      return `<div class="lec-row"><div>Week ${LEC[slug].week} · ${esc(LEC[slug].title)}<div class="bar"><div style="width:${p}%"></div></div></div><div class="muted">${fmt(b.s)}/${b.n}</div></div>`;
    }).join("");

    $("review").innerHTML = items.map((x, k) => {
      const q = x.q;
      let your = "", right = "";
      if (q.type === "mcq") { your = x.resp == null ? "(blank)" : q.options[x.resp]; right = q.options[q.answer]; }
      else if (q.type === "fill") { your = x.resp || "(blank)"; right = q.answer.join(" / "); }
      else { your = x.resp || "(blank)"; right = q.answer; }
      const mk = x.score === 1 ? ["ok", "✓"] : x.score === 0.5 ? ["part", "½"] : ["bad", "✗"];
      return `<div class="rv"><div class="rv-q"><span class="mark ${mk[0]}">${mk[1]}</span>${k + 1}. ${esc(q.q)}</div>
        ${x.score < 1 ? `<div class="rv-a muted">Yours: ${esc(your)}</div>` : ""}
        <div class="rv-a">Answer: <b>${esc(right)}</b></div>
        ${q.explanation ? `<div class="rv-a muted small">${esc(q.explanation)}</div>` : ""}</div>`;
    }).join("");
    show("result");
  }
  $("newBtn").onclick = () => { show("home"); };
  $("backHomeBtn").onclick = () => show("home");
  $("retryWrongBtn").onclick = () => startQuiz(quiz.items.filter(x => x.score < 1).map(x => x.q));

  // ---------- utils ----------
  function show(v) {
    ["home", "quiz", "result"].forEach(id => $(id).classList.toggle("hidden", id !== v));
    if (v === "home") renderHome();
    window.scrollTo(0, 0);
  }
  function cls(s) { return s === 1 ? "ok" : s === 0.5 ? "part" : s === 0 ? "bad" : ""; }
  function fmt(x) { return Number.isInteger(x) ? x : x.toFixed(1); }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function norm(s) {
    return String(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .replace(/[-_/]/g, " ").replace(/[^\p{L}\p{N} ]/gu, "").replace(/\b(the|a|an)\b/g, " ").replace(/\s+/g, " ").trim();
  }
  function lev(a, b) {
    if (Math.abs(a.length - b.length) > 3) return 99;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }

  renderHome();
})();
