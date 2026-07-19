// world-atlas (Natural Earth 既定 = 実効支配ベース) から「日本視点 (jpn POV)」版を生成する。
//
// 帰属判定は手書きの座標範囲ではなく、Natural Earth が公式配布する
//   ne_10m_admin_0_countries      (既定 = 実効支配ベース)
//   ne_10m_admin_0_countries_jpn  (日本視点。POV 系列は 10m スケールのみ存在)
// の2つを照合元にする: world-atlas の各ポリゴンの重心について両ファイルの帰属を調べ、
// **両者が食い違う場所だけ** 日本視点側の国へ移す。10m と 50m/110m の海岸線のズレによる
// 誤判定 (例: 凹形状のイスラエルの重心は西岸地区に落ちる) は両ファイルで同一に現れて
// 相殺されるため、真の POV 差分 = 係争地だけが移動対象になる。
// これにより 50m/110m の解像度で表現できる範囲はすべて公式 Japan POV に一致する。
//
// 使い方 (リポジトリ外の作業ディレクトリで):
//   npm install topojson-client d3-geo
//   curl -O https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json
//   curl -O https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json
//   curl -LO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson
//   curl -LO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries_jpn.geojson
//   node tools/make-jpn-pov.cjs ne_10m_admin_0_countries.geojson ne_10m_admin_0_countries_jpn.geojson countries-50m.json countries-50m-jpn.json
//   node tools/make-jpn-pov.cjs ne_10m_admin_0_countries.geojson ne_10m_admin_0_countries_jpn.geojson countries-110m.json countries-110m-jpn.json
// 生成物をリポジトリ直下に置き、app.js / sw.js の MAP_POV = "jpn" で読み込む。
//
// 期待される変換内容 (2026-07 時点の公式データで確認):
//   50m:  北方領土 → 日本 / クリミア → ウクライナ / ソマリランド → ソマリア /
//         北キプロス → キプロス / シアチェン氷河 → インド
//   110m: クリミア / ソマリランド / 北キプロス (北方領土・シアチェンは 110m に個別ポリゴンなし)
//   竹島・尖閣諸島は公式 POV では日本だが 50m/110m にポリゴンが存在しないため対象外。
//
// 移動はアーク参照 (geometry.arcs) の付け替え + 受け取り側での topojson.mergeArcs
// (共有アークの解消 = 旧境界線を消す) のみで、座標・トポロジーは不変。
const fs = require('fs');
const path = require('path');
const topojson = require('topojson-client');
const d3 = require('d3-geo');

const pad3 = (v) => String(v).padStart(3, '0');

// ISO_N3 が -99 のフィーチャの数値コード補完。France/Norway は NE 10m の既知の癖。
// ここに無い -99 (コソボ・インド洋領など) は「数値コード無し」= 移動先にしない。
const A3_TO_N3 = { FRA: '250', NOR: '578' };

function numericId(props) {
  const n = props.ISO_N3;
  if (n != null && String(n) !== '-99') return pad3(n);
  const a3 = props.ADM0_A3_JP || props.ADM0_A3;
  return A3_TO_N3[a3] || null;
}

function loadNe(nePath) {
  const geo = JSON.parse(fs.readFileSync(nePath));
  return geo.features.map((f) => ({
    f,
    id: numericId(f.properties),
    name: f.properties.ADMIN,
    bounds: d3.geoBounds(f),
  }));
}

// 経度は反経線またぎ (minLon > maxLon) を考慮した bbox 事前判定
function inBounds([lon, lat], [[x0, y0], [x1, y1]]) {
  if (lat < y0 || lat > y1) return false;
  return x0 <= x1 ? lon >= x0 && lon <= x1 : lon >= x0 || lon <= x1;
}

function ownerAt(ne, pt) {
  for (const entry of ne) {
    if (inBounds(pt, entry.bounds) && d3.geoContains(entry.f, pt)) return entry;
  }
  return null;
}

// フォールバック: 重心が 10m データ上で海に落ちる小島 (例: 歯舞群島 — 50m の島影は
// 10m の実形状とズレ、重心は島間の海に落ちる) は、ポリゴン輪郭の全頂点と 10m
// フィーチャ頂点との最短距離 (輪郭対輪郭) が最小のフィーチャに帰属させる。
// 係争地以外では既定/日本視点の幾何は同一なので、両ファイルが同じ最寄りを返し
// 「食い違う場所だけ移動」の判定は崩れない。
const NEAR_CAP_RAD = 0.02; // ~127km。これより遠い場合は帰属不明のまま
function ownerNear(ne, queryPts) {
  let best = null, bestD = NEAR_CAP_RAD;
  for (const entry of ne) {
    // bbox 事前判定: どの query 点からも cap より遠いフィーチャはスキップ
    const [[x0, y0], [x1, y1]] = entry.bounds;
    const pad = (NEAR_CAP_RAD * 180) / Math.PI + 1;
    const near = queryPts.some(([lon, lat]) =>
      lat >= y0 - pad && lat <= y1 + pad &&
      (x0 <= x1 ? lon >= x0 - pad && lon <= x1 + pad : lon >= x0 - pad || lon <= x1 + pad));
    if (!near) continue;
    const stack = [entry.f.geometry.coordinates];
    while (stack.length) {
      const c = stack.pop();
      if (typeof c[0] === 'number') {
        for (const q of queryPts) {
          const d = d3.geoDistance(c, q);
          if (d < bestD) { bestD = d; best = entry; }
        }
      } else {
        for (const child of c) stack.push(child);
      }
    }
  }
  return best;
}

// entry のフィーチャ頂点と queryPts の最短距離 (rad)。entry 無しは null
function distToEntry(entry, queryPts) {
  if (!entry) return null;
  let dmin = Infinity;
  const stack = [entry.f.geometry.coordinates];
  while (stack.length) {
    const c = stack.pop();
    if (typeof c[0] === 'number') {
      for (const q of queryPts) {
        const d = d3.geoDistance(c, q);
        if (d < dmin) dmin = d;
      }
    } else {
      for (const child of c) stack.push(child);
    }
  }
  return dmin;
}

function convert(defPath, jpnPath, srcPath, dstPath) {
  const neDef = loadNe(defPath);
  const neJpn = loadNe(jpnPath);
  const neDefById = new Map(neDef.filter((e) => e.id).map((e) => [e.id, e]));
  const neJpnById = new Map(neJpn.filter((e) => e.id).map((e) => [e.id, e]));
  const topo = JSON.parse(fs.readFileSync(srcPath));
  const geoms = topo.objects.countries.geometries;
  const byId = new Map();
  for (const g of geoms) if (g.id != null) byId.set(pad3(g.id), g);

  // 各ジオメトリをポリゴン単位にほどき、既定/日本視点の帰属が食い違うものだけ仕分ける
  const keptPolys = new Map();    // geometry → 残すポリゴン(アーク環リスト)の配列
  const movedPolys = new Map();   // 受け取り側 geometry → 追加ポリゴンの配列
  const moves = [];
  for (const geom of geoms) {
    const curId = geom.id != null ? pad3(geom.id) : null;
    const polys = geom.type === 'Polygon' ? [geom.arcs] : geom.arcs;
    const kept = [];
    for (const polyArcs of polys) {
      const f = topojson.feature(topo, { type: 'Polygon', arcs: polyArcs });
      const c = d3.geoCentroid(f);
      let dOwner = ownerAt(neDef, c);
      let jOwner = ownerAt(neJpn, c);
      let via = '';
      let ownerShifted = false;
      if (!dOwner && !jOwner) {
        const ringPts = f.geometry.coordinates.flat(1).concat([c]);
        dOwner = ownerNear(neDef, ringPts);
        jOwner = ownerNear(neJpn, ringPts);
        via = ' [最寄り判定]';
        // 10m にすら無い極小島 (例: 歯舞群島の水晶島群): 最寄りが両ファイルで一致しても、
        // 現所属国への距離が既定と日本視点で大きく食い違えば、この海域の現所属国の
        // 領土が jpn POV で剥奪されたということ = 係争地。非係争地では両ファイルの
        // 幾何は同一なので距離差はゼロになり、この判定は誤爆しない。
        const SHIFT_RAD = 0.005; // ~32km
        if (curId && jOwner && jOwner.id !== curId) {
          const dCur = distToEntry(neDefById.get(curId), ringPts);
          const jCur = distToEntry(neJpnById.get(curId), ringPts);
          if (dCur != null && jCur != null && jCur - dCur > SHIFT_RAD) {
            ownerShifted = true;
            via = ` [最寄り判定: 現所属${curId}が jpn POV で消失 (${(dCur * 6371).toFixed(0)}km→${(jCur * 6371).toFixed(0)}km)]`;
          }
        }
      }
      const disputed = (dOwner && jOwner && dOwner.name !== jOwner.name) || ownerShifted;
      const dst = disputed && jOwner.id && jOwner.id !== curId ? byId.get(jOwner.id) : null;
      if (dst) {
        if (!movedPolys.has(dst)) movedPolys.set(dst, []);
        movedPolys.get(dst).push(polyArcs);
        moves.push({
          from: curId
            ? `${curId} ${(neDefById.get(curId) || dOwner).name}`
            : `(idなし: ${geom.properties && geom.properties.name})`,
          to: `${jOwner.id} ${jOwner.name}${via}`,
          at: c.map((v) => v.toFixed(2)).join(','),
        });
      } else {
        kept.push(polyArcs);
      }
    }
    keptPolys.set(geom, kept);
  }

  // 反映: 受け取り側は mergeArcs で共有アークを解消 (旧境界線が国内に残らないように)
  for (const [geom, kept] of keptPolys) {
    const added = movedPolys.get(geom) || [];
    const all = kept.concat(added);
    if (added.length === 0 && all.length === (geom.type === 'Polygon' ? 1 : geom.arcs.length)) {
      continue; // 出入りなし: 元のジオメトリを一切触らない
    }
    const merged = added.length
      ? topojson.mergeArcs(topo, [{ type: 'MultiPolygon', arcs: all }])
      : { type: 'MultiPolygon', arcs: all };
    geom.type = merged.type;
    geom.arcs = merged.arcs;
  }

  // 全ポリゴンを失ったフィーチャ (ソマリランド等の id なし係争地) を除去
  topo.objects.countries.geometries = geoms.filter(
    (g) => (g.type === 'Polygon' ? [g.arcs] : g.arcs).length > 0
  );

  fs.writeFileSync(dstPath, JSON.stringify(topo));
  console.log(path.basename(srcPath), '->', path.basename(dstPath));
  for (const m of moves) console.log(`  ${m.from} -> ${m.to} (重心 ${m.at})`);
  const removed = geoms.length - topo.objects.countries.geometries.length;
  if (removed) console.log(`  除去したフィーチャ: ${removed}`);
  if (!moves.length) console.log('  (移動なし)');
}

convert(process.argv[2], process.argv[3], process.argv[4], process.argv[5]);
