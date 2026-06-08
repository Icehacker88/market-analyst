from __future__ import annotations

import os
import smtplib
from email.message import EmailMessage
from pathlib import Path


def send_report_email(
    report_path: Path,
    subject: str,
    recipients: list[str] | None = None,
) -> tuple[bool, str]:
    recipients = recipients or _env_recipients()
    if not recipients:
        return False, "未配置收件人，跳过邮件发送。"

    smtp_host = os.getenv("SMTP_HOST")
    smtp_user = os.getenv("SMTP_USER")
    smtp_password = os.getenv("SMTP_PASSWORD")
    smtp_from = os.getenv("SMTP_FROM") or smtp_user
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    if not smtp_host or not smtp_user or not smtp_password or not smtp_from:
        return False, "SMTP_HOST/SMTP_USER/SMTP_PASSWORD/SMTP_FROM 未完整配置，跳过邮件发送。"

    body = report_path.read_text(encoding="utf-8")
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = smtp_from
    message["To"] = ", ".join(recipients)
    message.set_content(body)
    message.add_attachment(
        body.encode("utf-8"),
        maintype="text",
        subtype="markdown",
        filename=report_path.name,
    )

    try:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=30) as server:
            server.starttls()
            server.login(smtp_user, smtp_password)
            server.send_message(message)
    except Exception as exc:
        return False, f"邮件发送失败：{exc}"
    return True, f"邮件已发送至：{', '.join(recipients)}"


def _env_recipients() -> list[str]:
    raw = os.getenv("REPORT_EMAIL_TO", "")
    return [item.strip() for item in raw.replace(";", ",").split(",") if item.strip()]
