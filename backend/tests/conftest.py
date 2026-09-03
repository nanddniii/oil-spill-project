"""
Ensures `backend/` is on sys.path so tests can use the same import style
as main.py (e.g. `from services.drift_service import estimate_origin`),
regardless of the directory pytest is invoked from.
"""
import os
import sys

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)
