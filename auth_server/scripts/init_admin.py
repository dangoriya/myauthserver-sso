import sys
import os
import argparse

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import engine, SessionLocal, Base
from models import User, GoogleSetting, ClientApp
from auth_utils import get_password_hash
from config import settings

def init_db():
    print("Creating DB tables if not exist...")
    Base.metadata.create_all(bind=engine)
    
    db = SessionLocal()
    try:
        # Create default admin user if missing
        admin = db.query(User).filter(User.email == "admin@example.com").first()
        if not admin:
            admin = User(
                email="admin@example.com",
                name="System Administrator",
                hashed_password=get_password_hash("admin123"),
                is_admin=True,
                is_active=True,
                provider="local"
            )
            db.add(admin)
            print("Default admin created: admin@example.com / admin123")
        
        # Init Google settings row
        g_setting = db.query(GoogleSetting).filter(GoogleSetting.id == 1).first()
        if not g_setting:
            g_setting = GoogleSetting(
                id=1,
                client_id="",
                client_secret="",
                redirect_uri="http://localhost:8000/auth/google/callback",
                is_enabled=False
            )
            db.add(g_setting)
            print("Google Setting initialized.")
            
        # Create default test client app if missing
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
            print("Default Client App created: test_client_id_1 / test_client_secret_1")

        db.commit()
    except Exception as e:
        print(f"Error during init_db: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    init_db()
