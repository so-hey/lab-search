import {
  GoogleAuth,
  OAuth2Client,
  type AuthClient,
} from "google-auth-library";
import { MIME } from "../mimeTypes.js";
import type { DocumentSource, SourceFile, SourceFileContent } from "./types.js";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const SLIDES_API = "https://slides.googleapis.com/v1";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const SLIDES_FIELDS = [
  "presentationId",
  "title",
  "slides(objectId,pageElements(objectId,shape(placeholder(type),text(textElements(textRun(content),autoText(content))))))",
].join(",");

type DriveFile = {
  id?: string;
  name?: string;
  mimeType?: string;
  parents?: string[];
  modifiedTime?: string;
  capabilities?: {
    canDownload?: boolean;
  };
  driveId?: string;
  webViewLink?: string;
  size?: string;
};

type ListResponse = { files?: DriveFile[]; nextPageToken?: string };

export type GoogleDriveSourceOptions = {
  folderId: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  serviceAccountJson?: string;
  acknowledgeAbuse?: boolean;
  logger?: DriveErrorLogger;
};

export type DriveErrorLogger = {
  error(message: string): void;
  warn(message: string): void;
};

export type DriveContentRequest = {
  url: string;
  params: Record<string, string>;
  contentMimeType: string;
  strategy: "download" | "export" | "google_slides_api";
};

export type DriveAcquisitionErrorReason =
  | "cannotDownloadAbusiveFile"
  | "exportSizeLimitExceeded"
  | "insufficientFilePermissions"
  | "fileNotDownloadable"
  | "unknown";

export type DriveRetrievalErrorLog = {
  status: number | string | null;
  error: {
    message: string;
    errors: Array<{ reason: string }>;
  };
  fileId: string;
  fileName: string;
  mimeType: string;
  capabilities: {
    canDownload: boolean | null;
  };
  driveId: string | null;
  parents: string[];
  retrievalStrategy: DriveContentRequest["strategy"];
  googleApiResponseBody: unknown;
};

const KNOWN_ACQUISITION_REASONS = new Set<DriveAcquisitionErrorReason>([
  "cannotDownloadAbusiveFile",
  "exportSizeLimitExceeded",
  "insufficientFilePermissions",
  "fileNotDownloadable",
]);

export class DriveAcquisitionError extends Error {
  readonly status: number | string | null;

  constructor(
    message: string,
    readonly reason: DriveAcquisitionErrorReason,
    readonly details: DriveRetrievalErrorLog,
    readonly action: "skipped" | "failed",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DriveAcquisitionError";
    this.status = details.status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseJsonText(text: string): unknown {
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function parseResponseBody(data: unknown): unknown {
  if (typeof data === "string") return parseJsonText(data);
  if (data instanceof ArrayBuffer) {
    return parseJsonText(new TextDecoder().decode(new Uint8Array(data)));
  }
  if (ArrayBuffer.isView(data)) {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return parseJsonText(new TextDecoder().decode(bytes));
  }
  return data ?? null;
}

function errorResponse(error: unknown): Record<string, unknown> | undefined {
  if (!isRecord(error) || !isRecord(error.response)) return undefined;
  return error.response;
}

function googleError(body: unknown): Record<string, unknown> | undefined {
  if (!isRecord(body) || !isRecord(body.error)) return undefined;
  return body.error;
}

function googleErrorReasons(error: Record<string, unknown> | undefined): Array<{ reason: string }> {
  if (!error || !Array.isArray(error.errors)) return [];
  return error.errors.flatMap((item) => {
    if (!isRecord(item) || typeof item.reason !== "string") return [];
    return [{ reason: item.reason }];
  });
}

export function buildDriveContentRequest(file: SourceFile): DriveContentRequest {
  const baseUrl = `${DRIVE_API}/files/${encodeURIComponent(file.id)}`;
  if (file.mimeType === MIME.googleSlides) {
    return {
      url: `${SLIDES_API}/presentations/${encodeURIComponent(file.id)}`,
      params: { fields: SLIDES_FIELDS },
      contentMimeType: MIME.googleSlides,
      strategy: "google_slides_api",
    };
  }
  if (file.mimeType === MIME.googleDocs) {
    return {
      url: `${baseUrl}/export`,
      params: { mimeType: MIME.docx },
      contentMimeType: MIME.docx,
      strategy: "export",
    };
  }
  return {
    url: baseUrl,
    params: { alt: "media" },
    contentMimeType: file.mimeType,
    strategy: "download",
  };
}

export function buildDriveRetrievalErrorLog(
  cause: unknown,
  file: SourceFile,
  request: DriveContentRequest,
): DriveRetrievalErrorLog {
  const response = errorResponse(cause);
  const responseBody = parseResponseBody(response?.data);
  const apiError = googleError(responseBody);
  const directStatus = isRecord(cause) ? cause.status : undefined;
  const responseStatus = response?.status;
  const status =
    typeof responseStatus === "number" || typeof responseStatus === "string"
      ? responseStatus
      : typeof directStatus === "number" || typeof directStatus === "string"
        ? directStatus
        : typeof apiError?.code === "number" || typeof apiError?.code === "string"
          ? apiError.code
          : null;
  const fallbackMessage = cause instanceof Error ? cause.message : String(cause);
  return {
    status,
    error: {
      message: typeof apiError?.message === "string" ? apiError.message : fallbackMessage,
      errors: googleErrorReasons(apiError),
    },
    fileId: file.id,
    fileName: file.name,
    mimeType: file.mimeType,
    capabilities: {
      canDownload: file.capabilities?.canDownload ?? null,
    },
    driveId: file.driveId ?? null,
    parents: file.parentIds,
    retrievalStrategy: request.strategy,
    googleApiResponseBody: responseBody,
  };
}

export function formatDriveRetrievalErrorLog(details: DriveRetrievalErrorLog): string {
  return `[drive] file retrieval failed\n${JSON.stringify(details, null, 2)}`;
}

export function classifyDriveAcquisitionError(
  details: DriveRetrievalErrorLog,
): DriveAcquisitionErrorReason {
  for (const { reason } of details.error.errors) {
    if (KNOWN_ACQUISITION_REASONS.has(reason as DriveAcquisitionErrorReason)) {
      return reason as DriveAcquisitionErrorReason;
    }
  }
  return "unknown";
}

function acquisitionError(
  cause: unknown,
  details: DriveRetrievalErrorLog,
  action: "skipped" | "failed" = "failed",
  reason = classifyDriveAcquisitionError(details),
): DriveAcquisitionError {
  return new DriveAcquisitionError(details.error.message, reason, details, action, { cause });
}

function formatAbusiveFileWarning(input: {
  details: DriveRetrievalErrorLog;
  enabled: boolean;
  attempted: boolean;
  action: "retry_with_acknowledge_abuse" | "downloaded" | "skipped";
}): string {
  return `[drive][warning]\n${JSON.stringify({
    file: input.details.fileName,
    reason: "cannotDownloadAbusiveFile",
    warning: "Google flagged this file as abusive, malware, or spam.",
    acknowledgeAbuse: {
      enabled: input.enabled,
      attempted: input.attempted,
    },
    action: input.action,
    details: input.details,
  }, null, 2)}`;
}

function validateDriveFile(file: DriveFile): SourceFile {
  if (!file.id || !file.name || !file.mimeType || !file.modifiedTime) {
    throw new Error("Google Drive returned incomplete file metadata.");
  }
  const size = file.size === undefined ? undefined : Number(file.size);
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    parentIds: file.parents ?? [],
    modifiedTime: file.modifiedTime,
    ...(file.capabilities?.canDownload === undefined
      ? {}
      : { capabilities: { canDownload: file.capabilities.canDownload } }),
    ...(file.driveId ? { driveId: file.driveId } : {}),
    ...(file.webViewLink ? { webViewLink: file.webViewLink } : {}),
    ...(size !== undefined && Number.isFinite(size) ? { size } : {}),
  };
}

function asBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  throw new Error("Google Drive returned an unsupported binary response.");
}

export class GoogleDriveDocumentSource implements DocumentSource {
  private readonly folderId: string;
  private readonly auth: AuthClient;
  private readonly logger: DriveErrorLogger;
  private readonly acknowledgeAbuse: boolean;

  constructor(
    folderId: string,
    auth: AuthClient,
    options: { logger?: DriveErrorLogger; acknowledgeAbuse?: boolean } = {},
  ) {
    this.folderId = folderId;
    this.auth = auth;
    this.logger = options.logger ?? console;
    this.acknowledgeAbuse = options.acknowledgeAbuse ?? false;
  }

  static async create(options: GoogleDriveSourceOptions): Promise<GoogleDriveDocumentSource> {
    let auth: AuthClient;
    if (options.serviceAccountJson) {
      let credentials: object;
      try {
        credentials = JSON.parse(options.serviceAccountJson) as object;
      } catch (cause) {
        throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.", { cause });
      }
      auth = await new GoogleAuth({ credentials, scopes: [DRIVE_SCOPE] }).getClient();
    } else {
      if (!options.clientId || !options.clientSecret || !options.refreshToken) {
        throw new Error(
          "Drive access requires GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_DRIVE_REFRESH_TOKEN.",
        );
      }
      const oauth = new OAuth2Client(options.clientId, options.clientSecret);
      oauth.setCredentials({ refresh_token: options.refreshToken });
      auth = oauth;
    }
    return new GoogleDriveDocumentSource(options.folderId, auth, {
      logger: options.logger,
      acknowledgeAbuse: options.acknowledgeAbuse,
    });
  }

  async listDocuments(): Promise<SourceFile[]> {
    const result: SourceFile[] = [];
    const pendingFolders = [this.folderId];
    const visited = new Set<string>();

    while (pendingFolders.length > 0) {
      const folderId = pendingFolders.shift();
      if (!folderId || visited.has(folderId)) continue;
      visited.add(folderId);
      let pageToken: string | undefined;
      do {
        const response = await this.auth.request<ListResponse>({
          url: `${DRIVE_API}/files`,
          params: {
            q: `'${folderId.replaceAll("'", "\\'")}' in parents and trashed = false`,
            fields: "nextPageToken,files(id,name,mimeType,parents,modifiedTime,capabilities(canDownload),driveId,webViewLink,size)",
            pageSize: 1000,
            pageToken,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
          },
        });
        for (const rawFile of response.data.files ?? []) {
          const file = validateDriveFile(rawFile);
          if (file.mimeType === MIME.folder) pendingFolders.push(file.id);
          else result.push(file);
        }
        pageToken = response.data.nextPageToken;
      } while (pageToken);
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getDocument(file: SourceFile): Promise<SourceFileContent> {
    const request = buildDriveContentRequest(file);
    try {
      return await this.executeRequest(file, request);
    } catch (cause) {
      const details = buildDriveRetrievalErrorLog(cause, file, request);
      const reason = classifyDriveAcquisitionError(details);
      if (reason !== "cannotDownloadAbusiveFile") {
        this.logger.error(formatDriveRetrievalErrorLog(details));
        throw acquisitionError(cause, details);
      }

      const mayRetry =
        file.mimeType === MIME.pdf &&
        request.strategy === "download" &&
        this.acknowledgeAbuse;
      this.logger.warn(formatAbusiveFileWarning({
        details,
        enabled: this.acknowledgeAbuse,
        attempted: false,
        action: mayRetry ? "retry_with_acknowledge_abuse" : "skipped",
      }));
      if (!mayRetry) {
        throw acquisitionError(cause, details, "skipped", reason);
      }

      const acknowledgedRequest = {
        ...request,
        params: { ...request.params, acknowledgeAbuse: "true" },
      };
      try {
        const result = await this.executeRequest(file, acknowledgedRequest);
        this.logger.warn(formatAbusiveFileWarning({
          details,
          enabled: true,
          attempted: true,
          action: "downloaded",
        }));
        return result;
      } catch (retryCause) {
        const retryDetails = buildDriveRetrievalErrorLog(retryCause, file, acknowledgedRequest);
        this.logger.warn(formatAbusiveFileWarning({
          details: retryDetails,
          enabled: true,
          attempted: true,
          action: "skipped",
        }));
        throw acquisitionError(
          retryCause,
          retryDetails,
          "skipped",
          "cannotDownloadAbusiveFile",
        );
      }
    }
  }

  private async executeRequest(
    file: SourceFile,
    request: DriveContentRequest,
  ): Promise<SourceFileContent> {
    if (request.strategy === "google_slides_api") {
      const response = await this.auth.request<unknown>({
        url: request.url,
        params: request.params,
      });
      const serialized = JSON.stringify(response.data);
      if (!serialized) throw new Error(`${file.name} returned an empty Slides API response.`);
      return {
        file,
        data: new TextEncoder().encode(serialized),
        contentMimeType: request.contentMimeType,
      };
    }
    const response = await this.auth.request<ArrayBuffer>({
      url: request.url,
      params: request.params,
      responseType: "arraybuffer",
    });
    const data = asBytes(response.data);
    if (data.byteLength === 0) throw new Error(`${file.name} is empty.`);
    return { file, data, contentMimeType: request.contentMimeType };
  }
}
