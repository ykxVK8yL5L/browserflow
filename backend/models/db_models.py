"""
SQLAlchemy 数据库模型
"""

from sqlalchemy import (
    Column,
    String,
    Boolean,
    DateTime,
    Text,
    Integer,
    ForeignKey,
    JSON,
)
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid

from .database import Base


def generate_uuid():
    return str(uuid.uuid4())


class UserModel(Base):
    """用户表"""

    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    username = Column(String(32), unique=True, nullable=False, index=True)
    password_hash = Column(String(128), nullable=False)
    role = Column(String(16), nullable=False, default="user", index=True)

    # 邮箱
    email = Column(String(128), unique=True, nullable=True, index=True)
    email_verified = Column(Boolean, default=False)
    email_verify_code = Column(String(6), nullable=True)
    email_verify_expires = Column(DateTime, nullable=True)

    # OTP
    otp_enabled = Column(Boolean, default=False)
    otp_secret = Column(String(32), nullable=True)
    # WebAuthn 临时 challenge 存储（与 OTP secret 分开，避免冲突）
    webauthn_challenge = Column(Text, nullable=True)

    # Passkey
    passkey_enabled = Column(Boolean, default=False)
    passkey_id = Column(String(64), nullable=True, unique=True)
    passkey_credential = Column(Text, nullable=True)  # JSON 格式的 WebAuthn credential

    # 恢复码 (JSON 数组)
    recovery_codes = Column(Text, default="[]")  # JSON array of strings
    recovery_codes_used = Column(Text, default="[]")  # JSON array of strings

    # 历史密码 (JSON 数组，存储最近 N 个密码的 hash)
    password_history = Column(Text, default="[]")  # JSON array of password hashes

    # OTP 设置状态（用于首次登录强制设置）
    otp_setup_completed = Column(Boolean, default=False)  # 是否已完成 OTP 设置
    otp_setup_deadline = Column(DateTime, nullable=True)  # OTP 重新绑定截止时间
    recovery_codes_downloaded = Column(Boolean, default=False)  # 是否已下载恢复码

    # 时间戳
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # 关系
    sessions = relationship(
        "SessionModel", back_populates="user", cascade="all, delete-orphan"
    )
    api_keys = relationship(
        "ApiKeyModel", back_populates="user", cascade="all, delete-orphan"
    )
    flows = relationship(
        "FlowModel", back_populates="user", cascade="all, delete-orphan"
    )
    credentials = relationship(
        "CredentialModel", back_populates="user", cascade="all, delete-orphan"
    )
    identities = relationship(
        "IdentityModel", back_populates="user", cascade="all, delete-orphan"
    )
    user_agents = relationship(
        "UserAgentModel", back_populates="user", cascade="all, delete-orphan"
    )
    executions = relationship(
        "ExecutionModel", back_populates="user", cascade="all, delete-orphan"
    )


class SessionModel(Base):
    """会话表"""

    __tablename__ = "sessions"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    token = Column(String(128), unique=True, nullable=False, index=True)

    user_agent = Column(String(256), nullable=True)
    ip_address = Column(String(45), nullable=True)  # IPv6 最长45字符

    active = Column(Boolean, default=True, index=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    last_active = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=True)

    # 关系
    user = relationship("UserModel", back_populates="sessions")


class ApiKeyModel(Base):
    """API Key 表"""

    __tablename__ = "api_keys"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)

    name = Column(String(64), nullable=False)
    key_prefix = Column(String(20), nullable=False)  # 用于显示，如 "bfk_a1b2..."
    key_hash = Column(String(128), nullable=False, unique=True, index=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=True)
    last_used = Column(DateTime, nullable=True)
    revoked = Column(Boolean, default=False, index=True)

    # 关系
    user = relationship("UserModel", back_populates="api_keys")


class AuthSettingsModel(Base):
    """认证设置表（单例）"""

    __tablename__ = "auth_settings"
    id = Column(Integer, primary_key=True, autoincrement=True)
    registration_enabled = Column(Boolean, default=True)
    passkey_login_enabled = Column(Boolean, default=False)
    otp_required = Column(Boolean, default=True)


class FlowModel(Base):
    """流程定义表"""

    __tablename__ = "flows"
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(128), nullable=False)
    description = Column(Text, nullable=True)
    # Flow JSON 定义（nodes, edges）
    flow_data = Column(JSON, nullable=False)
    # Flow 级运行设置
    run_settings = Column(JSON, nullable=True)
    # Flow 通知接收配置
    notification_rules = Column(JSON, nullable=True)
    # Flow 通知总开关
    notification_enabled = Column(Boolean, default=True)
    # 元数据
    tags = Column(Text, default="[]")  # JSON array of strings
    is_template = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    identity_id = Column(
        String(36), ForeignKey("identities.id"), nullable=True, index=True
    )
    # 时间戳
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    # 关系
    user = relationship("UserModel", back_populates="flows")
    executions = relationship(
        "ExecutionModel", back_populates="flow", cascade="all, delete-orphan"
    )
    schedules = relationship(
        "ScheduleModel", back_populates="flow", cascade="all, delete-orphan"
    )


class CredentialModel(Base):
    """账号凭证表"""

    __tablename__ = "credentials"
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(128), nullable=False)
    site = Column(String(256), nullable=False)  # 网站标识，如 "taobao", "jd"
    # 凭证数据（加密存储）
    credential_data = Column(Text, nullable=False)  # 加密的 JSON 数据
    # 元数据
    description = Column(Text, nullable=True)
    is_visible = Column(Boolean, default=True)
    last_used = Column(DateTime, nullable=True)
    is_valid = Column(Boolean, default=True)
    # 时间戳
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    # 关系
    user = relationship("UserModel", back_populates="credentials")
    identities = relationship(
        "IdentityModel", back_populates="credential", cascade="all, delete-orphan"
    )


class IdentityModel(Base):
    """浏览器身份/环境表"""

    __tablename__ = "identities"
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    # 关联凭证（可选，因为有些 Identity 可能是手动创建的 Profile）
    credential_id = Column(
        String(36), ForeignKey("credentials.id"), nullable=True, index=True
    )
    name = Column(String(128), nullable=False)
    # 类型: none, file, profile
    type = Column(String(20), nullable=False, default="none")
    # 存储路径 (对于 profile 是目录，对于 file 是 state.json 的路径)
    storage_path = Column(String(512), nullable=True)
    # 状态
    status = Column(String(32), default="active")  # active, expired, invalid
    last_used = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=True)
    # 时间戳
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # 关系
    user = relationship("UserModel", back_populates="identities")
    credential = relationship("CredentialModel", back_populates="identities")
    executions = relationship("ExecutionModel", back_populates="identity")


class UserAgentModel(Base):
    """User-Agent 管理表"""

    __tablename__ = "user_agents"
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    value = Column(Text, nullable=False)
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("UserModel", back_populates="user_agents")


class ExecutionModel(Base):
    """执行记录表"""

    __tablename__ = "executions"
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    flow_id = Column(String(36), ForeignKey("flows.id"), nullable=False, index=True)
    identity_id = Column(
        String(36), ForeignKey("identities.id"), nullable=True, index=True
    )
    # 执行状态
    status = Column(
        String(32), default="pending"
    )  # pending, running, completed, failed, cancelled
    # 执行结果
    result = Column(JSON, nullable=True)  # 执行结果数据
    flow_snapshot = Column(JSON, nullable=True)  # 执行时的流程快照
    error_message = Column(Text, nullable=True)
    # 时间戳
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # 关系
    user = relationship("UserModel", back_populates="executions")
    flow = relationship("FlowModel", back_populates="executions")
    identity = relationship("IdentityModel", back_populates="executions")
    node_executions = relationship(
        "NodeExecutionModel", back_populates="execution", cascade="all, delete-orphan"
    )


class ScheduleModel(Base):
    """计划任务表"""

    __tablename__ = "schedules"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    flow_id = Column(String(36), ForeignKey("flows.id"), nullable=False, index=True)
    identity_id = Column(
        String(36), ForeignKey("identities.id"), nullable=True, index=True
    )

    name = Column(String(128), nullable=False)
    enabled = Column(Boolean, default=False, index=True)
    trigger_type = Column(String(20), nullable=False, default="cron")
    cron_expression = Column(String(64), nullable=True)
    interval_seconds = Column(Integer, nullable=True)
    run_at = Column(DateTime, nullable=True)
    run_settings = Column(JSON, nullable=True)

    last_run_at = Column(DateTime, nullable=True)
    next_run_at = Column(DateTime, nullable=True)
    last_execution_id = Column(String(36), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("UserModel")
    flow = relationship("FlowModel", back_populates="schedules")
    identity = relationship("IdentityModel")


class NotificationChannelConfigModel(Base):
    """通知通道系统配置表"""

    __tablename__ = "notification_channel_configs"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    channel_type = Column(String(32), nullable=False, unique=True, index=True)
    display_name = Column(String(64), nullable=False)
    enabled = Column(Boolean, default=False, index=True)
    config = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class NotificationSettingsModel(Base):
    """通知系统全局设置（单例）"""

    __tablename__ = "notification_settings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    recipients = Column(JSON, nullable=True)
    system_rules = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class TemplateSettingsModel(Base):
    """模板功能全局设置（单例）"""

    __tablename__ = "template_settings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    feature_enabled = Column(Boolean, default=True)
    index_url = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class NodeExecutionModel(Base):
    """节点执行记录表"""

    __tablename__ = "node_executions"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    execution_id = Column(
        String(36), ForeignKey("executions.id"), nullable=False, index=True
    )
    # 节点信息
    node_label = Column(String(150), nullable=False, index=True)
    node_id = Column(String(36), nullable=False, index=True)
    node_type = Column(String(64), nullable=False)
    # 执行状态
    status = Column(
        String(32), default="pending"
    )  # pending, running, success, failed, skipped
    message = Column(Text, nullable=True)
    error = Column(Text, nullable=True)
    result_data = Column(JSON, nullable=True)  # 节点执行结果数据
    # 时间戳
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    duration_ms = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # 关系
    execution = relationship("ExecutionModel", back_populates="node_executions")
