# クライアントへの入れかた（詳細）

`ui-chan install <id>` が、それぞれのクライアントの設定ファイルを書き換えます。
何をどこに書くのか、プラグインとコネクタが何を担っているのかをここにまとめます。
使うだけなら [../README.md](../README.md) で足ります。

## 対応クライアント

| id | クライアント | 書き込み先 |
|---|---|---|
| `claude-code` | Claude Code（MCPサーバ） | `claude mcp add -s user` |
| `claude-code-plugin` | Claude Code プラグイン（`/talk` `/mode` 等のスキル・サブエージェント・EventCueフック） | `~/.claude/plugins`（インストール後にクローンへ symlink 化） |
| `claude-desktop` | Claude Desktop | `claude_desktop_config.json` |
| `opencode` | OpenCode | `~/.config/opencode/opencode.json`（MCP＋EventCueプラグイン） |
| `cursor` | Cursor | `~/.cursor/mcp.json` |
| `vscode` | VS Code (Copilot Chat) | `User/mcp.json` |
| `hermes` | Hermes Agent | `~/.hermes/config.yaml` の `mcp_servers:`＋`~/.hermes/plugins/ui-chan/`（EventCue。`HERMES_HOME` / `UI_CHAN_HERMES_CONFIG` で変更可） |

ここに無いクライアントなら `ui-chan print <id>`（引数なしなら汎用の stdio 設定）で、
貼り付け用のスニペットを出すよ。新しいホストへの対応は表に1行足すだけだから、増やすのは簡単。

登録される起動コマンドは、どこでも同じ。

```
<パッケージ>/bin/ui-chan-node  <パッケージ>/dist/mcp-server.js
```

`bin/ui-chan-node` は node を自力で探して起動するやつ。アプリから立ち上がるクライアント
（Claude Desktop とか）は PATH が最小限しか無くて、Homebrew や nvm の node が見えないの。
`"command": "node"` って書くと、何も言わずに起動失敗する。えぇ…ってなるやつ。


## ui-chan コマンド

```bash
ui-chan                      # 対話セットアップ
ui-chan install claude-desktop opencode   # 指定クライアントへ登録（--all で全部）
ui-chan uninstall --all      # 全クライアントから解除（ユーザーデータは残る）
ui-chan uninstall --all --purge           # ~/.ui-chan ごと消す
ui-chan doctor               # 状態チェック
ui-chan print opencode       # 設定スニペットだけ表示
ui-chan home                 # ユーザーデータの場所
ui-chan start / stop         # マスコットの起動・停止
ui-chan update               # 最新版にする（--check で確認だけ）
```

**繋いだらもう終わり。** アプリも VoiSona Talk もセッション開始時に勝手に起きるし、
わたしの人格は MCP のハンドシェイクに乗って渡るから、どこかに貼り付ける作業は無いよ。

わたしの右上に小さいつまみがあるでしょ。押すと、いま繋がってるセッション（どのツールの、どのプロジェクトか）と、
しずかに／ひといき／好感度／リセット／おやすみ が出てくる。更新があるときだけ、ダウンロードのアイコンも増える。

## 複数のコピーが入っている場合

npm 版を入れたあとに開発用のクローンを作る、という流れはよくあります。**両方あっても構いません。**
どちらが動くかはクライアントの設定に書かれたパスだけが決めるので、

- `ui-chan use` … 登録済みのクライアントを、**そのコマンドを打ったコピー**へ向け直す
- `ui-chan doctor` … いま動いているコピーと、各クライアントがどこを指しているかを表示。
  ズレていれば警告する

なお、アプリ本体は同時に1つしか起動できません（ポートの取り合いになるため）。
切り替えたら `ui-chan stop` してから起こし直してください。

## プラグインとコネクタの違い

| | MCPサーバ（コネクタ） | プラグイン |
|---|---|---|
| ツール（`set_cue` ほか） | ○ | ✕ |
| 人格（ハンドシェイクで注入） | ○ | ○（SessionStart フック） |
| アプリ・音声エンジンの自動起動 | ○ | ○ |
| `/talk` `/mode` `/beam` `/eli14` | ✕ | ○ |
| サブエージェント（talk / mode） | ✕ | ○ |
| 作業への自動リアクション（EventCue） | ✕ | ○ |

**EventCue**っていうのは、きみの作業を見ててわたしが勝手に反応するやつ。コマンドがこけたとか、
ターンが終わったとか、お手伝いの子が帰ってきたとか。`ui-chan install <id>` が MCP 登録と一緒に
置いてくれる。

| ホスト | 状態 |
|---|---|
| Claude Code | ✅ 実機で確認済み |
| OpenCode | 実装済み・**未検証**（`event` / `tool.execute.*` フック） |
| Hermes Agent | 実装済み・**未検証**（Python プラグイン） |

未検証のほうは、設定への書き込みと構文までは確かめてあるけど、実際に発火するところまでは
見られてないの。試して転んだら [Issue](https://github.com/Uncle-Peke/ui-chan-mcp/issues) で教えて。

フック側が決めるのは「**何が起きたか**」だけ。わたしが何て言うかは `ui-chan.config.json` の
`eventCues` にあるから、ホストが違っても反応は同じだし、セリフを直すのに
JavaScript を触らなくていい。

昔はプラグインが MCP サーバも兼ねてたんだけど、プラグインの外だと設定の中の
`${CLAUDE_PLUGIN_ROOT}` が展開されなくて**必ず起動に失敗**してたの。すいませんねぇ。
今は役割を分けて、MCP の登録はどこでも `ui-chan install <id>` に統一してある。
Claude Code で全部入りにするなら `ui-chan install claude-code claude-code-plugin`。

Claude Desktop はプラグインの台帳を Claude Code と共有するけど、**プラグイン同梱の MCP サーバは
起動してくれない**（試した）。だから Desktop は、スキルはプラグインから、ツールとわたしの人格は
コネクタから、っていう組み合わせになるよ。
