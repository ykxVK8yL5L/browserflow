"""计划任务路由。"""

from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from core.scheduler import remove_schedule_job, run_schedule_now, sync_schedule_job
from models.database import get_db
from models.db_models import FlowModel, IdentityModel, ScheduleModel, UserModel
from routers.auth import get_current_user

router = APIRouter(prefix="/api/schedules", tags=["schedules"])


class ScheduleBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    flow_id: str
    identity_id: Optional[str] = None
    enabled: bool = False
    trigger_type: str = Field(..., pattern="^(cron|interval|once)$")
    cron_expression: Optional[str] = None
    interval_seconds: Optional[int] = Field(default=None, ge=1)
    run_at: Optional[datetime] = None
    run_settings: Optional[dict] = None

    @model_validator(mode="after")
    def validate_trigger(self):
        if self.trigger_type == "cron" and not self.cron_expression:
            raise ValueError("cron_expression is required for cron schedules")
        if self.trigger_type == "interval" and not self.interval_seconds:
            raise ValueError("interval_seconds is required for interval schedules")
        if self.trigger_type == "once" and not self.run_at:
            raise ValueError("run_at is required for once schedules")
        return self


class ScheduleCreate(ScheduleBase):
    pass


class ScheduleUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=128)
    identity_id: Optional[str] = None
    enabled: Optional[bool] = None
    trigger_type: Optional[str] = Field(default=None, pattern="^(cron|interval|once)$")
    cron_expression: Optional[str] = None
    interval_seconds: Optional[int] = Field(default=None, ge=1)
    run_at: Optional[datetime] = None
    run_settings: Optional[dict] = None


class ScheduleResponse(BaseModel):
    id: str
    user_id: str
    flow_id: str
    identity_id: Optional[str]
    name: str
    enabled: bool
    trigger_type: str
    cron_expression: Optional[str]
    interval_seconds: Optional[int]
    run_at: Optional[datetime]
    run_settings: Optional[dict]
    last_run_at: Optional[datetime]
    next_run_at: Optional[datetime]
    last_execution_id: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ScheduleToggleRequest(BaseModel):
    enabled: bool


def _to_response(schedule: ScheduleModel) -> ScheduleResponse:
    return ScheduleResponse.model_validate(schedule)


def _ensure_flow(flow_id: str, user_id: str, db: Session) -> FlowModel:
    flow = (
        db.query(FlowModel)
        .filter(FlowModel.id == flow_id, FlowModel.user_id == user_id)
        .first()
    )
    if not flow:
        raise HTTPException(status_code=404, detail="Flow not found")
    return flow


def _ensure_identity(identity_id: Optional[str], user_id: str, db: Session) -> None:
    if not identity_id:
        return
    identity = (
        db.query(IdentityModel)
        .filter(IdentityModel.id == identity_id, IdentityModel.user_id == user_id)
        .first()
    )
    if not identity:
        raise HTTPException(status_code=404, detail="Identity not found")


@router.get("", response_model=List[ScheduleResponse])
async def list_schedules(
    flow_id: Optional[str] = None,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(ScheduleModel).filter(ScheduleModel.user_id == user.id)
    if flow_id:
        query = query.filter(ScheduleModel.flow_id == flow_id)
    schedules = query.order_by(ScheduleModel.created_at.desc()).all()
    return [_to_response(s) for s in schedules]


@router.post("", response_model=ScheduleResponse)
async def create_schedule(
    data: ScheduleCreate,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_flow(data.flow_id, user.id, db)
    _ensure_identity(data.identity_id, user.id, db)

    schedule = ScheduleModel(
        user_id=user.id,
        flow_id=data.flow_id,
        identity_id=data.identity_id,
        name=data.name,
        enabled=data.enabled,
        trigger_type=data.trigger_type,
        cron_expression=data.cron_expression,
        interval_seconds=data.interval_seconds,
        run_at=data.run_at,
        run_settings=data.run_settings,
    )
    db.add(schedule)
    db.flush()

    sync_schedule_job(schedule, db)
    db.commit()
    db.refresh(schedule)
    return _to_response(schedule)


@router.put("/{schedule_id}", response_model=ScheduleResponse)
async def update_schedule(
    schedule_id: str,
    data: ScheduleUpdate,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    schedule = (
        db.query(ScheduleModel)
        .filter(ScheduleModel.id == schedule_id, ScheduleModel.user_id == user.id)
        .first()
    )
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")

    updates = data.model_dump(exclude_unset=True)
    if "identity_id" in updates:
        _ensure_identity(updates.get("identity_id"), user.id, db)

    for key, value in updates.items():
        setattr(schedule, key, value)

    sync_schedule_job(schedule, db)
    db.commit()
    db.refresh(schedule)
    return _to_response(schedule)


@router.post("/{schedule_id}/toggle", response_model=ScheduleResponse)
async def toggle_schedule(
    schedule_id: str,
    data: ScheduleToggleRequest,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    schedule = (
        db.query(ScheduleModel)
        .filter(ScheduleModel.id == schedule_id, ScheduleModel.user_id == user.id)
        .first()
    )
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")

    schedule.enabled = data.enabled
    sync_schedule_job(schedule, db)
    db.commit()
    db.refresh(schedule)
    return _to_response(schedule)


@router.post("/{schedule_id}/run-now", response_model=ScheduleResponse)
async def run_now(
    schedule_id: str,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    schedule = (
        db.query(ScheduleModel)
        .filter(ScheduleModel.id == schedule_id, ScheduleModel.user_id == user.id)
        .first()
    )
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")

    await run_schedule_now(schedule.id)
    db.refresh(schedule)
    return _to_response(schedule)


@router.delete("/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_schedule(
    schedule_id: str,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    schedule = (
        db.query(ScheduleModel)
        .filter(ScheduleModel.id == schedule_id, ScheduleModel.user_id == user.id)
        .first()
    )
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")

    remove_schedule_job(schedule.id)
    db.delete(schedule)
    db.commit()
    return None
