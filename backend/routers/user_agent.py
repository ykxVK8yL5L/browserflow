"""User-Agent 路由

处理 User-Agent 的 CRUD 操作。
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel, Field
from datetime import datetime

from models.database import get_db
from models.db_models import UserModel, UserAgentModel
from routers.auth import get_current_user

router = APIRouter(prefix="/api/user-agents", tags=["user-agents"])


# ============== Pydantic 模型 ==============


class UserAgentCreate(BaseModel):
    """创建 User-Agent"""

    value: str = Field(..., min_length=1, max_length=1024)
    is_default: bool = False


class UserAgentUpdate(BaseModel):
    """更新 User-Agent"""

    value: Optional[str] = Field(None, min_length=1, max_length=1024)
    is_default: Optional[bool] = None


class UserAgentResponse(BaseModel):
    """User-Agent 响应"""

    id: str
    value: str
    is_default: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ============== API 端点 ==============


@router.post("", response_model=UserAgentResponse)
async def create_user_agent(
    data: UserAgentCreate,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """创建 User-Agent"""
    if data.is_default:
        # 如果设置为默认，则取消其他所有 User-Agent 的默认状态
        db.query(UserAgentModel).filter(
            UserAgentModel.user_id == user.id, UserAgentModel.is_default == True
        ).update({"is_default": False})

    ua = UserAgentModel(
        user_id=user.id,
        value=data.value,
        is_default=data.is_default,
    )
    db.add(ua)
    db.commit()
    db.refresh(ua)
    return ua


@router.get("", response_model=List[UserAgentResponse])
async def list_user_agents(
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取用户的所有 User-Agent"""
    return db.query(UserAgentModel).filter(UserAgentModel.user_id == user.id).all()


@router.put("/{ua_id}", response_model=UserAgentResponse)
async def update_user_agent(
    ua_id: str,
    data: UserAgentUpdate,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """更新 User-Agent"""
    ua = (
        db.query(UserAgentModel)
        .filter(UserAgentModel.id == ua_id, UserAgentModel.user_id == user.id)
        .first()
    )

    if not ua:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User-Agent not found"
        )

    if data.value is not None:
        ua.value = data.value
    if data.is_default is not None:
        if data.is_default:
            # 取消其他默认状态
            db.query(UserAgentModel).filter(
                UserAgentModel.user_id == user.id, UserAgentModel.is_default == True
            ).update({"is_default": False})
        ua.is_default = data.is_default

    db.commit()
    db.refresh(ua)
    return ua


@router.delete("/{ua_id}")
async def delete_user_agent(
    ua_id: str,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """删除 User-Agent"""
    ua = (
        db.query(UserAgentModel)
        .filter(UserAgentModel.id == ua_id, UserAgentModel.user_id == user.id)
        .first()
    )

    if not ua:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User-Agent not found"
        )

    db.delete(ua)
    db.commit()
    return {"detail": "User-Agent deleted"}
