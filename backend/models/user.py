from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List
from datetime import datetime
from enum import Enum


class AuthMethod(str, Enum):
    PASSWORD = "password"
    PASSKEY = "passkey"
    OTP = "otp"
    RECOVERY_CODE = "recovery_code"
    EMAIL = "email"


# ============== 密码找回 ==============
class PasswordRecoveryStartRequest(BaseModel):
    username: str


class PasswordRecoveryMethodsResponse(BaseModel):
    has_email: bool
    has_otp: bool
    has_passkey: bool
    has_recovery_codes: bool
    has_old_password: bool  # 是否有历史密码记录
    required_methods: int = 2  # 需要验证的方式数量


class PasswordRecoveryVerifyRequest(BaseModel):
    username: str
    verification_methods: List[str]  # 选择的验证方式
    email_code: Optional[str] = None
    otp_code: Optional[str] = None
    passkey_credential: Optional[dict] = None
    recovery_code: Optional[str] = None
    old_password: Optional[str] = None


class PasswordRecoveryResetRequest(BaseModel):
    username: str
    new_password: str
    verification_token: str  # 验证通过后的临时 token


class PasswordRecoveryOtpResetRequest(BaseModel):
    username: str
    verification_token: str  # 验证通过后的临时 token


class PasswordRecoveryOtpConfirmRequest(BaseModel):
    username: str
    verification_token: str
    secret: str
    code: str


class UserBase(BaseModel):
    username: str = Field(..., min_length=2, max_length=32)


class UserCreate(BaseModel):
    username: str = Field(..., min_length=2, max_length=32)
    password: str = Field(..., min_length=4, max_length=128)


class UserLogin(BaseModel):
    username: str
    password: str


class EmailBindRequest(BaseModel):
    email: EmailStr


class EmailVerifyRequest(BaseModel):
    email: EmailStr
    code: str


class UserResponse(BaseModel):
    id: str
    username: str
    role: str = "user"
    email: Optional[str] = None
    email_verified: bool = False
    otp_enabled: bool = False
    passkey_enabled: bool = False
    created_at: datetime


class User(UserBase):
    """数据库用户模型"""

    id: str
    password_hash: str
    email: Optional[str] = None
    email_verified: bool = False
    email_verify_code: Optional[str] = None
    email_verify_expires: Optional[datetime] = None

    # OTP 相关
    otp_enabled: bool = False
    otp_secret: Optional[str] = None

    # Passkey 相关
    passkey_enabled: bool = False
    passkey_id: Optional[str] = None
    passkey_credential: Optional[str] = None  # 存储credential JSON

    # 恢复码
    recovery_codes: List[str] = []
    recovery_codes_used: List[str] = []

    # 时间戳
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class OtpSetupResponse(BaseModel):
    secret: str
    uri: str
    qr: str


class OtpVerifyRequest(BaseModel):
    code: str


class OtpConfirmRequest(BaseModel):
    secret: str
    code: str


class RecoveryCodeVerifyRequest(BaseModel):
    code: str


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str
    second_factor_code: Optional[str] = None  # OTP或恢复码


class AuthSettingsResponse(BaseModel):
    registration_enabled: bool = True
    passkey_login_enabled: bool = False
    otp_required: bool = True


# ============== Passkey (WebAuthn) ==============
class PasskeyRegisterCompleteRequest(BaseModel):
    credential: dict
    transports: list[str] = []


class PasskeyLoginBeginRequest(BaseModel):
    username: str


class PasskeyLoginCompleteRequest(BaseModel):
    user_id: str
    credential: dict
