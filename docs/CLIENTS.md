# クライアントへの入れかた

> **どのアプリに、何が書き込まれるのかを知りたいとき**に読みます。
> 入れるだけなら [../README.md](../README.md) で足ります。

---

## `01` 対応クライアント

| id | クライアント | 書き込み先 |
|---|---|---|
| `claude-code` | Claude Code（MCPサーバ） | `claude mcp add -s user` |
| `claude-code-plugin` | Claude Code プラグイン（`/talk` `/mode` 等のスキル・サブエージェント・EventCueフック） | `~/.claude/plugins`（インストール後にクローンへ symlink 化） |
| `claude-desktop` | Claude Desktop | `claude_desktop_config.json` |
| `opencode` | OpenCode | `~/.config/opencode/opencode.json`（MCP＋EventCueプラグイン） |
| `cursor` | Cursor | `~/.cursor/mcp.json` |
| `vscode` | VS Code (Copilot Chat) | `User/mcp.json` |
| `hermes` | Hermes Agent | `~/.hermes/config.yaml` の `mcp_servers:`＋`~/.hermes/plugins/ui-chan/`（EventCue。`HERMES_HOME` / `UI_CHAN_HERMES_CONFIG` で変更可） |

一覧に無いクライアントには `ui-chan print <id>`（引数なしなら汎用の stdio 設定）が
貼り付け用のスニペットを出します。新しいホストへの対応は `tools/setup/clients.mjs` に
1エントリ追加するだけで、インストーラを書き足す必要はありません。

登録される起動コマンドは、どのクライアントでも同じです。

```
<パッケージ>/bin/ui-chan-node  <パッケージ>/dist/mcp-server.js
```

`bin/ui-chan-node` は node を自力で探して exec するランチャです。GUI から起動される
クライアント（Claude Desktop など）は launchd の最小 PATH しか持たず、Homebrew や nvm の
`node` が見えないため、`"command": "node"` と書くと**何も出さずに起動失敗**します。


---

## `02` ui-chan コマンド

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

**登録した時点で完了です。** アプリと VoiSona Talk はセッション開始時に自動起動し、人格は
MCP のハンドシェイク（`instructions`）に乗って渡ります。人格ファイルを貼り付ける作業はありません。

マスコット足元（右下）のつまみを開くと、接続中のセッション（クライアント名とプロジェクト名）と
操作が上に向かって開きます。セッションの行をクリックすると、そのクライアントのアプリが前面に出ます
（ターミナルの場合はターミナル本体まで。タブの選択まではしません）。

---

## `03` 複数のコピーが入っている場合

npm 版を入れたあとに開発用のクローンを作る、という流れはよくあります。**両方あっても構いません。**
どちらが動くかはクライアントの設定に書かれたパスだけが決めるので、

- `ui-chan use` … 登録済みのクライアントを、**そのコマンドを打ったコピー**へ向け直す
- `ui-chan doctor` … いま動いているコピーと、各クライアントがどこを指しているかを表示。
  ズレていれば警告する

なお、アプリ本体は同時に1つしか起動できません（ポートの取り合いになるため）。
切り替えたら `ui-chan stop` してから起こし直してください。

---

## `04` プラグインとコネクタの違い

| | MCPサーバ（コネクタ） | プラグイン |
|---|---|---|
| ツール（`set_cue` ほか） | ○ | ✕ |
| 人格（ハンドシェイクで注入） | ○ | ○（SessionStart フック） |
| アプリ・音声エンジンの自動起動 | ○ | ○ |
| `/talk` `/mode` `/beam` `/eli14` | ✕ | ○ |
| サブエージェント（talk / mode） | ✕ | ○ |
| 作業への自動リアクション（EventCue） | ✕ | ○ |

**EventCue** は、セッション中に起きたこと（コマンドの失敗、ターンの終了、サブエージェントの
往復など）に反応して自動で再生される演目です。`ui-chan install <id>` が MCP 登録と同時に配置します。

| ホスト | 状態 |
|---|---|
| Claude Code | ✅ 実機で確認済み |
| OpenCode | 実装済み・**未検証**（`event` / `tool.execute.*` フック） |
| Hermes Agent | 実装済み・**未検証**（Python プラグイン） |

未検証のものは、設定への書き込みと構文までは確認済みですが、実際に発火するところまでは
確認できていません。試して問題があれば [Issue](https://github.com/Uncle-Peke/ui-chan-mcp/issues) へ。

フック側が決めるのは「**何が起きたか**」だけです。セリフ・重み・クールダウン・好感度ゲートは
`ui-chan.config.json` の `eventCues` にあるので、ホストが違っても反応は同じですし、
セリフを直すのに JavaScript を触る必要はありません。

以前はプラグインが MCP サーバも兼ねていましたが、プラグイン文脈の外では設定中の
`${CLAUDE_PLUGIN_ROOT}` が展開されず**必ず起動に失敗する**ため、役割を分けました。
MCP の登録はどのクライアントでも `ui-chan install <id>` に統一されています。
Claude Code で全部入りにするなら `ui-chan install claude-code claude-code-plugin`。

Claude Desktop はプラグインの台帳を Claude Code と共有しますが、**プラグイン同梱の MCP サーバは
起動しません**（実測）。Desktop では「スキルはプラグインから、ツールと人格はコネクタから」という
組み合わせになります。

---

<sub>次に読むなら [TROUBLESHOOTING.md](TROUBLESHOOTING.md)（繋いだのに動かないとき） / [TOOLS.md](TOOLS.md)（エージェントから何ができるか）</sub>
