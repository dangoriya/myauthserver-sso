import smtplib
import logging
import httpx
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from config import settings

logger = logging.getLogger(__name__)

class EmailService:
    @staticmethod
    def send_email(to_email: str, subject: str, body_html: str, body_text: str = None) -> bool:
        """
        Generic email dispatcher that supports both Brevo REST API and standard SMTP
        based on EMAIL_PROVIDER setting ("brevo_api" or "smtp").
        """
        provider = (settings.EMAIL_PROVIDER or "smtp").lower()

        if provider == "brevo_api" and settings.BREVO_API_KEY:
            return EmailService._send_via_brevo_api(to_email, subject, body_html)
        elif settings.SMTP_HOST and settings.SMTP_USER and settings.SMTP_PASSWORD:
            return EmailService._send_via_smtp(to_email, subject, body_html, body_text)
        else:
            # Development fallback logging if no credentials set
            logger.info("================ EMAIL DEV FALLBACK ================")
            logger.info(f"To: {to_email}")
            logger.info(f"Subject: {subject}")
            logger.info(f"HTML Content: {body_html}")
            logger.info("====================================================")
            print(f"📧 [DEV EMAIL] To: {to_email} | Subject: {subject}\n{body_html}")
            return True

    @staticmethod
    def _send_via_brevo_api(to_email: str, subject: str, body_html: str) -> bool:
        url = "https://api.brevo.com/v3/smtp/email"
        headers = {
            "accept": "application/json",
            "api-key": settings.BREVO_API_KEY,
            "content-type": "application/json"
        }
        payload = {
            "sender": {
                "name": settings.EMAIL_FROM_NAME or "IAM Security Team",
                "email": settings.EMAIL_FROM or "no-reply@myauth.local"
            },
            "to": [{"email": to_email}],
            "subject": subject,
            "htmlContent": body_html
        }
        try:
            with httpx.Client(timeout=10.0) as client:
                res = client.post(url, json=payload, headers=headers)
                if res.status_code in (200, 201, 202):
                    logger.info(f"✅ Brevo API email sent successfully to {to_email}")
                    return True
                else:
                    logger.error(f"❌ Brevo API Email failed ({res.status_code}): {res.text}")
                    return False
        except Exception as e:
            logger.error(f"❌ Error sending email via Brevo API: {e}")
            return False

    @staticmethod
    def _send_via_smtp(to_email: str, subject: str, body_html: str, body_text: str = None) -> bool:
        msg = MIMEMultipart("alternative")
        msg["From"] = f"{settings.EMAIL_FROM_NAME} <{settings.EMAIL_FROM}>"
        msg["To"] = to_email
        msg["Subject"] = subject

        if body_text:
            msg.attach(MIMEText(body_text, "plain"))
        msg.attach(MIMEText(body_html, "html"))

        try:
            server = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10.0)
            if settings.SMTP_USE_TLS:
                server.starttls()
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.sendmail(settings.EMAIL_FROM, [to_email], msg.as_string())
            server.quit()
            logger.info(f"✅ SMTP email sent successfully to {to_email}")
            return True
        except Exception as e:
            logger.error(f"❌ Error sending email via SMTP: {e}")
            return False

    @staticmethod
    def send_signup_verification_code(to_email: str, name: str, code: str) -> bool:
        subject = f"{code} is your IAM Auth Email Verification Code"
        body_html = f"""
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; background-color: #0f172a; border-radius: 16px; color: #f8fafc;">
            <div style="text-align: center; margin-bottom: 20px;">
                <h1 style="color: #10b981; margin: 0;">IAM Auth Server</h1>
                <p style="color: #94a3b8; font-size: 14px;">Identity & Access Control System</p>
            </div>
            <div style="background-color: #1e293b; padding: 20px; border-radius: 12px; border: 1px solid #334155;">
                <p style="margin-top: 0; color: #cbd5e1;">Hi {name or 'User'},</p>
                <p style="color: #94a3b8;">Use the verification code below to complete your registration:</p>
                <div style="text-align: center; margin: 24px 0;">
                    <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #34d399; font-family: monospace; background: #090d16; padding: 12px 24px; border-radius: 8px; border: 1px dashed #059669;">
                        {code}
                    </span>
                </div>
                <p style="color: #64748b; font-size: 12px; margin-bottom: 0;">This code will expire in 10 minutes. If you did not request this code, please ignore this email.</p>
            </div>
        </div>
        """
        return EmailService.send_email(to_email, subject, body_html)

    @staticmethod
    def send_2fa_reset_otp(to_email: str, name: str, code: str) -> bool:
        subject = f"{code} - Security Verification OTP to Reset 2FA"
        body_html = f"""
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; background-color: #0f172a; border-radius: 16px; color: #f8fafc;">
            <div style="text-align: center; margin-bottom: 20px;">
                <h1 style="color: #f59e0b; margin: 0;">IAM 2FA Security Reset</h1>
                <p style="color: #94a3b8; font-size: 14px;">Two-Factor Authentication Security OTP</p>
            </div>
            <div style="background-color: #1e293b; padding: 20px; border-radius: 12px; border: 1px solid #334155;">
                <p style="margin-top: 0; color: #cbd5e1;">Hello {name or 'User'},</p>
                <p style="color: #94a3b8;">You requested to reset your Two-Factor Authentication (2FA) key. Enter this verification code in your Profile settings to generate a new 2FA secret:</p>
                <div style="text-align: center; margin: 24px 0;">
                    <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #fbbf24; font-family: monospace; background: #090d16; padding: 12px 24px; border-radius: 8px; border: 1px dashed #d97706;">
                        {code}
                    </span>
                </div>
                <p style="color: #ef4444; font-size: 12px; margin-bottom: 0;">⚠️ Security Notice: Do not share this code with anyone. It expires in 10 minutes.</p>
            </div>
        </div>
        """
        return EmailService.send_email(to_email, subject, body_html)

    @staticmethod
    def send_password_reset_otp(to_email: str, name: str, code: str) -> bool:
        subject = f"{code} - Verification Code to Reset Password"
        body_html = f"""
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; background-color: #0f172a; border-radius: 16px; color: #f8fafc;">
            <div style="text-align: center; margin-bottom: 20px;">
                <h1 style="color: #38bdf8; margin: 0;">IAM Security Alert</h1>
                <p style="color: #94a3b8; font-size: 14px;">Password Reset Verification Code</p>
            </div>
            <div style="background-color: #1e293b; padding: 20px; border-radius: 12px; border: 1px solid #334155;">
                <p style="margin-top: 0; color: #cbd5e1;">Hello {name or 'User'},</p>
                <p style="color: #94a3b8;">You requested to reset your password. Use the 6-digit verification code below to authorize setting a new password:</p>
                <div style="text-align: center; margin: 24px 0;">
                    <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #38bdf8; font-family: monospace; background: #090d16; padding: 12px 24px; border-radius: 8px; border: 1px dashed #0284c7;">
                        {code}
                    </span>
                </div>
                <p style="color: #ef4444; font-size: 12px; margin-bottom: 0;">⚠️ Security Notice: Do not share this code with anyone. It expires in 10 minutes.</p>
            </div>
        </div>
        """
        return EmailService.send_email(to_email, subject, body_html)

    @staticmethod
    def send_2fa_disable_otp(to_email: str, name: str, code: str) -> bool:
        subject = f"{code} - Verification Code to Disable 2FA Security"
        body_html = f"""
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; background-color: #0f172a; border-radius: 16px; color: #f8fafc;">
            <div style="text-align: center; margin-bottom: 20px;">
                <h1 style="color: #f43f5e; margin: 0;">IAM Security Alert</h1>
                <p style="color: #94a3b8; font-size: 14px;">Disable Two-Factor Authentication</p>
            </div>
            <div style="background-color: #1e293b; padding: 20px; border-radius: 12px; border: 1px solid #334155;">
                <p style="margin-top: 0; color: #cbd5e1;">Hello {name or 'User'},</p>
                <p style="color: #94a3b8;">You requested to disable Two-Factor Authentication on your account. Enter this 6-digit security code to confirm:</p>
                <div style="text-align: center; margin: 24px 0;">
                    <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #fb7185; font-family: monospace; background: #090d16; padding: 12px 24px; border-radius: 8px; border: 1px dashed #e11d48;">
                        {code}
                    </span>
                </div>
                <p style="color: #ef4444; font-size: 12px; margin-bottom: 0;">⚠️ Warning: Disabling 2FA will lower your account security. Code expires in 10 minutes.</p>
            </div>
        </div>
        """
        return EmailService.send_email(to_email, subject, body_html)

