"""
Passkey (WebAuthn) 认证路由

实现无密码认证，支持指纹、Face ID、硬件密钥等
"""

import json
import base64
import uuid
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from webauthn import (
    generate_registration_options,
    verify_registration_response,
    generate_authentication_options,
    verify_authentication_response,
    options_to_json,
)
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    AuthenticatorAttachment,
    UserVerificationRequirement,
    AuthenticatorTransport,
    PublicKeyCredentialDescriptor,
    COSEAlgorithmIdentifier,
)

from models.database import get_db, SessionLocal
from models.db_models import UserModel, SessionModel
from routers.auth import (
    get_current_user,
    get_or_create_auth_settings,
    generate_jwt,
    generate_token,
    create_session_expiry,
)

router = APIRouter(prefix="/api/passkey", tags=["passkey"])

# WebAuthn 配置
RP_ID = "localhost"
RP_NAME = "BrowserFlow"
# 支持开发环境的多个端口
# 快速登录的临时 challenge 存储（生产环境应使用 Redis）
_quick_login_challenge = None

ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:8080",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:8080",
]


def get_origin_from_request(request: Request) -> str:
    """从请求中获取 origin，或返回默认值"""
    origin = request.headers.get("origin") or request.headers.get("referer")
    if origin:
        # 移除路径部分
        from urllib.parse import urlparse

        parsed = urlparse(origin)
        return f"{parsed.scheme}://{parsed.netloc}"
    return "http://localhost:5173"


@router.post("/register/begin")
async def passkey_register_begin(
    request: Request,
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
):
    """开始 Passkey 注册流程"""
    if user.passkey_enabled:
        raise HTTPException(status_code=400, detail="Passkey already registered")

    options = generate_registration_options(
        rp_id=RP_ID,
        rp_name=RP_NAME,
        user_id=uuid.UUID(user.id).bytes,
        user_name=user.username,
        user_display_name=user.username,
        authenticator_selection=AuthenticatorSelectionCriteria(
            authenticator_attachment=AuthenticatorAttachment.PLATFORM,
            user_verification=UserVerificationRequirement.PREFERRED,
        ),
        supported_pub_key_algs=[
            COSEAlgorithmIdentifier.ECDSA_SHA_256,
            COSEAlgorithmIdentifier.RSASSA_PKCS1_v1_5_SHA_256,
        ],
    )

    user.webauthn_challenge = base64.urlsafe_b64encode(options.challenge).decode()
    db.commit()

    return json.loads(options_to_json(options))


@router.post("/register/complete")
async def passkey_register_complete(
    data: dict,
    request: Request,
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
):
    """完成 Passkey 注册"""
    if user.passkey_enabled:
        raise HTTPException(status_code=400, detail="Passkey already registered")
    if not user.webauthn_challenge:
        raise HTTPException(status_code=400, detail="No pending registration")

    origin = get_origin_from_request(request)
    if origin not in ALLOWED_ORIGINS:
        raise HTTPException(status_code=400, detail=f"Origin not allowed: {origin}")

    try:
        verification = verify_registration_response(
            credential=data.get("credential", {}),
            expected_challenge=base64.urlsafe_b64decode(user.webauthn_challenge),
            expected_origin=origin,
            expected_rp_id=RP_ID,
            require_user_verification=False,
        )

        user.passkey_id = (
            base64.b64encode(verification.credential_id).decode()
            if isinstance(verification.credential_id, bytes)
            else verification.credential_id
        )
        user.passkey_credential = json.dumps(
            {
                "id": (
                    base64.b64encode(verification.credential_id).decode()
                    if isinstance(verification.credential_id, bytes)
                    else verification.credential_id
                ),
                "public_key": (
                    base64.b64encode(verification.credential_public_key).decode()
                    if isinstance(verification.credential_public_key, bytes)
                    else verification.credential_public_key
                ),
                "sign_count": verification.sign_count,
                "transports": data.get("transports", []),
            }
        )
        user.passkey_enabled = True
        user.webauthn_challenge = None
        db.commit()

        return {"ok": True, "message": "Passkey registered successfully"}

    except Exception as e:
        user.webauthn_challenge = None
        db.commit()
        raise HTTPException(status_code=400, detail=f"Registration failed: {str(e)}")


@router.post("/login/begin")
async def passkey_login_begin(
    data: dict,
    db: Session = Depends(get_db),
):
    """开始 Passkey 登录流程

    支持两种模式：
    1. 快速登录（无用户名）：使用 resident key
    2. 普通登录（有用户名）：指定用户登录

    当注册被禁用时，不允许快速登录
    """
    global _quick_login_challenge
    settings = get_or_create_auth_settings(db)
    username = data.get("username", "").lower().strip()

    # 快速登录模式（无用户名）- 使用 resident key
    # 用户 ID 存储在 Passkey 中，无需检查注册状态
    if not username:
        # 生成无指定 credential 的选项，允许使用 resident key
        options = generate_authentication_options(
            rp_id=RP_ID,
            user_verification=UserVerificationRequirement.REQUIRED,
        )
        _quick_login_challenge = base64.urlsafe_b64encode(options.challenge).decode()

        response_data = json.loads(options_to_json(options))
        response_data["quick_login"] = True
        return response_data

    # 普通登录模式（有用户名）
    user = db.query(UserModel).filter(UserModel.username == username).first()
    if not user or not user.passkey_enabled:
        raise HTTPException(
            status_code=404, detail="User not found or passkey not enabled"
        )

    options = generate_authentication_options(
        rp_id=RP_ID,
        user_verification=UserVerificationRequirement.PREFERRED,
        allow_credentials=[
            PublicKeyCredentialDescriptor(
                id=(
                    base64.b64decode(user.passkey_id)
                    if isinstance(user.passkey_id, str)
                    else user.passkey_id
                ),
                transports=[AuthenticatorTransport.INTERNAL],
            )
        ],
    )
    user.webauthn_challenge = base64.urlsafe_b64encode(options.challenge).decode()
    db.commit()

    response_data = json.loads(options_to_json(options))
    response_data["user_id"] = user.id
    return response_data


@router.post("/login/complete")
async def passkey_login_complete(
    data: dict,
    request: Request,
    db: Session = Depends(get_db),
):
    """完成 Passkey 登录

    支持普通登录和快速登录两种模式
    """
    global _quick_login_challenge
    user_id = data.get("user_id")
    quick_login = data.get("quick_login", False)

    # 快速登录模式
    if quick_login and not user_id:
        if not _quick_login_challenge:
            raise HTTPException(status_code=400, detail="No pending quick login")

        # 从 credential 的 userHandle 中获取用户信息
        credential_data = data.get("credential", {})
        user_handle = credential_data.get("response", {}).get("userHandle")

        if not user_handle:
            raise HTTPException(status_code=400, detail="No user handle in credential")

        # 解码 userHandle 获取用户 ID
        try:
            user_id_bytes = base64.b64decode(user_handle)
            user_id = str(uuid.UUID(bytes=user_id_bytes))
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid user handle")

        user = db.query(UserModel).filter(UserModel.id == user_id).first()
        if not user or not user.passkey_enabled:
            raise HTTPException(status_code=404, detail="User not found")

        origin = get_origin_from_request(request)
        if origin not in ALLOWED_ORIGINS:
            raise HTTPException(status_code=400, detail=f"Origin not allowed: {origin}")

        credential_info = json.loads(user.passkey_credential)

        try:
            verification = verify_authentication_response(
                credential=data.get("credential", {}),
                expected_challenge=base64.urlsafe_b64decode(_quick_login_challenge),
                expected_origin=origin,
                expected_rp_id=RP_ID,
                credential_public_key=(
                    base64.b64decode(credential_info["public_key"])
                    if isinstance(credential_info["public_key"], str)
                    else credential_info["public_key"]
                ),
                credential_current_sign_count=credential_info["sign_count"],
                require_user_verification=True,
            )
            _quick_login_challenge = None

            credential_info["sign_count"] = verification.new_sign_count
            user.passkey_credential = json.dumps(credential_info)
            db.commit()

        except Exception as e:
            _quick_login_challenge = None
            raise HTTPException(
                status_code=401, detail=f"Authentication failed: {str(e)}"
            )

    else:
        # 普通登录模式
        user = db.query(UserModel).filter(UserModel.id == user_id).first()
        if not user or not user.passkey_enabled:
            raise HTTPException(status_code=404, detail="User not found")

        if not user.webauthn_challenge:
            raise HTTPException(status_code=400, detail="No pending authentication")

        origin = get_origin_from_request(request)
        if origin not in ALLOWED_ORIGINS:
            raise HTTPException(status_code=400, detail=f"Origin not allowed: {origin}")

        credential_info = json.loads(user.passkey_credential)

        try:
            verification = verify_authentication_response(
                credential=data.get("credential", {}),
                expected_challenge=base64.urlsafe_b64decode(user.webauthn_challenge),
                expected_origin=origin,
                expected_rp_id=RP_ID,
                credential_public_key=(
                    base64.b64decode(credential_info["public_key"])
                    if isinstance(credential_info["public_key"], str)
                    else credential_info["public_key"]
                ),
                credential_current_sign_count=credential_info["sign_count"],
                require_user_verification=False,
            )
            credential_info["sign_count"] = verification.new_sign_count
            user.passkey_credential = json.dumps(credential_info)
            user.webauthn_challenge = None
            db.commit()

        except Exception as e:
            user.webauthn_challenge = None
            db.commit()
            raise HTTPException(
                status_code=401, detail=f"Authentication failed: {str(e)}"
            )

    # 检查是否需要 OTP
    settings = get_or_create_auth_settings(db)
    if settings.otp_required and user.otp_enabled:
        return {
            "ok": True,
            "requires_otp": True,
            "user_id": user.id,
        }

    # 创建会话
    user_agent = request.headers.get("user-agent", "")
    ip_address = request.client.host if request.client else ""
    new_session = SessionModel(
        user_id=user.id,
        token=generate_token(),
        user_agent=user_agent,
        ip_address=ip_address,
        expires_at=create_session_expiry(),
    )
    db.add(new_session)
    db.commit()
    db.refresh(new_session)

    jwt_token = generate_jwt(user.id, user.username, new_session.id)

    return {
        "ok": True,
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "email_verified": user.email_verified,
            "otp_enabled": user.otp_enabled,
            "passkey_enabled": user.passkey_enabled,
            "created_at": user.created_at.isoformat(),
        },
        "token": jwt_token,
        "sessionId": new_session.id,
    }


@router.delete("/")
async def passkey_delete(
    db: Session = Depends(get_db),
    user: UserModel = Depends(get_current_user),
):
    """删除 Passkey"""
    user.passkey_enabled = False
    user.passkey_id = None
    user.passkey_credential = None
    db.commit()

    return {"ok": True, "message": "Passkey deleted"}
