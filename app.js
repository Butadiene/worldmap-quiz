/* ================================================================
   世界地図クイズ  —  app logic
   ================================================================ */
(function () {
  "use strict";

  const WORLD_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

  const REGION_LABEL = {
    all: "世界全体", asia: "アジア", europe: "ヨーロッパ", africa: "アフリカ",
    north_america: "北アメリカ", south_america: "南アメリカ", oceania: "オセアニア",
    other: "その他",
  };

  // ---- DOM refs ----
  const $ = (id) => document.getElementById(id);
  const svg = d3.select("#map");
  const els = {
    stage: $("map-stage"), loading: $("loading"), error: $("load-error"),
    retry: $("retry-btn"), setup: $("setup"), start: $("start-btn"),
    result: $("result"), stats: $("stats"), score: $("score"),
    answered: $("answered"), streak: $("streak"), quit: $("quit-btn"),
    progTrack: $("progress-track"), progFill: $("progress-fill"),
    promptBar: $("prompt-bar"), promptKicker: $("prompt-kicker"),
    promptTarget: $("prompt-target"), choices: $("choices"),
    choicesGrid: $("choices-grid"), toast: $("toast"), toastIcon: $("toast-icon"),
    toastText: $("toast-text"), zoomControls: $("zoom-controls"),
    zoomIn: $("zoom-in"), zoomOut: $("zoom-out"), zoomReset: $("zoom-reset"),
    resultNum: $("result-num"), resultDen: $("result-den"), resultPct: $("result-pct"),
    resultReview: $("result-review"), reviewList: $("review-list"),
    resultHome: $("result-home"), resultAgain: $("result-again"),
    offlineBadge: $("offline-badge"),
  };

  // ---- state ----
  const state = {
    features: [],       // renderable GeoJSON features that have Japanese data
    byId: new Map(),    // padded id -> feature
    pool: [],           // {id, ja, region, feature} for current settings
    settings: { mode: "find", region: "all", count: 20 },
    queue: [], idx: 0,
    score: 0, streak: 0, answered: 0, mistakes: [],
    locked: false, fittedFeatures: null,
  };

  let projection, geoPath, zoom, zoomLayer;

  const pad3 = (id) => String(id).padStart(3, "0");
  const dataFor = (id) => window.COUNTRY_DATA[pad3(id)] || null;
  const nameOf = (f) => { const d = dataFor(f.id); return d ? d.ja : (f.properties && f.properties.name) || "???"; };
  const regionOf = (f) => { const d = dataFor(f.id); return d ? d.region : "other"; };
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

  /* ============================================================
     Boot
     ============================================================ */
  function init() {
    wireSetup();
    registerSW();
    updateOnlineBadge();
    window.addEventListener("online", updateOnlineBadge);
    window.addEventListener("offline", updateOnlineBadge);
    loadWorld();
  }

  function updateOnlineBadge() {
    const b = els.offlineBadge;
    if (state.features.length) {
      b.textContent = "● オフライン準備完了";
      b.className = "setup-foot offline";
    } else if (navigator.onLine) {
      b.textContent = "● オンライン — 地図を準備中";
      b.className = "setup-foot online";
    } else {
      b.textContent = "● オフライン — 初回はネット接続が必要です";
      b.className = "setup-foot offline";
    }
  }

  function loadWorld() {
    els.loading.hidden = false;
    els.error.hidden = true;
    fetch(WORLD_URL)
      .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then((topo) => {
        buildFeatures(topo);
        renderMap();
        els.loading.hidden = true;
        updateOnlineBadge();
      })
      .catch((err) => {
        console.error("Map load failed:", err);
        els.loading.hidden = true;
        els.error.hidden = false;
      });
  }

  function buildFeatures(topo) {
    const geo = topojson.feature(topo, topo.objects.countries);
    state.features = [];
    state.byId.clear();
    geo.features.forEach((f) => {
      if (f.id == null) return;
      if (!dataFor(f.id)) return;           // keep only countries we have JP names for
      state.byId.set(pad3(f.id), f);
      state.features.push(f);
    });
  }

  /* ============================================================
     Map rendering
     ============================================================ */
  function renderMap() {
    projection = d3.geoNaturalEarth1();
    geoPath = d3.geoPath(projection);

    svg.selectAll("*").remove();
    zoomLayer = svg.append("g").attr("class", "zoom-layer");

    zoomLayer.selectAll("path.country")
      .data(state.features, (d) => pad3(d.id))
      .join("path")
      .attr("class", "country")
      .attr("data-id", (d) => pad3(d.id))
      .on("click", onCountryClick);

    zoom = d3.zoom()
      .scaleExtent([1, 14])
      .on("zoom", (ev) => zoomLayer.attr("transform", ev.transform));
    svg.call(zoom);

    fitToFeatures(state.features, false);
    window.addEventListener("resize", debounce(() => {
      fitToFeatures(state.fittedFeatures || state.features, false);
    }, 180));

    // zoom buttons
    els.zoomIn.onclick = () => svg.transition().duration(250).call(zoom.scaleBy, 1.6);
    els.zoomOut.onclick = () => svg.transition().duration(250).call(zoom.scaleBy, 1 / 1.6);
    els.zoomReset.onclick = () => fitToFeatures(state.fittedFeatures || state.features, true);
  }

  function fitToFeatures(features, animate) {
    state.fittedFeatures = features;
    const rect = els.stage.getBoundingClientRect();
    const w = rect.width || window.innerWidth;
    const h = rect.height || window.innerHeight;
    const fc = { type: "FeatureCollection", features };
    projection.fitExtent([[20, 20], [w - 20, h - 20]], fc);
    zoomLayer.selectAll("path.country").attr("d", geoPath);
    resetZoom(animate);
  }

  function resetZoom(animate) {
    const sel = animate ? svg.transition().duration(400) : svg;
    sel.call(zoom.transform, d3.zoomIdentity);
  }

  function focusFeature(f) {
    const rect = els.stage.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    const b = geoPath.bounds(f);
    const dx = b[1][0] - b[0][0], dy = b[1][1] - b[0][1];
    const cx = (b[0][0] + b[1][0]) / 2, cy = (b[0][1] + b[1][1]) / 2;
    let scale = 0.55 / Math.max(dx / w, dy / h);
    scale = Math.max(1, Math.min(10, scale));
    const tx = w / 2 - scale * cx, ty = h / 2 - scale * cy;
    svg.transition().duration(650)
      .call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  }

  /* ============================================================
     Setup screen
     ============================================================ */
  function wireSetup() {
    segGroup("mode-seg", "mode", (v) => (state.settings.mode = v));
    chipGroup("region-chips", (v) => (state.settings.region = v));
    segGroup("count-seg", "count", (v) => (state.settings.count = parseInt(v, 10)));

    els.start.onclick = () => {
      if (state.features.length) { startQuiz(); return; }
      if (navigator.onLine) { loadWorld(); }
      else { alert("地図データがまだありません。最初の1回だけ、ネットに接続して開いてください。"); }
    };
    els.retry.onclick = loadWorld;
    els.quit.onclick = () => { if (confirm("クイズをやめて設定に戻りますか？")) showSetup(); };
    els.resultHome.onclick = showSetup;
    els.resultAgain.onclick = startQuiz;
  }

  function segGroup(id, attr, cb) {
    const wrap = $(id);
    wrap.querySelectorAll(".seg-btn").forEach((b) => {
      b.onclick = () => {
        wrap.querySelectorAll(".seg-btn").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        cb(b.dataset[attr]);
      };
    });
  }
  function chipGroup(id, cb) {
    const wrap = $(id);
    wrap.querySelectorAll(".chip").forEach((b) => {
      b.onclick = () => {
        wrap.querySelectorAll(".chip").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        cb(b.dataset.region);
      };
    });
  }

  function showSetup() {
    els.setup.hidden = false;
    els.result.hidden = true;
    els.stats.hidden = true;
    els.progTrack.hidden = true;
    els.promptBar.hidden = true;
    els.choices.hidden = true;
    els.zoomControls.hidden = true;
    clearMapStates();
    if (state.features.length) fitToFeatures(state.features, true);
    updateOnlineBadge();
  }

  /* ============================================================
     Quiz engine
     ============================================================ */
  function buildPool() {
    const r = state.settings.region;
    state.pool = state.features
      .filter((f) => r === "all" || regionOf(f) === r)
      .map((f) => ({ id: pad3(f.id), ja: nameOf(f), region: regionOf(f), feature: f }));
  }

  function startQuiz() {
    buildPool();
    if (state.pool.length < 4) { alert("この地域は問題数が少なすぎます。"); return; }

    const ids = shuffle(state.pool.map((c) => c.id));
    const n = state.settings.count > 0 ? Math.min(state.settings.count, ids.length) : ids.length;
    state.queue = ids.slice(0, n);
    state.idx = 0; state.score = 0; state.streak = 0; state.answered = 0;
    state.mistakes = []; state.locked = false;

    els.setup.hidden = true;
    els.result.hidden = true;
    els.stats.hidden = false;
    els.progTrack.hidden = false;
    els.zoomControls.hidden = false;

    // zoom into region for focused study; whole world when "all"
    const poolFeatures = state.pool.map((c) => c.feature);
    fitToFeatures(state.settings.region === "all" ? state.features : poolFeatures, true);

    updateStats();
    setTimeout(nextQuestion, state.settings.region === "all" ? 100 : 500);
  }

  function currentCountry() {
    const id = state.queue[state.idx];
    return state.pool.find((c) => c.id === id);
  }

  function nextQuestion() {
    if (state.idx >= state.queue.length) { endQuiz(); return; }
    state.locked = false;
    clearMapStates();
    updateProgress();
    const c = currentCountry();
    if (state.settings.mode === "find") askFind(c);
    else askName(c);
  }

  // ---- FIND mode: show a name, tap the country ----
  function askFind(c) {
    els.choices.hidden = true;
    els.promptBar.hidden = false;
    els.promptKicker.textContent = "この国はどこ？";
    els.promptTarget.textContent = c.ja;
    zoomLayer.selectAll("path.country").classed("hoverable", true);
  }

  function onCountryClick(ev, f) {
    if (state.settings.mode !== "find" || state.locked) return;
    state.locked = true;
    const c = currentCountry();
    const clickedId = pad3(f.id);
    const correct = clickedId === c.id;

    zoomLayer.selectAll("path.country").classed("hoverable", false);
    const targetEl = zoomLayer.select(`path[data-id="${c.id}"]`);

    if (correct) {
      targetEl.classed("correct", true);
      scoreCorrect();
      toast("正解！", "ok");
    } else {
      d3.select(ev.currentTarget).classed("wrong", true);
      targetEl.classed("correct", true);   // reveal where it actually was
      scoreWrong(c.ja);
      toast("正解は " + c.ja, "ng");
    }
    advanceAfter(correct ? 900 : 1500);
  }

  // ---- NAME mode: highlight a country, pick its name ----
  function askName(c) {
    els.promptBar.hidden = true;
    els.choices.hidden = false;
    zoomLayer.selectAll("path.country").classed("hoverable", false);

    const targetEl = zoomLayer.select(`path[data-id="${c.id}"]`);
    targetEl.classed("target pulse", true).raise();
    focusFeature(c.feature);

    // build 4 choices: correct + 3 distractors from the same pool
    const others = shuffle(state.pool.filter((x) => x.id !== c.id)).slice(0, 3);
    const opts = shuffle([c, ...others]);

    els.choicesGrid.innerHTML = "";
    opts.forEach((o) => {
      const btn = document.createElement("button");
      btn.className = "choice";
      btn.textContent = o.ja;
      btn.onclick = () => onChoice(o, c, btn);
      els.choicesGrid.appendChild(btn);
    });
  }

  function onChoice(chosen, c, btn) {
    if (state.locked) return;
    state.locked = true;
    const correct = chosen.id === c.id;
    const targetEl = zoomLayer.select(`path[data-id="${c.id}"]`);
    targetEl.classed("target pulse", false);

    els.choicesGrid.querySelectorAll(".choice").forEach((b) => {
      b.disabled = true;
      if (b.textContent === c.ja) b.classList.add("correct");
    });

    if (correct) {
      targetEl.classed("correct", true);
      scoreCorrect();
      toast("正解！", "ok");
    } else {
      btn.classList.add("wrong");
      targetEl.classed("wrong", true);
      scoreWrong(c.ja);
      toast("正解は " + c.ja, "ng");
    }
    advanceAfter(correct ? 900 : 1400);
  }

  /* ============================================================
     Scoring & flow
     ============================================================ */
  function scoreCorrect() { state.score++; state.streak++; state.answered++; updateStats(); }
  function scoreWrong(ja) { state.streak = 0; state.answered++; state.mistakes.push(ja); updateStats(); }

  function advanceAfter(ms) {
    setTimeout(() => { state.idx++; nextQuestion(); }, ms);
  }

  function updateStats() {
    els.score.firstChild.textContent = state.score;
    els.answered.textContent = "/" + state.answered;
    els.streak.textContent = state.streak;
  }
  function updateProgress() {
    const pct = (state.idx / state.queue.length) * 100;
    els.progFill.style.width = pct + "%";
  }

  function clearMapStates() {
    if (!zoomLayer) return;
    zoomLayer.selectAll("path.country")
      .classed("target pulse correct wrong hoverable", false);
  }

  function endQuiz() {
    els.progFill.style.width = "100%";
    els.promptBar.hidden = true;
    els.choices.hidden = true;
    els.stats.hidden = true;
    clearMapStates();

    const total = state.queue.length;
    const pct = total ? Math.round((state.score / total) * 100) : 0;
    els.resultNum.textContent = state.score;
    els.resultDen.textContent = "/ " + total;
    els.resultPct.textContent = "正答率 " + pct + "%";

    if (state.mistakes.length) {
      els.resultReview.hidden = false;
      els.reviewList.innerHTML = "";
      [...new Set(state.mistakes)].forEach((ja) => {
        const s = document.createElement("span");
        s.className = "review-item";
        s.textContent = ja;
        els.reviewList.appendChild(s);
      });
    } else {
      els.resultReview.hidden = true;
    }
    els.result.hidden = false;
  }

  /* ============================================================
     Helpers
     ============================================================ */
  let toastTimer;
  function toast(msg, type) {
    els.toast.className = "toast " + (type || "");
    els.toastText.textContent = msg;
    els.toastIcon.textContent = type === "ok" ? "✓" : type === "ng" ? "✕" : "";
    els.toast.hidden = false;
    requestAnimationFrame(() => els.toast.classList.add("show"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.classList.remove("show");
      setTimeout(() => (els.toast.hidden = true), 200);
    }, 1300);
  }

  function debounce(fn, ms) {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  function registerSW() {
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW failed", e));
      });
    }
  }

  init();
})();
