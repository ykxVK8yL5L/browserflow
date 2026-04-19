from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class ApiKeyCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    expires_in_days: Optional[int] = Field(None, ge=1, le=365)


class ApiKeyResponse(BaseModel):
    id: str
    name: str
    key_prefix: str
    created_at: datetime
    expires_at: Optional[datetime] = None
    last_used: Optional[datetime] = None
    revoked: bool


class ApiKey(ApiKeyResponse):
    user_id: str
    key_hash: str

    class Config:
        from_attributes = True


class ApiKeyWithRawKey(ApiKeyResponse):
    """创建时返回，包含完整的key"""

    key: str
