/* ================================================================
   世界地図クイズ  —  app logic
   ================================================================ */
(function () {
  "use strict";

  // Shown on the setup screen so on-device users can confirm an update landed.
  // MUST be bumped together with CACHE in sw.js (same version number).
  const APP_VERSION = "v26";

  const WORLD_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json";
  const WORLD_URL_LOW = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";  // LOD 低詳細 (Run 13)

  const REGION_LABEL = {
    all: "世界全体", asia: "アジア", europe: "ヨーロッパ", africa: "アフリカ",
    north_america: "北アメリカ", south_america: "南アメリカ", oceania: "オセアニア",
    other: "その他",
  };

  // Finer sub-regions, keyed by ISO 3166-1 numeric so countries.js stays untouched.
  const SUBREGIONS = {
    east_asia:       { label: "東アジア",       ids: ["156","158","392","408","410","496"] },
    southeast_asia:  { label: "東南アジア",     ids: ["096","104","116","360","418","458","608","626","702","704","764"] },
    south_asia:      { label: "南アジア",       ids: ["004","050","064","144","356","462","524","586"] },
    central_asia:    { label: "中央アジア",     ids: ["398","417","762","795","860"] },
    west_asia:       { label: "西アジア（中東）", ids: ["031","048","051","196","268","275","364","368","376","400","414","422","512","634","682","760","784","792","887"] },

    north_europe:    { label: "北ヨーロッパ",   ids: ["208","233","246","352","372","428","440","578","752","826"] },
    west_europe:     { label: "西ヨーロッパ",   ids: ["040","056","250","276","442","528","756"] },
    east_europe:     { label: "東ヨーロッパ",   ids: ["100","112","203","348","498","616","642","643","703","804"] },
    south_europe:    { label: "南ヨーロッパ",   ids: ["008","070","191","300","380","470","499","620","688","705","724","807"] },

    north_africa:    { label: "北アフリカ",     ids: ["012","434","504","729","732","788","818"] },
    west_africa:     { label: "西アフリカ",     ids: ["132","204","270","288","324","384","430","466","478","562","566","624","686","694","768","854"] },
    east_africa:     { label: "東アフリカ",     ids: ["108","174","231","232","262","404","450","454","480","508","646","690","706","716","728","800","834","894"] },
    central_africa:  { label: "中部アフリカ",   ids: ["024","120","140","148","178","180","226","266","678"] },
    southern_africa: { label: "南部アフリカ",   ids: ["072","426","516","710","748"] },

    central_america: { label: "中央アメリカ",   ids: ["084","188","222","320","340","558","591"] },
    caribbean:       { label: "カリブ",         ids: ["044","052","192","214","332","388","630","780"] },
  };
  Object.keys(SUBREGIONS).forEach((k) => { SUBREGIONS[k].set = new Set(SUBREGIONS[k].ids); });

  // Reverse lookup id -> subregion key, so distractors can be drawn from the nearest ring.
  const SUBREGION_OF = new Map();
  Object.keys(SUBREGIONS).forEach((k) => {
    SUBREGIONS[k].ids.forEach((id) => SUBREGION_OF.set(id, k));
  });

  function inRegion(f, r) {
    if (r === "all") return true;
    const sub = SUBREGIONS[r];
    if (sub) return sub.set.has(pad3(f.id));
    return regionOf(f) === r;   // coarse continent
  }

  // 世界一周モードの海路（フェリー航路・海峡）。監督者が 50m データの海岸線間距離から
  // 機械生成し、日本から全182か国への到達可能性を検証済み。1本も改変しないこと。
  const SEA_LINKS = [
    ["008","380"], ["032","238"], ["036","360"], ["036","554"], ["036","598"], ["036","626"],
    ["044","192"], ["044","840"], ["048","634"], ["048","682"], ["052","780"], ["090","548"],
    ["090","598"], ["124","304"], ["132","686"], ["144","356"], ["144","462"], ["156","158"],
    ["156","392"], ["156","410"], ["158","392"], ["158","608"], ["174","450"], ["174","508"],
    ["174","834"], ["191","380"], ["192","214"], ["192","332"], ["192","388"], ["192","484"],
    ["192","840"], ["196","300"], ["196","792"], ["208","578"], ["208","752"], ["214","630"],
    ["226","678"], ["232","887"], ["233","246"], ["242","548"], ["242","882"], ["250","826"],
    ["262","887"], ["266","678"], ["300","380"], ["304","352"], ["332","388"], ["352","578"],
    ["356","462"], ["360","608"], ["360","702"], ["364","512"], ["364","784"], ["380","470"],
    ["380","788"], ["392","410"], ["392","643"], ["400","818"], ["450","480"], ["450","508"],
    ["450","690"], ["458","608"], ["458","702"], ["470","788"], ["504","724"], ["528","826"],
    ["643","840"], ["682","818"], ["706","887"], ["780","862"]
  ];

  // ---- DOM refs ----
  const $ = (id) => document.getElementById(id);
  const canvasSel = d3.select("#map");
  const canvas = canvasSel.node();
  const ctx = canvas.getContext("2d");
  const REDUCED = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const els = {
    stage: $("map-stage"), loading: $("loading"), error: $("load-error"),
    retry: $("retry-btn"), setup: $("setup"), start: $("start-btn"),
    setupRank: $("setup-rank"),
    result: $("result"), stats: $("stats"), score: $("score"),
    answered: $("answered"), streak: $("streak"), quit: $("quit-btn"),
    livesStat: $("lives-stat"), lives: $("lives"), resultEyebrow: $("result-eyebrow"),
    progTrack: $("progress-track"), progFill: $("progress-fill"),
    promptBar: $("prompt-bar"), promptKicker: $("prompt-kicker"),
    promptTarget: $("prompt-target"), promptHint: $("prompt-hint"),
    giveup: $("giveup-btn"), hint: $("hint-btn"), choices: $("choices"),
    choicesKicker: $("choices-kicker"),
    choicesGrid: $("choices-grid"), toast: $("toast"), toastIcon: $("toast-icon"),
    toastText: $("toast-text"), zoomControls: $("zoom-controls"),
    zoomIn: $("zoom-in"), zoomOut: $("zoom-out"), zoomReset: $("zoom-reset"),
    resultNum: $("result-num"), resultDen: $("result-den"), resultPct: $("result-pct"),
    resultReview: $("result-review"), reviewList: $("review-list"),
    resultHome: $("result-home"), resultAgain: $("result-again"),
    resultRetryMissed: $("result-retry-missed"),
    offlineBadge: $("offline-badge"),
    explainPanel: $("explain-panel"), explainBadge: $("explain-badge"),
    explainName: $("explain-name"), explainRegion: $("explain-region"),
    explainCap: $("explain-cap"), explainNote: $("explain-note"),
    explainStats: $("explain-stats"), explainNext: $("explain-next"),
    countField: $("count-field"), explainField: $("explain-field"),
    soundField: $("sound-field"),
    masteryLegend: $("mastery-legend"),
  };

  // ---- state ----
  const state = {
    features: [],       // renderable GeoJSON features that have Japanese data
    inertFeatures: [],  // id なしジオメトリ (Somaliland/Kosovo/N.Cyprus 等): 陸として描くだけの無反応領域
    byId: new Map(),    // padded id -> feature
    allCountries: [],   // {id, ja, region, feature} for every renderable country (distractor source)
    pool: [],           // {id, ja, region, feature} for current settings
    settings: { mode: "find", region: "all", count: 20, explain: true, sound: false },
    queue: [], idx: 0,
    score: 0, streak: 0, answered: 0, mistakes: [],   // mistakes: padded ids this session
    survival: false,    // サバイバル（問題数=-1）: ライフ制の無限出題
    lives: 3,           // 残りライフ（サバイバルのみ）
    survivalOver: false, // ライフ0でこの問のフィードバック後に endQuiz へ向かう
    exploreGuesses: 0,  // たんけん: この問の推測回数
    exploreTried: null, // たんけん: この問で推測済みの id（Set・重複タップ判定）
    exploreFound: 0,    // たんけん: 発見できた問の数（平均計算用）
    exploreTotalGuesses: 0, // たんけん: 発見できた問の推測回数合計（平均計算用）
    journey: false,     // 世界一周: 隣接国タップで旅する（3旅=1セッション）
    journeyRoute: [],   // 世界一周: たどった国の pad3 id 配列（経路線・トレイル）
    journeyCurrent: null, // 世界一周: 現在地 pad3 id
    journeyGoal: null,  // 世界一周: この旅のゴール pad3 id（地図上ではハイライトしない）
    journeyMoves: 0,    // 世界一周: この旅の手数
    journeyBest: 0,     // 世界一周: この旅の BFS 最短手数（目安）
    journeyHints: 0,    // 世界一周: この旅のヒント使用回数
    journeyMisses: 0,   // 世界一周: 非隣接タップ回数（内部カウンタ）
    journeyLeg: 0,      // 世界一周: 完了した旅の数（0..3）
    journeyStars: 0,    // 世界一周: 獲得した☆の合計
    journeyShortest: 0, // 世界一周: 最短手数で到達した旅の数
    stats: {},          // padded id -> { c: 正解数, w: 誤答数, last: 最終出題epochMs }
    reasks: {},         // padded id -> このセッションで再挿入した回数
    locked: false, fittedFeatures: null,
    marks: new Map(),   // padded id -> "target" | "correct" | "wrong" | "hi"
    transform: null,    // current d3 zoom transform
    browsing: false,    // "地図を見る" (study) mode active
    progressView: false, // "成績マップ" (mastery) mode active — a browse variant
    paint: null,        // null | Map(padded id -> fill color) for mastery-colored land
    labels: false,      // draw country-name labels on the map
    labelData: [],      // [{name, cx, cy, w}] precomputed per fit
    viewMode: "fit",    // "fit" | "focus" | "anchor" — how to re-frame after a resize
    viewFeature: null,  // the focused feature when viewMode === "focus"
    viewAnchor: null,   // { geo:[lon,lat], eff } — 巻き戻し先の地理アンカー（viewMode === "anchor"）。
                        // リサイズ/再投影後も同じ視点へ再適用する（reapplyView）。
    preFocus: null,     // { geo:[lon,lat], eff } の視点 — アプリが自動フォーカスする直前の「ユーザーの視点」。
                        // 地理座標＋実効ズームで保持するので投影の作り直し（解説パネル開閉のリサイズ等）に
                        // 不変。次問でここへ巻き戻す。ユーザーが自分でパン/ズームすると破棄（gesture start）。
  };

  let projection, geoPath, zoom;
  let cssW = 0, cssH = 0, dpr = 1, pulseRAF = 0;
  const COLORS = {};    // filled from CSS custom properties at init

  // Projected-path cache (Run 8). The projection only changes on fit/resize, so pan
  // and zoom are pure ctx-transform tricks — there is no need to re-run the d3
  // projection every frame. buildPaths() reprojects all countries into Path2D objects
  // once per fit; render() and featureAt() then just replay those under the transform.
  let pathGen = null;              // Path2D-backed d3.geoPath, kept OFF the ctx-bound geoPath
  let pathsGen = 0;                // projection-generation counter: bumped by buildPaths() so a
                                   // snapshot captured under an OLD projection is discarded, not blitted
  const paths = new Map();         // padded id -> Path2D (projected outline, 50m 高詳細)
  let landPath = null;             // every country in one Path2D (batched fill/stroke)
  let inertPath = null;            // id なしジオメトリを1本にまとめた Path2D (最下層の無反応な陸)
  const boundsMap = new Map();     // padded id -> [[x0,y0],[x1,y1]] projected bbox (culling)
  // LOD (Run 13): a parallel LOW-detail path set built from the coarse 110m atlas. Used
  // only when zoomed out (effScale < DETAIL_SCALE) where 50m's extra vertices are sub-pixel
  // waste. Draw-layer only — none of it touches state.features / pool / centroids / ADJ.
  let lowById = null;              // padded id -> merged 110m feature (null until 110m loads)
  let lowInert = [];               // 110m の id なしジオメトリ (無ければ 50m の inert を流用)
  let lowPending = false;          // a 110m fetch is in flight (guards retry double-fetch)
  const pathsLow = new Map();      // padded id -> low-detail Path2D (falls back to 50m per id)
  let landPathLow = null;          // low-detail batched land Path2D
  let inertPathLow = null;         // low-detail inert Path2D (or the 50m inertPath when 110m has none)
  // effScale = projection.scale()*t.k. World fit ≈ 70, region fits (Europe 等) ≈ 300.
  // Below 180 we're at the world view or its zoom-in ramp → low detail; region views stay 50m.
  const DETAIL_SCALE = 180;
  const geoCentroids = new Map();  // padded id -> [lon,lat] spherical centroid (たんけん距離計算)
  const projCentroids = new Map(); // padded id -> [x,y] projected-plane centroid (世界一周の経路線); rebuilt with paths
  const ADJ = new Map();           // padded id -> Set(padded id) 隣接グラフ (陸国境 topojson.neighbors + 海路 SEA_LINKS)
  // Gesture / transition blit snapshot: the last sharp frame + the transform + projection
  // generation it was drawn at (stale gen ⇒ discard, never blit).
  let snapCanvas = null;           // reused offscreen backing buffer
  let snap = null;                 // { canvas, t0:{x,y,k}, gen } while a snapshot is live
  let transitioning = false;       // a programmatic zoom transition is animating (blit-driven).
                                   // The name-mode pulse pauses its render()s while true so it
                                   // doesn't fight the transition's blits; always cleared at zoom "end".
  // Cap the backing-store resolution: 3x phones would otherwise push ~2.25x the pixels
  // of a 2x panel for no visible gain. All canvas sizing goes through this.
  const deviceRatio = () => Math.min(window.devicePixelRatio || 1, 2);

  // localStorage wrapper — Safari private mode etc. can throw, so degrade quietly.
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
      catch (e) { return fallback; }
    },
    set(key, val) {
      try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
    },
  };
  const STATS_KEY = "wq.stats.v1";
  const SETTINGS_KEY = "wq.settings.v1";
  const BEST_KEY = "wq.best.v1";   // サバイバル自己ベスト: { [mode+":"+region]: 正解数 }

  const pad3 = (id) => String(id).padStart(3, "0");
  const dataFor = (id) => window.COUNTRY_DATA[pad3(id)] || null;
  const nameOf = (f) => { const d = dataFor(f.id); return d ? d.ja : (f.properties && f.properties.name) || "???"; };
  const regionOf = (f) => { const d = dataFor(f.id); return d ? d.region : "other"; };
  const infoFor = (id) => (window.COUNTRY_INFO && window.COUNTRY_INFO[pad3(id)]) || null;
  // Prepend the flag emoji to a name for panels/result chips; degrade gracefully when absent.
  const withFlag = (id, name) => { const d = dataFor(id); return d && d.flag ? d.flag + " " + name : name; };
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
  // Haptic feedback where supported; silently ignored elsewhere (desktop, iOS Safari…).
  const buzz = (pattern) => { if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) {} } };

  /* ============================================================
     Sound effects — WebAudio, fully synthesized (no assets), OFF by default.
     ============================================================ */
  let audioCtx = null;
  // Create the AudioContext lazily, only when sound is on and a sound is first
  // requested (always inside a user tap → satisfies autoplay policy). Failures
  // are swallowed to silence. Returns null when sound is off / unavailable.
  function ensureAudio() {
    if (!state.settings.sound) return null;
    if (!audioCtx) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        audioCtx = new AC();
      } catch (e) { audioCtx = null; return null; }
    }
    if (audioCtx.state === "suspended") { try { audioCtx.resume(); } catch (e) {} }
    return audioCtx;
  }
  // One oscillator note with a short exponential gain envelope.
  function tone(freq, startMs, durMs, type, peak) {
    const ac = audioCtx;
    if (!ac) return;
    const t0 = ac.currentTime + startMs / 1000;
    const dur = durMs / 1000;
    try {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g); g.connect(ac.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    } catch (e) {}
  }
  const soundCorrect = () => { if (ensureAudio()) { tone(880, 0, 60, "sine", 0.08); tone(1318, 70, 70, "sine", 0.08); } };
  const soundWrong = () => { if (ensureAudio()) { tone(165, 0, 150, "triangle", 0.08); } };
  // Rising C-E-G arpeggio for a perfect run / survival best.
  const soundFanfare = () => { if (ensureAudio()) { tone(523, 0, 130, "sine", 0.09); tone(659, 120, 130, "sine", 0.09); tone(784, 240, 260, "sine", 0.09); } };

  /* ============================================================
     Confetti — a disposable full-screen <canvas>, celebration only.
     Created on demand and removed when the burst ends; never resident.
     ============================================================ */
  let fxCanvas = null, fxCtx = null, fxRAF = 0, fxParticles = null, fxResize = null;

  function stopConfetti() {
    if (fxRAF) { cancelAnimationFrame(fxRAF); fxRAF = 0; }
    if (fxResize) { window.removeEventListener("resize", fxResize); fxResize = null; }
    if (fxCanvas && fxCanvas.parentNode) fxCanvas.parentNode.removeChild(fxCanvas);
    fxCanvas = null; fxCtx = null; fxParticles = null;
  }

  function startConfetti() {
    if (REDUCED) return;
    stopConfetti();                              // never overlap two bursts
    fxCanvas = document.createElement("canvas");
    fxCanvas.id = "fx";
    // Above the result overlay (z-index 30); clicks fall through to the buttons.
    fxCanvas.style.cssText = "pointer-events:none;position:fixed;inset:0;z-index:60;";
    ($("app") || document.body).appendChild(fxCanvas);
    fxCtx = fxCanvas.getContext("2d");

    const sizeFx = () => {
      fxCanvas.width = Math.round(window.innerWidth * dpr);
      fxCanvas.height = Math.round(window.innerHeight * dpr);
    };
    sizeFx();
    fxResize = () => sizeFx();                    // fixed canvas: rebuild backing store on resize
    window.addEventListener("resize", fxResize);

    const W = window.innerWidth, H = window.innerHeight;
    const colors = [COLORS.target, COLORS.correct, COLORS.mMid, COLORS.primary];
    fxParticles = [];
    for (let i = 0; i < 72; i++) {
      fxParticles.push({
        x: Math.random() * W,
        y: -20 - Math.random() * H * 0.35,       // start above the viewport
        vx: (Math.random() - 0.5) * 0.18,        // px/ms
        vy: 0.18 + Math.random() * 0.24,
        size: 6 + Math.random() * 6,
        color: colors[(Math.random() * colors.length) | 0] || "#f2a413",
        rot: Math.random() * Math.PI,
        vrot: (Math.random() - 0.5) * 0.012,
      });
    }

    const start = performance.now();
    let last = start;
    const step = (now) => {
      const dt = Math.min(now - last, 50); last = now;
      const w = window.innerWidth, h = window.innerHeight;
      fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      fxCtx.clearRect(0, 0, w, h);
      let alive = 0;
      for (let i = 0; i < fxParticles.length; i++) {
        const p = fxParticles[i];
        p.vy += 0.0004 * dt;                      // gentle gravity
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vrot * dt;
        if (p.y < h + 20) alive++;
        fxCtx.save();
        fxCtx.translate(p.x, p.y);
        fxCtx.rotate(p.rot);
        fxCtx.fillStyle = p.color;
        fxCtx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        fxCtx.restore();
      }
      // Stop once every piece has left the bottom (hard cap as a safety net).
      if (alive > 0 && now - start < 4000) fxRAF = requestAnimationFrame(step);
      else stopConfetti();
    };
    fxRAF = requestAnimationFrame(step);
  }

  /* ============================================================
     Boot
     ============================================================ */
  function init() {
    readColors();
    const ver = $("app-version");
    if (ver) ver.textContent = APP_VERSION;
    state.stats = store.get(STATS_KEY, {});
    // Guard against a corrupted / hand-edited store (array, string, null…): stats must be a plain object.
    if (!state.stats || typeof state.stats !== "object" || Array.isArray(state.stats)) state.stats = {};
    wireSetup();
    applySavedSettings(store.get(SETTINGS_KEY, null));
    updateRank();
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
    // LOD: pull the coarse 110m atlas in parallel. This NEVER blocks or fails the app —
    // its own promise chain, and every selector falls back to 50m when it is missing.
    loadLowDetail();
  }

  // Fetch + ingest the 110m atlas for the low-detail LOD path set. Best-effort: any
  // failure/late arrival just leaves LOD off (50m everywhere). Idempotent across retries.
  function loadLowDetail() {
    if (lowById || lowPending) return;
    lowPending = true;
    fetch(WORLD_URL_LOW)
      .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then((topo) => {
        ingestLowTopo(topo);
        lowPending = false;
        // If the 50m map is already up, rebuild the caches so LOD kicks in immediately.
        if (lowById && projection) { buildPaths(); render(); }
      })
      .catch((err) => { lowPending = false; console.warn("LOD (110m) load skipped:", err); });
  }

  // Extract the 110m topology into a merged id->feature map + inert list ONCE (same
  // merge rules as buildFeatures). Kept in module scope and reprojected by buildPaths on
  // every fit; state.features etc. are never touched. Only ids present in COUNTRY_DATA.
  function ingestLowTopo(topo) {
    try {
      const geo = topojson.feature(topo, topo.objects.countries);
      const byId = new Map();
      const inert = [];
      const polysOf = (g) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates);
      geo.features.forEach((f) => {
        if (f.id == null) { inert.push(f); return; }
        if (!dataFor(f.id)) return;
        const id = pad3(f.id);
        const prev = byId.get(id);
        if (prev) {
          prev.geometry = {
            type: "MultiPolygon",
            coordinates: polysOf(prev.geometry).concat(polysOf(f.geometry)),
          };
          return;
        }
        byId.set(id, f);
      });
      lowById = byId;
      lowInert = inert;
    } catch (e) { lowById = null; lowInert = []; }
  }

  function buildFeatures(topo) {
    const geo = topojson.feature(topo, topo.objects.countries);
    state.features = [];
    state.inertFeatures = [];
    state.byId.clear();
    const polysOf = (g) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates);
    geo.features.forEach((f) => {
      // id なしジオメトリ (50m データの Somaliland/Kosovo/N. Cyprus/Indian Ocean Ter./Siachen
      // Glacier) は捨てず、見た目だけ普通の陸として描く無反応領域として収集する。pool/paths/
      // hit-test/centroid/ADJ には一切入れない（id 付きで COUNTRY_DATA に無い海外領土は従来どおりスキップ）。
      if (f.id == null) { state.inertFeatures.push(f); return; }
      if (!dataFor(f.id)) return;           // keep only countries we have JP names for
      const id = pad3(f.id);
      const prev = state.byId.get(id);
      if (prev) {
        // The 50m atlas can carry one ISO id as several geometries (036 is both
        // "Australia" and "Ashmore and Cartier Is."). Every downstream cache —
        // paths, boundsMap, centroids, hit testing — is keyed by id, so a second
        // feature would silently REPLACE the first (this made mainland Australia
        // vanish under culling). Merge them into one MultiPolygon instead.
        prev.geometry = {
          type: "MultiPolygon",
          coordinates: polysOf(prev.geometry).concat(polysOf(f.geometry)),
        };
        return;
      }
      state.byId.set(id, f);
      state.features.push(f);
    });
    // Distractor source: every renderable country, independent of the current region filter.
    state.allCountries = state.features.map(
      (f) => ({ id: pad3(f.id), ja: nameOf(f), region: regionOf(f), feature: f })
    );
    // Spherical centroids for たんけん distance hints — the great-circle distance uses
    // real lon/lat, NOT the projected-plane centroid geoPath.centroid returns.
    geoCentroids.clear();
    state.features.forEach((f) => geoCentroids.set(pad3(f.id), d3.geoCentroid(f)));
    buildAdjacency(topo, geo);
  }

  // 隣接グラフ（世界一周モード）。topo が手元にある buildFeatures から呼ぶ。
  // 陸の国境は topojson.neighbors（返り値の index は geometries 配列＝geo.features と一致）、
  // 海路は SEA_LINKS。いずれも pad3 id をキーに双方向で ADJ へ。COUNTRY_DATA に無い国は除外。
  function buildAdjacency(topo, geo) {
    ADJ.clear();
    const geoms = topo.objects.countries.geometries;
    const nb = topojson.neighbors(geoms);
    // geometry index -> pad3 id（描画対象の国だけ。南極など COUNTRY_DATA 外は null にして無視）
    const idAt = geo.features.map((f) => (f.id != null && dataFor(f.id)) ? pad3(f.id) : null);
    const link = (a, b) => {
      if (!a || !b || a === b) return;
      if (!ADJ.has(a)) ADJ.set(a, new Set());
      ADJ.get(a).add(b);
    };
    for (let i = 0; i < nb.length; i++) {
      const a = idAt[i];
      if (!a) continue;
      nb[i].forEach((j) => { const b = idAt[j]; if (b) { link(a, b); link(b, a); } });
    }
    // 海路: 監督者生成の70本を双方向で追加（両端が収録国のときだけ）。
    SEA_LINKS.forEach((pair) => {
      const a = pad3(pair[0]), b = pad3(pair[1]);
      if (dataFor(a) && dataFor(b)) { link(a, b); link(b, a); }
    });
  }

  /* ============================================================
     Map rendering
     ============================================================ */
  function renderMap() {
    projection = d3.geoNaturalEarth1();
    geoPath = d3.geoPath(projection, ctx);   // kept for centroid/bounds/area; drawing goes through buildPaths' Path2D cache

    resizeCanvas();

    zoom = d3.zoom()
      .scaleExtent([1, 100])
      .on("start", (ev) => {
        if (ev.sourceEvent) {
          state.preFocus = null;   // the user grabbed the map → this view is theirs; nothing to roll back to
          // Their own gesture ends anchor mode: a later resize should behave like a plain
          // user-panned "fit" (resetZoom), not snap back to the old auto-focus anchor.
          if (state.viewMode === "anchor") state.viewMode = "fit";
          fling.interrupted = false;
          stopFling(true);
          fling.t = 0;             // force trackFling to start sampling fresh
          captureSnap();           // freeze the current sharp frame for gesture blitting
        }
      })
      .on("zoom", (ev) => {
        state.transform = ev.transform;
        if (ev.sourceEvent) trackFling(ev.transform);
        // Blit whenever a valid (same-projection) snapshot exists: finger pans/pinches,
        // inertial fling steps AND programmatic transition ticks (focusFeature / zoom
        // buttons / the auto-focus rollback) all glide by transferring the frozen frame.
        // A fit rebuilds the projection (pathsGen++), so its snapshot is stale → full render.
        if (snap && snap.gen === pathsGen) blit();
        else render();
      })
      .on("end", (ev) => {
        transitioning = false;     // any programmatic transition is over; let the pulse redraw again
        // Starting a fling keeps blitting (its steps re-enter the zoom handler);
        // startFling() itself calls render() when it decides NOT to glide, so a released
        // gesture always terminates on a sharp frame. Programmatic transitions (focus /
        // buttons / rollback) — and any interrupted transition — land their sharp frame here.
        if (ev.sourceEvent) startFling();
        else render();
      });
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
    els.zoomIn.onclick = () => { beginTransition(); canvasSel.transition().duration(250).call(zoom.scaleBy, 1.6); };
    els.zoomOut.onclick = () => { beginTransition(); canvasSel.transition().duration(250).call(zoom.scaleBy, 1 / 1.6); };
    els.zoomReset.onclick = () => fitToFeatures(state.fittedFeatures || state.features, true);
  }

  // Match the backing store to the CSS box × device pixel ratio for crisp lines.
  function resizeCanvas() {
    const rect = els.stage.getBoundingClientRect();
    cssW = rect.width || window.innerWidth;
    cssH = rect.height || window.innerHeight;
    dpr = deviceRatio();
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    snap = null;   // backing store resized: any gesture snapshot is stale
  }

  function readColors() {
    const s = getComputedStyle(document.documentElement);
    const g = (k, fb) => (s.getPropertyValue(k).trim() || fb);
    COLORS.land = g("--land", "#aec2cc");
    COLORS.landStroke = g("--land-stroke", "#5e7b87");
    COLORS.primary = g("--primary", "#0e7c86");   // confetti color source
    COLORS.target = g("--target", "#f2a413");
    COLORS.targetLite = "#ffca5c";   // pulse peak (from the old CSS keyframe)
    COLORS.correct = g("--correct", "#1c9e5b");
    COLORS.wrong = g("--wrong", "#d64444");
    COLORS.mGood = g("--m-good", "#4caf7d");   // mastery map buckets
    COLORS.mMid = g("--m-mid", "#e8c04a");
    COLORS.mWeak = g("--m-weak", "#e07a6a");
    COLORS.heatHot = g("--heat-hot", "#d13b2a");    // たんけん: 近い / 遠い の熱色
    COLORS.heatCold = g("--heat-cold", "#9fb8c4");
    COLORS.journeyTrail = g("--journey-trail", "#bfe0e4");   // 世界一周: 訪問トレイル / あきらめ最短路
    COLORS.journeyPath = g("--journey-path", "#7fc6cd");
  }

  // Bucket a country by its recorded performance → a fill color, or null for "not seen yet".
  function masteryColor(id) {
    const s = state.stats[id];
    const seen = s ? s.c + s.w : 0;
    if (!seen) return null;                          // no record → default land color
    const rate = s.c / seen;
    if (rate >= 0.8 && seen >= 2) return COLORS.mGood;  // 習得: solid & practiced
    if (rate >= 0.5) return COLORS.mMid;                // 学習中
    return COLORS.mWeak;                                // 苦手
  }

  // 習得数 = masteryColor が good バケット（正答率≥0.8 かつ seen≥2）に入る国の数。
  function masteredCount() {
    let n = 0;
    for (const id in state.stats) { if (masteryColor(id) === COLORS.mGood) n++; }
    return n;
  }

  // 習得数に応じた七段階の称号（しきい値は習得国数）。
  const RANK_TIERS = [
    { min: 170, name: "世界マスター" },
    { min: 140, name: "世界の達人" },
    { min: 100, name: "地理博士" },
    { min: 60, name: "冒険家" },
    { min: 30, name: "旅人" },
    { min: 10, name: "まちある記" },
    { min: 0, name: "ちず見習い" },
  ];
  const rankFor = (n) => RANK_TIERS.find((t) => n >= t.min);

  // setup カードの称号行を現在の習得数から更新する。習得0のときは誘い文言。
  function updateRank() {
    if (!els.setupRank) return;
    const n = masteredCount();
    const total = Object.keys(window.COUNTRY_DATA || {}).length;
    els.setupRank.textContent = n
      ? "称号「" + rankFor(n).name + "」 — 習得 " + n + " / " + total + " か国"
      : "クイズに正解して称号を集めよう";
    els.setupRank.hidden = false;
  }

  // Build the id -> color map for 成績マップ from the current stats (non-mastered stay unset).
  function buildPaint() {
    const m = new Map();
    for (let i = 0; i < state.features.length; i++) {
      const id = pad3(state.features[i].id);
      const col = masteryColor(id);
      if (col) m.set(id, col);
    }
    return m;
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

  // The final composited fill a country shows in render(): a mark (painted on top)
  // wins, else its 成績マップ bucket, else plain land. Single source of truth for the
  // fill color so render() and blit()'s exposed-ring live draw can never disagree.
  function countryFill(id) {
    const mark = state.marks.get(id);
    if (mark) return markFill(mark);
    if (state.paint) return state.paint.get(id) || COLORS.land;
    return COLORS.land;
  }
  // Draw one country exactly as render() composites it: fill + constant-width border.
  // Shared by render()'s individual passes and blit()'s exposed-ring redraw so the
  // two paths stay pixel-identical.
  function drawCountry(id, strokeW) {
    const p = activePaths().get(id);   // LOD: same path set render/blit/featureAt agree on
    if (!p) return;
    ctx.fillStyle = countryFill(id);
    ctx.fill(p);
    if (strokeW > 0) {
      ctx.lineWidth = strokeW;
      ctx.strokeStyle = COLORS.landStroke;
      ctx.stroke(p);
    }
  }

  // LOD selectors — ONE decision, shared by render(), blit()'s exposed-ring draw and
  // featureAt() so the drawn pixels and the hit-test always use the SAME path set (the
  // pixel-exact tap invariant). Low detail only when 110m is loaded AND we are zoomed out
  // past DETAIL_SCALE; otherwise (or when 110m never arrived) always the 50m set.
  function useLow() {
    if (!lowById || !landPathLow || !projection) return false;
    const t = state.transform || d3.zoomIdentity;
    return projection.scale() * t.k < DETAIL_SCALE;
  }
  const activePaths = () => (useLow() ? pathsLow : paths);
  const activeLand = () => (useLow() ? landPathLow : landPath);
  const activeInert = () => (useLow() ? inertPathLow : inertPath);

  // Reproject every country into a cached Path2D. Called once after each projection
  // change (fitToFeatures / syncSizeNow) — the ONLY places projection.fitExtent runs —
  // so paths / landPath / boundsMap always agree with the current projection. pathGen
  // is a SEPARATE geoPath so the ctx-bound `geoPath` (used for centroid/bounds/area and
  // its context) is never repointed at a Path2D.
  function buildPaths() {
    if (!projection) return;
    pathsGen++;                    // new projection generation: any live snapshot is now stale
    if (!pathGen) pathGen = d3.geoPath(projection);   // NOT ctx-bound; feeds Path2D contexts
    paths.clear();
    boundsMap.clear();
    projCentroids.clear();
    landPath = new Path2D();
    // id なしジオメトリを1本の Path2D にまとめる（landPath と同じ手法で投影に追随）。
    inertPath = new Path2D();
    pathGen.context(inertPath);
    for (let i = 0; i < state.inertFeatures.length; i++) pathGen(state.inertFeatures[i]);
    for (let i = 0; i < state.features.length; i++) {
      const f = state.features[i];
      const id = pad3(f.id);
      const p = new Path2D();
      pathGen.context(p);
      pathGen(f);
      paths.set(id, p);
      boundsMap.set(id, geoPath.bounds(f));   // bounds() ignores the render context, so ctx-bound geoPath is safe
      projCentroids.set(id, geoPath.centroid(f));   // projected-plane centroid for the 世界一周 route line (follows re-fits)
      // Stream into landPath too (instead of Path2D.addPath, which older Safari/Firefox
      // lack). Marks stay IN landPath; render step 2 just overpaints them.
      pathGen.context(landPath);
      pathGen(f);
    }
    buildLowPaths();               // LOD low-detail set, reprojected with the same pathGen
  }

  // Build the LOW-detail (110m) path set under the SAME projection as the 50m set above,
  // so the two line up when the LOD threshold is crossed. Keyed by the SAME id list
  // (state.features): countries missing from 110m — e.g. the 12 island nations only in
  // 50m — reuse their 50m Path2D (negligible at the world zoom where low detail runs).
  // No state / boundsMap / centroids touched: culling reuses the 50m boundsMap (bounds
  // differ sub-pixel between the two atlases, harmless for a 50px-padded viewport test).
  function buildLowPaths() {
    if (!lowById) return;          // 110m not (yet) available → LOD stays off, selectors use 50m
    pathsLow.clear();
    landPathLow = new Path2D();
    // inert: prefer 110m's own id-less geometries; fall back to the 50m inertPath Path2D.
    if (lowInert.length) {
      inertPathLow = new Path2D();
      pathGen.context(inertPathLow);
      for (let i = 0; i < lowInert.length; i++) pathGen(lowInert[i]);
    } else {
      inertPathLow = inertPath;
    }
    for (let i = 0; i < state.features.length; i++) {
      const id = pad3(state.features[i].id);
      const lf = lowById.get(id);
      if (lf) {
        const p = new Path2D();
        pathGen.context(p);
        pathGen(lf);
        pathsLow.set(id, p);
        pathGen.context(landPathLow);
        pathGen(lf);
      } else {
        // absent from 110m: reuse the 50m outline (already built in the loop above) and
        // stream the 50m feature into the batched low land path.
        pathsLow.set(id, paths.get(id));
        pathGen.context(landPathLow);
        pathGen(state.byId.get(id));
      }
    }
  }

  // Does a country's projected bbox meet an arbitrary CSS rect [x0,y0,x1,y1] (expanded by
  // pad)? Screen(CSS) pos of a world point (x,y) is (t.x + t.k*x, t.y + t.k*y); we test the
  // bbox corners against the padded rect. Cheap enough for 182×frame. Shared by the viewport
  // cull (onScreen) and blit's exposed-band selection (Run 13).
  function bboxIntersects(id, t, rect, pad) {
    const b = boundsMap.get(id);
    if (!b) return true;
    const x0 = t.x + t.k * b[0][0], y0 = t.y + t.k * b[0][1];
    const x1 = t.x + t.k * b[1][0], y1 = t.y + t.k * b[1][1];
    return !(x1 < rect[0] - pad || x0 > rect[2] + pad || y1 < rect[1] - pad || y0 > rect[3] + pad);
  }
  // Viewport cull: is the country within the padded screen box? (the whole-viewport case)
  function onScreen(id, t, pad) {
    return bboxIntersects(id, t, [0, 0, cssW, cssH], pad);
  }

  // Copy the current (sharp) canvas into an offscreen buffer for gesture blitting.
  // The live canvas is guaranteed sharp here: every gesture ends with a render(). t0
  // records the transform at capture so blit() can map the snapshot to the live view.
  function captureSnap() {
    if (!canvas.width || !canvas.height) { snap = null; return; }
    if (!snapCanvas) snapCanvas = document.createElement("canvas");
    if (snapCanvas.width !== canvas.width || snapCanvas.height !== canvas.height) {
      snapCanvas.width = canvas.width;
      snapCanvas.height = canvas.height;
    }
    const sctx = snapCanvas.getContext("2d");
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, snapCanvas.width, snapCanvas.height);
    sctx.drawImage(canvas, 0, 0);
    const tr = state.transform || d3.zoomIdentity;
    snap = { canvas: snapCanvas, t0: { x: tr.x, y: tr.y, k: tr.k }, gen: pathsGen };
  }

  // Begin a programmatic zoom transition (focusFeature / zoom buttons / auto-focus rollback):
  // mark it transitioning so the pulse steps aside, force one sharp render so the frozen frame
  // matches the current projection (captureSnap assumes a sharp canvas — after a syncSizeNow
  // reproject or mid-interrupt the live canvas may be stale/soft), then snapshot it. The
  // transition's ticks then blit that frame; zoom "end" restores a sharp render + clears the flag.
  function beginTransition() {
    transitioning = true;
    render();
    captureSnap();
  }

  // The current on-screen view as a reprojection-proof geographic anchor: the world point
  // under the screen center plus the effective zoom (projection.scale()*k). invert() takes
  // PRE-transform projection-plane coords — the on-screen center cssW/2 = t.x + t.k*X, so
  // X = (cssW/2 - t.x)/t.k. Storing lon/lat instead of a raw transform makes the view
  // survive a reprojection (the explain panel open/close resizes map-stage → buildPaths).
  // Returns null when the center does not unproject (NaN) so callers can bail cleanly.
  function currentViewAnchor() {
    if (!projection) return null;
    const t = state.transform || d3.zoomIdentity;
    const inv = projection.invert([(cssW / 2 - t.x) / t.k, (cssH / 2 - t.y) / t.k]);
    if (!inv || isNaN(inv[0]) || isNaN(inv[1])) return null;
    return { geo: inv, eff: projection.scale() * t.k };
  }

  // Remember the pre-auto-focus view so nextQuestion can roll back to it. Only the FIRST
  // auto-focus of a turn is recorded — a later focus (e.g. explain after a wrong find) must
  // not overwrite the genuine user view. A user gesture clears preFocus (zoom "start").
  function savePreFocus() {
    if (state.preFocus) return;
    const anchor = currentViewAnchor();
    if (anchor) state.preFocus = anchor;   // unprojectable center → keep view (no rollback)
  }

  // Rebuild a zoom transform that puts a geographic anchor back at the screen center at its
  // saved effective zoom, using the CURRENT projection/size. Returns null when the anchor
  // does not project (NaN) so callers can fall back to a region fit.
  function anchorTransform(anchor) {
    if (!projection || !anchor) return null;
    const k = Math.max(1, Math.min(100, anchor.eff / projection.scale()));   // scaleExtent bounds
    const p = projection(anchor.geo);
    if (!p || isNaN(p[0]) || isNaN(p[1])) return null;
    const tx = cssW / 2 - k * p[0];
    const ty = cssH / 2 - k * p[1];
    return d3.zoomIdentity.translate(tx, ty).scale(k);
  }

  // Gesture frame: instead of re-drawing 182 paths, slide/scale the last sharp frame.
  // Derivation — a world point p sat on the snapshot at CSS position s0 = t0.x + t0.k*p.
  // We want it at s = t.x + t.k*p. Writing s = A + r*s0 and solving:
  //   r = t.k / t0.k     (so r*t0.k = t.k)
  //   A = t.x − r*t0.x   →   A + r*s0 = (t.x − r·t0.x) + r·(t0.x + t0.k·p) = t.x + t.k·p = s ✓
  // So translate by A then scale by r maps every snapshot pixel to its live position.
  function blit() {
    if (!snap || snap.gen !== pathsGen) { render(); return; }   // stale projection ⇒ never blit
    const t = state.transform || d3.zoomIdentity;
    const r = t.k / snap.t0.k;
    const offsetX = t.x - r * snap.t0.x;
    const offsetY = t.y - r * snap.t0.y;
    // Coverage rect R (in CSS px): where the snapshot lands on screen this frame.
    const snapW = snap.canvas.width / dpr, snapH = snap.canvas.height / dpr;
    const Rw = snapW * r, Rh = snapH * r;

    // How much of the viewport R still covers. Areas captured off-screen (blank in the
    // snapshot) show up as viewport minus R and must be drawn live, or they stay blank
    // until the gesture ends (the 2-second lag this Run fixes).
    const iw = Math.max(0, Math.min(cssW, offsetX + Rw) - Math.max(0, offsetX));
    const ih = Math.max(0, Math.min(cssH, offsetY + Rh) - Math.max(0, offsetY));
    const coverRatio = (iw * ih) / (cssW * cssH || 1);

    // Re-anchor with a sharp render + fresh snapshot when either (a) too little of the
    // frozen frame is left (fast fling / big pinch-out — the exposed ring would be most of
    // the screen), or (b) the snapshot has been scaled up past 1.5× (zoom-in transition /
    // pinch-in), where the transferred pixels turn soft. A culled render() is cheap enough
    // here and the next tick blits from the fresh, crisp image. render() BEFORE captureSnap()
    // — the latter assumes the live canvas is already sharp.
    if (coverRatio < 0.5 || r > 1.5) { render(); captureSnap(); return; }

    // Transfer the frozen frame (Run 8 math).
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.translate(offsetX, offsetY);
    ctx.scale(r, r);
    // snap.canvas backing store is cssW*dpr × cssH*dpr; drawing it at CSS size (dpr is
    // already in the transform) reproduces the same coordinate basis a render() uses.
    ctx.drawImage(snap.canvas, 0, 0, snapW, snapH);

    // R fully covers the viewport (within a px guard): nothing exposed, transfer is enough.
    const G = 0.5;
    if (offsetX <= G && offsetY <= G && offsetX + Rw >= cssW - G && offsetY + Rh >= cssH - G) return;

    // Partial cover: live-draw only the exposed region (viewport − R) with the SAME
    // per-country routine render() uses, so revealed land matches exactly. An evenodd
    // clip of viewport ⊕ R isolates the exposed ring; the transfer above keeps R itself.
    //
    // Run 13-A: the country selection tests bboxes against the EXPOSED BANDS, not the whole
    // viewport. The exposed region = viewport − (R∩viewport) is at most 4 rectangles (top /
    // bottom / left / right remainders around the covered area). On a normal pan the bands
    // are thin, so only a handful of countries stream instead of the whole on-screen set
    // (the clip already discarded their pixels, but the Path2D walk was still paying full price).
    const Ix0 = Math.max(0, offsetX), Iy0 = Math.max(0, offsetY);
    const Ix1 = Math.min(cssW, offsetX + Rw), Iy1 = Math.min(cssH, offsetY + Rh);
    const bands = [];                              // [x0,y0,x1,y1] CSS rects, ≥0.5px each
    if (Iy0 > 0.5) bands.push([0, 0, cssW, Iy0]);              // top strip (above cover)
    if (cssH - Iy1 > 0.5) bands.push([0, Iy1, cssW, cssH]);    // bottom strip
    if (Ix0 > 0.5) bands.push([0, Iy0, Ix0, Iy1]);            // left strip (beside cover)
    if (cssW - Ix1 > 0.5) bands.push([Ix1, Iy0, cssW, Iy1]);  // right strip

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const clip = new Path2D();
    clip.rect(0, 0, cssW, cssH);          // viewport
    clip.rect(offsetX, offsetY, Rw, Rh);  // snapshot coverage
    ctx.clip(clip, "evenodd");            // viewport minus R = exposed
    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);
    ctx.lineJoin = "round";
    const strokeW = 0.7 / t.k;            // same constant on-screen border as render()
    const inertP = activeInert();         // LOD: same detail level render() uses this frame
    // inert land first (as render step 0) so the exposed ring has no海色の穴 either.
    if (inertP) {
      ctx.fillStyle = COLORS.land;
      ctx.fill(inertP);
      if (strokeW > 0) { ctx.lineWidth = strokeW; ctx.strokeStyle = COLORS.landStroke; ctx.stroke(inertP); }
    }
    // Only countries whose screen bbox meets an exposed band; the clip discards the rest.
    for (let i = 0; i < state.features.length; i++) {
      const id = pad3(state.features[i].id);
      let vis = false;
      for (let b = 0; b < bands.length; b++) { if (bboxIntersects(id, t, bands[b], 2)) { vis = true; break; } }
      if (vis) drawCountry(id, strokeW);
    }
    ctx.restore();
  }

  // The map is redrawn from the Path2D cache — no per-frame reprojection. Marked
  // countries stay inside landPath and are simply overpainted opaquely on top, so
  // landPath is independent of state.marks and never needs rebuilding per answer.
  function render() {
    if (!ctx || !projection || !landPath) return;
    const t = state.transform || d3.zoomIdentity;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // work in CSS px, sharp on HiDPI
    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);
    ctx.lineJoin = "round";

    // constant on-screen stroke like SVG's non-scaling-stroke. Drawn during pans
    // and pinches too: borders vanishing mid-gesture reads as a glitch.
    const strokeW = 0.7 / t.k;
    // Viewport culling above a small zoom: when most of the world is off-screen,
    // draw only countries whose projected bbox meets the viewport. Near the world
    // view (k<=1.2) everything is visible, so the batched landPath is faster.
    const cull = t.k > 1.2;
    const PAD = 50;

    // LOD: pick the low- or high-detail path set ONCE for the whole frame (drawCountry
    // reads the same selector, so batched and per-country passes never mix detail levels).
    const inertP = activeInert(), landP = activeLand();

    // 0) id なしジオメトリを「無反応の陸地」として最下層に。各国の塗り(ステップ1)が上に乗る。
    //    5ジオメトリだけなので paint/cull のどちらの分岐でも常に一括1回で描く（カリング不要）。
    if (inertP) {
      ctx.fillStyle = COLORS.land;
      ctx.fill(inertP);
      if (strokeW > 0) { ctx.lineWidth = strokeW; ctx.strokeStyle = COLORS.landStroke; ctx.stroke(inertP); }
    }

    // 1) unmarked land. Normally the whole world as one batched fill/stroke; in
    //    成績マップ mode each country fills with its own bucket color.
    if (!state.paint) {
      if (cull) {
        // Individual per-country draw (shared with blit's exposed-ring pass via drawCountry).
        for (let i = 0; i < state.features.length; i++) {
          const id = pad3(state.features[i].id);
          if (!onScreen(id, t, PAD)) continue;
          drawCountry(id, strokeW);
        }
      } else {
        ctx.fillStyle = COLORS.land;
        ctx.fill(landP);
        if (strokeW > 0) { ctx.lineWidth = strokeW; ctx.strokeStyle = COLORS.landStroke; ctx.stroke(landP); }
      }
    } else {
      const pset = activePaths();
      for (let i = 0; i < state.features.length; i++) {
        const id = pad3(state.features[i].id);
        if (cull && !onScreen(id, t, PAD)) continue;
        ctx.fillStyle = countryFill(id);   // same color decision blit's exposed ring uses
        ctx.fill(pset.get(id));
      }
      // one batched stroke pass over the whole world (cheap: a single stroke() call)
      if (strokeW > 0) { ctx.lineWidth = strokeW; ctx.strokeStyle = COLORS.landStroke; ctx.stroke(landP); }
    }

    // 2) marked countries (usually 0-2) overpainted individually on top, via the same
    //    drawCountry routine (countryFill resolves each id's mark color) so nothing drifts.
    if (state.marks.size) {
      for (const id of state.marks.keys()) drawCountry(id, strokeW);
    }

    // 2.5) 世界一周の経路線: たどった国の投影重心を結ぶ折れ線。マークの後・ラベルの前に、
    //      画面一定幅(2/t.k)で描く。projCentroids は buildPaths で投影に追随済み。
    //      ジェスチャー中(blit)は露出領域に描かれないが、停止時の render で揃う（許容）。
    if (state.journey && state.journeyRoute && state.journeyRoute.length > 1) {
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < state.journeyRoute.length; i++) {
        const c = projCentroids.get(state.journeyRoute[i]);
        if (!c || isNaN(c[0])) continue;
        if (!started) { ctx.moveTo(c[0], c[1]); started = true; }
        else ctx.lineTo(c[0], c[1]);
      }
      ctx.lineWidth = 2 / t.k;
      ctx.strokeStyle = COLORS.primary;
      ctx.lineCap = "round";
      ctx.stroke();
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
      // A programmatic transition (e.g. this question's focusFeature) is blitting the map;
      // skip our sharp render so the two don't alternate. The pulse resumes once it ends.
      if (!transitioning) render();
      pulseRAF = requestAnimationFrame(loop);
    };
    pulseRAF = requestAnimationFrame(loop);
  }
  function stopPulse() {
    if (pulseRAF) { cancelAnimationFrame(pulseRAF); pulseRAF = 0; }
  }

  /* ------------------------------------------------------------
     Fling inertia: d3.zoom stops dead when the finger lifts, so we
     sample the drag velocity ourselves and, on release, keep
     translating with exponential decay like native scrolling.
     Programmatic zoom events have no sourceEvent and are ignored,
     so the fling's own translateBy calls don't feed back into it.
     ------------------------------------------------------------ */
  const fling = { vx: 0, vy: 0, x: 0, y: 0, k: 1, t: 0, raf: 0, interrupted: false };

  function stopFling(byPointer) {
    if (fling.raf) {
      cancelAnimationFrame(fling.raf);
      fling.raf = 0;
      // a tap that stops the glide is not an answer
      if (byPointer) fling.interrupted = true;
    }
    fling.vx = fling.vy = 0;
  }

  function trackFling(t) {
    const now = performance.now();
    const dt = now - fling.t;
    if (t.k !== fling.k || dt > 120) {
      // pinch/wheel (scale changed) or a fresh gesture — no carry-over
      fling.vx = fling.vy = 0;
    } else if (dt > 0) {
      // low-pass blend so one jittery frame doesn't set the speed
      const w = 0.7;
      fling.vx = fling.vx * (1 - w) + ((t.x - fling.x) / dt) * w;
      fling.vy = fling.vy * (1 - w) + ((t.y - fling.y) / dt) * w;
    }
    fling.x = t.x; fling.y = t.y; fling.k = t.k; fling.t = now;
  }

  function startFling() {
    const paused = performance.now() - fling.t > 100;  // finger stopped before lifting
    const speed = Math.hypot(fling.vx, fling.vy);
    if (paused || speed < 0.08) { fling.vx = fling.vy = 0; render(); return; }
    const DECAY = 0.004;   // 1/ms — glide settles in roughly a second
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(now - last, 50); last = now;
      const k = (state.transform || d3.zoomIdentity).k;
      // translateBy is in pre-scale units; divide by k to move in screen px
      canvasSel.call(zoom.translateBy, fling.vx * dt / k, fling.vy * dt / k);
      const decay = Math.exp(-DECAY * dt);
      fling.vx *= decay; fling.vy *= decay;
      const cont = Math.hypot(fling.vx, fling.vy) > 0.02;
      fling.raf = cont ? requestAnimationFrame(step) : 0;
      if (!cont) render();   // glide settled → replace the last blit with a sharp frame
    };
    fling.raf = requestAnimationFrame(step);
  }

  function fitToFeatures(features, animate) {
    state.fittedFeatures = features;
    state.preFocus = null;         // reframing the projection voids any pending auto-focus rollback
    state.viewMode = "fit";
    state.viewAnchor = null;       // a fresh fit clears any geographic rollback anchor
    resizeCanvas();
    const fc = { type: "FeatureCollection", features };
    projection.fitExtent([[20, 20], [cssW - 20, cssH - 20]], fc);
    buildPaths();                // reproject the Path2D cache to the new framing
    resetZoom(animate);
    if (!animate) render();
  }

  function resetZoom(animate) {
    stopFling();
    const sel = animate ? canvasSel.transition().duration(400) : canvasSel;
    sel.call(zoom.transform, d3.zoomIdentity);
  }

  function focusFeature(f, animate) {
    state.viewMode = "focus";
    state.viewFeature = f;
    const before = currentViewAnchor();   // the current view under the OLD projection
    if (syncSizeNow() && before) {
      // The projection was just rebuilt (e.g. the explain panel resized map-stage).
      // state.transform still describes the old projection, so reconstruct the same
      // geographic view under the new one INSTANTLY before the focus glide begins —
      // otherwise the first frame is "old transform × new projection", a different
      // place, and the glide starts from there (the reported jump). Non-animated apply;
      // snap falls back to a full render on gen mismatch, which is correct here.
      const tr = anchorTransform(before);
      if (tr) canvasSel.call(zoom.transform, tr);
    }
    applyFocus(f, animate !== false);
  }
  function applyFocus(f, animate) {
    stopFling();
    const b = geoPath.bounds(f);
    const dx = b[1][0] - b[0][0], dy = b[1][1] - b[0][1];
    const cx = (b[0][0] + b[1][0]) / 2, cy = (b[0][1] + b[1][1]) / 2;
    let scale = 0.55 / Math.max(dx / cssW, dy / cssH);
    scale = Math.max(1, Math.min(60, scale));   // deep enough for tiny islands; stays under scaleExtent's 100
    const tx = cssW / 2 - scale * cx, ty = cssH / 2 - scale * cy;
    const tr = d3.zoomIdentity.translate(tx, ty).scale(scale);
    if (animate) beginTransition();   // blit the focus glide instead of re-rendering every frame
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
    const dprNow = deviceRatio();
    if (Math.abs(w - cssW) < 0.5 && Math.abs(h - cssH) < 0.5 && dprNow === dpr) return false;
    cssW = w; cssH = h; dpr = dprNow;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    snap = null;                 // backing store resized: any gesture snapshot is stale
    const feats = state.fittedFeatures || state.features;
    projection.fitExtent([[20, 20], [cssW - 20, cssH - 20]],
      { type: "FeatureCollection", features: feats });
    buildPaths();                // reproject the Path2D cache to the resized framing
    if (state.labels) buildLabels(feats);
    return true;
  }

  function reapplyView() {
    if (state.viewMode === "focus" && state.viewFeature) applyFocus(state.viewFeature, false);
    else if (state.viewMode === "anchor" && state.viewAnchor) {
      // Re-apply the rolled-back geographic view non-animated (instant follow on resize).
      // This is the core of the fix: closing the explain panel resizes map-stage →
      // relayout → syncSizeNow (reproject) → reapplyView, and the anchor re-derives the
      // SAME view under the new projection instead of the stale transform being lost.
      const tr = anchorTransform(state.viewAnchor);
      if (tr) canvasSel.call(zoom.transform, tr);
      else resetZoom(false);
    }
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
    segGroup("sound-seg", "sound", (v) => (state.settings.sound = v === "1"));

    els.start.onclick = () => {
      if (!state.features.length) {
        if (navigator.onLine) { loadWorld(); }
        else { alert("地図データがまだありません。最初の1回だけ、ネットに接続して開いてください。"); }
        return;
      }
      store.set(SETTINGS_KEY, state.settings);
      if (state.settings.mode === "browse") startBrowse();
      else if (state.settings.mode === "progress") startProgress();
      else if (state.settings.mode === "journey") startJourney();
      else startQuiz();
    };
    els.retry.onclick = loadWorld;
    els.quit.onclick = () => {
      if (state.browsing) { showSetup(); return; }
      if (confirm("クイズをやめて設定に戻りますか？")) showSetup();
    };
    els.resultHome.onclick = showSetup;
    // Wrap so the click MouseEvent is never passed in as reviewIds. 世界一周は別セッション
    // 機構なので mode で分岐（startQuiz() 直結のままだと journey を再開できない）。
    els.resultAgain.onclick = () => { if (state.settings.mode === "journey") startJourney(); else startQuiz(); };
    els.resultRetryMissed.onclick = () => startQuiz([...new Set(state.mistakes)]);
    els.giveup.onclick = onGiveUp;
    els.hint.onclick = onHint;
    els.explainNext.onclick = onExplainNext;
  }

  // Restore a previously saved setup, validating every field before applying it.
  function applySavedSettings(s) {
    if (!s || typeof s !== "object") return;
    // explore / journey はメニューから外した（コードは残置）。保存設定に残っていても
    // ここで弾かれてデフォルトの find に落ちる。
    const modes = ["find", "name", "recall", "browse", "progress"];
    if (modes.indexOf(s.mode) !== -1) {
      state.settings.mode = s.mode;
      activateSeg("mode-seg", "mode", s.mode);
    }
    if (typeof s.region === "string" &&
        document.querySelector('#region-chips [data-region="' + s.region + '"]')) {
      state.settings.region = s.region;
      activateChip("region-chips", s.region);
    }
    if ([10, 20, 0, -1].indexOf(s.count) !== -1) {
      state.settings.count = s.count;
      activateSeg("count-seg", "count", String(s.count));
    }
    if (typeof s.explain === "boolean") {
      state.settings.explain = s.explain;
      activateSeg("explain-seg", "explain", s.explain ? "1" : "0");
    }
    if (typeof s.sound === "boolean") {
      state.settings.sound = s.sound;
      activateSeg("sound-seg", "sound", s.sound ? "1" : "0");
    }
    onModeChange(state.settings.mode);
  }

  function activateSeg(id, attr, val) {
    $(id).querySelectorAll(".seg-btn")
      .forEach((b) => b.classList.toggle("active", b.dataset[attr] === val));
  }
  function activateChip(id, region) {
    $(id).querySelectorAll(".chip")
      .forEach((b) => b.classList.toggle("active", b.dataset.region === region));
  }

  // Toggle quiz-only settings and the start button label for the study mode.
  function onModeChange(v) {
    state.settings.mode = v;
    const noQuiz = v === "browse" || v === "progress";   // non-quiz views hide count/explain/sound
    // 世界一周は3旅固定なので問題数だけ隠し、解説/効果音は出す。
    if (els.countField) els.countField.hidden = noQuiz || v === "journey";
    if (els.explainField) els.explainField.hidden = noQuiz;
    if (els.soundField) els.soundField.hidden = noQuiz;
    els.start.textContent = v === "browse" ? "地図を見る" : v === "progress" ? "成績を見る"
      : v === "explore" ? "たんけんに出る" : v === "journey" ? "旅に出る" : "スタート";
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
    clearTimeout(advanceTimer);            // cancel any queued next-question/result
    clearTimeout(hintTimer);               // cancel a pending 世界一周 hint restore
    stopConfetti();
    state.browsing = false;
    state.progressView = false;
    state.journey = false;                 // 世界一周の経路線・トレイルを次のモードへ持ち越さない
    state.journeyRoute = [];
    state.paint = null;                    // never let mastery colors bleed into other modes
    state.labels = false;
    els.stats.classList.remove("browse");
    els.setup.hidden = false;
    els.result.hidden = true;
    els.stats.hidden = true;
    els.livesStat.hidden = true;
    els.progTrack.hidden = true;
    els.promptBar.hidden = true;
    els.choices.hidden = true;
    els.zoomControls.hidden = true;
    els.masteryLegend.hidden = true;
    els.explainStats.hidden = true;
    els.explainPanel.hidden = true;
    onModeChange(state.settings.mode);
    updateRank();
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

  // 苦手・久しぶりの国ほど出やすくする重み（重み付き非復元抽出で使用）。
  function weightFor(id, now) {
    const s = state.stats[id];
    const seen = s ? s.c + s.w : 0;
    if (!seen) return 1.7;                            // 未出題をやや優先
    const wrongRate = s.w / seen;
    const days = (now - (s.last || 0)) / 86400000;    // 前回出題からの経過日数
    // 誤答率が高いほど（最大 +2.5）、久しぶりの国ほど（30日で頭打ち +0.5）重くする。
    return 1 + 2.5 * wrongRate + Math.min(days / 30, 1) * 0.5;
  }

  // reviewIds を渡すと「まちがえた国だけ復習」（count 無視）。無ければ苦手優先の通常出題。
  function startQuiz(reviewIds) {
    stopConfetti();                        // clear any celebration still falling from a prior result
    buildPool();
    // Distractors now come from state.allCountries, so any non-empty pool is quizzable.
    if (state.pool.length < 1) { alert("この地域には収録国がありません。"); return; }

    // サバイバルは「問題数=-1 かつ 復習でない」ときだけ。復習クイズは常に通常ルール。
    // たんけんはライフ制と相性が悪いのでサバイバルにしない（-1 は 10 問扱い）。
    const isExplore = state.settings.mode === "explore";
    const survival = !(reviewIds && reviewIds.length) && state.settings.count === -1 && !isExplore;

    let queue;
    if (reviewIds && reviewIds.length) {
      queue = shuffle([...new Set(reviewIds)]);
    } else {
      // Efraimidis–Spirakis A-Res: key = rand^(1/weight) を降順に取り、上位 n 件を選ぶ。
      const now = Date.now();
      const keyed = state.pool.map((c) => ({ id: c.id, key: Math.pow(Math.random(), 1 / weightFor(c.id, now)) }));
      keyed.sort((a, b) => b.key - a.key);
      let n;
      if (state.settings.count > 0) n = Math.min(state.settings.count, keyed.length);
      else if (state.settings.count === -1 && isExplore) n = Math.min(10, keyed.length);  // たんけんのサバイバル指定は 10 問
      else n = keyed.length;                                                              // この地域すべて（またはサバイバルの初期キュー）
      queue = shuffle(keyed.slice(0, n).map((x) => x.id));   // 出題順はランダム化
    }
    state.queue = queue;
    state.idx = 0; state.score = 0; state.streak = 0; state.answered = 0;
    state.mistakes = []; state.reasks = {}; state.locked = false;
    state.survival = survival; state.lives = 3; state.survivalOver = false;
    state.exploreGuesses = 0; state.exploreTried = new Set();
    state.exploreFound = 0; state.exploreTotalGuesses = 0;
    state.browsing = false;
    state.progressView = false;
    state.journey = false; state.journeyRoute = [];   // 世界一周の残骸を持ち越さない
    state.paint = null;                    // clear any mastery coloring from a prior view

    els.setup.hidden = true;
    els.result.hidden = true;
    els.stats.hidden = false;
    els.progTrack.hidden = survival;       // サバイバルは長さが不定なのでバーを出さない
    els.livesStat.hidden = !survival;      // ライフ表示はサバイバルのみ
    if (survival) updateLives();
    els.zoomControls.hidden = false;
    els.masteryLegend.hidden = true;

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

  // サバイバル用のキュー補充: 直近3問を除いた pool から A-Res 重み付きで10問追加。
  // pool が3以下の小地域では除外すると候補が枯れるので除外しない。
  function extendQueue() {
    const now = Date.now();
    const recent = new Set(state.queue.slice(Math.max(0, state.idx - 2), state.idx + 1));
    let cands = state.pool;
    if (state.pool.length > 3) cands = state.pool.filter((c) => !recent.has(c.id));
    const keyed = cands.map((c) => ({ id: c.id, key: Math.pow(Math.random(), 1 / weightFor(c.id, now)) }));
    keyed.sort((a, b) => b.key - a.key);
    const take = Math.min(10, keyed.length);
    for (let i = 0; i < take; i++) state.queue.push(keyed[i].id);
  }

  function nextQuestion() {
    // サバイバルは無限出題: 残り2問未満になったらキューを補充し、endQuiz の
    // 到達条件（idx >= queue.length）を踏まないようにする。
    if (state.survival && state.queue.length - state.idx < 2) extendQueue();
    if (state.idx >= state.queue.length) { endQuiz(); return; }
    state.locked = false;
    els.explainPanel.hidden = true;
    clearMapStates();
    updateProgress();
    // A previous wrong answer / explanation panel may have zoomed onto one country. Roll
    // that AUTO-focus back to the view the player had just before it (preFocus) — but only
    // the app's own focus: a user gesture cleared preFocus, so their own pan/zoom is kept
    // (this replaces Run 2's always-re-fit, which was the "zoom keeps snapping back" annoyance).
    // NAME mode re-frames itself via focusFeature every question, so it is left untouched.
    if (state.settings.mode === "find" || state.settings.mode === "explore") {
      if (state.preFocus) {
        const tr = anchorTransform(state.preFocus);
        if (tr) {
          // Enter "anchor" view: the geographic anchor survives later reprojections (the
          // explain-panel-close resize), so reapplyView keeps re-deriving this same view
          // instead of the old gen-mismatch fallback that re-fit to the whole region.
          state.viewMode = "anchor";
          state.viewAnchor = state.preFocus;
          state.viewFeature = null;
          beginTransition();             // glide back via blit
          canvasSel.transition().duration(400).call(zoom.transform, tr);
        } else {
          // Anchor does not project (degenerate): fall back to a fresh region fit.
          fitToFeatures(state.fittedFeatures || state.features, true);
        }
        state.preFocus = null;
      }
    }
    const c = currentCountry();
    if (state.settings.mode === "find") askFind(c);
    else if (state.settings.mode === "explore") askExplore(c);
    else if (state.settings.mode === "recall") askRecall(c);
    else askName(c);
  }

  // ---- FIND mode: show a name, tap the country ----
  function askFind(c) {
    els.choices.hidden = true;
    els.promptBar.hidden = false;
    els.giveup.hidden = true;                 // たんけん / 世界一周 専用ボタン
    els.hint.hidden = true;
    els.promptHint.textContent = "地図をタップ";
    els.promptKicker.textContent = "この国はどこ？";
    els.promptTarget.textContent = c.ja;
  }

  /* ============================================================
     たんけん (explore) — Globle 型。謎の国を、タップした国が距離に応じて
     熱色に染まる手がかりを頼りに探し当てる。推測タップは stats を汚さない
     （ソナーとして使っただけ）— 発見/ギブアップのみ finishTurn を通す。
     ============================================================ */
  // ---- EXPLORE mode: hidden target, tap countries for distance heat hints ----
  function askExplore(c) {
    els.choices.hidden = true;
    els.promptBar.hidden = false;
    els.giveup.hidden = false;
    els.giveup.textContent = "ギブアップ";     // 世界一周が「あきらめる」に書き換えるので戻す
    els.hint.hidden = true;
    els.promptKicker.textContent = "なぞの国はどこ？";
    els.promptTarget.textContent = "???";
    state.exploreGuesses = 0;
    state.exploreTried = new Set();
    state.paint = new Map();                   // 問ごとに真新しい熱マップへ張り替え（他モードへ漏れない）
    updateExploreHint();
    render();
  }

  function updateExploreHint() {
    els.promptHint.textContent = "試行 " + state.exploreGuesses + "回";
  }

  // Great-circle distance between two countries' spherical centroids, in km.
  function exploreKm(f, c) {
    const a = geoCentroids.get(pad3(f.id));
    const b = geoCentroids.get(c.id);
    if (!a || !b) return Infinity;
    return d3.geoDistance(a, b) * 6371;        // 地球半径 6371km
  }

  // Toast wording by distance band (数値は toLocaleString で桁区切り)。
  function heatMsg(km) {
    const s = Math.round(km).toLocaleString();
    if (km >= 6500) return "❄️ つめたい… 約" + s + "km";
    if (km >= 3000) return "🌤 まだ遠い 約" + s + "km";
    if (km >= 1000) return "🔥 あつい！ 約" + s + "km";
    return "🔥🔥 めちゃくちゃ近い！ 約" + s + "km";
  }

  function onExploreGuess(f) {
    const c = currentCountry();
    const gid = pad3(f.id);

    if (gid === c.id) {                         // 発見！
      state.locked = true;
      state.exploreGuesses++;
      els.giveup.hidden = true;
      setMark(c.id, "correct");
      render();
      scoreCorrect();
      state.exploreFound++;
      state.exploreTotalGuesses += state.exploreGuesses;
      toast("🎉 " + state.exploreGuesses + "回で発見！", "ok");
      // 4回以内で見つけたら「正解」として stats に記録（finishTurn → recordAnswer）。
      finishTurn(c, state.exploreGuesses <= 4, 1600);
      return;
    }

    const km = exploreKm(f, c);
    // 未タップの国だけ試行を数え、熱色を塗る。同じ国の再タップはトーストだけ再表示。
    if (!state.exploreTried.has(gid)) {
      state.exploreTried.add(gid);
      state.exploreGuesses++;
      const t = Math.pow(Math.max(0, 1 - km / 6500), 1.35);   // 6500km 以遠は t=0
      state.paint.set(gid, lerpColor(COLORS.heatCold, COLORS.heatHot, t));
      render();
      updateExploreHint();
    }
    toast(heatMsg(km), "");
  }

  // ギブアップ: 正解を見せ、scoreWrong で mistakes に入れて（復習ボタンが効く）finishTurn へ。
  function onGiveUp() {
    if (state.settings.mode === "journey") { onJourneyGiveUp(); return; }
    if (state.locked || state.settings.mode !== "explore") return;
    state.locked = true;
    els.giveup.hidden = true;
    const c = currentCountry();
    setMark(c.id, "correct");
    render();
    toast("正解は " + c.ja + " でした", "ng");
    scoreWrong(c.id);
    // find の不正解と同じく、解説オフのときだけ自前でズーム（オンなら showExplain が寄せる）。
    // 巻き戻し用に直前の視点を保存してからフォーカス。
    if (!state.settings.explain) { savePreFocus(); focusFeature(c.feature); }
    finishTurn(c, false, 2200);
  }

  /* ============================================================
     世界一周 (journey) — スタート国からゴール国へ、隣の国だけをタップして移動する旅。
     1セッション=3旅（前の旅の終了地点が次の旅のスタート）。隣接は ADJ（陸国境+海路）。
     このモードは stats / mistakes / recordAnswer を一切使わない（別スキルなので学習記録を汚さない）。
     ============================================================ */
  let hintTimer;

  // BFS: id から全到達国への最短手数と直前ノード。ゴール選定・目安手数・あきらめ最短路に共用。
  function bfsFrom(id) {
    const dist = new Map([[id, 0]]);
    const prev = new Map();
    const q = [id];
    for (let h = 0; h < q.length; h++) {
      const cur = q[h];
      const nb = ADJ.get(cur);
      if (!nb) continue;
      const d = dist.get(cur) + 1;
      nb.forEach((n) => { if (!dist.has(n)) { dist.set(n, d); prev.set(n, cur); q.push(n); } });
    }
    return { dist, prev };
  }

  // このセッション最初のスタート国。region=all は日本(392)、それ以外は pool からランダム。
  function pickJourneyStart() {
    if (state.settings.region === "all" && state.pool.some((c) => c.id === "392")) return "392";
    return state.pool[(Math.random() * state.pool.length) | 0].id;
  }

  // スタートから BFS で 4〜9 手の pool 内の国をゴールに。無ければ 2〜11、それも無ければ pool から。
  function pickJourneyGoal(startId, dist) {
    const inRange = (lo, hi) => state.pool
      .filter((c) => { const d = dist.get(c.id); return d != null && d >= lo && d <= hi && c.id !== startId; })
      .map((c) => c.id);
    let cands = inRange(4, 9);
    if (!cands.length) cands = inRange(2, 11);
    if (!cands.length) cands = state.pool.filter((c) => c.id !== startId).map((c) => c.id);
    if (!cands.length) cands = [startId];   // pool に1国しか無いときの退避
    return cands[(Math.random() * cands.length) | 0];
  }

  function journeyFitFeatures() {
    return state.settings.region === "all" ? state.features : state.pool.map((c) => c.feature);
  }

  function startJourney() {
    stopConfetti();
    buildPool();
    if (state.pool.length < 2) { alert("この地域には旅ができるほどの国がありません。"); return; }

    state.journey = true;
    state.browsing = false;
    state.progressView = false;
    state.survival = false;
    state.survivalOver = false;
    state.locked = false;
    state.paint = null;
    state.labels = false;
    state.mistakes = [];                    // 復習ボタンを出さない（journey は mistakes を使わない）
    state.journeyLeg = 0; state.journeyStars = 0; state.journeyShortest = 0; state.journeyMisses = 0;
    state.journeyRoute = [];

    els.setup.hidden = true;
    els.result.hidden = true;
    els.stats.hidden = false;
    els.stats.classList.remove("browse");
    els.livesStat.hidden = true;
    els.progTrack.hidden = false;
    els.choices.hidden = true;
    els.zoomControls.hidden = false;
    els.masteryLegend.hidden = true;
    els.explainPanel.hidden = true;

    clearMapStates();
    newLeg(pickJourneyStart());
  }

  // 1つの旅の開始（startId から）。ゴールを選び、トレイル/経路/HUD を初期化して region にフィット。
  function newLeg(startId) {
    clearTimeout(hintTimer);
    state.locked = false;
    els.explainPanel.hidden = true;
    els.promptBar.hidden = false;
    els.choices.hidden = true;
    els.hint.hidden = false;
    els.giveup.hidden = false;
    els.giveup.textContent = "あきらめる";

    const { dist } = bfsFrom(startId);
    const goal = pickJourneyGoal(startId, dist);
    state.journeyCurrent = startId;
    state.journeyGoal = goal;
    state.journeyBest = dist.get(goal) || 0;
    state.journeyMoves = 0;
    state.journeyHints = 0;
    state.journeyRoute = [startId];
    state.paint = new Map([[startId, COLORS.journeyTrail]]);   // 訪問トレイル（現在地は mark で上塗り）
    state.marks.clear();
    setMark(startId, "hi");

    els.progFill.style.width = (state.journeyLeg / 3 * 100) + "%";
    updateJourneyStats();
    updateJourneyHud();
    fitToFeatures(journeyFitFeatures(), true);
  }

  function updateJourneyStats() {
    els.score.firstChild.textContent = state.journeyStars;
    els.answered.textContent = "/9";       // ☆合計 / 9
    els.streak.textContent = state.journeyMoves;   // 「連続」欄を手数に流用
  }
  function updateJourneyHud() {
    const gf = state.byId.get(state.journeyGoal);
    els.promptKicker.textContent = (gf ? withFlag(state.journeyGoal, nameOf(gf)) : "?") + " をめざせ！";
    const cf = state.byId.get(state.journeyCurrent);
    els.promptTarget.textContent = cf ? nameOf(cf) : "";
    els.promptHint.textContent = "手数 " + state.journeyMoves + " / 目安 " + state.journeyBest;
  }

  // 移動タップ。現在地=無視 / 隣接=移動（ゴールなら到達） / 非隣接=ミス（移動しない）。
  function onJourneyTap(f) {
    const gid = pad3(f.id);
    if (gid === state.journeyCurrent) return;
    const nb = ADJ.get(state.journeyCurrent);
    if (!nb || !nb.has(gid)) {
      buzz(30);
      const cf = state.byId.get(state.journeyCurrent);
      toast(nameOf(f) + " は " + (cf ? nameOf(cf) : "") + " のとなりではありません", "ng");
      state.journeyMisses++;
      return;
    }
    // 移動
    clearTimeout(hintTimer);               // 移動したらヒント表示を確定的に片付ける
    state.journeyCurrent = gid;
    state.journeyMoves++;
    state.journeyRoute.push(gid);
    state.paint.set(gid, COLORS.journeyTrail);
    state.marks.clear();
    setMark(gid, "hi");
    updateJourneyStats();
    updateJourneyHud();
    if (gid === state.journeyGoal) { onJourneyArrive(); return; }
    render();
  }

  function onJourneyArrive() {
    state.locked = true;
    els.hint.hidden = true;
    els.giveup.hidden = true;
    state.marks.clear();
    setMark(state.journeyGoal, "correct");
    render();
    buzz(15); soundCorrect();
    // 星評価: 最短&ヒント0 → ☆3、最短+2以内 → ☆2、それ以外 → ☆1
    let stars;
    if (state.journeyMoves === state.journeyBest && state.journeyHints === 0) stars = 3;
    else if (state.journeyMoves <= state.journeyBest + 2) stars = 2;
    else stars = 1;
    state.journeyStars += stars;
    if (state.journeyMoves === state.journeyBest) state.journeyShortest++;
    updateJourneyStats();
    const starStr = "★".repeat(stars) + "☆".repeat(3 - stars);
    toast("🎉 とうちゃく！ " + starStr + (stars === 3 ? " 最短ルート！" : ""), "ok");
    finishLeg(true);
  }

  function onJourneyGiveUp() {
    if (state.locked || state.settings.mode !== "journey") return;
    state.locked = true;
    els.hint.hidden = true;
    els.giveup.hidden = true;
    clearTimeout(hintTimer);
    // 現在地からゴールまでの最短路を復元して濃い色で描く。
    const { prev } = bfsFrom(state.journeyCurrent);
    const path = [];
    let n = state.journeyGoal;
    if (n === state.journeyCurrent || prev.has(n)) {
      while (n != null) { path.unshift(n); if (n === state.journeyCurrent) break; n = prev.get(n); }
    }
    if (path.length > 1) {
      path.forEach((id) => state.paint.set(id, COLORS.journeyPath));
      state.journeyRoute = path;
    }
    state.marks.clear();
    setMark(state.journeyGoal, "correct");
    render();
    const remain = path.length > 1 ? path.length - 1 : 0;
    toast("最短ルートはあと " + remain + " 手でした", "");
    finishLeg(false);                      // ☆0
  }

  // 現在地の全隣接国を1.2秒だけ mark "target" で光らせる。旅をまたいだら復元しない。
  function onHint() {
    if (state.locked || state.settings.mode !== "journey") return;
    const nb = ADJ.get(state.journeyCurrent);
    if (!nb || !nb.size) return;
    state.journeyHints++;
    nb.forEach((id) => { if (state.byId.has(id)) setMark(id, "target"); });
    setMark(state.journeyCurrent, "hi");   // 現在地は残す
    render();
    clearTimeout(hintTimer);
    const leg = state.journeyLeg;
    hintTimer = setTimeout(() => {
      if (!state.journey || leg !== state.journeyLeg) return;   // 旅が進んでいたら無効
      state.marks.clear();
      setMark(state.journeyCurrent, "hi");
      render();
    }, 1200);
  }

  // 旅の完了処理: 進捗を進め、解説オンなら ゴール国の解説パネル、オフなら遅延後に次の旅へ。
  function finishLeg(arrived) {
    state.journeyLeg++;
    els.progFill.style.width = (state.journeyLeg / 3 * 100) + "%";
    if (state.settings.explain) {
      const f = state.byId.get(state.journeyGoal);
      const c = { id: state.journeyGoal, ja: nameOf(f), region: regionOf(f), feature: f };
      showExplain(c, arrived);             // 既存パネルを流用（stats は書かない）
      els.explainBadge.textContent = arrived ? "とうちゃく" : "ゴール";
    } else {
      clearTimeout(advanceTimer);
      advanceTimer = setTimeout(advanceJourney, arrived ? 1800 : 3000);
    }
  }

  function advanceJourney() {
    if (state.journeyLeg >= 3) { endJourney(); return; }
    newLeg(state.journeyCurrent);          // 前旅の終了地点が次のスタート
  }

  function endJourney() {
    els.progFill.style.width = "100%";
    els.promptBar.hidden = true;
    els.choices.hidden = true;
    els.explainPanel.hidden = true;
    els.stats.hidden = true;
    els.livesStat.hidden = true;
    els.hint.hidden = true;
    els.giveup.hidden = true;
    state.journey = false;
    state.journeyRoute = [];
    clearMapStates();

    els.resultEyebrow.textContent = "世界一周おつかれさま！";
    els.resultNum.textContent = state.journeyStars;
    els.resultDen.textContent = "/ 9";
    els.resultPct.textContent = "最短一致 " + state.journeyShortest + "回";
    // mistakes 空なので復習系は出さない。「もう一度」を primary に。
    els.resultReview.hidden = true;
    els.resultRetryMissed.hidden = true;
    els.resultAgain.className = "btn primary";
    els.result.hidden = false;
    if (state.journeyStars === 9) { soundFanfare(); startConfetti(); }   // 全旅最短のパーフェクト
  }

  // Pixel-exact hit testing: test the pointer against the SAME cached Path2D objects
  // render() draws, under the SAME dpr+zoom transform. isPointInPath/Stroke take the
  // point in backing-store px and transform the path by the CTM, so this matches what's
  // on screen exactly — no projection.invert / spherical-vs-planar drift.
  function featureAt(mx, my) {
    if (!ctx || !projection) return null;
    const t = state.transform || d3.zoomIdentity;
    const px = mx * dpr, py = my * dpr;   // isPointInPath wants backing-store px
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);
    const pset = activePaths();   // LOD: hit-test the SAME path set on screen this frame
    let hit = null;
    for (let i = 0; i < state.features.length; i++) {
      const f = state.features[i];
      const p = pset.get(pad3(f.id));
      if (p && ctx.isPointInPath(p, px, py)) { hit = f; break; }
    }
    // Near-miss fallback: if the tap landed on ocean but a country's border is
    // within ~8 CSS px, snap to it (helps tap tiny island nations). We stroke each
    // path with a fat pen and test isPointInStroke. lineWidth is in the zoomed user
    // space, so 16/t.k keeps the tolerance a constant ~8 CSS px on screen regardless
    // of zoom. Multiple hits → pick the smallest country so islands beat big neighbours.
    if (!hit) {
      ctx.lineWidth = 16 / t.k;   // restored by ctx.restore() below
      let bestArea = Infinity;
      for (let i = 0; i < state.features.length; i++) {
        const f = state.features[i];
        const p = pset.get(pad3(f.id));
        if (p && ctx.isPointInStroke(p, px, py)) {
          const a = geoPath.area(f);
          if (a < bestArea) { bestArea = a; hit = f; }
        }
      }
    }
    ctx.restore();
    return hit;
  }

  function onCanvasClick(ev) {
    if (fling.interrupted) { fling.interrupted = false; return; }
    if (syncSizeNow()) { reapplyView(); render(); }   // backstop: never test a stale map
    const [mx, my] = d3.pointer(ev, canvas);
    const f = featureAt(mx, my);
    if (!f) return;                        // tapped ocean — ignore

    if (state.browsing) { showBrowseDetail(f); return; }
    if (state.locked) return;
    if (state.settings.mode === "explore") { onExploreGuess(f); return; }
    if (state.settings.mode === "journey") { onJourneyTap(f); return; }
    if (state.settings.mode !== "find") return;

    state.locked = true;
    const c = currentCountry();
    const correct = pad3(f.id) === c.id;

    setMark(c.id, "correct");              // always reveal where it actually was
    if (!correct) setMark(pad3(f.id), "wrong");
    render();

    if (correct) {
      scoreCorrect();
      toast(correctMsg(), "ok");
    } else {
      scoreWrong(c.id);
      toast("正解は " + c.ja, "ng");
      // Burn the location in: zoom to where it actually was. When explain is on,
      // showExplain already focuses this feature, so only do it ourselves when it's off.
      // Save the current view first so nextQuestion can roll this auto-focus back.
      if (!state.settings.explain) { savePreFocus(); focusFeature(c.feature); }
    }
    finishTurn(c, correct, correct ? 900 : 2200);
  }

  // Pick n plausible wrong answers, preferring geographically close countries so the
  // choices actually test knowledge. Rings: same subregion → same continent → anywhere.
  // Source is state.allCountries (not the region-filtered pool) so region-limited and
  // review quizzes still get a full, varied set of distractors.
  function pickDistractors(c, n = 3) {
    const sub = SUBREGION_OF.get(c.id);
    const rest = state.allCountries.filter((x) => x.id !== c.id);
    const rings = [
      sub ? rest.filter((x) => SUBREGION_OF.get(x.id) === sub) : [],
      rest.filter((x) => x.region === c.region),
      rest,
    ];
    const out = [];
    const used = new Set();
    for (let r = 0; r < rings.length && out.length < n; r++) {
      const ring = shuffle(rings[r].slice());
      for (let i = 0; i < ring.length && out.length < n; i++) {
        if (used.has(ring[i].id)) continue;
        used.add(ring[i].id);
        out.push(ring[i]);
      }
    }
    return out;
  }

  // ---- NAME mode: highlight a country, pick its name ----
  function askName(c) {
    els.promptBar.hidden = true;
    els.choices.hidden = false;
    els.choicesKicker.textContent = "ハイライトされた国は？";   // recall モードが書き換えるので戻す

    setMark(c.id, "target");
    render();
    startPulse();
    focusFeature(c.feature);

    // build 4 choices: correct + 3 distractors drawn from the nearest countries first
    const others = pickDistractors(c, 3);
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
      toast(correctMsg(), "ok");
    } else {
      btn.classList.add("wrong");
      setMark(c.id, "wrong");
      scoreWrong(c.id);
      toast("正解は " + c.ja, "ng");
    }
    render();
    finishTurn(c, correct, correct ? 900 : 1400);
  }

  /* ============================================================
     名前を思い出す (recall) — 選択肢に頼らず国名を言えるようにするモード。
     フェーズ1: 国をハイライトし「はっきり思い浮かべてみよう」＋『思い浮かべた！』ボタンのみ。
     フェーズ2: 6択で答え合わせ — 国名4つ＋「ここにはなかった」＋「わからなかった」。
     正解名が選択肢に混ざるのは8割（2割は「ここにはなかった」が正解）なので、
     先に自力で名前を確定していないと答えられない。
     ============================================================ */
  function askRecall(c) {
    els.promptBar.hidden = true;
    els.choices.hidden = false;

    setMark(c.id, "target");
    render();
    startPulse();
    focusFeature(c.feature);

    els.choicesKicker.textContent = "この国の名前は？はっきり思い浮かべてみよう";
    els.choicesGrid.innerHTML = "";
    const btn = document.createElement("button");
    btn.className = "choice span2 recall-go";
    btn.textContent = "思い浮かべた！";
    btn.onclick = () => showRecallChoices(c);
    els.choicesGrid.appendChild(btn);
  }

  function showRecallChoices(c) {
    if (state.locked) return;
    els.choicesKicker.textContent = "思い浮かべた名前はある？";
    const present = Math.random() < 0.8;   // 正解名を選択肢に混ぜる確率（8割。「ここにはなかった」が正解なのは2割）
    const opts = present
      ? shuffle([c, ...pickDistractors(c, 3)])
      : shuffle(pickDistractors(c, 4));
    els.choicesGrid.innerHTML = "";
    opts.forEach((o) => {
      const btn = document.createElement("button");
      btn.className = "choice";
      btn.textContent = o.ja;
      btn.onclick = () => onRecallChoice(o.id === c.id, c, btn, present);
      els.choicesGrid.appendChild(btn);
    });
    const none = document.createElement("button");
    none.className = "choice not-here";
    none.textContent = "ここにはなかった";
    none.dataset.nothere = "1";
    none.onclick = () => onRecallChoice(!present, c, none, present);
    els.choicesGrid.appendChild(none);
    // 6つ目: 思い浮かべられなかったときの正直な逃げ道。常に不正解扱いだが、
    // 誤答ボタンの赤フラッシュは付けない（当て推量の失敗とは区別する）。
    const idk = document.createElement("button");
    idk.className = "choice not-here";
    idk.textContent = "わからなかった";
    idk.dataset.idk = "1";
    idk.onclick = () => onRecallChoice(false, c, idk, present);
    els.choicesGrid.appendChild(idk);
  }

  function onRecallChoice(correct, c, btn, present) {
    if (state.locked) return;
    state.locked = true;
    stopPulse();
    els.choicesGrid.querySelectorAll(".choice").forEach((b) => {
      b.disabled = true;
      const isAnswer = present ? b.textContent === c.ja : b.dataset.nothere === "1";
      if (isAnswer) b.classList.add("correct");
    });
    if (correct) {
      setMark(c.id, "correct");
      scoreCorrect();
      // 「ここにはなかった」正解のときも国名を必ず見せて答え合わせにする。
      toast(correctMsg() + "（" + c.ja + "）", "ok");
    } else {
      if (!btn.dataset.idk) btn.classList.add("wrong");   // 「わからなかった」は赤くしない
      setMark(c.id, "wrong");
      scoreWrong(c.id);
      toast("正解は " + c.ja, "ng");
    }
    render();
    finishTurn(c, correct, correct ? 1100 : 1600);
  }

  /* ============================================================
     Scoring & flow
     ============================================================ */
  function scoreCorrect() { state.score++; state.streak++; state.answered++; buzz(15); soundCorrect(); updateStats(); }
  // Celebrate every 5th consecutive correct answer (call AFTER scoreCorrect bumps the streak).
  function correctMsg() {
    return state.streak >= 5 && state.streak % 5 === 0 ? "🔥 " + state.streak + "連続正解！" : "正解！";
  }
  function scoreWrong(id) { state.streak = 0; state.answered++; state.mistakes.push(id); buzz(60); soundWrong(); updateStats(); }

  // Persist a per-country tally. Called only from finishTurn to avoid double counting.
  function recordAnswer(id, correct) {
    let s = state.stats[id];
    if (!s) { s = { c: 0, w: 0, last: 0 }; state.stats[id] = s; }
    if (correct) s.c++; else s.w++;
    s.last = Date.now();
    store.set(STATS_KEY, state.stats);
  }

  // Session-only re-ask: slip a missed country back a few questions ahead (max 2×/id).
  function reaskLater(id) {
    if ((state.reasks[id] || 0) >= 2) return;
    if (state.queue.includes(id, state.idx + 1)) return;   // already scheduled ahead
    const at = Math.min(state.idx + 3 + ((Math.random() * 3) | 0), state.queue.length);
    state.queue.splice(at, 0, id);
    state.reasks[id] = (state.reasks[id] || 0) + 1;
  }

  // After an answer: either show the explanation panel (解説モード) or auto-advance.
  function finishTurn(c, correct, ms) {
    recordAnswer(c.id, correct);
    if (state.survival) {
      // ライフの減算はここ一箇所だけ（二重減算防止）。無限出題なので再挿入はしない。
      if (!correct) { state.lives--; updateLives(); }
      if (state.lives <= 0) state.survivalOver = true;
    } else if (!correct && state.settings.mode !== "explore") {
      reaskLater(c.id);   // たんけんは固定キュー（再挿入しない）
    }
    if (state.settings.explain) {
      showExplain(c, correct);
    } else {
      advanceAfter(ms);
    }
  }

  // 残りライフを ♥、失った分を ♡ で表示（例: 2機 → "♥♥♡"）。
  function updateLives() {
    const left = Math.max(0, state.lives);
    els.lives.textContent = "♥".repeat(left) + "♡".repeat(Math.max(0, 3 - left));
  }

  function showExplain(c, correct) {
    const info = infoFor(c.id);
    els.explainBadge.hidden = false;
    els.explainBadge.textContent = correct ? "正解" : "不正解";
    els.explainBadge.className = "explain-badge " + (correct ? "ok" : "ng");
    els.explainName.textContent = withFlag(c.id, c.ja);
    els.explainRegion.textContent = REGION_LABEL[c.region] || "";
    els.explainCap.textContent = info && info.cap ? "首都: " + info.cap : "";
    els.explainCap.hidden = !(info && info.cap);
    els.explainNote.textContent = info && info.note ? info.note : "この国の解説データはまだありません。";
    els.explainStats.hidden = true;        // quiz explanation never shows the mastery tally
    // ライフ切れ（この解説を見た後で結果へ）のときはボタン文言を変える。
    els.explainNext.textContent = state.survivalOver ? "結果へ →" : "次へ →";
    els.promptBar.hidden = true;
    els.choices.hidden = true;
    els.explainPanel.hidden = false;
    // find/explore: save the pre-focus view so nextQuestion rolls this focus back. NAME
    // mode focuses every question by design (no rollback), and journey uses its own flow,
    // so neither records preFocus.
    if (state.settings.mode === "find" || state.settings.mode === "explore") savePreFocus();
    // Focus AFTER the panel is shown so the map is already at its final size.
    focusFeature(c.feature);
  }

  // Advance (quiz) or just close the panel (browse), depending on mode.
  function onExplainNext() {
    els.explainPanel.hidden = true;
    if (state.browsing) { clearMapStates(); return; }   // keep browsing & labels
    if (state.journey) { advanceJourney(); return; }     // 世界一周: 次の旅（または結果）へ
    if (state.survivalOver) { endQuiz(); return; }       // ライフ切れ: フィードバックを見た後で終了
    state.idx++;
    nextQuestion();
  }

  // Hold the timer id so quitting to setup (showSetup) can cancel a pending advance —
  // otherwise a queued next-question / result could pop up over the setup screen.
  let advanceTimer;
  function advanceAfter(ms) {
    clearTimeout(advanceTimer);
    advanceTimer = setTimeout(() => {
      if (state.survivalOver) { endQuiz(); return; }     // ライフ切れ: 遅延後に終了
      state.idx++; nextQuestion();
    }, ms);
  }

  /* ============================================================
     Browse (study) mode — labeled map, tap a country for details
     ============================================================ */
  function startBrowse() {
    buildPool();
    if (!state.pool.length) { alert("この地域には収録国がありません。"); return; }
    state.browsing = true;
    state.progressView = false;
    state.journey = false; state.journeyRoute = [];
    state.paint = null;                    // plain browse: no mastery coloring
    state.locked = false;

    els.setup.hidden = true;
    els.result.hidden = true;
    els.stats.hidden = false;
    els.stats.classList.add("browse");     // keep only the ✕ in the top bar
    els.livesStat.hidden = true;
    els.progTrack.hidden = true;
    els.promptBar.hidden = true;
    els.choices.hidden = true;
    els.zoomControls.hidden = false;
    els.masteryLegend.hidden = true;
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

  /* ============================================================
     Mastery map (成績マップ) — browse variant tinted by past results
     ============================================================ */
  function startProgress() {
    buildPool();
    if (!state.pool.length) { alert("この地域には収録国がありません。"); return; }
    state.browsing = true;                 // reuse browse tap→detail + ✕→setup behavior
    state.progressView = true;
    state.journey = false; state.journeyRoute = [];
    state.locked = false;
    state.paint = buildPaint();            // tint land by mastery bucket

    els.setup.hidden = true;
    els.result.hidden = true;
    els.stats.hidden = false;
    els.stats.classList.add("browse");     // keep only the ✕ in the top bar
    els.livesStat.hidden = true;
    els.progTrack.hidden = true;
    els.promptBar.hidden = true;
    els.choices.hidden = true;
    els.zoomControls.hidden = false;
    els.masteryLegend.hidden = false;
    els.explainPanel.hidden = true;

    clearMapStates();                      // clears marks, then render() paints via state.paint
    const feats = state.settings.region === "all"
      ? state.features
      : state.pool.map((c) => c.feature);
    state.labels = true;
    fitToFeatures(feats, true);
    buildLabels(feats);
    render();
    toast("緑=習得 黄=学習中 赤=苦手。タップで成績が見られます", "");
  }

  function showBrowseDetail(f) {
    const id = pad3(f.id);
    clearMapStates();
    setMark(id, "hi");
    render();
    const info = infoFor(id);
    els.explainBadge.hidden = true;        // no 正解/不正解 badge when just browsing
    els.explainName.textContent = withFlag(id, nameOf(f));
    els.explainRegion.textContent = REGION_LABEL[regionOf(f)] || "";
    els.explainCap.textContent = info && info.cap ? "首都: " + info.cap : "";
    els.explainCap.hidden = !(info && info.cap);
    els.explainNote.textContent = info && info.note ? info.note : "この国の解説データはまだありません。";
    // In 成績マップ mode, show this country's tally; otherwise the row stays hidden.
    if (state.progressView) {
      const s = state.stats[id];
      const seen = s ? s.c + s.w : 0;
      els.explainStats.textContent = seen
        ? "正解 " + s.c + "回 / まちがい " + s.w + "回（正答率 " + Math.round((s.c / seen) * 100) + "%）"
        : "まだ出題されていません";
      els.explainStats.hidden = false;
    } else {
      els.explainStats.hidden = true;
    }
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
    if (state.survival) return;            // 長さ不定: ゼロ除算・見た目の混乱を避ける
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
    els.livesStat.hidden = true;
    clearMapStates();

    let celebrate = false;                 // perfect run / survival best → fanfare + confetti

    if (state.survival) {
      // サバイバルはスコア（正解数）と自己ベストを見せる。
      const key = state.settings.mode + ":" + state.settings.region;
      const bests = store.get(BEST_KEY, {});
      const safe = bests && typeof bests === "object" && !Array.isArray(bests) ? bests : {};
      const hadRecord = Object.prototype.hasOwnProperty.call(safe, key);
      const prev = hadRecord ? safe[key] : 0;
      const isBest = state.score > prev;
      if (isBest) { safe[key] = state.score; store.set(BEST_KEY, safe); }
      els.resultEyebrow.textContent = "サバイバル終了！";
      els.resultNum.textContent = state.score;
      els.resultDen.textContent = "問";
      els.resultPct.textContent = (isBest && hadRecord)
        ? "🎉 自己ベスト更新！"
        : "自己ベスト: " + Math.max(prev, state.score);
      celebrate = isBest && hadRecord;     // 初回記録は控えめ、更新時だけお祝い
    } else {
      els.resultEyebrow.textContent = "おつかれさまでした";
      const total = state.queue.length;
      const pct = total ? Math.round((state.score / total) * 100) : 0;
      els.resultNum.textContent = state.score;
      els.resultDen.textContent = "/ " + total;
      // たんけんは「発見できた問の平均試行回数」を見せる（発見ゼロなら正答率）。
      els.resultPct.textContent = (state.settings.mode === "explore" && state.exploreFound)
        ? "平均 " + (state.exploreTotalGuesses / state.exploreFound).toFixed(1) + "回で発見"
        : "正答率 " + pct + "%";
      celebrate = total > 0 && state.score === total;   // 全問正解
    }

    if (state.mistakes.length) {
      els.resultReview.hidden = false;
      els.reviewList.innerHTML = "";
      [...new Set(state.mistakes)].forEach((id) => {
        const f = state.byId.get(id);
        const s = document.createElement("span");
        s.className = "review-item";
        s.textContent = f ? withFlag(id, nameOf(f)) : id;
        els.reviewList.appendChild(s);
      });
      // Missed some: make "復習" the primary action, demote "もう一度" to ghost.
      els.resultRetryMissed.hidden = false;
      els.resultRetryMissed.className = "btn primary";
      els.resultAgain.className = "btn ghost";
    } else {
      els.resultReview.hidden = true;
      els.resultRetryMissed.hidden = true;
      els.resultAgain.className = "btn primary";
    }
    els.result.hidden = false;

    if (celebrate) { soundFanfare(); startConfetti(); }
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
