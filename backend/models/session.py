from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class SessionBase(BaseModel):
    id: str
    user_id: str
    token: str
    user_agent: Optional[str] = None
    ip_address: Optional[str] = None
    active: bool = True
    created_at: datetime
    last_active: datetime
    expires_at: Optional[datetime] = None


class Session(SessionBase):
    class Config:
        from_attributes = True


class SessionResponse(BaseModel):
    id: str
    user_agent: Optional[str]
    ip_address: Optional[str]
    active: bool
    created_at: datetime
    last_active: datetime
    expires_at: Optional[datetime] = None
