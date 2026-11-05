
import os
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient

# Load the .env file beside config.py
BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

MONGO_URI = os.getenv("MONGO_URI", "").strip()

if not MONGO_URI:
    raise RuntimeError(
        "MONGO_URI is missing. Check Backend/.env."
    )

# MongoDB Atlas connection
client = MongoClient(
    MONGO_URI,
    serverSelectionTimeoutMS=15000,
)

# CivicFix database
db = client["civicfix"]

# Database collections
users_collection = db["users"]
reports_collection = db["reports"]
departments_collection = db["departments"]


def test_database_connection():
    """Verify that MongoDB Atlas is reachable."""
    client.admin.command("ping")
    return True
