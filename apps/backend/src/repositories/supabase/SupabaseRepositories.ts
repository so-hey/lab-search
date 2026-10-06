import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AllowedUser,
  AllowedUserRepository,
  DocumentLocationRepository,
  DocumentMetadataRepository,
  DocumentRecord,
  FeedbackInput,
  FeedbackRepository,
  SearchLogInput,
  SearchLogRepository,
  UpsertDocumentInput,
} from "../metadata/types.js";

type DocumentLocationRow = {
  id: string;
  parent_folder_id: string | null;
};

type DocumentRow = {
  id: string;
  drive_file_id: string;
  name: string;
  mime_type: string;
  parent_folder_id: string | null;
  web_view_link: string | null;
  modified_time: string;
  is_indexed: boolean;
  embedding_provider_id: string | null;
  vector_store_id: string | null;
  duplicate_of: string | null;
  is_active: boolean;
};

function toDocumentRecord(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    driveFileId: row.drive_file_id,
    name: row.name,
    mimeType: row.mime_type,
    parentFolderId: row.parent_folder_id,
    webViewLink: row.web_view_link,
    modifiedTime: row.modified_time,
    isIndexed: row.is_indexed,
    embeddingProviderId: row.embedding_provider_id,
    vectorStoreId: row.vector_store_id,
    duplicateOf: row.duplicate_of,
    isActive: row.is_active,
  };
}

function documentInput(input: UpsertDocumentInput) {
  return {
    drive_file_id: input.driveFileId,
    name: input.name,
    mime_type: input.mimeType,
    parent_folder_id: input.parentFolderId,
    web_view_link: input.webViewLink,
    modified_time: input.modifiedTime,
    is_indexed: input.isIndexed,
    embedding_provider_id: input.embeddingProviderId,
    vector_store_id: input.vectorStoreId,
    duplicate_of: input.duplicateOf,
    is_active: input.isActive,
  };
}

export class SupabaseDocumentMetadataRepository
  implements DocumentMetadataRepository
{
  constructor(private readonly client: SupabaseClient) {}

  async listActive(): Promise<DocumentRecord[]> {
    const { data, error } = await this.client
      .from("documents")
      .select("id,drive_file_id,name,mime_type,parent_folder_id,web_view_link,modified_time,is_indexed,embedding_provider_id,vector_store_id,duplicate_of,is_active")
      .eq("is_active", true);
    if (error) throw new Error(`Failed to list documents: ${error.message}`);
    return (data as DocumentRow[]).map(toDocumentRecord);
  }

  async upsert(input: UpsertDocumentInput): Promise<DocumentRecord> {
    const { data, error } = await this.client
      .from("documents")
      .upsert(documentInput(input), { onConflict: "drive_file_id" })
      .select("id,drive_file_id,name,mime_type,parent_folder_id,web_view_link,modified_time,is_indexed,embedding_provider_id,vector_store_id,duplicate_of,is_active")
      .single();
    if (error) throw new Error(`Failed to upsert document: ${error.message}`);
    return toDocumentRecord(data as DocumentRow);
  }

  async updateIndexState(
    id: string,
    state: Pick<DocumentRecord, "isIndexed" | "duplicateOf" | "isActive">,
  ): Promise<void> {
    const { error } = await this.client
      .from("documents")
      .update({
        is_indexed: state.isIndexed,
        duplicate_of: state.duplicateOf,
        is_active: state.isActive,
      })
      .eq("id", id);
    if (error) throw new Error(`Failed to update document state: ${error.message}`);
  }
}

export class SupabaseDocumentLocationRepository
  implements DocumentLocationRepository
{
  constructor(private readonly client: SupabaseClient) {}

  async getParentFolderIds(
    documentIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    const uniqueIds = [...new Set(documentIds)];
    if (uniqueIds.length === 0) return new Map();

    const { data, error } = await this.client
      .from("documents")
      .select("id,parent_folder_id")
      .in("id", uniqueIds);
    if (error) {
      throw new Error(`Failed to load document locations: ${error.message}`);
    }

    return new Map(
      (data as DocumentLocationRow[])
        .filter(
          (row): row is DocumentLocationRow & { parent_folder_id: string } =>
            typeof row.parent_folder_id === "string" &&
            row.parent_folder_id.length > 0,
        )
        .map((row) => [row.id, row.parent_folder_id]),
    );
  }
}

export class SupabaseSearchLogRepository implements SearchLogRepository {
  constructor(private readonly client: SupabaseClient) {}

  async create(input: SearchLogInput): Promise<string> {
    const { data, error } = await this.client
      .from("search_logs")
      .insert({
        user_id: input.userId,
        source: input.source,
        query: input.query,
        result_count: input.resultCount,
      })
      .select("id")
      .single();
    if (error) throw new Error(`Failed to save search log: ${error.message}`);
    return (data as { id: string }).id;
  }

  async isOwnedBy(searchLogId: string, userId: string): Promise<boolean> {
    const { data, error } = await this.client
      .from("search_logs")
      .select("id")
      .eq("id", searchLogId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(`Failed to verify search log: ${error.message}`);
    return data !== null;
  }
}

export class SupabaseFeedbackRepository implements FeedbackRepository {
  constructor(private readonly client: SupabaseClient) {}

  async create(input: FeedbackInput): Promise<string> {
    const { data, error } = await this.client
      .from("feedback")
      .insert({
        user_id: input.userId,
        source: input.source,
        search_log_id: input.searchLogId,
        document_id: input.documentId,
        chunk_id: input.chunkId,
        rank: input.rank,
        score: input.score,
        feedback: input.feedback,
      })
      .select("id")
      .single();
    if (error) throw new Error(`Failed to save feedback: ${error.message}`);
    return (data as { id: string }).id;
  }
}

export class SupabaseAllowedUserRepository implements AllowedUserRepository {
  constructor(private readonly client: SupabaseClient) {}

  async findByEmail(email: string): Promise<AllowedUser | null> {
    const { data, error } = await this.client
      .from("allowed_users")
      .select("email,role")
      .eq("email", email.toLocaleLowerCase())
      .maybeSingle();
    if (error) throw new Error(`Failed to check allowed user: ${error.message}`);
    return data as AllowedUser | null;
  }
}
