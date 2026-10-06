# 研究室資料検索（Lab Search）

研究室のGoogle Driveにある資料を自然言語で検索する、Backend中心のmonorepoです。Phase 2ではPDF／PPTX／Google Slides／DOCX／Google DocsをDriveから差分同期し、交換可能なGemini／Voyage AI Embedding、Zilliz Cloudのdense＋BM25 Hybrid Search、交換可能なrerankerで検索します。検索ログとfeedbackはSupabaseへ保存します。Phase 3では同じBackend APIを使うSlack Slash Commandとfeedbackを追加しています。Phase 1のローカルPDF検索と、移行元のQdrant実装も開発・障害切り分け用に残しています。

## 構成と責務

```text
lab-search/
├── apps/
│   ├── web/       # Next.js App Router: 検索・Driveリンク・feedback・Google Login
│   ├── backend/   # Hono: Drive、extract、chunk、embedding、Zilliz、Supabase、認可
│   └── slack/     # Slack Bolt: Slash Command、App Mention、DM、Block Kit、feedback
├── packages/
│   └── shared/    # Web / Slack / Backend間のAPI契約だけ
├── package.json
└── pnpm-workspace.yaml
```

WebとSlack BotはBackendのHTTP APIだけを利用します。Google Drive、Gemini、Zilliz、Supabaseの秘密情報や検索ロジックはクライアント側へ置きません。どちらも同じ`POST /api/search`と`POST /api/feedback`を利用します。

## データ構成

- Zilliz Cloud Free: 1 entity = 1 chunk。Embedding Providerに対応するdense vectorと`documentId`、`driveFileId`、文書名、MIME type、chunk番号、本文、page／slide／sectionTitle、Drive URLを固定schemaで保存します。Hybrid collectionでは、文書名・section title・本文からICU analyzerとBM25 functionでsparse vectorも生成します。denseはAUTOINDEX + COSINE、sparseはAUTOINDEX + BM25、`documentId`はTRIE indexです。collectionがなければ作成し、既存collectionは再作成しません。次元・field・記録済みEmbedding Provider・Hybrid schemaの不一致時は安全のため停止します。
- Qdrant Cloud: `SEARCH_MODE=qdrant`で従来実装を利用できます。既存vectorを再EmbeddingせずZillizへ移すmigration sourceとしても残しています。
- Supabase PostgreSQL: `documents`（Drive metadataと同期状態）、`search_logs`、`feedback`、`allowed_users`を保存します。Embeddingは保存しません。
- Google Drive: `GOOGLE_DRIVE_FOLDER_ID`以下だけをサブフォルダまで再帰探索します。

Supabase schemaは[`apps/backend/supabase/migrations`](apps/backend/supabase/migrations)にあります。ファイル名順にSupabase SQL Editorで実行するか、Supabase CLIを利用する環境ではmigrationとして適用してください。全tableでRLSを有効化し、クライアント向けpolicyは作成していません。Backendだけがsecret keyでアクセスします。

利用を許可する研究室メンバーはSQL Editorなどから追加します。

```sql
insert into public.allowed_users (email, role)
values ('member@example.ac.jp', 'member');
```

## 必要環境

- Node.js 25系（開発・typecheck・test・build確認済み: v25.3.0）
- pnpm 10.x
- Phase 2実運用: Zilliz Cloud Free、Supabase、Gemini API、Google Drive APIを有効にしたGoogle Cloud project

```bash
node --version # v25.x.x
corepack enable pnpm
pnpm install
cp apps/backend/.env.example apps/backend/.env
cp apps/web/.env.example apps/web/.env.local
```

- `corepack enable pnpm`: Node.js付属のCorepackを有効化し、このrepositoryが指定するpnpmを利用可能にします。
- `pnpm install`: 全workspaceの依存関係を一括でinstallします。
- `cp ...env.example ...env`: 公開可能な設定例を実際のローカル設定ファイルへコピーします。秘密値はコピー先だけに記入し、Gitへ追加しません。

## Phase 2の環境変数

Backendの`apps/backend/.env`を設定します。

```dotenv
SEARCH_MODE=zilliz
EMBEDDING_PROVIDER=voyage
EMBEDDING_DIMENSIONS=1024
VOYAGE_API_KEY=...
VOYAGE_EMBEDDING_MODEL=voyage-4-lite
VOYAGE_EMBEDDING_MAX_RETRIES=8
VOYAGE_EMBEDDING_REQUESTS_PER_MINUTE=3
VOYAGE_EMBEDDING_TOKENS_PER_MINUTE=10000
EMBEDDING_SYNC_BATCH_SIZE=5
SEARCH_STRATEGY=hybrid
RERANKER_PROVIDER=voyage
VOYAGE_RERANK_MODEL=rerank-2.5-lite
RERANK_CANDIDATE_DOCUMENTS=20
VOYAGE_RERANK_MAX_RETRIES=4

ZILLIZ_ENDPOINT=https://your-cluster-endpoint
ZILLIZ_TOKEN=...
ZILLIZ_COLLECTION=document_chunks_voyage4_lite_1024_hybrid

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...

GOOGLE_DRIVE_FOLDER_ID=...
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
# Default false. See the abusive-file policy below.
GOOGLE_DRIVE_ACKNOWLEDGE_ABUSE=false

AUTH_MODE=google
GOOGLE_CLIENT_ID=....apps.googleusercontent.com

# Slack Botを接続する場合。openssl rand -hex 32で生成します。
SLACK_BACKEND_SERVICE_TOKEN=...
SLACK_ALLOWED_TEAM_ID=T0123456789
```

Drive取得はservice accountを推奨します。対象フォルダをservice accountのメールアドレスへ共有してください。代わりに`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`GOOGLE_DRIVE_REFRESH_TOKEN`の組も利用できます。Google Slides APIも同じ認証と`drive.readonly` scopeを再利用します。Google Cloud projectではDrive APIに加えてGoogle Slides APIを有効化してください。`SUPABASE_SERVICE_ROLE_KEY`は旧形式との互換用で、可能なら`SUPABASE_SECRET_KEY`を使用します。

Webの`apps/web/.env.local`:

```dotenv
NEXT_PUBLIC_BACKEND_URL=http://localhost:8787
NEXT_PUBLIC_AUTH_MODE=google
NEXT_PUBLIC_GOOGLE_CLIENT_ID=....apps.googleusercontent.com
```

`ZILLIZ_TOKEN`、`QDRANT_API_KEY`、`SUPABASE_SECRET_KEY`、`GEMINI_API_KEY`、`VOYAGE_API_KEY`、`GOOGLE_CLIENT_SECRET`、service account JSONは絶対に`NEXT_PUBLIC_*`へ設定しないでください。Google OAuthのWeb clientには`http://localhost:3000`と本番Web originを承認済みJavaScript生成元として登録します。

Slack Botの設定と起動方法は[`apps/slack/README.md`](apps/slack/README.md)を参照してください。ローカルではSocket Modeを利用できるため、公開Request URLなしで動作確認できます。

Googleログインでは対応ChromeでFedCM button flowを利用し、非対応ブラウザのpopup flow向けに`Cross-Origin-Opener-Policy: same-origin-allow-popups`も設定しています。localhostでログインpopupがブラウザに拒否される場合は、通常のブラウザタブで`http://localhost:3000`を直接開き、このoriginのpopupを許可してください。iframe内のpreviewではpopupやFedCMが制限されることがあります。

## Zilliz collectionの準備

Zilliz CloudでFree clusterを作成し、Public EndpointとTokenを`apps/backend/.env`へ設定します。collectionはConsoleで手作業作成せず、次のコマンドで固定schemaとindexを作成・検証します。この処理はEmbedding APIを呼びません。

```bash
pnpm setup:zilliz
```

新規環境は、この後そのまま`pnpm sync:drive`を実行します。

### Hybrid Searchとreranker

検索は環境変数で個別に切り替えられます。

```dotenv
# denseのみ
SEARCH_STRATEGY=dense
RERANKER_PROVIDER=none

# dense + BM25をRRFで統合
SEARCH_STRATEGY=hybrid
RERANKER_PROVIDER=none

# Hybrid候補をVoyageで最終並べ替え
SEARCH_STRATEGY=hybrid
RERANKER_PROVIDER=voyage
VOYAGE_RERANK_MODEL=rerank-2.5-lite
RERANK_CANDIDATE_DOCUMENTS=20
VOYAGE_RERANK_MAX_RETRIES=4
```

Hybrid retrievalでは、日本語・英語が混在する研究室資料向けにICU analyzerを使ったBM25検索と、既存EmbeddingによるCOSINE検索を別々に実行し、Zilliz内でRRF（`k=60`）統合します。その後`documentId`で候補をまとめ、best chunkと上位2件の関連chunkを含む上位20文書を既定でVoyage `rerank-2.5-lite`へ送り、最終Top 5を決定します。reranker障害時は検索API全体を失敗させず、RRFの順位へfallbackします。

Hybrid schemaは既存dense collectionへ後付けできないため、新しいcollection名が必要です。既存の`document_chunks_voyage4_lite_1024`から再Embeddingせず移す場合は、次のように設定します。

```dotenv
SEARCH_MODE=zilliz
SEARCH_STRATEGY=hybrid
EMBEDDING_PROVIDER=voyage
EMBEDDING_DIMENSIONS=1024
ZILLIZ_SOURCE_COLLECTION=document_chunks_voyage4_lite_1024
ZILLIZ_COLLECTION=document_chunks_voyage4_lite_1024_hybrid
```

```bash
pnpm setup:zilliz
pnpm migrate:zilliz-to-hybrid
```

移行コマンドは元collectionのdense vector・chunk本文・metadataを新collectionへコピーし、BM25 sparse vectorはZilliz側で生成します。文書ごとのコピーが完了してからSupabaseの`vector_store_id`を更新するため、途中停止後も同じコマンドを再実行できます。移行・検索・`sync:drive`を確認するまでは元collectionを削除しないでください。

### GeminiからVoyage AIへ切り替える

既存Gemini vectorとVoyage vectorは同じcollectionへ混在させられません。既存`document_chunks`は残し、Voyage専用の新しいcollection名を設定します。

```dotenv
EMBEDDING_PROVIDER=voyage
EMBEDDING_DIMENSIONS=1024
VOYAGE_API_KEY=...
VOYAGE_EMBEDDING_MODEL=voyage-4-lite
VOYAGE_EMBEDDING_MAX_RETRIES=8
VOYAGE_EMBEDDING_REQUESTS_PER_MINUTE=3
VOYAGE_EMBEDDING_TOKENS_PER_MINUTE=10000
EMBEDDING_SYNC_BATCH_SIZE=5
ZILLIZ_COLLECTION=document_chunks_voyage4_lite_1024
```

既存Supabase projectでは、先に`apps/backend/supabase/migrations/002_embedding_index_identity.sql`をSQL Editorで実行します。その後に次を実行します。

```bash
pnpm setup:zilliz
pnpm sync:drive
```

`documents.embedding_provider_id`と`vector_store_id`を比較するため、Driveの更新時刻が同じでもProviderまたはcollectionが変われば自動的に再indexします。手動で`is_indexed`を全件更新する必要はありません。途中停止後は同じコマンドを再実行するとVoyage用collectionのcheckpointを再利用します。切替が完了するまで旧Gemini collectionは削除しないでください。

QdrantにあるGemini vectorをVoyage collectionへ移行してはいけません。`migrate:qdrant-to-zilliz`は移行元と移行先が同じEmbedding Provider・次元の場合だけ利用します。

Voyageへ支払い方法を登録していないorganizationでは、APIが通知する3 RPM／10K TPMに合わせて上記の低速設定を使用します。ProviderはUTF-8 byte数による保守的なtoken概算でbatchを自動分割し、直近60秒のrequest数・推定token数を超えないよう待機します。429の場合も同じbatchを自動再試行します。`EMBEDDING_SYNC_BATCH_SIZE=5`は成功分を小刻みにZillizへcheckpoint保存するための値です。支払い方法を登録してTier 1になった後は、Dashboardに表示された実際の上限に合わせて`VOYAGE_EMBEDDING_REQUESTS_PER_MINUTE`と`VOYAGE_EMBEDDING_TOKENS_PER_MINUTE`を変更し、同期batchも100程度へ戻せます。

### 既存Qdrantデータを移行する

すでにQdrantへ保存済みのvectorがある場合は、Qdrantの環境変数も一時的に残して次を実行します。

```dotenv
QDRANT_URL=https://your-cluster.cloud.qdrant.io
QDRANT_API_KEY=...
QDRANT_COLLECTION=document_chunks
```

```bash
pnpm migrate:qdrant-to-zilliz
```

このコマンドはSupabaseのactive documentsを順に処理し、Qdrantのvector・chunk本文・metadataをZillizへupsertします。Geminiへの再Embeddingは行いません。途中失敗は文書単位で記録して続行するため、同じコマンドを再実行できます。移行後も検索と`sync:drive`を確認するまではQdrant collectionを削除しないでください。

## Driveの事前分析

Vector DBやSupabaseへ書き込まず、対象folderの形式別件数、重複数、概算chunk数・vector容量を確認します。

```bash
pnpm analyze:drive
# 同等: pnpm --filter backend analyze:drive
```

容量はDrive metadataのfile sizeから推定した概算で、Vector DBのindexとpayload overheadは含みません。

### 実ファイルを使った精密分析

`analyze:drive:deep`は重複排除後の資料を実際にdownloadし、本番と同じExtractorとchunkerを適用して、page／slide／実chunk数と容量を測定します。

最初は形式比率を保ったsample分析を推奨します。

```bash
pnpm --filter backend analyze:drive:deep --sample 100
```

全index対象を測定する場合:

```bash
pnpm analyze:drive:deep
```

主なoption:

```text
--sample 100        形式比率を保った決定的sample
--dimension 768     容量計算に使うEmbedding次元
--concurrency 3     Drive downloadの並列数
--capacity-gib 5    Vector DB容量の仮定（Zilliz Freeは5 GB）
--top 20            巨大ファイルranking件数
--output-dir PATH   report保存先
```

出力には形式別のpage／slide／文字数／chunk数、percentile、histogram、巨大ファイル、抽出失敗、raw float32 vector、実payload JSON容量、1.5x／2x／3x overhead scenario、指定したcluster容量に対する使用率と概算最大chunk数を含みます。sample modeでは実測sample値と全体への形式別外挿値を明確に区別します。

詳細reportは次へ保存されます。

```text
apps/backend/reports/drive-analysis-YYYYMMDD-HHmmss.json
apps/backend/reports/drive-analysis-files-YYYYMMDD-HHmmss.csv
```

このコマンドはEmbedding APIを呼ばず、Zilliz／Qdrant／Supabaseへ書き込まず、Driveも変更しません。index等のoverheadは実登録値ではないため、base dataへ係数を掛けた参考シナリオとして表示します。

特定ファイルのmetadata、取得方式、Google API reason、抽出・chunk結果は次で確認できます。

```bash
pnpm --filter backend debug:drive-file --file-id <GOOGLE_DRIVE_FILE_ID>
```

Google Slidesでは`Google Slides API (presentations.get)`、PDF／PPTXでは`Drive binary download`、Google Docsでは`Drive Workspace export`と表示されます。

## Driveを差分同期する

先にSupabase migrationを適用し、環境変数を設定します。

```bash
pnpm sync:drive
# 同等: pnpm --filter backend sync:drive
```

処理は次の順序です。

```text
folder以下のmetadata一覧
  → 対応形式だけ選択
  → PDF/PPTX重複排除
  → Supabaseのdrive_file_id / modified_timeと比較
  → NEW / UPDATEDだけdownload・extract・chunk
  → 同じ更新時刻のZilliz checkpointを読み戻す
  → 未保存chunkだけembeddingし、batchごとにZillizへupsert
  → 完了時に旧版の余分なZilliz entitiesを削除
  → Supabaseの同期状態を更新
  → Driveから消えた／folder外へ移動した文書をZillizから削除してinactive化
```

1文書のdownload、parse、Embedding、Vector DB更新が失敗しても他文書は続行し、最後にsummaryを表示します。失敗した文書は`is_indexed=false`になるため次回同期で再試行されます。抽出可能なテキストがない画像のみのPDF／PPTX等は障害ではなく`Empty skipped`として正常にskipし、古いvectorがあれば削除します。取得エラーは`cannotDownloadAbusiveFile`、`exportSizeLimitExceeded`、`insufficientFilePermissions`、`fileNotDownloadable`、その他へ分類します。

Geminiへの文書Embeddingは、既定では20 chunkずつbatch送信し、成功したbatchを直ちにZillizへcheckpoint保存します（`EMBEDDING_SYNC_BATCH_SIZE`で1〜100件に変更可能）。通常の呼び出しは`GEMINI_EMBEDDING_REQUESTS_PER_MINUTE`（既定90）で平準化します。それでもproject全体の利用量などにより一時的な429になった場合は、Google APIが返す`retryDelay`に1秒の余裕を加えて同じbatchを自動再試行します（既定8回）。

`EmbedContentRequestsPerDay...FreeTier`の日次quotaを使い切っても、その文書ですでに保存したchunkは失われません。quota reset後に同じ`pnpm sync:drive`を再実行すると、同じDrive更新時刻・chunk ID・本文・次元数のcheckpointをZillizから読み戻し、未保存chunkだけをGeminiへ送ります。summaryの`Embedded chunks`、`Reused checkpoint chunks`、`Embedding batch attempts`、`Embedding input chunks submitted`、`Embedding quota exhausted`、`Deferred`で、Embedding APIへ送った量とZillizへ確定した量を比較できます。Gemini APIの日次quotaはPacific timeの午前0時にresetされます（日本時間では夏時間中16時、標準時間中17時）。初回同期のchunk数が無料枠を大きく超える場合はVoyage AI等への切替、またはGoogle AI Studioでbillingを有効化したpaid tierを検討します。

異なるEmbeddingモデルのvectorは比較できないため、Providerを変える場合は必ず別collectionを使用します。BackendはProvider IDとvector store IDをSupabaseへ記録し、変更時は自動的に全件を再index対象として扱います。

### Google側で危険判定されたPDF

`cannotDownloadAbusiveFile`は通常の権限エラーと分離します。既定の`GOOGLE_DRIVE_ACKNOWLEDGE_ABUSE=false`ではwarningを記録して`skipped_abusive_file`とし、同期全体を続行します。`true`の場合に限り、PDFを`acknowledgeAbuse=true`付きで1回だけ再取得します。再取得にも失敗した場合はskipします。

Googleの仕様上、`acknowledgeAbuse=true`が利用できるのは対象ファイルの所有者、または対象共有ドライブのorganizerである認証主体に限られます。この設定はGoogle側のmalware判定を解除するものではありません。安全性を確認したファイルにだけ明示的に使用してください。

## 対応形式とchunking

| Drive形式 | 取得／抽出 | chunking |
|---|---|---|
| PDF | pdf-parse、ページ番号を保持 | ページ内の自然な文末を優先し約900文字、overlap 120 |
| PPTX | OOXMLのslide XML | 原則1 slide、1500文字超は分割 |
| Google Slides | Slides API `presentations.get`からshape内のtext runを直接抽出 | 原則1 slide |
| DOCX | OOXMLのheading／paragraph | heading sectionを優先し約900文字、overlap 100 |
| Google Docs | Drive APIでDOCX export後に同じ抽出器 | heading sectionを優先 |

その他の形式は`unsupported`としてskipします。OCRは行わないため、画像だけのPDFは検索対象にできません。

Google SlidesはPPTX exportを行わないため、Drive exportのサイズ上限には依存しません。slideの`pageElements`を順に処理し、shape内の`textRun`／`autoText`を連結します。`TITLE`／`CENTERED_TITLE` placeholderはsection titleとして保持します。画像OCRとSpeaker Notes解析は行いません。

重複扱いするのは、次をすべて満たす場合だけです。

1. 同じparent folderにある
2. 拡張子を除いたbasenameがUnicode正規化後に完全一致する
3. 一方がPDF、もう一方がPPTXである

この場合はslide構造を保持できるPPTXだけをZillizへ登録します。PDF metadataはSupabaseへ`is_indexed=false`、`duplicate_of=<PPTX documents.id>`として残します。fuzzy matchingや内容比較は行いません。

## 起動と検索

```bash
pnpm dev:backend
pnpm dev:web
# Slack App設定後
pnpm dev:slack
# または両方を並列起動
pnpm dev
```

Backendは既定`http://localhost:8787`、Webは`http://localhost:3000`です。`pnpm dev`は両方の開発serverを起動するため、終了は`Ctrl+C`です。

Health check:

```bash
curl http://localhost:8787/health
```

認証を無効にした開発環境での検索例:

```bash
curl -X POST http://localhost:8787/api/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"モデルマージによる破滅的忘却","limit":5,"source":"web"}'
```

`AUTH_MODE=google`では`Authorization: Bearer <Google ID token>`も必要です。Backendが署名・audience・email verificationを検証し、`allowed_users`にemailがある利用者だけ許可します。

Response例:

```json
{
  "searchLogId": "uuid",
  "results": [{
    "chunkId": "uuid:3",
    "documentId": "uuid",
    "documentName": "seminar.pptx",
    "mimeType": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "content": "...",
    "score": 0.87,
    "scoreType": "reranker",
    "retrievalScore": 0.031,
    "slide": 18,
    "url": "https://drive.google.com/..."
  }]
}
```

Zillizからはvectorを返さず、本文と必要なmetadataだけを含むchunk候補を取得して`documentId`でgroup化します。候補は最低100件（reranker有効時は候補文書数`× 20`件）から開始し、同じ文書のchunkが候補を占有して指定文書数に届かない場合は最大500件まで自動的に拡張します。各文書の最大chunk scoreで候補を並べ、同一文書のchunkだけで結果欄を埋めません。他の一致chunkは`relatedChunks`に保持します。

`scoreType`はdense検索なら`cosine`、Hybrid retrievalなら`rrf`、Voyage最終並べ替え後なら`reranker`です。reranker利用時は`score`がrerankerのrelevance score、`retrievalScore`がRRF段階のscoreです。方式ごとに尺度が異なるため、異なる`scoreType`間でscoreの絶対値を直接比較しないでください。

## 検索品質評価

初期評価セットは`apps/backend/evaluation/search-cases.json`です。同期済みの研究室資料を正解候補として、日本語の意味検索、日英をまたぐ検索、専門用語検索、短いkeyword検索、該当資料なしqueryを含む33件を収録しています。同じテーマの説明文queryと短いqueryを比較できます。人手関連度は次の4段階です。

| 関連度 | 意味 |
|---:|---|
| 3 | queryの中心テーマを扱う直接の正解 |
| 2 | queryの意図をかなり扱う関連資料 |
| 1 | 用語や広い分野だけが関係する周辺資料 |
| 0 | 不適合、または評価セットで正解指定されていない資料 |

関連度2以上を正解として、現在のBackend検索を実行し、`Hit@5`、`MRR@5`、`nDCG@5`を計算します。

```bash
# APIを呼ばずにquery一覧だけ確認
pnpm evaluate:search -- --list

# 全queryを現在のEmbedding／vector collectionで評価
pnpm evaluate:search

# 1件だけ評価
pnpm evaluate:search -- --case bm25-length-normalization

# 短いkeyword queryだけ評価
pnpm evaluate:search -- --category simple-keyword
```

実行結果はterminalに表示され、詳細は`apps/backend/reports/search-evaluation-*.json`へ保存されます。各結果の`score`は選択した検索方式のscore、`relevance`は評価セットに固定した人手関連度であり、別の値です。該当資料なしqueryはranking指標の平均から除外し、誤検索の`top score`を記録して、方式ごとのscore threshold調整に使います。

この初期ラベルは主に資料名と研究テーマから作成した暫定版です。評価結果に未採点だが適合する資料が出た場合は、内容を確認してJSONへ関連度を追加します。検索方式やEmbeddingモデルを比較するときは、同じdataset versionと同じTop-kを使用します。Voyageの3 RPM設定では全33件の評価に約10〜11分かかります。

## Feedback API

```bash
curl -X POST http://localhost:8787/api/feedback \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <Google ID token>' \
  -d '{"searchLogId":"...","documentId":"...","chunkId":"...","rank":2,"score":0.81,"feedback":"positive","source":"web"}'
```

`feedback`は`positive`または`negative`です。Backendは検索ログがログイン利用者自身のものか確認してから保存します。DBにも`user_id + search_log_id + document_id`のunique constraintがあります。Webは送信済み状態に切り替え、同じ結果への連打を防ぎます。

## Phase 1ローカルモード

外部サービスなしで回帰確認できます。Backend `.env`を`SEARCH_MODE=local`、`EMBEDDING_PROVIDER=local`、`AUTH_MODE=disabled`にします。PDFを`apps/backend/sample/`へ置きます。

```bash
pnpm index:local
pnpm dev
```

`index:local`は`PDF抽出 → 約700文字・overlap 100のchunk → 決定的な日本語対応hashing embedding → apps/backend/data/local-index.json`を行います。local embeddingは日本語2文字／3文字n-gramを含みますが、本番品質の意味検索ではありません。local modeではSupabase未設定なら`searchLogId`は`null`で、feedback buttonは無効です。

## 品質確認

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

unit testは既存cosine／chunking／local embeddingに加え、Zilliz dense／BM25 Hybrid schema・RRF検索request・検索結果変換・checkpoint削除、Voyage reranker、basename正規化、PDF/PPTX重複判定、構造metadata保持、document-level grouping、search service、feedback serviceを外部APIなしで確認します。

## 今後

- 複数Slack workspace向けOAuth installation store
- RAG回答生成、Hybrid Searchのweight調整・日本語analyzer比較、reranker比較
- OCR、高度な重複検出、feedbackを使ったranking改善、analytics、監視・rate limit・本番deploy
