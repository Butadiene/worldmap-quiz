# 世界地図クイズ 🌍

白地図で世界の国の「位置」と「名前」を覚えるためのクイズアプリです。
**PWA(Webアプリ)** なので、スマホ（Android / iPhone）でもPCでも動き、
**一度オンラインで開けば、以降はオフラインでも遊べます。**

## 遊び方

- **地図で探す** … 表示された国名の場所を、地図をタップして当てる
- **名前を選ぶ** … 光った国の名前を4択から選ぶ
- 地域（アジア／ヨーロッパ など）や問題数を選んでスタート
- 地図はピンチ／ホイールで拡大、右下のボタンでも操作できます
- 最後にスコアと「まちがえた国」の一覧が出ます

## オフラインで使う仕組み

初回にオンラインで開いたとき、地図データ（ベクター）とアプリ本体を
端末にキャッシュします。2回目からはネットがなくても動きます。
Androidなら、ブラウザのメニューから **「ホーム画面に追加」** すると
アプリのように起動できます。

---

## GitHub Pages で公開する手順

1. GitHubで新しいリポジトリを作成（例: `worldmap-quiz`）
2. このフォルダの中身をすべてアップロード（`git push` でもドラッグ＆ドロップでもOK）
   - `index.html` がリポジトリの**直下**に来るようにしてください
3. リポジトリの **Settings → Pages** を開く
4. **Build and deployment** の Source を **Deploy from a branch** にする
5. Branch を `main`（または `master`）、フォルダを `/ (root)` にして **Save**
6. 数十秒〜数分後、`https://ユーザー名.github.io/リポジトリ名/` で公開されます

> 初回だけオンラインでそのURLを開けば、オフライン用にキャッシュされます。
> ファイルを更新したら `sw.js` の `CACHE = "worldquiz-v1"` の数字を
> 上げると（例: `v2`）、利用者側でも新しい版に更新されます。

## ローカルで試す

`file://` で直接開くと Service Worker が動きません。簡易サーバーで開いてください。

```bash
cd worldmap-quiz
python3 -m http.server 8000
# ブラウザで http://localhost:8000 を開く
```

---

## ファイル構成

| ファイル | 役割 |
|---|---|
| `index.html` | 画面の構造 |
| `style.css` | デザイン |
| `app.js` | 地図描画（D3）とクイズのロジック |
| `countries.js` | 国データ（ISO番号→日本語名・地域） |
| `sw.js` | オフライン用 Service Worker |
| `manifest.json` | ホーム画面追加（PWA）設定 |
| `icons/` | アプリアイコン |
| `gen_countries.py` / `gen_icons.py` | データ・アイコンの生成用（実行は任意） |

## データの出典・技術

- 地図: [world-atlas](https://github.com/topojson/world-atlas)（Natural Earth 由来）
- 描画: [D3.js](https://d3js.org/) + [TopoJSON](https://github.com/topojson/topojson-client)（CDNから読み込み、初回にキャッシュ）
- 収録国数: 170カ国

## カスタマイズのヒント

- 国名や地域分けを変えたい → `countries.js` を直接編集（`gen_countries.py` から再生成も可）
- 地図の見た目（色）→ `style.css` 冒頭の `:root` 変数
- 国境の細かさを上げたい → `app.js` と `sw.js` の
  `countries-110m.json` を `countries-50m.json` に変更（データは大きくなります）
