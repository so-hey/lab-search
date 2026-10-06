# デプロイ手順

この構成では、WebをVercel Hobby、BackendとSlack BotをNorthflank Developer Sandboxへデプロイします。Supabase、Zilliz Cloud、Voyage AI、Google Driveは既存のmanaged serviceをそのまま利用します。

```text
Vercel Web
    ↓ HTTPS
Northflank Backend
    ├── Zilliz
    ├── Supabase
    └── Voyage
    ↑ HTTPS
Northflank Slack Bot（Socket Mode）

Northflank Cron Job
    └── Google Drive差分同期 → Voyage → Zilliz / Supabase
```

## 0. 事前確認

変更をGitHubのdefault branchへpushします。秘密情報をrepositoryへcommitしないでください。Docker build contextからも`.env`、local PDF、生成済みindex／reportを除外しています。

ローカルでproduction buildとcontainerを確認できます。

```bash
pnpm build
pnpm docker:build:backend
pnpm docker:build:slack
```

BackendとSlackのcontainerはNode.js 25を利用します。Vercelが提供するNode.js runtimeは24 LTSまでなので、Web workspaceだけはNode.js 24／25の両方を許可しています。ローカル開発は引き続きNode.js 25を使用します。

## 1. Northflank project

1. Northflankで`Developer Sandbox` planを選択します。
2. GitHub accountを接続します。
3. `lab-search` projectを作成します。
4. Regionは、可能なら現在のZilliz clusterに近いものを選択します。

Developer Sandboxのまま利用し、Pay-as-you-goへの変更、paid resource、BYOCを追加しないでください。Billing alertも設定します。

## 2. Backend service

Git repositoryからCombined Serviceを作成します。

```text
Service name: lab-search-backend
Branch: main
Build type: Dockerfile
Dockerfile: /deploy/backend.Dockerfile
Build context: /
Port: 8787
Protocol: HTTP
Public: enabled
Health check: HTTP GET /health on port 8787
```

Runtime environmentには次を設定します。

```dotenv
PORT=8787
CORS_ORIGIN=https://YOUR_WEB_DOMAIN

SEARCH_MODE=zilliz
SEARCH_STRATEGY=hybrid
EMBEDDING_PROVIDER=voyage
EMBEDDING_DIMENSIONS=1024
VOYAGE_API_KEY=...
VOYAGE_EMBEDDING_MODEL=voyage-4-lite
VOYAGE_EMBEDDING_MAX_RETRIES=8
VOYAGE_EMBEDDING_REQUESTS_PER_MINUTE=3
VOYAGE_EMBEDDING_TOKENS_PER_MINUTE=10000
QUERY_EMBEDDING_CACHE_TTL_SECONDS=900
QUERY_EMBEDDING_CACHE_MAX_ENTRIES=500

RERANKER_PROVIDER=voyage
VOYAGE_RERANK_MODEL=rerank-3-lite
RERANK_CANDIDATE_DOCUMENTS=20
VOYAGE_RERANK_MAX_RETRIES=4
VOYAGE_RERANK_REQUESTS_PER_MINUTE=3

ZILLIZ_ENDPOINT=...
ZILLIZ_TOKEN=...
ZILLIZ_COLLECTION=document_chunks_voyage4_lite_1024_hybrid

SUPABASE_URL=...
SUPABASE_SECRET_KEY=...

AUTH_MODE=google
GOOGLE_CLIENT_ID=....apps.googleusercontent.com

SLACK_BACKEND_SERVICE_TOKEN=...
SLACK_ALLOWED_TEAM_ID=T...
```

`CORS_ORIGIN`はVercel URL確定後に設定して再deployします。Backend serviceにはDrive同期用の`GOOGLE_SERVICE_ACCOUNT_JSON`を渡しません。

deploy後、発行されたURLで確認します。

```bash
curl https://YOUR_BACKEND_DOMAIN/health
```

期待するresponseは`{"status":"ok"}`です。

## 3. Vercel Web

Vercel Dashboardから同じGitHub repositoryをimportします。

```text
Plan: Hobby
Framework Preset: Next.js
Root Directory: apps/web
Include source files outside of the Root Directory: enabled
Node.js Version: 24.x
Install Command: auto（pnpm install）
Build Command: auto（pnpm build）
Output Directory: auto
```

Production environment variablesを設定します。`NEXT_PUBLIC_*`はbuild時にbrowser bundleへ埋め込まれるため、変更後は必ず再deployします。

```dotenv
NEXT_PUBLIC_BACKEND_URL=https://YOUR_BACKEND_DOMAIN
NEXT_PUBLIC_AUTH_MODE=google
NEXT_PUBLIC_GOOGLE_CLIENT_ID=....apps.googleusercontent.com
```

Vercelのproduction domainが決まったら、Backendの`CORS_ORIGIN`をそのoriginへ変更します。末尾の`/`は付けません。

```dotenv
CORS_ORIGIN=https://YOUR_WEB_DOMAIN
```

Google Cloud ConsoleのWeb OAuth Clientにも同じoriginを追加します。

```text
APIs & Services
→ Credentials
→ 対象のOAuth 2.0 Client ID
→ Authorized JavaScript origins
→ https://YOUR_WEB_DOMAIN
```

Vercel PreviewのURLは毎回変わるため、Google LoginとBackend CORSの本番確認にはproduction domainを使用します。

## 4. Slack Bot service

同じNorthflank projectへ2つ目のCombined Serviceを作成します。

```text
Service name: lab-search-slack
Branch: main
Build type: Dockerfile
Dockerfile: /deploy/slack.Dockerfile
Build context: /
Public port: none
```

Runtime environment:

```dotenv
SLACK_SOCKET_MODE=true
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_SEARCH_COMMAND=/lab-search

BACKEND_URL=https://YOUR_BACKEND_DOMAIN
SLACK_BACKEND_SERVICE_TOKEN=...

SLACK_IDENTITY_CACHE_TTL_SECONDS=3600
SLACK_IDENTITY_CACHE_MAX_ENTRIES=500
PORT=3001
```

`SLACK_BACKEND_SERVICE_TOKEN`はBackendと完全に同じ値を設定します。Socket Modeではpublic port、Request URL、`SLACK_SIGNING_SECRET`は不要です。

deploy logで次を確認します。

```text
[slack] /lab-search started in Socket Mode
```

## 5. Google Drive差分同期Job

初回は手動Jobとして作成し、成功確認後にCronを有効化します。Backendと同じDockerfileを再利用します。

```text
Job name: lab-search-drive-sync
Source: Git repository
Branch: main
Build type: Dockerfile
Dockerfile: /deploy/backend.Dockerfile
Build context: /
Command override: node dist/scripts/sync-drive.js
Concurrency policy: Forbid concurrent runs
```

Jobには次を設定します。

```dotenv
SEARCH_MODE=zilliz
SEARCH_STRATEGY=hybrid
EMBEDDING_PROVIDER=voyage
EMBEDDING_DIMENSIONS=1024
EMBEDDING_SYNC_BATCH_SIZE=5

VOYAGE_API_KEY=...
VOYAGE_EMBEDDING_MODEL=voyage-4-lite
VOYAGE_EMBEDDING_MAX_RETRIES=8
VOYAGE_EMBEDDING_REQUESTS_PER_MINUTE=3
VOYAGE_EMBEDDING_TOKENS_PER_MINUTE=10000

ZILLIZ_ENDPOINT=...
ZILLIZ_TOKEN=...
ZILLIZ_COLLECTION=document_chunks_voyage4_lite_1024_hybrid

SUPABASE_URL=...
SUPABASE_SECRET_KEY=...

GOOGLE_DRIVE_FOLDER_ID=...
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
GOOGLE_DRIVE_ACKNOWLEDGE_ABUSE=false
```

手動実行が成功した後、例えば毎日午前3時（JST）ならUTCで次を指定します。

```cron
0 18 * * *
```

差分がない日はDrive metadataを確認してskipするため、全資料を再Embeddingしません。Job summaryの`Failed`が1以上ならprocessは失敗扱いになります。

## 6. デプロイ後確認

次の順に確認します。

1. Backend `/health`
2. Vercel WebのGoogle Login
3. Web検索とDriveリンク
4. Web feedback
5. Slack DM、mention、slash command
6. Slack feedback
7. Drive同期Jobの手動実行
8. Supabaseの`search_logs`と`feedback`

秘密値はVercel／Northflankのruntime secretsとして保存し、build argumentやGitHub repositoryには入れません。
