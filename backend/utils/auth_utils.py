"""
认证相关工具函数
"""

import os
import secrets
import hashlib
import hmac
import base64
import json
from datetime import datetime, timedelta
from typing import Optional, Tuple, Dict, Any
import pyotp
from dotenv import load_dotenv

# 加载环境变量（确保在导入时加载）
load_dotenv()

# JWT 配置
JWT_SECRET = os.environ.get(
    "JWT_SECRET", "browserflow_secret_key_2024_change_in_production"
)
JWT_ALGORITHM = "HS256"
DEFAULT_TOKEN_EXPIRE_DAYS = 7
MAX_TOKEN_EXPIRE_DAYS = 100
OTP_SETUP_GRACE_HOURS = max(1, int(os.environ.get("OTP_SETUP_GRACE_HOURS", "24")))


def hash_password(password: str) -> str:
    """使用 PBKDF2 哈希密码"""
    salt = os.urandom(32)
    key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100000)
    return base64.b64encode(salt + key).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    """验证密码"""
    try:
        decoded = base64.b64decode(password_hash.encode("utf-8"))
        salt = decoded[:32]
        stored_key = decoded[32:]
        new_key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100000)
        return hmac.compare_digest(stored_key, new_key)
    except Exception:
        return False


def generate_token() -> str:
    """生成随机token"""
    return secrets.token_hex(32)


def create_otp_setup_deadline() -> datetime:
    """生成 OTP 重新绑定截止时间。"""
    return datetime.utcnow() + timedelta(hours=OTP_SETUP_GRACE_HOURS)


def is_otp_setup_deadline_expired(deadline: Optional[datetime]) -> bool:
    """检查 OTP 重新绑定期限是否已过。"""
    return deadline is not None and deadline < datetime.utcnow()


def generate_jwt(
    user_id: str,
    username: str,
    session_id: str,
    expires_days: int = DEFAULT_TOKEN_EXPIRE_DAYS,
) -> str:
    """生成 JWT token"""
    from jose import jwt

    # 限制最大过期时间
    expires_days = min(expires_days, MAX_TOKEN_EXPIRE_DAYS)

    now = datetime.utcnow()
    payload = {
        "sub": user_id,
        "username": username,
        "sid": session_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=expires_days)).timestamp()),
    }

    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_jwt(token: str) -> Optional[Dict[str, Any]]:
    """解码并验证 JWT token"""
    from jose import jwt, JWTError

    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except JWTError:
        return None


def verify_jwt(token: str) -> Tuple[bool, Optional[Dict[str, Any]]]:
    """验证 JWT token，返回 (是否有效, payload)"""
    payload = decode_jwt(token)
    if not payload:
        return False, None

    # 检查过期
    exp = payload.get("exp")
    if exp and datetime.fromtimestamp(exp) < datetime.utcnow():
        return False, None

    return True, payload


# OTP 相关
def generate_otp_secret() -> str:
    """生成 OTP secret"""
    return pyotp.random_base32()


def get_otp_uri(secret: str, username: str, issuer: str = "BrowserFlow") -> str:
    """生成 OTP URI (用于二维码)"""
    return pyotp.totp.TOTP(secret).provisioning_uri(name=username, issuer_name=issuer)


def verify_otp(secret: str, code: str, valid_window: int = 1) -> bool:
    """
    验证 OTP 代码
    valid_window: 允许的时间窗口偏移（前后各valid_window个30秒周期）
    """
    totp = pyotp.totp.TOTP(secret)
    return totp.verify(code, valid_window=valid_window)


# 恢复码
def generate_recovery_codes(count: int = 16) -> list:
    """生成恢复码"""
    codes = []
    for _ in range(count):
        code = secrets.token_hex(4)  # 8字符
        codes.append(f"{code[:4]}-{code[4:]}")
    return codes


def verify_recovery_code(db, user_id: str, code: str, consume: bool = True) -> bool:
    """验证恢复码，可选在验证通过后立即消费。"""
    from models.db_models import UserModel

    user = db.query(UserModel).filter(UserModel.id == user_id).first()
    if not user:
        return False

    normalized_code = code.replace(" ", "").lower()
    recovery_codes = [item.lower() for item in json.loads(user.recovery_codes or "[]")]
    recovery_codes_used = [
        item.lower() for item in json.loads(user.recovery_codes_used or "[]")
    ]

    if normalized_code not in recovery_codes or normalized_code in recovery_codes_used:
        return False

    if not consume:
        return True

    recovery_codes_used.append(normalized_code)
    user.recovery_codes_used = json.dumps(recovery_codes_used)
    db.commit()
    return True


# API Key
def generate_api_key() -> str:
    """生成 API Key"""
    return f"bfk_{secrets.token_hex(24)}"


def hash_api_key(key: str) -> str:
    """哈希 API Key"""
    return hashlib.sha256(key.encode()).hexdigest()


# 数据加密/解密（用于凭证数据）
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC


def _get_encryption_key(user_id: str) -> bytes:
    """
    从用户 ID 生成加密密钥

    使用 JWT_SECRET 作为主密钥，用户 ID 作为盐
    """
    # 使用 PBKDF2 派生密钥
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=user_id.encode(),
        iterations=100000,
    )
    key = base64.urlsafe_b64encode(kdf.derive(JWT_SECRET.encode()))
    return key


def encrypt_data(data: str, user_id: str) -> str:
    """
    加密数据

    Args:
        data: 要加密的数据（字符串）
        user_id: 用户 ID（用于生成密钥）

    Returns:
        加密后的数据（Base64 编码）
    """
    key = _get_encryption_key(user_id)
    f = Fernet(key)
    encrypted = f.encrypt(data.encode())
    return base64.b64encode(encrypted).decode()


def decrypt_data(encrypted_data: str, user_id: str) -> str:
    """
    解密数据

    Args:
        encrypted_data: 加密的数据（Base64 编码）
        user_id: 用户 ID（用于生成密钥）

    Returns:
        解密后的数据
    """
    key = _get_encryption_key(user_id)
    f = Fernet(key)
    encrypted = base64.b64decode(encrypted_data.encode())
    decrypted = f.decrypt(encrypted)
    return decrypted.decode()
