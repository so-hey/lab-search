# Slack Bot

研究室資料検索Backendの`POST /api/search`と`POST /api/feedback`だけを利用するSlack Botです。検索、Embedding、Zilliz、Supabaseの処理は持ちません。

## 実装済み

- `/lab-search <検索語>`
- `@lab-search <検索語>`で投稿を残し、スレッドへ検索結果を返信
- BotとのDMに検索語を送り、同じDMへ検索結果を返信
- Slack user IDから`users.info`でemailを取得し、結果をmemory cache
- Backend Service Token、workspace ID、user ID、emailの転送
- 上位5文書のBlock Kit表示
- Page／Slide、最終score方式、該当箇所の表示
- 保存先フォルダ／元ファイルリンク
- 役に立った／役に立たなかったfeedback
- feedback送信後のボタン無効化
- Backend接続、認証・認可、rate limit、Slack権限エラーの日本語案内
- Socket Mode／HTTP Mode切り替え

## Slack App作成

Slack App管理画面で`manifest.json`を使ってAppを作成します。Bot Token Scopesは次のとおりです。

```text
app_mentions:read
commands
chat:write
im:history
users:read
users:read.email
```

Appをworkspaceへinstallし、`OAuth & Permissions`から`xoxb-`で始まるBot Tokenを取得します。

ローカルではSocket Modeを使用します。`Basic Information > App-Level Tokens`で`connections:write` scopeを持つ`xapp-` Tokenを発行してください。

## 環境変数

```bash
cp apps/slack/.env.example apps/slack/.env
openssl rand -hex 32
```

生成した値をSlackとBackendの両方へ設定します。

```dotenv
# apps/slack/.env
SLACK_BACKEND_SERVICE_TOKEN=<生成値>
SLACK_IDENTITY_CACHE_TTL_SECONDS=3600
SLACK_IDENTITY_CACHE_MAX_ENTRIES=500

# apps/backend/.env
SLACK_BACKEND_SERVICE_TOKEN=<同じ生成値>
SLACK_ALLOWED_TEAM_ID=T0123456789
```

`SLACK_ALLOWED_TEAM_ID`はSlash Command payloadの`team_id`です。Slack Appのinstall先workspace IDと同じ値を指定します。

## 起動

Backendを先に起動します。

```bash
pnpm dev:backend
pnpm dev:slack
```

Slackで次を実行します。

```text
/lab-search モデルマージ
```

BotはSlash Commandをすぐにackし、その後email取得とBackend検索を行い、結果を本人だけに見えるephemeral messageとして返します。

検索内容をチャンネルに残したい場合は、Botをチャンネルへ追加してメンションします。

```text
@lab-search モデルマージ
```

ユーザーの投稿は通常メッセージとして残り、Botはその投稿のスレッドへ検索結果を返します。Slash Commandの入力自体はSlackの仕様上メッセージとして残らないため、非公開検索にはSlash Command、共有する検索にはメンションを使用します。

履歴を残しながら非公開で検索したい場合は、Slackの`Apps`から`lab-search`を開き、Messagesタブへ検索語だけを送信します。

```text
破滅的忘却
```

DMではユーザーの入力とBotの検索結果が同じ会話に残ります。

## 認可

Slackから直接届く通信はBoltがSocket ModeまたはSigning Secretで検証します。その後Backendは次をすべて検証します。

```text
Service Tokenが一致
AND workspace IDが一致
AND emailがSupabase allowed_usersに存在
```

Slack Connect等でemailを取得できないユーザーは検索できません。

## 今後

- 複数workspace向けOAuth installation store
- Service Token rotation
