"""计划任务调度器。"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy.orm import Session

from core.executor import SCREENSHOTS_DIR
from core.queue import ExecutionQueueItem
from models.database import SessionLocal
from models.db_models import ExecutionModel, FlowModel, IdentityModel, ScheduleModel

scheduler = AsyncIOScheduler(timezone="UTC")


def _schedule_job_id(schedule_id: str) -> str:
    return f"schedule:{schedule_id}"


def _parse_cron_expression(expression: str) -> CronTrigger:
    parts = expression.strip().split()
    if len(parts) != 5:
        raise ValueError("Cron expression must have 5 fields")

    minute, hour, day, month, day_of_week = parts
    return CronTrigger(
        minute=minute,
        hour=hour,
        day=day,
        month=month,
        day_of_week=day_of_week,
        timezone="UTC",
    )


def _build_trigger(schedule: ScheduleModel):
    if schedule.trigger_type == "cron":
        if not schedule.cron_expression:
            raise ValueError("Cron expression is required")
        return _parse_cron_expression(schedule.cron_expression)

    if schedule.trigger_type == "interval":
        if not schedule.interval_seconds or schedule.interval_seconds <= 0:
            raise ValueError("Interval seconds must be greater than 0")
        return IntervalTrigger(seconds=schedule.interval_seconds, timezone="UTC")

    if schedule.trigger_type == "once":
        if not schedule.run_at:
            raise ValueError("run_at is required")
        return DateTrigger(run_date=schedule.run_at)

    raise ValueError(f"Unsupported trigger type: {schedule.trigger_type}")


async def _execute_schedule(schedule_id: str) -> None:
    db = SessionLocal()
    try:
        schedule = (
            db.query(ScheduleModel)
            .filter(ScheduleModel.id == schedule_id, ScheduleModel.enabled == True)
            .first()
        )
        if not schedule:
            return

        flow = (
            db.query(FlowModel)
            .filter(
                FlowModel.id == schedule.flow_id, FlowModel.user_id == schedule.user_id
            )
            .first()
        )
        if not flow:
            return

        identity_id = schedule.identity_id or flow.identity_id
        if identity_id:
            identity = (
                db.query(IdentityModel)
                .filter(
                    IdentityModel.id == identity_id,
                    IdentityModel.user_id == schedule.user_id,
                )
                .first()
            )
            if not identity:
                identity_id = None

        execution = ExecutionModel(
            user_id=schedule.user_id,
            flow_id=schedule.flow_id,
            identity_id=identity_id,
            status="pending",
            flow_snapshot={
                "nodes": flow.flow_data.get("nodes", []),
                "edges": flow.flow_data.get("edges", []),
            },
        )
        db.add(execution)
        db.commit()
        db.refresh(execution)

        run_settings = schedule.run_settings or flow.run_settings or {}

        item = ExecutionQueueItem(
            execution_id=execution.id,
            user_id=schedule.user_id,
            flow_id=schedule.flow_id,
            identity_id=identity_id,
            flow_data=flow.flow_data,
            client_id=f"schedule-{schedule.user_id}-{uuid.uuid4()}",
            headless=run_settings.get("headless"),
            viewport=run_settings.get("viewport"),
            locale=run_settings.get("locale"),
            timezone=run_settings.get("timezone"),
            proxy=run_settings.get("proxy"),
            humanize=run_settings.get("humanize"),
            user_agent_id=run_settings.get("userAgentId"),
        )

        from core.executor import run_execution

        execution.status = "running"
        execution.started_at = datetime.utcnow()
        db.commit()

        result = await run_execution(item)

        execution.status = result.get("status", "completed")
        execution.result = result
        execution.error_message = result.get("error")
        execution.finished_at = datetime.utcnow()

        schedule.last_run_at = execution.started_at
        schedule.last_execution_id = execution.id

        job = scheduler.get_job(_schedule_job_id(schedule.id))
        schedule.next_run_at = job.next_run_time if job else None

        if schedule.trigger_type == "once":
            schedule.enabled = False

        db.commit()
    except Exception as exc:
        db.rollback()
        schedule = (
            db.query(ScheduleModel).filter(ScheduleModel.id == schedule_id).first()
        )
        if schedule:
            schedule.last_run_at = datetime.utcnow()
            db.commit()
        print(f"Schedule execution failed for {schedule_id}: {exc}")
    finally:
        db.close()


def sync_schedule_job(schedule: ScheduleModel, db: Optional[Session] = None) -> None:
    job_id = _schedule_job_id(schedule.id)
    scheduler.remove_job(job_id=job_id) if scheduler.get_job(job_id) else None

    if not schedule.enabled:
        if db is not None:
            schedule.next_run_at = None
        return

    trigger = _build_trigger(schedule)
    job = scheduler.add_job(
        _execute_schedule,
        trigger=trigger,
        id=job_id,
        args=[schedule.id],
        replace_existing=True,
        misfire_grace_time=60,
        coalesce=True,
    )
    if db is not None:
        schedule.next_run_at = job.next_run_time


def remove_schedule_job(schedule_id: str) -> None:
    job_id = _schedule_job_id(schedule_id)
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)


def load_active_schedules() -> None:
    db = SessionLocal()
    try:
        schedules = db.query(ScheduleModel).filter(ScheduleModel.enabled == True).all()
        for schedule in schedules:
            try:
                sync_schedule_job(schedule, db)
            except Exception as exc:
                print(f"Failed to load schedule {schedule.id}: {exc}")
        db.commit()
    finally:
        db.close()


def start_scheduler() -> None:
    if not scheduler.running:
        scheduler.start()
    load_active_schedules()


def shutdown_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)


def refresh_schedule_next_run(schedule_id: str) -> None:
    db = SessionLocal()
    try:
        schedule = (
            db.query(ScheduleModel).filter(ScheduleModel.id == schedule_id).first()
        )
        if not schedule:
            return
        job = scheduler.get_job(_schedule_job_id(schedule.id))
        schedule.next_run_at = job.next_run_time if job else None
        db.commit()
    finally:
        db.close()


async def run_schedule_now(schedule_id: str) -> None:
    await _execute_schedule(schedule_id)


__all__ = [
    "scheduler",
    "start_scheduler",
    "shutdown_scheduler",
    "sync_schedule_job",
    "remove_schedule_job",
    "refresh_schedule_next_run",
    "run_schedule_now",
]
