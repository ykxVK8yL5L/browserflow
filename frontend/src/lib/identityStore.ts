import { 
  getIdentities as apiGetIdentities, 
  createIdentity as apiCreateIdentity, 
  updateIdentity as apiUpdateIdentity, 
  deleteIdentity as apiDeleteIdentity,
  uploadIdentityState as apiUploadIdentityState,
  type Identity as ApiIdentity 
} from "./identityApi";

export interface Identity extends ApiIdentity {
  // Add any frontend-specific extensions here
}

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
