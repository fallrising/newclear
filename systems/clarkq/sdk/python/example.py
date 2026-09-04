#!/usr/bin/env python3
"""Example: python sdk/python/example.py"""

import os
import sys

# Allow running without install.
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

from clarkq import Client


def main() -> None:
    client = Client(
        os.environ.get("CLARKQ_URL", "http://localhost:8080"),
        api_key=os.environ.get("CLARKQ_API_KEY", ""),
    )
    client.health()
    res = client.enqueue("sdk-demo", "hello from python sdk", metadata={"lang": "python"})
    print("enqueued", res)
    msg = client.dequeue("sdk-demo", timeout=2)
    print("dequeued", msg)


if __name__ == "__main__":
    main()
