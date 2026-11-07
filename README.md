# ana-workspace-skills

Claude Code から、自分の ANA（Google Workspace）アカウントの Gmail と Google Drive を使うためのスキル2つです。

| スキル | できること | 例 |
|---|---|---|
| `/ana-gmail` | メールを検索・スレッドの経緯を読んで、リンク付きで答える。頼まれたら返信・新規の**下書き**を作る（送信はしない） | `/ana-gmail TC15 の最後の連絡はいつ？` |
| `/ana-drive` | Drive を本文・名前で検索し、スライド・スプレッドシート・ドキュメントを読んで答える。頼まれたら Google 形式のファイルを**編集**する（削除はしない） | `/ana-drive 定例資料の最新版で INFINI の状況は？` |

書き込み（下書き・編集）は、依頼文で頼んだときだけ、内容を見せて OK をもらってから行います。

## しくみ
Google の API は直接使わず、**自分のアカウントで公開した Apps Script（ブリッジ）**を、Claude in Chrome が自分の Chrome で開いて呼びます。

- ブリッジは各自が自分で公開します。「実行するユーザー＝自分」「アクセス＝自分のみ」です。**他人のブリッジの URL は使えず、使ってもいけません**（他人のメールを読めることになるため）
- ブリッジのコードは [bridge/Code.gs](bridge/Code.gs) です。送信・削除の関数はありません

## 必要なもの
- Claude Code（Windows）と、Claude in Chrome 拡張機能。Chrome で ANA アカウントにログインしていること
- ANA の Google Workspace で Apps Script を使えること

## セットアップ（初回 10〜15 分）
1. **clone して install**
   ```powershell
   git clone https://github.com/yutaimint/ana-workspace-skills.git "$env:USERPROFILE\workspace\proj\yutaimint\ana-workspace-skills"
   & "$env:USERPROFILE\workspace\proj\yutaimint\ana-workspace-skills\install.ps1"
   ```
   スキルが `$env:CLAUDE_CONFIG_DIR\skills`（未設定なら `~\.claude\skills`）に登録され、設定ファイル `~\workspace\.ana\bridge.json` の雛形ができます。
2. **ブリッジを公開する**（ANA アカウントの Chrome で）
   1. https://script.google.com/home で「新しいプロジェクト」を作る。名前は `ana-workspace-bridge`
   2. 左の「プロジェクトの設定」（歯車）で「「appsscript.json」マニフェスト ファイルをエディタで表示する」にチェック
   3. エディタの `コード.gs` の中身を [bridge/Code.gs](bridge/Code.gs) に、`appsscript.json` を [bridge/appsscript.json](bridge/appsscript.json) に丸ごと置き換えて保存
   4. 関数 `authorizeAll` を選んで「実行」→「権限を確認」→ 自分の ANA アカウントを選んで許可（Gmail の閲覧・下書き、Drive、スプレッドシート、スライド、ドキュメント、メールアドレス）
   5. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」、次のユーザーとして実行「自分」、アクセスできるユーザー「自分のみ」→「デプロイ」。表示された**ウェブアプリの URL** を控える
3. **設定ファイルを書く**：`~\workspace\.ana\bridge.json` を開いて書き換える
   - `exec_url`：手順 2-5 のウェブアプリの URL
   - `editor_url`：Apps Script エディタの URL
   - `expected_user`：自分の ANA アカウントのメールアドレス
   - `chrome_device_id`：Claude Code で `/ana-gmail` を初めて実行するとブラウザの選択を求められるので、Windows の Chrome を選ぶ。そのとき表示される ID を書く（分からなければ空欄のまま実行し、Claude に聞く）
4. **確かめる**：Claude Code で `/ana-gmail 直近で自分が送ったメールの件名を3つ教えて` を実行し、答えが返れば完了

`bridge.json` は個人の設定です。リポジトリには入れません（`.gitignore` 済み・リポジトリの外に置く）。

## 更新
```powershell
git -C "$env:USERPROFILE\workspace\proj\yutaimint\ana-workspace-skills" pull
```
スキルはジャンクションなので pull だけで反映されます。`bridge/` が変わったときは、手順 2-3 のコードの置き換えをして「デプロイを管理」→ 既存デプロイの編集 →「新バージョン」で更新します（URL は変わりません。「新しいデプロイ」にすると URL が変わるので注意）。

## 注意
- Chrome のプロファイルに個人の Google アカウントも入っていると、Google の画面が個人アカウントで開くことがあります。スキルは別アカウントの画面を見たら止まるようにしていますが、ANA アカウント専用のプロファイルを使うのが確実です
- スキルが止まって「要確認」を返したときは、内容を読んで指示し直してください
