"""
数据库配置和连接
使用 SQLite 作为开发数据库，生产环境可切换为 PostgreSQL
"""

import os
from sqlalchemy import create_engine, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# 数据库路径
DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "browserflow.db")
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

SQLALCHEMY_DATABASE_URL = f"sqlite:///{DB_PATH}"
DATABASE_URL = SQLALCHEMY_DATABASE_URL  # 导出供其他模块使用

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}  # SQLite 需要
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """依赖注入：获取数据库会话"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """初始化数据库，创建所有表"""
    from . import db_models  # noqa: F401

    Base.metadata.create_all(bind=engine)

    with engine.begin() as conn:
        user_columns = {
            row[1] for row in conn.execute(text("PRAGMA table_info(users)"))
        }
        if "role" not in user_columns:
            conn.execute(
                text("ALTER TABLE users ADD COLUMN role VARCHAR(16) DEFAULT 'user'")
            )
            conn.execute(
                text(
                    "UPDATE users SET role = 'admin' WHERE id IN (SELECT id FROM users ORDER BY created_at ASC LIMIT 1)"
                )
            )

        if "otp_setup_deadline" not in user_columns:
            conn.execute(
                text("ALTER TABLE users ADD COLUMN otp_setup_deadline DATETIME")
            )

        # 检查 executions 表是否有 flow_snapshot 列
        exec_columns = {
            row[1] for row in conn.execute(text("PRAGMA table_info(executions)"))
        }
        if "flow_snapshot" not in exec_columns:
            conn.execute(text("ALTER TABLE executions ADD COLUMN flow_snapshot JSON"))

        # 检查 flows 表是否有 identity_id 列
        flow_columns = {
            row[1] for row in conn.execute(text("PRAGMA table_info(flows)"))
        }
        if "identity_id" not in flow_columns:
            conn.execute(text("ALTER TABLE flows ADD COLUMN identity_id VARCHAR(36)"))
        if "run_settings" not in flow_columns:
            conn.execute(text("ALTER TABLE flows ADD COLUMN run_settings JSON"))
        if "notification_rules" not in flow_columns:
            conn.execute(text("ALTER TABLE flows ADD COLUMN notification_rules JSON"))
        if "notification_enabled" not in flow_columns:
            conn.execute(
                text(
                    "ALTER TABLE flows ADD COLUMN notification_enabled BOOLEAN DEFAULT 1"
                )
            )

        schedule_columns = {
            row[1] for row in conn.execute(text("PRAGMA table_info(schedules)"))
        }
        if schedule_columns:
            if "identity_id" not in schedule_columns:
                conn.execute(
                    text("ALTER TABLE schedules ADD COLUMN identity_id VARCHAR(36)")
                )
            if "run_settings" not in schedule_columns:
                conn.execute(text("ALTER TABLE schedules ADD COLUMN run_settings JSON"))
            if "last_run_at" not in schedule_columns:
                conn.execute(
                    text("ALTER TABLE schedules ADD COLUMN last_run_at DATETIME")
                )
            if "next_run_at" not in schedule_columns:
                conn.execute(
                    text("ALTER TABLE schedules ADD COLUMN next_run_at DATETIME")
                )
            if "last_execution_id" not in schedule_columns:
                conn.execute(
                    text(
                        "ALTER TABLE schedules ADD COLUMN last_execution_id VARCHAR(36)"
                    )
                )

        channel_columns = {
            row[1]
            for row in conn.execute(
                text("PRAGMA table_info(notification_channel_configs)")
            )
        }
        if channel_columns:
            if "display_name" not in channel_columns:
                conn.execute(
                    text(
                        "ALTER TABLE notification_channel_configs ADD COLUMN display_name VARCHAR(64)"
                    )
                )
            if "enabled" not in channel_columns:
                conn.execute(
                    text(
                        "ALTER TABLE notification_channel_configs ADD COLUMN enabled BOOLEAN DEFAULT 1"
                    )
                )
            if "config" not in channel_columns:
                conn.execute(
                    text(
                        "ALTER TABLE notification_channel_configs ADD COLUMN config JSON"
                    )
                )

        existing_channels = (
            {
                row[0]
                for row in conn.execute(
                    text("SELECT channel_type FROM notification_channel_configs")
                )
            }
            if channel_columns
            else set()
        )
        defaults = [
            ("email", "邮件通知"),
            ("webhook", "Webhook 通知"),
        ]
        for channel_type, display_name in defaults:
            if channel_type not in existing_channels:
                conn.execute(
                    text(
                        "INSERT INTO notification_channel_configs (id, channel_type, display_name, enabled, config) VALUES (:id, :channel_type, :display_name, :enabled, :config)"
                    ),
                    {
                        "id": os.urandom(16).hex(),
                        "channel_type": channel_type,
                        "display_name": display_name,
                        "enabled": True,
                        "config": "{}",
                    },
                )

        notification_settings_columns = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info(notification_settings)"))
        }
        if notification_settings_columns:
            if "recipients" not in notification_settings_columns:
                conn.execute(
                    text("ALTER TABLE notification_settings ADD COLUMN recipients JSON")
                )
            if "system_rules" not in notification_settings_columns:
                conn.execute(
                    text(
                        "ALTER TABLE notification_settings ADD COLUMN system_rules JSON"
                    )
                )

        existing_notification_settings = conn.execute(
            text("SELECT COUNT(*) FROM notification_settings")
        ).scalar()
        if not existing_notification_settings:
            conn.execute(
                text(
                    "INSERT INTO notification_settings (recipients, system_rules) VALUES (:recipients, :system_rules)"
                ),
                {
                    "recipients": "[]",
                    "system_rules": "[]",
                },
            )
