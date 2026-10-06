alter table public.documents
  add column if not exists embedding_provider_id text,
  add column if not exists vector_store_id text;

comment on column public.documents.embedding_provider_id is
  'EmbeddingProvider.id used for the current vector index.';
comment on column public.documents.vector_store_id is
  'Vector store and collection identifier used for the current vector index.';
