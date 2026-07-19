// world-atlas (Natural Earth 既定 = 実効支配ベース) から「日本視点 (jpn POV)」版を生成する。
//
// 使い方 (リポジトリ外の作業ディレクトリで):
//   npm install topojson-client d3-geo
//   curl -O https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json
//   curl -O https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json
//   node tools/make-jpn-pov.cjs countries-50m.json countries-50m-jpn.json
//   node tools/make-jpn-pov.cjs countries-110m.json countries-110m-jpn.json
// 生成物をリポジトリ直下に置き、app.js / sw.js の MAP_POV = "jpn" で読み込む。
// 変換内容:
//   1. 北方領土 (択捉・国後・色丹・歯舞) のポリゴンを ロシア(643) → 日本(392) へ
//   2. クリミア半島のポリゴンを ロシア(643) → ウクライナ(804) へ
// TopoJSON のアーク参照 (geometry.arcs) を国間で移すだけなので、座標・トポロジーは不変。
// 竹島・尖閣諸島は 50m/110m データにポリゴンが存在しないため変換対象外。
const fs = require('fs');
const path = require('path');
const topojson = require('topojson-client');
const d3 = require('d3-geo');

// ポリゴン重心がこの箱に入っていたら移す [lonMin, lonMax, latMin, latMax]
const NORTHERN_TERRITORIES = [145.2, 149.2, 43.0, 45.9];   // 北方領土 (サハリン46N+・北海道は日本側なので対象外)
const CRIMEA = [32.0, 37.0, 44.0, 46.4];                    // クリミア (露本土クラスノダールは38E+で対象外)

const inBox = (c, [x0, x1, y0, y1]) => c[0] >= x0 && c[0] <= x1 && c[1] >= y0 && c[1] <= y1;

function convert(srcPath, dstPath) {
  const topo = JSON.parse(fs.readFileSync(srcPath));
  const geoms = topo.objects.countries.geometries;
  const byId = (id) => geoms.find((g) => g.id === id);
  const rus = byId('643'), jpn = byId('392'), ukr = byId('804');
  if (!rus || !jpn || !ukr) throw new Error('643/392/804 not all present in ' + srcPath);

  // MultiPolygon の各ポリゴン (アーク環リスト) 単位で重心を測って振り分け
  const rusPolys = rus.type === 'Polygon' ? [rus.arcs] : rus.arcs;
  const keep = [], toJpn = [], toUkr = [];
  for (const polyArcs of rusPolys) {
    const f = topojson.feature(topo, { type: 'Polygon', arcs: polyArcs, id: 0 });
    const c = d3.geoCentroid(f);
    if (inBox(c, NORTHERN_TERRITORIES)) toJpn.push({ polyArcs, c });
    else if (inBox(c, CRIMEA)) toUkr.push({ polyArcs, c });
    else keep.push(polyArcs);
  }

  const asMulti = (g) => (g.type === 'Polygon' ? [g.arcs] : g.arcs);
  if (toJpn.length) {
    jpn.arcs = asMulti(jpn).concat(toJpn.map((p) => p.polyArcs));
    jpn.type = 'MultiPolygon';
  }
  if (toUkr.length) {
    ukr.arcs = asMulti(ukr).concat(toUkr.map((p) => p.polyArcs));
    ukr.type = 'MultiPolygon';
  }
  rus.arcs = keep;
  rus.type = 'MultiPolygon';

  fs.writeFileSync(dstPath, JSON.stringify(topo));
  console.log(path.basename(srcPath), '->', path.basename(dstPath));
  console.log('  日本へ移動:', toJpn.length, 'polygons', toJpn.map((p) => p.c.map((v) => v.toFixed(1)).join(',')).join(' / '));
  console.log('  ウクライナへ移動:', toUkr.length, 'polygons', toUkr.map((p) => p.c.map((v) => v.toFixed(1)).join(',')).join(' / '));
}

convert(process.argv[2], process.argv[3]);
