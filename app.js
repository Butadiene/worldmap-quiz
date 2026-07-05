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

  // Finer sub-regions, keyed by ISO 3166-1 numeric so countries.js stays untouched.
  const SUBREGIONS = {
    east_asia:       { label: "東アジア",       ids: ["156","158","392","408","410","496"] },
    southeast_asia:  { label: "東南アジア",     ids: ["096","104","116","360","418","458","608","626","704","764"] },
    south_asia:      { label: "南アジア",       ids: ["004","050","064","144","356","524","586"] },
    central_asia:    { label: "中央アジア",     ids: ["398","417","762","795","860"] },
    west_asia:       { label: "西アジア（中東）", ids: ["031","051","196","268","364","368","376","400","414","422","512","634","682","760","784","792","887"] },

    north_europe:    { label: "北ヨーロッパ",   ids: ["208","233","246","352","372","428","440","578","752","826"] },
    west_europe:     { label: "西ヨーロッパ",   ids: ["040","056","250","276","442","528","756"] },
    east_europe:     { label: "東ヨーロッパ",   ids: ["100","112","203","348","498","616","642","643","703","804"] },
    south_europe:    { label: "南ヨーロッパ",   ids: ["008","070","191","300","380","499","620","688","705","724","807"] },

    north_africa:    { label: "北アフリカ",     ids: ["012","434","504","729","732","788","818"] },
    west_africa:     { label: "西アフリカ",     ids: ["204","270","288","324","384","430","466","478","562","566","624","686","694","768","854"] },
    east_africa:     { label: "東アフリカ",     ids: ["108","231","232","262","404","450","454","508","646","706","716","728","800","834","894"] },
    central_africa:  { label: "中部アフリカ",   ids: ["024","120","140","148","178","180","226","266"] },
    southern_africa: { label: "南部アフリカ",   ids: ["072","426","516","710","748"] },

    central_america: { label: "中央アメリカ",   ids: ["084","188","222","320","340","558","591"] },
    caribbean:       { label: "カリブ",         ids: ["044","192","214","332","388","630","780"] },
  };
  Object.keys(SUBREGIONS).forEach((k) => { SUBREGIONS[k].set = new Set(SUBREGIONS[k].ids); });

  function inRegion(f, r) {
    if (r === "all") return true;
    const sub = SUBREGIONS[r];
    if (sub) return sub.set.has(pad3(f.id));
    return regionOf(f) === r;   // coarse continent
  }

  // ---- DOM refs ----
  const $ = (id) => document.getElementById(id);
  const canvasSel = d3.select("#map");
  const canvas = canvasSel.node();
  const ctx = canvas.getContext("2d");
  const REDUCED = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
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
    explainPanel: $("explain-panel"), explainBadge: $("explain-badge"),
    explainName: $("explain-name"), explainRegion: $("explain-region"),
    explainCap: $("explain-cap"), explainNote: $("explain-note"),
    explainNext: $("explain-next"),
    countField: $("count-field"), explainField: $("explain-field"),
  };

  // ---- state ----
  const state = {
    features: [],       // renderable GeoJSON features that have Japanese data
    byId: new Map(),    // padded id -> feature
    pool: [],           // {id, ja, region, feature} for current settings
    settings: { mode: "find", region: "all", count: 20, explain: true },
    queue: [], idx: 0,
    score: 0, streak: 0, answered: 0, mistakes: [],
    locked: false, fittedFeatures: null,
    marks: new Map(),   // padded id -> "target" | "correct" | "wrong" | "hi"
    transform: null,    // current d3 zoom transform
    panning: false,     // true during an active drag/pinch
    browsing: false,    // "地図を見る" (study) mode active
    labels: false,      // draw country-name labels on the map
    labelData: [],      // [{name, cx, cy, w}] precomputed per fit
    viewMode: "fit",    // "fit" | "focus" — how to re-frame after a resize
    viewFeature: null,  // the focused feature when viewMode === "focus"
  };

  let projection, geoPath, zoom;
  let cssW = 0, cssH = 0, dpr = 1, pulseRAF = 0;
  const COLORS = {};    // filled from CSS custom properties at init

  const pad3 = (id) => String(id).padStart(3, "0");
  const dataFor = (id) => window.COUNTRY_DATA[pad3(id)] || null;
  const nameOf = (f) => { const d = dataFor(f.id); return d ? d.ja : (f.properties && f.properties.name) || "???"; };
  const regionOf = (f) => { const d = dataFor(f.id); return d ? d.region : "other"; };
  const infoFor = (id) => (window.COUNTRY_INFO && window.COUNTRY_INFO[pad3(id)]) || null;
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

  /* ============================================================
     Boot
     ============================================================ */
  function init() {
    readColors();
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
    geoPath = d3.geoPath(projection, ctx);   // canvas-backed path generator

    resizeCanvas();

    zoom = d3.zoom()
      .scaleExtent([1, 14])
      .on("start", () => { state.panning = true; })
      .on("zoom", (ev) => { state.transform = ev.transform; render(); })
      .on("end", () => { state.panning = false; render(); });
    canvasSel.call(zoom);
    state.transform = d3.zoomIdentity;

    canvasSel.on("click", onCanvasClick);

    fitToFeatures(state.features, false);

    // Keep the canvas + projection matched to the map area whenever it changes
    // (panels opening/closing, rotation, mobile URL bar). ResizeObserver is
    // delivered after layout and BEFORE paint, so the squished frame is never
    // shown. Without this the bitmap stretches and taps hit the wrong country.
    if (window.ResizeObserver) {
      new ResizeObserver(relayout).observe(els.stage);
    } else {
      window.addEventListener("resize", debounce(relayout, 150));
    }

    // zoom buttons
    els.zoomIn.onclick = () => canvasSel.transition().duration(250).call(zoom.scaleBy, 1.6);
    els.zoomOut.onclick = () => canvasSel.transition().duration(250).call(zoom.scaleBy, 1 / 1.6);
    els.zoomReset.onclick = () => fitToFeatures(state.fittedFeatures || state.features, true);
  }

  // Match the backing store to the CSS box × device pixel ratio for crisp lines.
  function resizeCanvas() {
    const rect = els.stage.getBoundingClientRect();
    cssW = rect.width || window.innerWidth;
    cssH = rect.height || window.innerHeight;
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }

  function readColors() {
    const s = getComputedStyle(document.documentElement);
    const g = (k, fb) => (s.getPropertyValue(k).trim() || fb);
    COLORS.land = g("--land", "#aec2cc");
    COLORS.landStroke = g("--land-stroke", "#5e7b87");
    COLORS.target = g("--target", "#f2a413");
    COLORS.targetLite = "#ffca5c";   // pulse peak (from the old CSS keyframe)
    COLORS.correct = g("--correct", "#1c9e5b");
    COLORS.wrong = g("--wrong", "#d64444");
  }

  const hexRGB = (h) => {
    h = h.trim().replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const lerpColor = (a, b, t) => {
    const A = hexRGB(a), B = hexRGB(b);
    const m = (i) => Math.round(A[i] + (B[i] - A[i]) * t);
    return `rgb(${m(0)},${m(1)},${m(2)})`;
  };
  function markFill(mark) {
    if (mark === "correct") return COLORS.correct;
    if (mark === "wrong") return COLORS.wrong;
    if (mark === "hi") return COLORS.target;                  // static browse highlight
    if (REDUCED) return COLORS.target;                        // no pulse
    const p = (Math.sin(performance.now() / 550) + 1) / 2;    // 0..1 oscillation
    return lerpColor(COLORS.target, COLORS.targetLite, p);
  }
  const setMark = (id, type) => state.marks.set(pad3(id), type);

  // The whole map is redrawn per frame; 110m/~170 polygons on canvas is cheap.
  function render() {
    if (!ctx || !projection) return;
    const t = state.transform || d3.zoomIdentity;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // work in CSS px, sharp on HiDPI
    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);
    ctx.lineJoin = "round";

    // constant on-screen stroke like SVG's non-scaling-stroke; skip while moving
    const strokeW = state.panning ? 0 : 0.7 / t.k;

    // 1) all unmarked land in a single batched path — one fill, one stroke
    ctx.beginPath();
    for (let i = 0; i < state.features.length; i++) {
      const f = state.features[i];
      if (state.marks.has(pad3(f.id))) continue;
      geoPath(f);
    }
    ctx.fillStyle = COLORS.land;
    ctx.fill();
    if (strokeW > 0) { ctx.lineWidth = strokeW; ctx.strokeStyle = COLORS.landStroke; ctx.stroke(); }

    // 2) marked countries (usually 0-2) drawn individually on top
    if (state.marks.size) {
      for (const [id, mark] of state.marks) {
        const f = state.byId.get(id);
        if (!f) continue;
        ctx.beginPath();
        geoPath(f);
        ctx.fillStyle = markFill(mark);
        ctx.fill();
        if (strokeW > 0) { ctx.lineWidth = strokeW; ctx.strokeStyle = COLORS.landStroke; ctx.stroke(); }
      }
    }

    // 3) country-name labels (browse mode) — drawn unscaled in screen space so
    //    text stays crisp and readable at any zoom; small countries appear as you zoom in.
    if (state.labels && state.labelData.length) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = '600 11px "Hiragino Sans","Noto Sans JP",system-ui,sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      for (let i = 0; i < state.labelData.length; i++) {
        const L = state.labelData[i];
        if (L.w * t.k < 24) continue;                      // too small to label yet
        const x = t.x + t.k * L.cx, y = t.y + t.k * L.cy;
        if (x < -60 || x > cssW + 60 || y < -16 || y > cssH + 16) continue;
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(255,255,255,.9)";
        ctx.strokeText(L.name, x, y);
        ctx.fillStyle = "#16303a";
        ctx.fillText(L.name, x, y);
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function buildLabels(features) {
    state.labelData = [];
    for (let i = 0; i < features.length; i++) {
      const f = features[i];
      const c = geoPath.centroid(f);
      if (!c || isNaN(c[0])) continue;
      const b = geoPath.bounds(f);
      state.labelData.push({ name: nameOf(f), cx: c[0], cy: c[1], w: b[1][0] - b[0][0] });
    }
  }

  const hasTarget = () => { for (const v of state.marks.values()) if (v === "target") return true; return false; };
  function startPulse() {
    if (REDUCED) { render(); return; }
    if (pulseRAF) return;
    const loop = () => {
      if (!hasTarget()) { pulseRAF = 0; return; }
      render();
      pulseRAF = requestAnimationFrame(loop);
    };
    pulseRAF = requestAnimationFrame(loop);
  }
  function stopPulse() {
    if (pulseRAF) { cancelAnimationFrame(pulseRAF); pulseRAF = 0; }
  }

  function fitToFeatures(features, animate) {
    state.fittedFeatures = features;
    state.viewMode = "fit";
    resizeCanvas();
    const fc = { type: "FeatureCollection", features };
    projection.fitExtent([[20, 20], [cssW - 20, cssH - 20]], fc);
    resetZoom(animate);
    if (!animate) render();
  }

  function resetZoom(animate) {
    const sel = animate ? canvasSel.transition().duration(400) : canvasSel;
    sel.call(zoom.transform, d3.zoomIdentity);
  }

  function focusFeature(f, animate) {
    state.viewMode = "focus";
    state.viewFeature = f;
    syncSizeNow();                 // ensure projection matches the current box
    applyFocus(f, animate !== false);
  }
  function applyFocus(f, animate) {
    const b = geoPath.bounds(f);
    const dx = b[1][0] - b[0][0], dy = b[1][1] - b[0][1];
    const cx = (b[0][0] + b[1][0]) / 2, cy = (b[0][1] + b[1][1]) / 2;
    let scale = 0.55 / Math.max(dx / cssW, dy / cssH);
    scale = Math.max(1, Math.min(10, scale));
    const tx = cssW / 2 - scale * cx, ty = cssH / 2 - scale * cy;
    const tr = d3.zoomIdentity.translate(tx, ty).scale(scale);
    const sel = animate ? canvasSel.transition().duration(650) : canvasSel;
    sel.call(zoom.transform, tr);
  }

  // Re-fit the canvas + projection to the current map-area size. Returns true if
  // anything changed. Rebuilds the projection to the currently fitted features so
  // the map is never distorted; the caller re-applies the framing (fit/focus).
  function syncSizeNow() {
    if (!projection) return false;
    const rect = els.stage.getBoundingClientRect();
    const w = rect.width || cssW, h = rect.height || cssH;
    const dprNow = window.devicePixelRatio || 1;
    if (Math.abs(w - cssW) < 0.5 && Math.abs(h - cssH) < 0.5 && dprNow === dpr) return false;
    cssW = w; cssH = h; dpr = dprNow;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const feats = state.fittedFeatures || state.features;
    projection.fitExtent([[20, 20], [cssW - 20, cssH - 20]],
      { type: "FeatureCollection", features: feats });
    if (state.labels) buildLabels(feats);
    return true;
  }

  function reapplyView() {
    if (state.viewMode === "focus" && state.viewFeature) applyFocus(state.viewFeature, false);
    else resetZoom(false);
  }

  function relayout() {
    if (syncSizeNow()) reapplyView();
    render();
  }

  /* ============================================================
     Setup screen
     ============================================================ */
  function wireSetup() {
    segGroup("mode-seg", "mode", onModeChange);
    chipGroup("region-chips", (v) => (state.settings.region = v));
    segGroup("count-seg", "count", (v) => (state.settings.count = parseInt(v, 10)));
    segGroup("explain-seg", "explain", (v) => (state.settings.explain = v === "1"));

    els.start.onclick = () => {
      if (!state.features.length) {
        if (navigator.onLine) { loadWorld(); }
        else { alert("地図データがまだありません。最初の1回だけ、ネットに接続して開いてください。"); }
        return;
      }
      if (state.settings.mode === "browse") startBrowse();
      else startQuiz();
    };
    els.retry.onclick = loadWorld;
    els.quit.onclick = () => {
      if (state.browsing) { showSetup(); return; }
      if (confirm("クイズをやめて設定に戻りますか？")) showSetup();
    };
    els.resultHome.onclick = showSetup;
    els.resultAgain.onclick = startQuiz;
    els.explainNext.onclick = onExplainNext;
  }

  // Toggle quiz-only settings and the start button label for the study mode.
  function onModeChange(v) {
    state.settings.mode = v;
    const browse = v === "browse";
    if (els.countField) els.countField.hidden = browse;
    if (els.explainField) els.explainField.hidden = browse;
    els.start.textContent = browse ? "地図を見る" : "スタート";
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
    state.browsing = false;
    state.labels = false;
    els.stats.classList.remove("browse");
    els.setup.hidden = false;
    els.result.hidden = true;
    els.stats.hidden = true;
    els.progTrack.hidden = true;
    els.promptBar.hidden = true;
    els.choices.hidden = true;
    els.zoomControls.hidden = true;
    els.explainPanel.hidden = true;
    onModeChange(state.settings.mode);
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
      .filter((f) => inRegion(f, r))
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
    els.explainPanel.hidden = true;
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
  }

  // Pixel-exact hit testing: rebuild each country's path under the SAME transform
  // used to draw it and let the canvas test the pointer against it. This matches
  // exactly what's on screen — no projection.invert / spherical-vs-planar drift.
  function featureAt(mx, my) {
    if (!ctx || !projection) return null;
    const t = state.transform || d3.zoomIdentity;
    const px = mx * dpr, py = my * dpr;   // isPointInPath wants backing-store px
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);
    let hit = null;
    for (let i = 0; i < state.features.length; i++) {
      const f = state.features[i];
      ctx.beginPath();
      geoPath(f);
      if (ctx.isPointInPath(px, py)) { hit = f; break; }
    }
    ctx.restore();
    return hit;
  }

  function onCanvasClick(ev) {
    if (syncSizeNow()) { reapplyView(); render(); }   // backstop: never test a stale map
    const [mx, my] = d3.pointer(ev, canvas);
    const f = featureAt(mx, my);
    if (!f) return;                        // tapped ocean — ignore

    if (state.browsing) { showBrowseDetail(f); return; }
    if (state.settings.mode !== "find" || state.locked) return;

    state.locked = true;
    const c = currentCountry();
    const correct = pad3(f.id) === c.id;

    setMark(c.id, "correct");              // always reveal where it actually was
    if (!correct) setMark(pad3(f.id), "wrong");
    render();

    if (correct) { scoreCorrect(); toast("正解！", "ok"); }
    else { scoreWrong(c.ja); toast("正解は " + c.ja, "ng"); }
    finishTurn(c, correct, correct ? 900 : 1500);
  }

  // ---- NAME mode: highlight a country, pick its name ----
  function askName(c) {
    els.promptBar.hidden = true;
    els.choices.hidden = false;

    setMark(c.id, "target");
    render();
    startPulse();
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
    stopPulse();
    const correct = chosen.id === c.id;

    els.choicesGrid.querySelectorAll(".choice").forEach((b) => {
      b.disabled = true;
      if (b.textContent === c.ja) b.classList.add("correct");
    });

    if (correct) {
      setMark(c.id, "correct");
      scoreCorrect();
      toast("正解！", "ok");
    } else {
      btn.classList.add("wrong");
      setMark(c.id, "wrong");
      scoreWrong(c.ja);
      toast("正解は " + c.ja, "ng");
    }
    render();
    finishTurn(c, correct, correct ? 900 : 1400);
  }

  /* ============================================================
     Scoring & flow
     ============================================================ */
  function scoreCorrect() { state.score++; state.streak++; state.answered++; updateStats(); }
  function scoreWrong(ja) { state.streak = 0; state.answered++; state.mistakes.push(ja); updateStats(); }

  // After an answer: either show the explanation panel (解説モード) or auto-advance.
  function finishTurn(c, correct, ms) {
    if (state.settings.explain) {
      showExplain(c, correct);
    } else {
      advanceAfter(ms);
    }
  }

  function showExplain(c, correct) {
    const info = infoFor(c.id);
    els.explainBadge.hidden = false;
    els.explainBadge.textContent = correct ? "正解" : "不正解";
    els.explainBadge.className = "explain-badge " + (correct ? "ok" : "ng");
    els.explainName.textContent = c.ja;
    els.explainRegion.textContent = REGION_LABEL[c.region] || "";
    els.explainCap.textContent = info && info.cap ? "首都: " + info.cap : "";
    els.explainCap.hidden = !(info && info.cap);
    els.explainNote.textContent = info && info.note ? info.note : "この国の解説データはまだありません。";
    els.explainNext.textContent = "次へ →";
    els.promptBar.hidden = true;
    els.choices.hidden = true;
    els.explainPanel.hidden = false;
    // Focus AFTER the panel is shown so the map is already at its final size.
    focusFeature(c.feature);
  }

  // Advance (quiz) or just close the panel (browse), depending on mode.
  function onExplainNext() {
    els.explainPanel.hidden = true;
    if (state.browsing) { clearMapStates(); return; }   // keep browsing & labels
    state.idx++;
    nextQuestion();
  }

  function advanceAfter(ms) {
    setTimeout(() => { state.idx++; nextQuestion(); }, ms);
  }

  /* ============================================================
     Browse (study) mode — labeled map, tap a country for details
     ============================================================ */
  function startBrowse() {
    buildPool();
    if (!state.pool.length) { alert("この地域には収録国がありません。"); return; }
    state.browsing = true;
    state.locked = false;

    els.setup.hidden = true;
    els.result.hidden = true;
    els.stats.hidden = false;
    els.stats.classList.add("browse");     // keep only the ✕ in the top bar
    els.progTrack.hidden = true;
    els.promptBar.hidden = true;
    els.choices.hidden = true;
    els.zoomControls.hidden = false;
    els.explainPanel.hidden = true;

    clearMapStates();
    const feats = state.settings.region === "all"
      ? state.features
      : state.pool.map((c) => c.feature);
    state.labels = true;
    fitToFeatures(feats, true);
    buildLabels(feats);
    render();
    toast("国をタップすると首都・豆知識が見られます", "");
  }

  function showBrowseDetail(f) {
    const id = pad3(f.id);
    clearMapStates();
    setMark(id, "hi");
    render();
    const info = infoFor(id);
    els.explainBadge.hidden = true;        // no 正解/不正解 badge when just browsing
    els.explainName.textContent = nameOf(f);
    els.explainRegion.textContent = REGION_LABEL[regionOf(f)] || "";
    els.explainCap.textContent = info && info.cap ? "首都: " + info.cap : "";
    els.explainCap.hidden = !(info && info.cap);
    els.explainNote.textContent = info && info.note ? info.note : "この国の解説データはまだありません。";
    els.explainNext.textContent = "閉じる";
    els.explainPanel.hidden = false;
    // Focus AFTER the panel is shown so the map is already at its final size.
    focusFeature(f);
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
    state.marks.clear();
    stopPulse();
    render();
  }

  function endQuiz() {
    els.progFill.style.width = "100%";
    els.promptBar.hidden = true;
    els.choices.hidden = true;
    els.explainPanel.hidden = true;
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
