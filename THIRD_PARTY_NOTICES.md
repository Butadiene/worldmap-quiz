# サードパーティのデータ・ライブラリについて

## 地図データ（countries-50m-jpn.json / countries-110m-jpn.json）

本リポジトリに同梱している地図データは、
[world-atlas](https://github.com/topojson/world-atlas)（Natural Earth の TopoJSON 版）の
`countries-50m.json` / `countries-110m.json` を基に、`tools/make-jpn-pov.cjs` で
係争地の帰属区分を Natural Earth 公式の日本視点データ
（`ne_10m_admin_0_countries_jpn`。POV 系列は 10m スケールのみ配布）に合わせた派生物です
（北方領土 → 日本、クリミア半島 → ウクライナ、ソマリランド → ソマリア、
北キプロス → キプロス、シアチェン氷河 → インド）。

### Natural Earth（元データ）

[Natural Earth](https://www.naturalearthdata.com/) のベクターデータは
**パブリックドメイン**であり、改変・再配布を含むあらゆる利用が許可されています。

### world-atlas（ISC License）

```
Copyright 2013-2019 Michael Bostock

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
```

## 実行時に CDN から読み込むライブラリ（同梱していません）

- [D3.js](https://github.com/d3/d3) — ISC License
- [topojson-client](https://github.com/topojson/topojson-client) — ISC License
