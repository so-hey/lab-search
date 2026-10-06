# Slack Bot workspace

Phase 3でSlack Botを実装するためのworkspaceです。Slack側に検索ロジックは置かず、API契約を`@lab-search/shared`からimportし、Backendの`POST /api/search`と`POST /api/feedback`をHTTPで利用します。

今後の予定:

- Slack App設定
- slash command
- mentionへの応答
- Block Kitによる検索結果表示
- feedback button
