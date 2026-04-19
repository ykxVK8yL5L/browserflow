"""
认证路由
处理登录、注册、OTP、恢复码等
"""

from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from typing import Optional, List
from datetime import datetime, timedelta
from pydantic import BaseModel
import json
import io
import base64
import qrcode

from models.database import get_db
from models.db_models import UserModel, SessionModel, ApiKeyModel, AuthSettingsModel
from models.user import (
    UserCreate,
    UserLogin,
    UserResponse,
    OtpSetupResponse,
    OtpVerifyRequest,
    OtpConfirmRequest,
    RecoveryCodeVerifyRequest,
    PasswordChangeRequest,
    AuthSettingsResponse,
    PasswordRecoveryStartRequest,
    PasswordRecoveryMethodsResponse,
    PasswordRecoveryVerifyRequest,
    PasswordRecoveryResetRequest,
    PasswordRecoveryOtpResetRequest,
    PasswordRecoveryOtpConfirmRequest,
)
from models.session import SessionResponse
from models.api_key import ApiKeyCreate, ApiKeyWithRawKey, ApiKeyResponse
from utils.auth_utils import (
    hash_password,
    verify_password,
    generate_token,
    generate_jwt,
    generate_otp_secret,
    get_otp_uri,
    verify_otp,
    generate_recovery_codes,
    generate_api_key,
    hash_api_key,
    verify_jwt,
    decode_jwt,
    create_otp_setup_deadline,
    is_otp_setup_deadline_expired,
    OTP_SETUP_GRACE_HOURS,
)
from utils.email_utils import (
    generate_verification_code,
    send_verification_code_email,
    is_smtp_configured,
)
from core.notifications import dispatch_system_notification

router = APIRouter(prefix="/api/auth", tags=["auth"])
security = HTTPBearer(auto_error=False)

# 临时保存已发起但尚未完成确认的 OTP 重置请求，恢复码仅在确认成功后消费
pending_otp_reset_codes: dict[str, dict[str, datetime | str]] = {}


def ensure_admin(user: UserModel) -> UserModel:
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )
    return user


async def emit_login_notification(user: UserModel, request: Request) -> None:
    user_agent, ip_address = get_client_info(request)
    payload = {
        "subject": f"[用户登录] {user.username}",
        "text": "\n".join(
            [
                f"用户: {user.username}",
                f"邮箱: {user.email or '—'}",
                f"IP: {ip_address or '—'}",
                f"User-Agent: {user_agent or '—'}",
                f"时间: {datetime.utcnow().isoformat()}",
            ]
        ),
        "data": {
            "event": "user_login",
            "timestamp": datetime.utcnow().isoformat(),
            "user": {
                "id": user.id,
                "username": user.username,
                "email": user.email,
            },
            "client": {
                "ip_address": ip_address,
                "user_agent": user_agent,
            },
        },
    }
    await dispatch_system_notification("user_login", payload)


def generate_qr_base64(uri: str) -> str:
    """生成 QR 码的 Base64 编码图片"""
    qr = qrcode.QRCode(version=1, box_size=10, border=2)
    qr.add_data(uri)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()


# Session 默认过期天数
DEFAULT_SESSION_EXPIRE_DAYS = 7


def create_session_expiry() -> datetime:
    """创建 session 过期时间"""
    return datetime.utcnow() + timedelta(days=DEFAULT_SESSION_EXPIRE_DAYS)


# ============== 依赖注入 ==============


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db),
) -> UserModel:
    """从 JWT 获取当前用户"""
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )

    token = credentials.credentials
    valid, payload = verify_jwt(token)

    if not valid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token"
        )

    user_id = payload.get("sub")
    session_id = payload.get("sid")

    # 验证 session 是否有效
    session = (
        db.query(SessionModel)
        .filter(
            SessionModel.id == session_id,
            SessionModel.user_id == user_id,
            SessionModel.active == True,
        )
        .first()
    )

    if not session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired or revoked",
        )

    user = db.query(UserModel).filter(UserModel.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found"
        )

    # 更新 session 最后活跃时间
    session.last_active = datetime.utcnow()
    db.commit()

    return user


def get_client_info(request: Request) -> tuple:
    """获取客户端信息"""
    user_agent = request.headers.get("user-agent", "")[:256]
    ip_address = request.client.host if request.client else "127.0.0.1"
    return user_agent, ip_address


def get_or_create_auth_settings(db: Session) -> AuthSettingsModel:
    """获取或创建认证设置"""
    settings = db.query(AuthSettingsModel).first()
    if not settings:
        settings = AuthSettingsModel()
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


# ============== 认证设置 ==============


@router.get("/settings", response_model=AuthSettingsResponse)
async def get_auth_settings(db: Session = Depends(get_db)):
    """获取认证设置"""
    settings = get_or_create_auth_settings(db)
    return AuthSettingsResponse(
        registration_enabled=settings.registration_enabled,
        passkey_login_enabled=settings.passkey_login_enabled,
        otp_required=settings.otp_required,
    )


class UpdateSettingsRequest(BaseModel):
    registration_enabled: bool | None = None
    passkey_login_enabled: bool | None = None
    otp_required: bool | None = None


@router.post("/settings", response_model=AuthSettingsResponse)
async def update_auth_settings(
    data: UpdateSettingsRequest,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """更新认证设置"""
    ensure_admin(user)
    settings = get_or_create_auth_settings(db)
    if data.registration_enabled is not None:
        settings.registration_enabled = data.registration_enabled
    if data.passkey_login_enabled is not None:
        settings.passkey_login_enabled = data.passkey_login_enabled
    if data.otp_required is not None:
        settings.otp_required = data.otp_required
    db.commit()
    db.refresh(settings)
    return AuthSettingsResponse(
        registration_enabled=settings.registration_enabled,
        passkey_login_enabled=settings.passkey_login_enabled,
        otp_required=settings.otp_required,
    )


# ============== 注册 ==============


@router.post("/register", response_model=dict)
async def register(data: UserCreate, request: Request, db: Session = Depends(get_db)):
    """用户注册"""
    settings = get_or_create_auth_settings(db)

    # 检查是否允许注册
    if not settings.registration_enabled:
        # 检查是否没有任何用户（首次注册允许）
        user_count = db.query(UserModel).count()
        if user_count > 0:
            raise HTTPException(status_code=403, detail="Registration is disabled")

    # 检查用户名是否已存在
    if db.query(UserModel).filter(UserModel.username == data.username.lower()).first():
        raise HTTPException(status_code=400, detail="Username already exists")

    # 创建用户
    user = UserModel(
        username=data.username.lower(),
        password_hash=hash_password(data.password),
        role="admin" if db.query(UserModel).count() == 0 else "user",
        password_history=json.dumps([hash_password(data.password)]),
        recovery_codes=json.dumps([]),
        recovery_codes_used=json.dumps([]),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # 创建 session
    user_agent, ip_address = get_client_info(request)
    session = SessionModel(
        user_id=user.id,
        token=generate_token(),
        user_agent=user_agent,
        ip_address=ip_address,
        expires_at=create_session_expiry(),
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    # 生成 JWT
    jwt_token = generate_jwt(user.id, user.username, session.id)

    await emit_login_notification(user, request)

    return {
        "ok": True,
        "user": UserResponse(
            id=user.id,
            username=user.username,
            role=user.role,
            email=user.email,
            email_verified=user.email_verified,
            otp_enabled=user.otp_enabled,
            passkey_enabled=user.passkey_enabled,
            created_at=user.created_at,
        ),
        "token": jwt_token,
        "sessionId": session.id,
    }


# ============== 登录 ==============


@router.post("/login")
async def login(data: UserLogin, request: Request, db: Session = Depends(get_db)):
    """用户登录（支持用户名或邮箱）"""
    # 查找用户（支持用户名或邮箱）
    username_or_email = data.username.lower().strip()
    user = (
        db.query(UserModel)
        .filter(
            (UserModel.username == username_or_email)
            | (UserModel.email == username_or_email)
        )
        .first()
    )

    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(
            status_code=401, detail="Invalid username/email or password"
        )

    if not user.otp_setup_completed and is_otp_setup_deadline_expired(
        user.otp_setup_deadline
    ):
        pending_otp_reset_codes.pop(user.id, None)
        raise HTTPException(
            status_code=403,
            detail="OTP 重新绑定已超时，请重新走密码找回流程",
        )

    if not user.otp_setup_completed:
        raise HTTPException(
            status_code=403,
            detail="OTP 尚未完成绑定，请先完成当前账号的 OTP 设置",
        )

    # 检查是否需要 OTP 验证
    if user.otp_enabled:
        return {"ok": True, "requiresOtp": True, "userId": user.id}

    # 创建 session
    user_agent, ip_address = get_client_info(request)
    session = SessionModel(
        user_id=user.id,
        token=generate_token(),
        user_agent=user_agent,
        ip_address=ip_address,
        expires_at=create_session_expiry(),
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    # 生成 JWT
    jwt_token = generate_jwt(user.id, user.username, session.id)

    await emit_login_notification(user, request)

    return {
        "ok": True,
        "user": UserResponse(
            id=user.id,
            username=user.username,
            role=user.role,
            email=user.email,
            email_verified=user.email_verified,
            otp_enabled=user.otp_enabled,
            passkey_enabled=user.passkey_enabled,
            created_at=user.created_at,
        ),
        "token": jwt_token,
        "sessionId": session.id,
    }


# ============== OTP 验证 ==============


@router.post("/login/otp")
async def verify_login_otp(
    data: OtpVerifyRequest, request: Request, db: Session = Depends(get_db)
):
    """验证登录 OTP"""
    # 需要从 query 参数获取 userId（临时登录状态）
    # 实际应用中可能需要使用临时 token 或 session 存储

    # 这里简化处理：前端需要传 userId
    user_id = request.query_params.get("userId")
    if not user_id:
        raise HTTPException(status_code=400, detail="userId required")

    user = db.query(UserModel).filter(UserModel.id == user_id).first()
    if not user or not user.otp_secret:
        raise HTTPException(status_code=404, detail="User not found")

    code = data.code.replace(" ", "").lower()

    # 验证 OTP
    if not verify_otp(user.otp_secret, code):
        # 尝试恢复码
        recovery_codes = [item.lower() for item in json.loads(user.recovery_codes)]
        recovery_codes_used = [
            item.lower() for item in json.loads(user.recovery_codes_used)
        ]

        if code in recovery_codes and code not in recovery_codes_used:
            recovery_codes_used.append(code)
            user.recovery_codes_used = json.dumps(recovery_codes_used)
        else:
            raise HTTPException(status_code=400, detail="Invalid OTP code")

    # 创建 session
    user_agent, ip_address = get_client_info(request)
    session = SessionModel(
        user_id=user.id,
        token=generate_token(),
        user_agent=user_agent,
        ip_address=ip_address,
        expires_at=create_session_expiry(),
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    # 生成 JWT
    jwt_token = generate_jwt(user.id, user.username, session.id)

    await emit_login_notification(user, request)

    return {
        "ok": True,
        "user": UserResponse(
            id=user.id,
            username=user.username,
            role=user.role,
            email=user.email,
            email_verified=user.email_verified,
            otp_enabled=user.otp_enabled,
            passkey_enabled=user.passkey_enabled,
            created_at=user.created_at,
        ),
        "token": jwt_token,
        "sessionId": session.id,
    }


# ============== OTP 管理 ==============


@router.post("/otp/setup", response_model=OtpSetupResponse)
async def setup_otp(
    user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)
):
    """开始设置 OTP"""
    if user.otp_enabled and user.otp_setup_completed:
        raise HTTPException(status_code=400, detail="OTP already enabled")

    if user.otp_enabled and not user.otp_setup_completed:
        user.otp_enabled = False
        db.commit()

    secret = generate_otp_secret()
    uri = get_otp_uri(secret, user.username)
    # 暂存 secret（实际应用中可能需要更安全的方式）
    # 这里简化处理：返回给前端，验证时再确认
    return {
        "secret": secret,
        "uri": uri,
        "qr": generate_qr_base64(uri),
    }


@router.post("/otp/confirm")
async def confirm_otp_setup(
    data: OtpConfirmRequest,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """确认 OTP 设置"""
    if user.otp_enabled and user.otp_setup_completed:
        if user.otp_secret == data.secret and verify_otp(data.secret, data.code):
            pending_otp_reset_codes.pop(user.id, None)
            return {"ok": True, "firstSetup": False}
        raise HTTPException(status_code=400, detail="OTP already enabled")
    if not verify_otp(data.secret, data.code):
        raise HTTPException(status_code=400, detail="Invalid OTP code")

    pending_reset = pending_otp_reset_codes.get(user.id)
    if pending_reset:
        from utils.auth_utils import verify_recovery_code

        recovery_code = str(pending_reset["recovery_code"])
        if not verify_recovery_code(db, user.id, recovery_code, consume=True):
            pending_otp_reset_codes.pop(user.id, None)
            raise HTTPException(
                status_code=400, detail="恢复码已失效，请重新开始 OTP 重置"
            )

    # 启用 OTP
    user.otp_enabled = True
    user.otp_secret = data.secret
    user.otp_setup_completed = True  # 标记已完成 OTP 设置
    user.otp_setup_deadline = None

    # 只有首次设置时才生成恢复码，重置后重新绑定保持原有恢复码
    # 检查是否已有有效的恢复码（不是空列表）
    existing_codes = json.loads(user.recovery_codes) if user.recovery_codes else []
    if not existing_codes:
        recovery_codes = generate_recovery_codes()
        user.recovery_codes = json.dumps(recovery_codes)
        user.recovery_codes_used = json.dumps([])
        db.commit()
        pending_otp_reset_codes.pop(user.id, None)
        return {"ok": True, "recoveryCodes": recovery_codes, "firstSetup": True}

    db.commit()
    pending_otp_reset_codes.pop(user.id, None)
    return {"ok": True, "firstSetup": False}


class OtpResetRequest(BaseModel):
    """OTP 重置请求，需要密码和恢复码双重验证"""

    code: Optional[str] = None  # 恢复码
    password: Optional[str] = None  # 密码
    # regenerate_recovery_codes: bool = False
    # 可选开关：如果未来希望在 OTP 重置时同时刷新恢复码，取消注释此字段。


@router.post("/otp/reset")
async def reset_otp(
    data: OtpResetRequest,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """重置 OTP（需要密码和恢复码验证），只更换 secret，恢复码保持不变"""
    if not user.otp_enabled:
        raise HTTPException(status_code=400, detail="OTP not enabled")

    if not data.password:
        raise HTTPException(status_code=400, detail="请输入当前密码")

    if not data.code:
        raise HTTPException(status_code=400, detail="请输入恢复码")

    if not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=400, detail="当前密码不正确")

    from utils.auth_utils import verify_recovery_code

    code = data.code.replace(" ", "").lower()
    if not verify_recovery_code(db, user.id, code, consume=False):
        raise HTTPException(status_code=400, detail="恢复码无效")

    # 重置 OTP：生成新 secret，暂时禁用让用户重新绑定
    new_secret = generate_otp_secret()
    user.otp_secret = new_secret
    user.otp_enabled = False  # 暂时禁用，等用户重新确认绑定
    user.otp_setup_completed = False
    user.otp_setup_deadline = create_otp_setup_deadline()

    pending_otp_reset_codes[user.id] = {
        "recovery_code": code,
        "created_at": datetime.utcnow(),
    }

    # 可选逻辑：如果未来希望“重置 OTP 时同时刷新恢复码”，可启用下面这段。
    # 注意：启用后前端需要接收 recoveryCodes，并在本次操作里只展示一次。
    # if data.regenerate_recovery_codes:
    #     new_codes = generate_recovery_codes()
    #     user.recovery_codes = json.dumps(new_codes)
    #     user.recovery_codes_used = json.dumps([])
    #     user.recovery_codes_downloaded = False

    db.commit()

    new_uri = get_otp_uri(new_secret, user.username)
    response = {
        "ok": True,
        "secret": new_secret,
        "uri": new_uri,
        "qr": generate_qr_base64(new_uri),
    }

    # if data.regenerate_recovery_codes:
    #     response["recoveryCodes"] = new_codes

    return response


# ============== 恢复码管理 ==============


@router.get("/recovery-codes")
async def get_recovery_codes(user: UserModel = Depends(get_current_user)):
    """获取恢复码状态"""
    recovery_codes = json.loads(user.recovery_codes)
    recovery_codes_used = json.loads(user.recovery_codes_used)

    return {
        "total": len(recovery_codes),
        "usedCodes": recovery_codes_used,
        "available": len(recovery_codes) - len(recovery_codes_used),
    }


@router.post("/recovery-codes/regenerate")
async def regenerate_recovery_codes(
    data: OtpVerifyRequest,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """重新生成恢复码（需要二次验证）"""
    if not user.otp_enabled:
        raise HTTPException(status_code=400, detail="OTP not enabled")

    code = data.code.replace(" ", "").lower()

    # 验证 OTP 或恢复码
    if not verify_otp(user.otp_secret, code):
        recovery_codes = [item.lower() for item in json.loads(user.recovery_codes)]
        recovery_codes_used = [
            item.lower() for item in json.loads(user.recovery_codes_used)
        ]
        if code in recovery_codes and code not in recovery_codes_used:
            recovery_codes_used.append(code)
            user.recovery_codes_used = json.dumps(recovery_codes_used)
        else:
            raise HTTPException(status_code=400, detail="Invalid OTP code")

    # 生成新的恢复码
    new_codes = generate_recovery_codes()
    user.recovery_codes = json.dumps(new_codes)
    user.recovery_codes_used = json.dumps([])

    db.commit()

    return {"ok": True, "recoveryCodes": new_codes}


# ============== 恢复码下载确认 ==============
@router.post("/recovery-codes/confirm-downloaded")
async def confirm_recovery_codes_downloaded(
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """确认恢复码已下载"""
    user.recovery_codes_downloaded = True
    db.commit()
    return {"ok": True}


# ============== Session 管理 ==============


@router.get("/sessions", response_model=List[SessionResponse])
async def get_sessions(
    user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)
):
    """获取用户所有 session"""
    sessions = (
        db.query(SessionModel)
        .filter(SessionModel.user_id == user.id)
        .order_by(SessionModel.created_at.desc())
        .all()
    )

    return [
        SessionResponse(
            id=s.id,
            user_agent=s.user_agent,
            ip_address=s.ip_address,
            active=s.active,
            created_at=s.created_at,
            last_active=s.last_active,
            expires_at=s.expires_at,
        )
        for s in sessions
    ]


@router.post("/sessions/{session_id}/revoke")
async def revoke_session(
    session_id: str,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """撤销指定 session"""
    session = (
        db.query(SessionModel)
        .filter(SessionModel.id == session_id, SessionModel.user_id == user.id)
        .first()
    )

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session.active = False
    db.commit()

    return {"ok": True}


class RevokeOtherSessionsRequest(BaseModel):
    current_session_id: Optional[str] = None


@router.post("/sessions/revoke-others")
async def revoke_other_sessions(
    request: RevokeOtherSessionsRequest,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """撤销除当前 session 外的所有 session"""
    sessions = (
        db.query(SessionModel)
        .filter(SessionModel.user_id == user.id, SessionModel.active == True)
        .all()
    )
    for s in sessions:
        if request.current_session_id and s.id != request.current_session_id:
            s.active = False
    db.commit()
    return {"ok": True}


@router.delete("/sessions/clean-revoked")
async def clean_revoked_sessions(
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """删除所有已撤销的 session 记录"""
    deleted = (
        db.query(SessionModel)
        .filter(SessionModel.user_id == user.id, SessionModel.active == False)
        .delete()
    )
    db.commit()
    return {"ok": True, "deleted": deleted}


# ============== API Key 管理 ==============


@router.post("/api-keys", response_model=ApiKeyWithRawKey)
async def create_api_key(
    data: ApiKeyCreate,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """创建 API Key"""
    raw_key = generate_api_key()
    key_hash = hash_api_key(raw_key)

    api_key = ApiKeyModel(
        user_id=user.id,
        name=data.name,
        key_prefix=raw_key[:11] + "...",
        key_hash=key_hash,
    )

    if data.expires_in_days:
        from datetime import timedelta

        api_key.expires_at = datetime.utcnow() + timedelta(days=data.expires_in_days)

    db.add(api_key)
    db.commit()
    db.refresh(api_key)

    return ApiKeyWithRawKey(
        id=api_key.id,
        name=api_key.name,
        key_prefix=api_key.key_prefix,
        created_at=api_key.created_at,
        expires_at=api_key.expires_at,
        last_used=api_key.last_used,
        revoked=api_key.revoked,
        key=raw_key,  # 只在创建时返回
    )


@router.get("/api-keys", response_model=List[ApiKeyResponse])
async def get_api_keys(
    user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)
):
    """获取用户所有 API Key"""
    keys = (
        db.query(ApiKeyModel)
        .filter(ApiKeyModel.user_id == user.id)
        .order_by(ApiKeyModel.created_at.desc())
        .all()
    )

    return [
        ApiKeyResponse(
            id=k.id,
            name=k.name,
            key_prefix=k.key_prefix,
            created_at=k.created_at,
            expires_at=k.expires_at,
            last_used=k.last_used,
            revoked=k.revoked,
        )
        for k in keys
    ]


@router.post("/api-keys/{key_id}/revoke")
async def revoke_api_key(
    key_id: str,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """撤销 API Key"""
    api_key = (
        db.query(ApiKeyModel)
        .filter(ApiKeyModel.id == key_id, ApiKeyModel.user_id == user.id)
        .first()
    )

    if not api_key:
        raise HTTPException(status_code=404, detail="API Key not found")

    api_key.revoked = True
    db.commit()
    return {"ok": True}


@router.delete("/api-keys/{key_id}")
async def delete_api_key(
    key_id: str,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """删除 API Key（仅限已撤销或已过期的 key）"""
    api_key = (
        db.query(ApiKeyModel)
        .filter(ApiKeyModel.id == key_id, ApiKeyModel.user_id == user.id)
        .first()
    )
    if not api_key:
        raise HTTPException(status_code=404, detail="API Key not found")

    # 只允许删除已撤销或已过期的 key
    from datetime import datetime

    is_expired = api_key.expires_at and api_key.expires_at < datetime.utcnow()
    if not api_key.revoked and not is_expired:
        raise HTTPException(
            status_code=400, detail="Can only delete revoked or expired API keys"
        )

    db.delete(api_key)
    db.commit()
    return {"ok": True}


# ============== 登出 ==============


@router.post("/logout")
async def logout(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db),
):
    """登出（撤销当前 session）"""
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )

    valid, payload = verify_jwt(credentials.credentials)
    if not valid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token"
        )

    user_id = payload.get("sub")
    session_id = payload.get("sid")
    if not user_id or not session_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session token"
        )

    session = (
        db.query(SessionModel)
        .filter(SessionModel.id == session_id, SessionModel.user_id == user_id)
        .first()
    )

    if session and session.active:
        session.active = False
        session.last_active = datetime.utcnow()
        db.commit()

    return {"ok": True}


# ============== 用户信息 ==============


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(user: UserModel = Depends(get_current_user)):
    """获取当前用户信息"""
    return UserResponse(
        id=user.id,
        username=user.username,
        role=user.role,
        email=user.email,
        email_verified=user.email_verified,
        otp_enabled=user.otp_enabled,
        passkey_enabled=user.passkey_enabled,
        created_at=user.created_at,
    )


# ============== 检查用户是否存在 ==============


@router.get("/has-users")
async def has_users(db: Session = Depends(get_db)):
    """检查系统是否有用户"""
    count = db.query(UserModel).count()
    return {"hasUsers": count > 0}


# ============== 修改密码 ==============
@router.post("/password/change")
async def change_password(
    data: PasswordChangeRequest,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """修改密码（需要 OTP 验证，如果已启用）"""
    # 验证当前密码
    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    # 如果用户启用了 OTP，需要验证二次认证码
    if user.otp_enabled:
        if not data.second_factor_code:
            raise HTTPException(status_code=400, detail="OTP code required")
        # 验证 OTP 或恢复码
        if not verify_otp(user.otp_secret, data.second_factor_code):
            # 尝试作为恢复码验证
            from utils.auth_utils import verify_recovery_code

            if not verify_recovery_code(db, user.id, data.second_factor_code):
                raise HTTPException(
                    status_code=400, detail="Invalid OTP code or recovery code"
                )

    # 保存当前密码到历史记录（最多保留最近 5 个）
    password_history = json.loads(user.password_history or "[]")
    password_history.insert(0, user.password_hash)
    password_history = password_history[:5]  # 只保留最近 5 个

    # 更新密码
    user.password_hash = hash_password(data.new_password)
    user.password_history = json.dumps(password_history)
    db.commit()
    return {"ok": True}


# ============== 邮箱绑定 ==============
from models.user import EmailBindRequest, EmailVerifyRequest


@router.post("/email/send-code")
async def send_email_code(
    data: EmailBindRequest,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """发送邮箱验证码（绑定邮箱）"""
    # 检查邮箱是否已被其他用户绑定
    existing = (
        db.query(UserModel)
        .filter(UserModel.email == data.email.lower(), UserModel.id != user.id)
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="该邮箱已被其他账户绑定")

    # 生成验证码
    code = generate_verification_code(6)

    # 存储验证码（有效期15分钟）
    user.email_verify_code = code
    user.email_verify_expires = datetime.utcnow() + timedelta(minutes=15)
    # 临时存储待验证的邮箱
    user.email = data.email.lower()
    db.commit()

    # 发送邮件
    if is_smtp_configured():
        success = send_verification_code_email(data.email, code, expiry_minutes=15)
        if not success:
            raise HTTPException(status_code=500, detail="邮件发送失败，请稍后重试")
        return {"ok": True, "message": "验证码已发送到您的邮箱"}
    else:
        # 开发环境：SMTP 未配置时返回验证码
        print(f"[DEV] 邮箱验证码发送到 {data.email}: {code}")
        return {"ok": True, "message": "验证码已发送", "dev_code": code}


@router.post("/email/verify")
async def verify_email(
    data: EmailVerifyRequest,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """验证邮箱验证码并完成绑定"""
    # 检查邮箱是否匹配
    if user.email != data.email.lower():
        raise HTTPException(status_code=400, detail="邮箱地址不匹配")

    # 检查验证码
    if not user.email_verify_code or user.email_verify_code != data.code:
        raise HTTPException(status_code=400, detail="验证码错误")

    # 检查验证码是否过期
    if user.email_verify_expires and user.email_verify_expires < datetime.utcnow():
        raise HTTPException(status_code=400, detail="验证码已过期，请重新获取")

    # 完成绑定
    user.email_verified = True
    user.email_verify_code = None
    user.email_verify_expires = None
    db.commit()

    return {
        "ok": True,
        "user": UserResponse(
            id=user.id,
            username=user.username,
            role=user.role,
            email=user.email,
            email_verified=user.email_verified,
            otp_enabled=user.otp_enabled,
            passkey_enabled=user.passkey_enabled,
            created_at=user.created_at,
        ),
    }


# ============== 密码找回 ==============
from models.user import (
    PasswordRecoveryStartRequest,
    PasswordRecoveryMethodsResponse,
    PasswordRecoveryVerifyRequest,
    PasswordRecoveryResetRequest,
)
import secrets

# 临时验证 token 存储（生产环境应使用 Redis）
recovery_tokens = {}  # {token: {user_id, expires_at, verified_methods, recovery_code}}


@router.post("/recovery/start")
async def password_recovery_start(
    data: PasswordRecoveryStartRequest,
    db: Session = Depends(get_db),
):
    """开始密码找回流程，返回可用的验证方式"""
    user = db.query(UserModel).filter(UserModel.username == data.username).first()
    if not user:
        # 安全考虑：不透露用户是否存在
        return PasswordRecoveryMethodsResponse(
            has_email=False,
            has_otp=False,
            has_passkey=False,
            has_recovery_codes=False,
            has_old_password=False,
            required_methods=2,
        )

    # 检查恢复码是否还有剩余
    recovery_codes = json.loads(user.recovery_codes or "[]")
    recovery_codes_used = json.loads(user.recovery_codes_used or "[]")
    has_recovery_codes = len(recovery_codes) > len(recovery_codes_used)

    # 检查是否有历史密码
    password_history = json.loads(user.password_history or "[]")
    has_old_password = len(password_history) > 0 or bool(user.password_hash)

    return PasswordRecoveryMethodsResponse(
        has_email=user.email_verified and bool(user.email),
        has_otp=user.otp_enabled,
        has_passkey=user.passkey_enabled,
        has_recovery_codes=has_recovery_codes,
        has_old_password=has_old_password,
        required_methods=2,
    )


@router.post("/recovery/send-email-code")
async def password_recovery_send_email(
    data: PasswordRecoveryStartRequest,
    db: Session = Depends(get_db),
):
    """发送密码找回邮箱验证码"""
    user = db.query(UserModel).filter(UserModel.username == data.username).first()
    if not user or not user.email or not user.email_verified:
        raise HTTPException(status_code=400, detail="用户未绑定邮箱")

    # 生成验证码
    code = generate_verification_code(6)
    user.email_verify_code = code
    user.email_verify_expires = datetime.utcnow() + timedelta(minutes=15)
    db.commit()

    # 发送邮件
    if is_smtp_configured():
        send_verification_code_email(user.email, code, "密码找回")
        return {"ok": True, "message": "验证码已发送"}
    else:
        # 开发环境返回验证码
        return {"ok": True, "dev_code": code, "message": "验证码已生成（开发模式）"}


@router.post("/recovery/verify")
async def password_recovery_verify(
    data: PasswordRecoveryVerifyRequest,
    db: Session = Depends(get_db),
):
    """验证密码找回的身份"""
    user = db.query(UserModel).filter(UserModel.username == data.username).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    # 验证至少两种方式
    verified_count = 0
    verification_details = []

    # 1. 邮箱验证码
    if "email" in data.verification_methods and data.email_code:
        if (
            user.email_verify_code == data.email_code
            and user.email_verify_expires
            and user.email_verify_expires > datetime.utcnow()
        ):
            verified_count += 1
            verification_details.append("email")
        else:
            raise HTTPException(status_code=400, detail="邮箱验证码无效或已过期")

    # 2. OTP 验证
    if "otp" in data.verification_methods and data.otp_code:
        if user.otp_enabled and verify_otp(user.otp_secret, data.otp_code):
            verified_count += 1
            verification_details.append("otp")
        else:
            raise HTTPException(status_code=400, detail="OTP 验证码无效")

    # 3. 恢复码验证
    if "recovery_code" in data.verification_methods and data.recovery_code:
        from utils.auth_utils import verify_recovery_code

        if verify_recovery_code(db, user.id, data.recovery_code, consume=False):
            verified_count += 1
            verification_details.append("recovery_code")
        else:
            raise HTTPException(status_code=400, detail="恢复码无效")

    # 4. 曾用密码验证
    if "old_password" in data.verification_methods and data.old_password:
        # 检查密码历史（包含注册密码和后续使用过的密码）
        password_history = json.loads(user.password_history or "[]")
        if not password_history and user.password_hash:
            password_history = [user.password_hash]
        verified = False
        for old_hash in password_history:
            if verify_password(data.old_password, old_hash):
                verified = True
                break
        if verified:
            verified_count += 1
            verification_details.append("old_password")
        else:
            raise HTTPException(status_code=400, detail="历史密码不正确")

    # 检查是否满足至少两种验证方式
    if verified_count < 2:
        raise HTTPException(
            status_code=400,
            detail=f"需要至少两种验证方式，当前已验证: {verified_count} 种",
        )

    # 生成临时验证 token（有效期 15 分钟）
    verification_token = secrets.token_urlsafe(32)
    recovery_tokens[verification_token] = {
        "user_id": user.id,
        "expires_at": datetime.utcnow() + timedelta(minutes=15),
        "verified_methods": verification_details,
        "recovery_code": (
            data.recovery_code if "recovery_code" in verification_details else None
        ),
    }

    return {
        "ok": True,
        "verification_token": verification_token,
        "verified_methods": verification_details,
    }


def get_valid_recovery_token_or_raise(verification_token: str):
    """获取并校验找回流程 token"""
    token_data = recovery_tokens.get(verification_token)
    if not token_data:
        raise HTTPException(status_code=400, detail="无效的验证 token")

    if token_data["expires_at"] < datetime.utcnow():
        del recovery_tokens[verification_token]
        raise HTTPException(status_code=400, detail="验证 token 已过期")

    return token_data


def get_recovery_user_or_raise(db: Session, user_id: str):
    user = db.query(UserModel).filter(UserModel.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    return user


def consume_recovery_code_if_needed(
    db: Session, user: UserModel, token_data: dict, *, error_detail: str
):
    recovery_code = token_data.get("recovery_code")
    if not recovery_code:
        return

    from utils.auth_utils import verify_recovery_code

    if not verify_recovery_code(db, user.id, recovery_code, consume=True):
        raise HTTPException(status_code=400, detail=error_detail)


@router.post("/recovery/reset-otp")
async def password_recovery_reset_otp(
    data: PasswordRecoveryOtpResetRequest,
    db: Session = Depends(get_db),
):
    """找回流程中重置 OTP，返回新的绑定信息"""
    token_data = get_valid_recovery_token_or_raise(data.verification_token)
    user = get_recovery_user_or_raise(db, token_data["user_id"])

    if user.username != data.username:
        raise HTTPException(status_code=400, detail="用户名与验证 token 不匹配")

    if not user.otp_enabled:
        raise HTTPException(status_code=400, detail="当前账号未启用 OTP")

    new_secret = generate_otp_secret()
    token_data["pending_otp_secret"] = new_secret

    new_uri = get_otp_uri(new_secret, user.username)
    return {
        "ok": True,
        "secret": new_secret,
        "uri": new_uri,
        "qr": generate_qr_base64(new_uri),
    }


@router.post("/recovery/confirm-otp")
async def password_recovery_confirm_otp(
    data: PasswordRecoveryOtpConfirmRequest,
    db: Session = Depends(get_db),
):
    """找回流程中确认新的 OTP 绑定"""
    token_data = get_valid_recovery_token_or_raise(data.verification_token)
    user = get_recovery_user_or_raise(db, token_data["user_id"])

    if user.username != data.username:
        raise HTTPException(status_code=400, detail="用户名与验证 token 不匹配")

    pending_secret = token_data.get("pending_otp_secret")
    if not pending_secret:
        raise HTTPException(status_code=400, detail="请先开始 OTP 重置流程")

    if data.secret != pending_secret:
        raise HTTPException(status_code=400, detail="OTP 设置信息已失效，请重新开始")

    if not verify_otp(data.secret, data.code):
        raise HTTPException(status_code=400, detail="Invalid OTP code")

    consume_recovery_code_if_needed(
        db,
        user,
        token_data,
        error_detail="恢复码已失效，请重新开始找回流程",
    )

    user.otp_secret = data.secret
    user.otp_enabled = True
    user.otp_setup_completed = True
    user.otp_setup_deadline = None

    db.commit()

    del recovery_tokens[data.verification_token]

    db.query(SessionModel).filter(SessionModel.user_id == user.id).delete()
    db.commit()

    return {
        "ok": True,
        "message": "OTP 已重置，请使用现有密码和新的 OTP 登录",
    }


@router.post("/recovery/reset")
async def password_recovery_reset(
    data: PasswordRecoveryResetRequest,
    db: Session = Depends(get_db),
):
    """重置密码"""
    token_data = get_valid_recovery_token_or_raise(data.verification_token)
    user = get_recovery_user_or_raise(db, token_data["user_id"])

    if user.username != data.username:
        raise HTTPException(status_code=400, detail="用户名与验证 token 不匹配")

    verified_methods = token_data.get("verified_methods", [])

    # 如果验证阶段使用了恢复码，则在真正重置密码成功前再消费一次
    consume_recovery_code_if_needed(
        db,
        user,
        token_data,
        error_detail="恢复码已失效，请重新开始找回流程",
    )

    # 如果本次找回没有使用 OTP，则视为原 OTP 已不可用，强制重新绑定
    otp_reset_required = user.otp_enabled and "otp" not in verified_methods

    # 更新密码
    password_history = json.loads(user.password_history or "[]")
    password_history.insert(0, user.password_hash)
    user.password_history = json.dumps(password_history[:5])
    user.password_hash = hash_password(data.new_password)

    if otp_reset_required:
        user.otp_enabled = False
        user.otp_secret = None
        user.otp_setup_completed = False
        user.otp_setup_deadline = create_otp_setup_deadline()
        user.recovery_codes = json.dumps([])
        user.recovery_codes_used = json.dumps([])
        user.recovery_codes_downloaded = False
    else:
        user.otp_setup_deadline = None

    db.commit()

    # 清除验证 token
    del recovery_tokens[data.verification_token]

    # 可选：撤销所有现有会话，强制重新登录
    db.query(SessionModel).filter(SessionModel.user_id == user.id).delete()
    db.commit()

    message = "密码已重置，请使用新密码登录"
    if otp_reset_required:
        message += (
            f"。原 OTP 已重置，请在 {OTP_SETUP_GRACE_HOURS} 小时内登录并重新绑定 OTP，"
            "否则需要重新走密码找回流程"
        )

    return {
        "ok": True,
        "message": message,
        "otp_reset_required": otp_reset_required,
    }
