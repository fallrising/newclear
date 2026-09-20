from __future__ import annotations

from PIL import Image

from .backends.registry import load_backend
from .config import Settings


def main() -> None:
    settings = Settings.from_env()
    backend = load_backend(settings)
    backend.recognize(Image.new("RGB", (64, 32), "white"))
    print(f"warmed {backend.name} {backend.model}")


if __name__ == "__main__":
    main()
