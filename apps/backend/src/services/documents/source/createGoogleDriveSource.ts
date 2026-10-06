import { booleanEnv, optionalEnv, requiredEnv } from "../../../config/env.js";
import { GoogleDriveDocumentSource } from "./GoogleDriveDocumentSource.js";

export function createGoogleDriveSource() {
  return GoogleDriveDocumentSource.create({
    folderId: requiredEnv("GOOGLE_DRIVE_FOLDER_ID"),
    clientId: optionalEnv("GOOGLE_CLIENT_ID"),
    clientSecret: optionalEnv("GOOGLE_CLIENT_SECRET"),
    refreshToken: optionalEnv("GOOGLE_DRIVE_REFRESH_TOKEN"),
    serviceAccountJson: optionalEnv("GOOGLE_SERVICE_ACCOUNT_JSON"),
    acknowledgeAbuse: booleanEnv("GOOGLE_DRIVE_ACKNOWLEDGE_ABUSE", false),
  });
}
