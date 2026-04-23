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
        table_names = {
            row[0]
            for row in conn.execute(
                text("SELECT name FROM sqlite_master WHERE type='table'")
            )
        }

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

        notification_settings_columns = (
            {
                row[1]
                for row in conn.execute(
                    text("PRAGMA table_info(notification_settings)")
                )
            }
            if "notification_settings" in table_names
            else set()
        )
        if notification_settings_columns:
            if "user_id" not in notification_settings_columns:
                conn.execute(
                    text(
                        "ALTER TABLE notification_settings ADD COLUMN user_id VARCHAR(36)"
                    )
                )
                notification_settings_columns.add("user_id")
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

        legacy_notification_rows = []
        if notification_settings_columns:
            legacy_notification_rows = (
                conn.execute(
                    text(
                        "SELECT id, user_id, recipients, system_rules, created_at, updated_at FROM notification_settings"
                    )
                )
                .mappings()
                .all()
            )

        platform_settings_columns = (
            {
                row[1]
                for row in conn.execute(text("PRAGMA table_info(platform_settings)"))
            }
            if "platform_settings" in table_names
            else set()
        )

        if (
            "platform_settings" in table_names
            and platform_settings_columns
            and "key" not in platform_settings_columns
        ):
            legacy_platform_rows = (
                conn.execute(
                    text("SELECT * FROM platform_settings ORDER BY id ASC LIMIT 1")
                )
                .mappings()
                .all()
            )
            conn.execute(
                text("ALTER TABLE platform_settings RENAME TO platform_settings_legacy")
            )
            conn.execute(
                text(
                    "CREATE TABLE platform_settings (id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, key VARCHAR(128) NOT NULL, value TEXT, value_type VARCHAR(32) NOT NULL DEFAULT 'string', description TEXT, created_at DATETIME, updated_at DATETIME)"
                )
            )
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS ix_platform_settings_key ON platform_settings (key)"
                )
            )

            if legacy_platform_rows:
                legacy = legacy_platform_rows[0]
                migrated_items = [
                    (
                        "auth.registration_enabled",
                        legacy.get("registration_enabled"),
                        "bool",
                        "是否允许新用户注册",
                    ),
                    (
                        "auth.passkey_login_enabled",
                        legacy.get("passkey_login_enabled"),
                        "bool",
                        "是否启用 Passkey 登录入口",
                    ),
                    (
                        "auth.otp_required",
                        legacy.get("otp_required"),
                        "bool",
                        "启用 OTP 的用户登录时是否必须进行 OTP 验证",
                    ),
                    (
                        "templates.feature_enabled",
                        legacy.get("template_feature_enabled"),
                        "bool",
                        "模板平台功能总开关",
                    ),
                    (
                        "templates.index_url",
                        legacy.get("template_index_url"),
                        "string",
                        "模板索引地址",
                    ),
                ]
                for key, value, value_type, description in migrated_items:
                    if value is None and value_type == "string":
                        serialized = None
                    elif value_type == "bool":
                        serialized = "true" if bool(value) else "false"
                    else:
                        serialized = str(value) if value is not None else None
                    conn.execute(
                        text(
                            "INSERT INTO platform_settings (key, value, value_type, description, created_at, updated_at) VALUES (:key, :value, :value_type, :description, :created_at, :updated_at)"
                        ),
                        {
                            "key": key,
                            "value": serialized,
                            "value_type": value_type,
                            "description": description,
                            "created_at": legacy.get("created_at"),
                            "updated_at": legacy.get("updated_at"),
                        },
                    )

            table_names = {
                row[0]
                for row in conn.execute(
                    text("SELECT name FROM sqlite_master WHERE type='table'")
                )
            }
            platform_settings_columns = {
                row[1]
                for row in conn.execute(text("PRAGMA table_info(platform_settings)"))
            }

        if platform_settings_columns:
            if "value_type" not in platform_settings_columns:
                conn.execute(
                    text(
                        "ALTER TABLE platform_settings ADD COLUMN value_type VARCHAR(32) DEFAULT 'string'"
                    )
                )
            if "description" not in platform_settings_columns:
                conn.execute(
                    text("ALTER TABLE platform_settings ADD COLUMN description TEXT")
                )

        if "auth_settings" in table_names or "template_settings" in table_names:
            auth_row = (
                conn.execute(
                    text(
                        "SELECT registration_enabled, passkey_login_enabled, otp_required FROM auth_settings ORDER BY id ASC LIMIT 1"
                    )
                )
                .mappings()
                .first()
                if "auth_settings" in table_names
                else None
            )
            template_row = (
                conn.execute(
                    text(
                        "SELECT feature_enabled, index_url FROM template_settings ORDER BY id ASC LIMIT 1"
                    )
                )
                .mappings()
                .first()
                if "template_settings" in table_names
                else None
            )
            existing_platform = conn.execute(
                text("SELECT COUNT(*) FROM platform_settings")
            ).scalar()
            if not existing_platform:
                migrated_items = [
                    (
                        "auth.registration_enabled",
                        (
                            "true"
                            if (auth_row["registration_enabled"] if auth_row else True)
                            else "false"
                        ),
                        "bool",
                        "是否允许新用户注册",
                    ),
                    (
                        "auth.passkey_login_enabled",
                        (
                            "true"
                            if (
                                auth_row["passkey_login_enabled"] if auth_row else False
                            )
                            else "false"
                        ),
                        "bool",
                        "是否启用 Passkey 登录入口",
                    ),
                    (
                        "auth.otp_required",
                        (
                            "true"
                            if (auth_row["otp_required"] if auth_row else True)
                            else "false"
                        ),
                        "bool",
                        "启用 OTP 的用户登录时是否必须进行 OTP 验证",
                    ),
                    (
                        "templates.feature_enabled",
                        (
                            "true"
                            if (
                                template_row["feature_enabled"]
                                if template_row
                                else True
                            )
                            else "false"
                        ),
                        "bool",
                        "模板平台功能总开关",
                    ),
                    (
                        "templates.index_url",
                        template_row["index_url"] if template_row else None,
                        "string",
                        "模板索引地址",
                    ),
                ]
                for key, value, value_type, description in migrated_items:
                    conn.execute(
                        text(
                            "INSERT INTO platform_settings (key, value, value_type, description) VALUES (:key, :value, :value_type, :description)"
                        ),
                        {
                            "key": key,
                            "value": value,
                            "value_type": value_type,
                            "description": description,
                        },
                    )

        existing_notification_by_user = (
            {
                row[0]
                for row in conn.execute(
                    text(
                        "SELECT user_id FROM notification_settings WHERE user_id IS NOT NULL"
                    )
                )
            }
            if notification_settings_columns
            else set()
        )
        if notification_settings_columns:
            for row in legacy_notification_rows:
                if row["user_id"]:
                    continue
                user_ids = [
                    item[0]
                    for item in conn.execute(
                        text("SELECT id FROM users ORDER BY created_at ASC")
                    )
                ]
                for user_id in user_ids:
                    if user_id in existing_notification_by_user:
                        continue
                    conn.execute(
                        text(
                            "INSERT INTO notification_settings (user_id, recipients, system_rules, created_at, updated_at) VALUES (:user_id, :recipients, :system_rules, :created_at, :updated_at)"
                        ),
                        {
                            "user_id": user_id,
                            "recipients": row["recipients"] or "[]",
                            "system_rules": row["system_rules"] or "[]",
                            "created_at": row["created_at"],
                            "updated_at": row["updated_at"],
                        },
                    )
                    existing_notification_by_user.add(user_id)

            for user_id in [
                item[0]
                for item in conn.execute(
                    text("SELECT id FROM users ORDER BY created_at ASC")
                )
            ]:
                if user_id in existing_notification_by_user:
                    continue
                conn.execute(
                    text(
                        "INSERT INTO notification_settings (user_id, recipients, system_rules) VALUES (:user_id, :recipients, :system_rules)"
                    ),
                    {
                        "user_id": user_id,
                        "recipients": "[]",
                        "system_rules": "[]",
                    },
                )
                existing_notification_by_user.add(user_id)

            conn.execute(
                text("DELETE FROM notification_settings WHERE user_id IS NULL")
            )

        credential_columns = {
            row[1] for row in conn.execute(text("PRAGMA table_info(credentials)"))
        }
        if credential_columns and "is_visible" not in credential_columns:
            conn.execute(
                text("ALTER TABLE credentials ADD COLUMN is_visible BOOLEAN DEFAULT 1")
            )
