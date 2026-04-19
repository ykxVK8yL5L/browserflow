"""邮件发送工具模块"""

import os
import smtplib
import secrets
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional
from datetime import datetime, timedelta

# SMTP 配置
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", "BrowserFlow <noreply@browserflow.local>")
SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "true").lower() == "true"


def is_smtp_configured() -> bool:
    print(
        f"[Email] SMTP_HOST: {SMTP_HOST}, SMTP_USER: {SMTP_USER}, SMTP_PASSWORD set: {bool(SMTP_PASSWORD)}"
    )
    """检查 SMTP 是否已配置"""
    return bool(SMTP_HOST and SMTP_USER and SMTP_PASSWORD)


def generate_verification_code(length: int = 6) -> str:
    """生成验证码"""
    return "".join(secrets.choice("0123456789") for _ in range(length))


def send_email(
    to_email: str,
    subject: str,
    body: str,
    html_body: Optional[str] = None,
) -> bool:
    """
    发送邮件

    Args:
        to_email: 收件人邮箱
        subject: 邮件主题
        body: 纯文本内容
        html_body: HTML 内容（可选）

    Returns:
        bool: 是否发送成功
    """
    if not is_smtp_configured():
        print(f"[Email] SMTP not configured, skipping email to {to_email}")
        return False

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = SMTP_FROM
        msg["To"] = to_email

        # 纯文本版本
        msg.attach(MIMEText(body, "plain", "utf-8"))

        # HTML 版本（如果提供）
        if html_body:
            msg.attach(MIMEText(html_body, "html", "utf-8"))

        # 连接 SMTP 服务器
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            if SMTP_USE_TLS:
                server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(SMTP_FROM, to_email, msg.as_string())

        print(f"[Email] Successfully sent to {to_email}")
        return True

    except Exception as e:
        print(f"[Email] Failed to send to {to_email}: {e}")
        return False


def send_verification_code_email(
    to_email: str, code: str, expiry_minutes: int = 10
) -> bool:
    """
    发送验证码邮件

    Args:
        to_email: 收件人邮箱
        code: 验证码
        expiry_minutes: 过期时间（分钟）

    Returns:
        bool: 是否发送成功
    """
    subject = "BrowserFlow 邮箱验证码"

    # 纯文本版本
    body = f"""
您的验证码是：{code}

此验证码将在 {expiry_minutes} 分钟后过期。

如果您没有请求此验证码，请忽略此邮件。

BrowserFlow
"""

    # HTML 版本
    html_body = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }}
        .container {{ max-width: 480px; margin: 0 auto; padding: 20px; }}
        .code {{ 
            font-size: 32px; 
            font-weight: bold; 
            letter-spacing: 8px; 
            text-align: center; 
            padding: 20px;
            background: #f5f5f5;
            border-radius: 8px;
            margin: 20px 0;
        }}
        .footer {{ color: #666; font-size: 12px; margin-top: 20px; }}
    </style>
</head>
<body>
    <div class="container">
        <h2>BrowserFlow 邮箱验证</h2>
        <p>您的验证码是：</p>
        <div class="code">{code}</div>
        <p>此验证码将在 <strong>{expiry_minutes} 分钟</strong>后过期。</p>
        <p>如果您没有请求此验证码，请忽略此邮件。</p>
        <div class="footer">
            <p>BrowserFlow - 浏览器自动化工作流平台</p>
        </div>
    </div>
</body>
</html>
"""

    return send_email(to_email, subject, body, html_body)


def send_password_reset_email(
    to_email: str, reset_link: str, expiry_hours: int = 24
) -> bool:
    """
    发送密码重置邮件

    Args:
        to_email: 收件人邮箱
        reset_link: 重置链接
        expiry_hours: 过期时间（小时）

    Returns:
        bool: 是否发送成功
    """
    subject = "BrowserFlow 密码重置"

    body = f"""
您收到了密码重置请求。

请点击以下链接重置密码：
{reset_link}

此链接将在 {expiry_hours} 小时后过期。

如果您没有请求重置密码，请忽略此邮件。

BrowserFlow
"""

    html_body = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }}
        .container {{ max-width: 480px; margin: 0 auto; padding: 20px; }}
        .button {{
            display: inline-block;
            padding: 12px 24px;
            background: #007bff;
            color: white;
            text-decoration: none;
            border-radius: 6px;
            margin: 20px 0;
        }}
        .footer {{ color: #666; font-size: 12px; margin-top: 20px; }}
    </style>
</head>
<body>
    <div class="container">
        <h2>BrowserFlow 密码重置</h2>
        <p>您收到了密码重置请求。</p>
        <p>
            <a href="{reset_link}" class="button">重置密码</a>
        </p>
        <p>或复制以下链接到浏览器：</p>
        <p style="word-break: break-all; color: #666;">{reset_link}</p>
        <p>此链接将在 <strong>{expiry_hours} 小时</strong>后过期。</p>
        <p>如果您没有请求重置密码，请忽略此邮件。</p>
        <div class="footer">
            <p>BrowserFlow - 浏览器自动化工作流平台</p>
        </div>
    </div>
</body>
</html>
"""

    return send_email(to_email, subject, body, html_body)
