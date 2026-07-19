# 変更を「本当の意味で最新」にする手順

このリポジトリを編集しても、**すでに起動しているプロセスには即反映されない**。
その理由と、確実に反映させる手順をまとめる。

## 大前提：このプラグインは repo から直接動く（キャッシュではない）

ui-chan は **directory ソースの marketplace**（`~/.claude/plugins/known_marketplaces.json` で
`source: directory, path: /Users/adachi/Projects/mcp/ui-chan-mcp`）。
このとき **`CLAUDE_PLUGIN_ROOT` ＝ このリポジトリそのもの**。実プロセスで確認済み：

```
$ ps ... 49087
node /Users/adachi/Projects/mcp/ui-chan-mcp//dist/mcp-server.js     ← MCPサーバは repo の dist
$ ps ... <electron>
…/Electron  /Users/adachi/Projects/mcp/ui-chan-mcp                  ← アプリも repo を projectRoot に起動
```

- `~/.claude/plugins/cache/ui-chan/ui-chan/<version>/` は**古いメタデータの残骸で、実行時には使われない**
- したがって **`/plugin update` も version 上げも、コード反映には不要**（やっても害はないが無意味）
- スキル / スラッシュコマンド / context(人格) / hooks も repo 直読み。編集は次のセッションで反映される
  （実際 `beam`→`ui-beam` の改名は update 無しで一覧へ即反映された）

## では何が「古いまま」なのか＝起動済みプロセスのメモリ

反映を止めているのは**キャッシュではなく、走り続けているプロセス**：

```
 repo を編集 → npm run build で repo/dist を更新
        │
        ├─ MCPサーバ (プロセス): セッション開始時の dist をメモリに保持。
        │     → 新しいツール（adjust_affinity 等）は「新セッション」で初めて出る
        │
        └─ Electron 表示アプリ (プロセス): 起動時の dist で動き続ける。detached なので
              セッションを閉じても生き残る → 明示的に kill しないと新 dist にならない
```

## 手順（フルリロード）

### 1. ビルド（repo/dist を再生成）
```
cd /Users/adachi/Projects/mcp/ui-chan-mcp
npm run build
npx biome check --write src/   # 任意（整形）
```

### 2. 古い Electron 表示アプリを終了
detached で生き残っているので kill が必要。
```
pkill -f "Electron.*ui-chan-mcp"
lsof -nP -iTCP:8123 -sTCP:LISTEN     # 誰も listen していなければ停止済み
```

### 3. 表示アプリを新 dist で起動し直す
どちらでもよい：
- **手動**：`npm run app`（build ＋ electron 起動）
- **自動**：`get_state` など**マスコット系ツールを1回呼ぶ** → 稼働中の MCPサーバが repo/dist から
  detached でアプリを再起動する（2で古いのを消してあること）

> 見た目・アイドル・好感度 state はアプリ側（dist/app + dist/renderer）。ここまでで反映される。

### 4. Claude Code のセッションを開き直す（MCPツールを更新したいときだけ）
MCPサーバはセッションに紐づき、開始時の dist をメモリに保持する。
`set_cue` 等の**既存ツールの挙動変更やツールの追加**（例：`adjust_affinity`）を
反映するには、**新セッション**にする（新セッション＝ repo/dist から新しい MCPサーバが spawn）。

### 5. 反映確認
```
get_state で:
  - affinity {value, band, beamReady} が出る            … 新ビルド確認
  - availableCues に追加/変更したCue名がある             … Cue移行確認
  - warnings が空                                        … レイヤーパス修正確認
adjust_affinity が呼べる                                … 要・新セッション
/ui-chan:ui-beam が存在
アイドル放置であくび・きょろきょろ等が出る
```

## どこまでで足りるか早見
| 変えたもの | 必要な手順 |
|---|---|
| Cue cues/*.json | 何もいらない（ホットリロード） |
| 見た目・アイドル・好感度 state（dist/app, dist/renderer） | 1〜3（アプリ再起動） |
| MCPツールの追加・挙動変更（dist/mcp-server.js） | 1〜4（＋新セッション） |
| skills / context(人格) / hooks | 次のセッション（repo 直読み） |

## 注意・ハマりどころ
- **`/plugin update` は不要**。directory ソースなので repo が実行元。cache は無視してよい
- **認証情報は消えない**：VoiSona の `UI_CHAN_TTS_USERNAME/PASSWORD` は `~/.claude/settings.json` の
  トップレベル `env` にある（キャッシュでもリポジトリでもない）。更新の影響を受けない
- **表示アプリはセッション横断で1つ**：port 8123 を共有。複数セッションは同じ窓に繋ぐ
- MCPサーバだけ落としたい：`pkill -f dist/mcp-server.js`（アプリは残る）
- PSD 等の素材は `.gitignore` 除外。`assets/` に実体がある前提
