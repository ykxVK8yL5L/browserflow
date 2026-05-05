import { 
  getIdentities as apiGetIdentities, 
  createIdentity as apiCreateIdentity, 
  updateIdentity as apiUpdateIdentity, 
  deleteIdentity as apiDeleteIdentity,
  uploadIdentityState as apiUploadIdentityState,
  getIdentityState as apiGetIdentityState,
  saveIdentityState as apiSaveIdentityState,
  listIdentityFiles as apiListIdentityFiles,
  getIdentityFileContent as apiGetIdentityFileContent,
  saveIdentityFileContent as apiSaveIdentityFileContent,
  createIdentityFolder as apiCreateIdentityFolder,
  renameIdentityPath as apiRenameIdentityPath,
  deleteIdentityPath as apiDeleteIdentityPath,
  uploadIdentityFile as apiUploadIdentityFile,
  type IdentityStateFile as ApiIdentityStateFile,
  type IdentityFileEntry as ApiIdentityFileEntry,
  type IdentityFileListResponse as ApiIdentityFileListResponse,
  type IdentityFileContentResponse as ApiIdentityFileContentResponse,
  type Identity as ApiIdentity 
} from "./identityApi";

export interface Identity extends ApiIdentity {
  // Add any frontend-specific extensions here
}

export interface IdentityStateFile extends ApiIdentityStateFile {}
export interface IdentityFileEntry extends ApiIdentityFileEntry {}
export interface IdentityFileListResponse extends ApiIdentityFileListResponse {}
export interface IdentityFileContentResponse extends ApiIdentityFileContentResponse {}

/**
 * 获取所有 Identity 列表
 */
export async function fetchIdentities(): Promise<Identity[]> {
  try {
    return await apiGetIdentities();
  } catch (error) {
    console.error("Failed to fetch identities:", error);
    throw error;
  }
}

/**
 * 创建 Identity
 */
export async function createIdentity(data: {
  name: string;
  type: string;
  credential_id?: string;
}): Promise<Identity> {
  return await apiCreateIdentity(data);
}

/**
 * 更新 Identity
 */
export async function updateIdentity(id: string, updates: Partial<Identity>): Promise<Identity> {
  return await apiUpdateIdentity(id, updates);
}

/**
 * 删除 Identity
 */
export async function deleteIdentity(id: string): Promise<void> {
  return await apiDeleteIdentity(id);
}

/**
 * 上传 storageState 文件
 */
export async function uploadIdentityState(formData: FormData): Promise<Identity> {
  return await apiUploadIdentityState(formData);
}

export async function fetchIdentityState(identityId: string): Promise<IdentityStateFile> {
  return await apiGetIdentityState(identityId);
}

export async function saveIdentityState(identityId: string, content: string): Promise<IdentityStateFile> {
  return await apiSaveIdentityState(identityId, content);
}

export async function fetchIdentityFiles(identityId: string, path = ""): Promise<IdentityFileListResponse> {
  return await apiListIdentityFiles(identityId, path);
}

export async function fetchIdentityFileContent(identityId: string, path: string): Promise<IdentityFileContentResponse> {
  return await apiGetIdentityFileContent(identityId, path);
}

export async function saveIdentityFileContent(identityId: string, path: string, content: string): Promise<IdentityFileContentResponse> {
  return await apiSaveIdentityFileContent(identityId, path, content);
}

export async function createIdentityFolder(identityId: string, path: string, name: string): Promise<{ message: string; path: string }> {
  return await apiCreateIdentityFolder(identityId, path, name);
}

export async function renameIdentityPath(identityId: string, path: string, newPath: string): Promise<{ message: string; path: string }> {
  return await apiRenameIdentityPath(identityId, path, newPath);
}

export async function deleteIdentityPath(identityId: string, path: string): Promise<{ message: string }> {
  return await apiDeleteIdentityPath(identityId, path);
}

export async function uploadIdentityFile(identityId: string, path: string, file: File): Promise<{ message: string; path: string; size: number }> {
  return await apiUploadIdentityFile(identityId, path, file);
}
