# Forwarding script for backward compatibility (init_admin.py has been renamed to migrate_db.py)
from migrate_db import run_migrations, argparse

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="IAM Auth Server Database Migration Script")
    parser.add_argument("--reset", "--fresh", action="store_true", help="Drop all existing tables and re-create fresh schema")
    args = parser.parse_args()
    run_migrations(reset=args.reset)
