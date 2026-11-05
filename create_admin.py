
from getpass import getpass
from datetime import datetime, timezone

from pymongo.errors import DuplicateKeyError
from werkzeug.security import generate_password_hash

from config import users_collection


def create_admin():
    print("\n=== CivicFix AI: Create Admin Account ===\n")

    name = input("Admin name: ").strip()
    email = input("Admin email: ").strip().lower()
    password = getpass("Admin password (hidden): ")
    confirm_password = getpass("Confirm password: ")

    if not name or not email or not password:
        print("Error: All fields are required.")
        return

    if len(password) < 8:
        print("Error: Password must be at least 8 characters.")
        return

    if password != confirm_password:
        print("Error: Passwords do not match.")
        return

    # Prevent duplicate accounts across roles.
    existing = users_collection.find_one({"email": email})
    if existing:
        print(
            "Error: This email already exists in users. "
            "Choose another email."
        )
        return

    admin = {
        "name": name,
        "email": email,
        "password_hash": generate_password_hash(password),
        "role": "admin",
        "created_at": datetime.now(timezone.utc),
    }

    try:
        users_collection.insert_one(admin)
        print("\nAdmin account created successfully!")
        print(f"Email: {email}")
        print("Password: stored securely as a hash.")
        print("You can now use Administrator Access to log in.")

    except DuplicateKeyError:
        print("Error: An account with this email already exists.")
    except Exception as error:
        print(f"Could not create admin account: {error}")


if __name__ == "__main__":
    create_admin()
