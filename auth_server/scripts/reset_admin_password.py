import sys
import os
import argparse

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import SessionLocal
from models import User
from auth_utils import get_password_hash

def reset_password(email: str, new_password: str):
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        if not user:
            print(f"User with email '{email}' not found.")
            return False
        
        user.hashed_password = get_password_hash(new_password)
        db.commit()
        print(f"Successfully updated password for user '{email}'.")
        return True
    except Exception as e:
        print(f"Error resetting password: {e}")
        db.rollback()
        return False
    finally:
        db.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Reset user password in Auth Server")
    parser.add_argument("--email", required=True, help="User email address")
    parser.add_argument("--password", required=True, help="New password")
    
    args = parser.parse_args()
    reset_password(args.email, args.password)
