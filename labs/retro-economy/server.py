#!/usr/bin/env python3
"""Run the local RE-1 demonstration with Python 3.11 or later."""
import argparse
from pathlib import Path

from retro.http import make_server


def main():
    parser = argparse.ArgumentParser(description="霧岸鎮 RE-1 本機示範；不是正式登入服務")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--db", default=str(Path(__file__).resolve().parent / "var" / "retro-economy.sqlite3"))
    args = parser.parse_args()
    with make_server(args.host, args.port, args.db) as server:
        print(f"http://{args.host}:{server.server_port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
