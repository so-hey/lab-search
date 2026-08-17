# 研究室資料検索（Lab Search）

研究室内資料をWebと将来のSlack Botから共通利用するための、Backend中心のAI資料検索monorepoです。Phase 1ではローカルPDFを抽出・chunk化・簡易Embedding化し、cosine similarityによるTop-k検索をREST APIとWeb UIから利用できます。

## 構成

```text
lab-search/
├── apps/
│   ├── web/       # Next.js App Routerの検索UI
│   ├── backend/   # Hono API、PDF index、検索処理、local repository
│   └── slack/     # Phase 2用workspace（Bot本体は未実装）
├── packages/
│   └── shared/    # クライアントとBackendで共有するAPI型だけを定義
├── package.json
└── pnpm-workspace.yaml
```

- `web`: 検索語を受け取り、HTTPでBackendを呼び、結果を表示します。PDF、Embedding、検索処理は持ちません。
- `backend`: PDF解析、chunking、Embedding、index保存、cosine検索、REST APIを担当します。
- `slack`: 将来Backend APIを呼ぶSlack Botの配置先です。
- `@lab-search/shared`: `SearchRequest` / `SearchResponse`などのAPI契約です。各workspaceからpackage名でimportします。

## 必要環境

- Node.js 20.16以上（Node.js 20系の場合）または22.3以上
- pnpm 10.x

Corepackを使う場合:

```bash
corepack enable pnpm
pnpm install
```

## ローカル設定

WebのBackend URLを設定します。

```bash
cp apps/web/.env.example apps/web/.env.local
```

Backendの`PORT`、`CORS_ORIGIN`、PDF/indexパスを上書きする場合:

```bash
cp apps/backend/.env.example apps/backend/.env
```

Backendのscriptは`.env`が存在する場合に自動で読み込みます。未指定時はport 8787、CORS origin `*`、repository内のsample/dataディレクトリを使います。

## PDF indexを作る

検索対象のPDFを`apps/backend/sample/`直下へ配置します。確認用の`paper.pdf`も同梱しています。

```bash
pnpm --filter backend index:local
```

またはルートscriptを使います。

```bash
pnpm index:local
```

処理フローは`PDF text extraction → chunking（既定700文字、overlap 100文字）→ local hashing embedding → apps/backend/data/local-index.json`です。生成indexはGit管理対象外です。PDFを追加・更新したら再実行してください。

## 起動

BackendとWebを別々に起動する場合:

```bash
pnpm dev:backend
pnpm dev:web
```

両方を並列起動する場合:

```bash
pnpm dev
```

既定ではWebは`http://localhost:3000`、Backendは`http://localhost:8787`です。

## APIを検索する

Health check:

```bash
curl http://localhost:8787/health
```

検索:

```bash
curl -X POST http://localhost:8787/api/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"モデルマージの手法","limit":5,"source":"web"}'
```

ブラウザでは`http://localhost:3000`を開き、検索語を入力します。

## データフロー

```text
Web（将来はSlack Botも同じ）
  → POST /api/search
  → search route（validationのみ）
  → searchDocuments()
  → EmbeddingProvider.embed(query)
  → DocumentRepository.searchSimilar()
  → cosine similarity / Top-k
  → SearchResponse
  → Webに結果表示
```

`searchDocuments()`はHonoのContextやHTTP Requestへ依存していないため、API以外のCLIや将来の処理からも再利用できます。

## 差し替えポイント

- Supabase / pgvector: `DocumentRepository`を実装する`LocalDocumentRepository`を、将来の`SupabaseDocumentRepository`へ差し替えます。RouteとWebにはlocal配列やcosine計算が漏れていません。
- Gemini / E5: `EmbeddingProvider`を実装する`LocalEmbeddingProvider`を、将来の`GeminiEmbeddingProvider`または`E5EmbeddingProvider`へ差し替えます。
- Slack Bot: `@lab-search/shared`の型を使い、Webと同じ`POST /api/search`をHTTPで呼びます。

## 品質確認

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

unit testはchunking、local embedding、cosine similarityを対象にしています。

## 今後の予定と現在の制約

- Google Drive API / Google OAuthによる文書取得
- Supabase / pgvectorへのindex保存とvector search移行
- GeminiまたはE5のEmbedding
- Slack App、slash command、mention、Block Kit、feedback button
- 検索ログとfeedback保存
- RAG / LLM回答生成
- BM25 / Hybrid Search / reranker
- 本番向け認証、rate limit、監視、デプロイ

現在のhashing embeddingは外部APIなしで構成確認を行うための決定的な簡易表現です。日本語の短い検索語にも対応できるよう、単語特徴に加えて2文字・3文字のn-gramを使用しています。同一語・近い文字列はある程度近くなりますが、本番品質の意味検索精度はありません。また、画像のみのPDFに対するOCRは未実装です。
