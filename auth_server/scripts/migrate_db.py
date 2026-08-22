import sys
import os
import argparse

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import engine, SessionLocal, Base
from models import User, Role, GoogleSetting, ClientApp
from auth_utils import get_password_hash
from config import settings

def run_migrations(reset: bool = False):
    # Check env var for reset if not set by argument
    if not reset:
        reset = os.getenv("RESET_DB", "false").lower() in ("true", "1", "yes")

    if reset:
        print("⚠️ [MIGRATION] Resetting Database: Dropping all existing tables...")
        Base.metadata.drop_all(bind=engine)

    print("🚀 [MIGRATION] Creating database tables if not exist...")
    Base.metadata.create_all(bind=engine)
    
    db = SessionLocal()
    try:
        # Seed Master Roles (guest role deleted as requested)
        default_roles = [
            {"name": "normal-user", "label": "User", "description": "Standard authenticated user.", "sort_order": 1},
            {"name": "admin", "label": "Admin", "description": "Full access including admin-only features.", "sort_order": 2},
        ]
        role_map = {}
        for r_data in default_roles:
            r_obj = db.query(Role).filter(Role.name == r_data["name"]).first()
            if not r_obj:
                r_obj = Role(**r_data)
                db.add(r_obj)
                db.flush()
                print(f"  ✅ Role seeded: {r_data['name']}")
            role_map[r_data["name"]] = r_obj

        # Delete any legacy 'guest' role if present in existing DB
        guest_role = db.query(Role).filter(Role.name == "guest").first()
        if guest_role:
            # Reassign any guest users to normal-user
            normal_role = role_map.get("normal-user")
            guest_users = db.query(User).filter(User.role == "guest").all()
            for u in guest_users:
                u.role = "normal-user"
                if normal_role:
                    u.role_id = normal_role.id
            db.delete(guest_role)
            print("  🗑️ Legacy 'guest' role deleted and associated users migrated to 'normal-user'.")

        # Seed Default Admin User
        admin = db.query(User).filter(User.email == "admin@example.com").first()
        if not admin:
            admin_role = role_map.get("admin")
            admin = User(
                email="admin@example.com",
                name="System Administrator",
                hashed_password=get_password_hash("admin123"),
                role="admin",
                role_id=admin_role.id if admin_role else None,
                is_admin=True,
                is_active=True,
                provider="local"
            )
            db.add(admin)
            print("  ✅ Default Admin created: admin@example.com / admin123")
        
        # Seed Default Google Setting
        g_setting = db.query(GoogleSetting).filter(GoogleSetting.id == 1).first()
        if not g_setting:
            g_setting = GoogleSetting(
                id=1,
                client_id="",
                client_secret="",
                redirect_uri="http://localhost:8000/auth/google/callback",
                is_enabled=False,
                enforce_2fa_all=False
            )
            db.add(g_setting)
            print("  ✅ Google Setting initialized.")
            
        # Seed Default Client SSO Applications
        default_client = db.query(ClientApp).filter(ClientApp.client_id == "test_client_id_1").first()
        if not default_client:
            default_client = ClientApp(
                client_id="test_client_id_1",
                client_secret="test_client_secret_1",
                client_name="Test App 1",
                redirect_uris="http://localhost:3001/callback",
                allowed_grant_types="authorization_code",
                is_sso_enabled=True
            )
            db.add(default_client)
            print("  ✅ Default Client App created: test_client_id_1 / test_client_secret_1")

        # Seed Auth Server Management Client App
        management_redirect_uri = f"{settings.MANAGEMENT_URL.rstrip('/')}/auth/callback"
        mgmt_client = db.query(ClientApp).filter(ClientApp.client_id == "auth_management_app").first()
        if not mgmt_client:
            mgmt_client = ClientApp(
                client_id="auth_management_app",
                client_secret="auth_management_secret",
                client_name="Auth Server Management",
                redirect_uris=f"{management_redirect_uri},{settings.MANAGEMENT_URL.rstrip('/')}",
                allowed_grant_types="authorization_code",
                is_sso_enabled=True
            )
            db.add(mgmt_client)
            print(f"  ✅ Auth Server Management App registered: auth_management_app ({management_redirect_uri})")

        db.commit()
        print("🎉 [MIGRATION] Database schema & master data setup completed successfully!")
    except Exception as e:
        print(f"❌ [MIGRATION] Error during migration: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="IAM Auth Server Database Migration & Seeding Script")
    parser.add_argument("--reset", "--fresh", action="store_true", help="Drop all existing tables and re-create fresh schema")
    args = parser.parse_args()
    
    run_migrations(reset=args.reset)
