from __future__ import annotations

import os
from typing import Optional

BACKEND_DIR = os.path.dirname(os.path.dirname(__file__))
DATA_DIR = os.path.join(BACKEND_DIR, "data")
SCREENSHOTS_DIR = os.path.join(DATA_DIR, "screenshots")


def build_screenshot_dir(
    user_id: str,
    execution_id: str,
    node_id: Optional[str] = None,
) -> str:
    base_dir = os.path.join(SCREENSHOTS_DIR, user_id, execution_id)
    return os.path.join(base_dir, node_id) if node_id else base_dir


def build_legacy_screenshot_dir(
    execution_id: str,
    node_id: Optional[str] = None,
) -> str:
    base_dir = os.path.join(SCREENSHOTS_DIR, execution_id)
    return os.path.join(base_dir, node_id) if node_id else base_dir
