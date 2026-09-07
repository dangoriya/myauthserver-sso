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
        elif provider == "smtp" and settings.SMTP_HOST and settings.SMTP_USER and settings.SMTP_PASSWORD:
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
                    error_msg = f"Brevo API email failed ({res.status_code}): {res.text}"
                    logger.error(f"❌ {error_msg}")
                    raise RuntimeError(error_msg)
        except Exception as e:
            error_msg = f"Error sending email via Brevo API: {e}"
            logger.error(f"❌ {error_msg}")
            raise RuntimeError(error_msg) from e

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
            if settings.SMTP_USE_SSL:
                server = smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10.0)
            else:
                server = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10.0)
                server.ehlo()
                if settings.SMTP_USE_TLS:
                    server.starttls()
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.sendmail(settings.EMAIL_FROM, [to_email], msg.as_string())
            server.quit()
            logger.info(f"✅ SMTP email sent successfully to {to_email}")
            return True
        except Exception as e:
            error_msg = f"Error sending email via SMTP: {e}"
            logger.error(f"❌ {error_msg}")
            raise RuntimeError(error_msg) from e

    @staticmethod
    def _header(title: str, title_color: str, subtitle: str, url: str = None) -> str:
        """Shared email header: a title, the IAM portal URL on a small dim line,
        and a subtitle. Tightened line-height so the header lines are not spread apart."""
        url_line = (
            f'<p style="color: #64748b; font-size: 11px; margin: 2px 0; line-height: 1.2;">{url}</p>'
            if url else ''
        )
        return (
            '<div style="text-align: center; margin-bottom: 20px; line-height: 1.3;">'
            f'<h1 style="color: {title_color}; margin: 0; font-size: 22px; line-height: 1.2;">{title}</h1>'
            f'{url_line}'
            f'<p style="color: #94a3b8; font-size: 14px; margin: 0; line-height: 1.3;">{subtitle}</p>'
            '</div>'
        )

    @staticmethod
    def send_signup_verification_code(to_email: str, name: str, code: str) -> bool:
        subject = f"{code} is your IAM Auth Email Verification Code"
        body_html = f"""
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; background-color: #0f172a; border-radius: 16px; color: #f8fafc;">
            {EmailService._header("IAM Auth Server", "#10b981", "Identity & Access Control System", settings.MANAGEMENT_URL)}
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
    def send_account_created_notification(to_email: str, name: str) -> bool:
        """Welcome notification sent after a user successfully completes signup
        (after 2FA setup or skip). Includes the IAM portal URL to sign in."""
        subject = "Your IAM account was created successfully"
        body_html = f"""
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; background-color: #0f172a; border-radius: 16px; color: #f8fafc;">
            {EmailService._header("IAM Auth Server", "#10b981", "Your account is ready", settings.MANAGEMENT_URL)}
            <div style="background-color: #1e293b; padding: 20px; border-radius: 12px; border: 1px solid #334155;">
                <p style="margin-top: 0; color: #cbd5e1;">Hi {name or 'User'},</p>
                <p style="color: #94a3b8;">Your IAM account has been successfully created. You can now sign in to the IAM Portal using your email and password.</p>
                <p style="color: #94a3b8;">If you enabled Two-Factor Authentication, have your authenticator app ready on your next login.</p>
                <div style="text-align: center; margin: 24px 0;">
                    <a href="{settings.MANAGEMENT_URL.rstrip('/')}" style="display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #10b981, #14b8a6); color: #0f172a; font-weight: 700; text-decoration: none; border-radius: 10px;">Go to IAM Portal</a>
                </div>
                <p style="color: #64748b; font-size: 12px; margin-bottom: 0;">Secured by IAM Central Auth.</p>
            </div>
        </div>
        """
        return EmailService.send_email(to_email, subject, body_html)

    @staticmethod
    def send_2fa_reset_otp(to_email: str, name: str, code: str) -> bool:
        subject = f"{code} - Security Verification OTP to Reset 2FA"
        body_html = f"""
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; background-color: #0f172a; border-radius: 16px; color: #f8fafc;">
            {EmailService._header("IAM 2FA Security Reset", "#f59e0b", "Two-Factor Authentication Security OTP", settings.MANAGEMENT_URL)}
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
            {EmailService._header("IAM Security Alert", "#38bdf8", "Password Reset Verification Code", settings.MANAGEMENT_URL)}
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
    def send_password_reset_link(to_email: str, name: str, reset_link: str) -> bool:
        """Sends a password-reset *link* (tokenised URL) for the unauthenticated
        'forgot password' flow. The link points at the auth server's reset page."""
        subject = "IAM Auth Server — Password Reset Request"
        body_html = f"""
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; background-color: #0f172a; border-radius: 16px; color: #f8fafc;">
            {EmailService._header("IAM Security Alert", "#38bdf8", "Password Reset Request", settings.MANAGEMENT_URL)}
            <div style="background-color: #1e293b; padding: 20px; border-radius: 12px; border: 1px solid #334155;">
                <p style="margin-top: 0; color: #cbd5e1;">Hello {name or 'User'},</p>
                <p style="color: #94a3b8;">You (or someone claiming your account) requested a password reset. Click the button below to choose a new password. This link expires in 10 minutes.</p>
                <div style="text-align: center; margin: 24px 0;">
                    <a href="{reset_link}" style="display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #38bdf8, #06b6d4); color: #0f172a; font-weight: 700; text-decoration: none; border-radius: 10px;">Reset My Password</a>
                </div>
                <p style="color: #64748b; font-size: 12px; margin-top: 0;">If the button above doesn't work, copy and paste this URL into your browser:</p>
                <p style="color: #38bdf8; font-size: 11px; word-break: break-all; margin-top: 4px;">{reset_link}</p>
                <p style="color: #ef4444; font-size: 12px; margin-top: 16px; margin-bottom: 0;">⚠️ If you did not request this, ignore this email. Your password will not change.</p>
            </div>
        </div>
        """
        return EmailService.send_email(to_email, subject, body_html)

    @staticmethod
    def send_2fa_disable_otp(to_email: str, name: str, code: str) -> bool:
        subject = f"{code} - Verification Code to Disable 2FA Security"
        body_html = f"""
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; background-color: #0f172a; border-radius: 16px; color: #f8fafc;">
            {EmailService._header("IAM Security Alert", "#f43f5e", "Disable Two-Factor Authentication", settings.MANAGEMENT_URL)}
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
