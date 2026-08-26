# 音声合成（VoiSona Talk 連携）

README から分離した詳細リファレンス。


[VoiSona Talk](https://voisona.com/talk/download/)（テクノスピーチ、無料）の REST API 経由で、
`set_cue` のセリフを実際に喋らせることができます。合成は `destination: memory` で行い、
WAV と音素タイミング（`phonemes` / `phoneme_durations`）を取得してアプリ側で再生するため、
**口パクは音素単位で音声と完全同期**します。吹き出しの表示時間も音声の実時間に一致します。

API リファレンスは REST API 有効化後に http://localhost:32766/docs/talk_api.html で読めます。

### 有効化手順

1. VoiSona Talk を起動してログインし、ボイスライブラリを 1 つ以上ダウンロード
2. メニュー「編集 > 環境設定」の **API タブ** で待ち受けポート（デフォルト 32766）と API 用パスワードを設定し、「REST API を有効にする」をチェック
3. 認証情報を **mcp.json の `env`** に設定（上記「Claude Code への登録」参照）。
   本サーバの config はディスク上に認証情報を持たず、MCP ブリッジ経由でメモリ上にのみ渡されます

`ui-chan.config.json` 側の設定は接続先とボイス選択だけです：

```json
"tts": {
  "enabled": true,
  "provider": "voisona-talk",
  "url": "http://127.0.0.1:32766",
  "voice_name": "使いたいボイス名（空なら日本語対応の最初のボイス）",
  "language": "ja_JP",
  "app_name": "VoiSona Talk"
}
```

- `enabled` — TTS のマスタースイッチ。true でも認証情報が届くまでは音声なしで動きます
- `app_name` — MCP サーバ起動時に API へ到達できないとき `open -a` で起動するアプリ名（macOS）

### Cueと声のトーンの連動

`set_cue(cue)` が顔と声の両方を駆動します。各Cueファイル（`cues/<cue>.json`）の `voice` ブロックが
そのCueの声を決めます：

- `voice.style_weights` はスタイル名 → 重みのオブジェクト（`{"Happy": 0.7, "Bashful": 0.3}`）。
  ブレンド計算はせず、ボイスの `style_names` の並び順に変換して VoiSona の `global_parameters.style_weights`
  にそのまま渡ります
- `voice.alp` / `voice.huskiness` もCueに焼き込め、同じく `global_parameters` に素通しされます
- そのセリフ一行だけの演技（`pitch`/`speed`/`volume`/`intonation`）は `set_cue` の引数として渡します。
  Cueの `voice` と `set_cue` のアドリブパラメータはどちらも同じ `global_parameters` にマージされて送られます
- スタイル名はボイスごとに異なるので `GET {url}/api/talk/v1/voices/{voice_name}/{voice_version}` の
  `style_names` で確認して合わせてください。一致しない場合はデフォルトのトーンで喋ります

利用可能なボイス名は `GET {url}/api/talk/v1/voices`（Basic 認証）で確認できます。

- 雨衣（うい）ちゃんのボイスが発売されたら、`voice_name` を差し替えるだけで対応できる想定です
- エンジンに接続できない場合は音声なしで動き続けます（60 秒のクールダウン後に再試行）。その間のリップシンクはテキスト読み駆動（`set_cue` の `reading`）にフォールバックします
