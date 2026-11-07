import os
from pathlib import Path

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"


def load_env():
    """Load KEY=VALUE lines from .env into os.environ without overriding what's already set."""
    try:
        lines = ENV_PATH.read_text().splitlines()
    except OSError:
        return
    for line in lines:
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
