#!/usr/bin/env python3
"""临时本地 HTTP 服务，用于测试模板 URL 功能。"""

from __future__ import annotations

import argparse
import http.server
import os
import socketserver
from pathlib import Path


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
DEFAULT_DIRECTORY = "templates"


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="启动一个临时静态 HTTP 服务，用于测试 templates URL"
    )
    parser.add_argument("--host", default=DEFAULT_HOST, help="监听地址")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="监听端口")
    parser.add_argument(
        "--dir",
        default=DEFAULT_DIRECTORY,
        help="要暴露的目录，默认是项目根目录下的 templates",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    root = Path(__file__).resolve().parent
    directory = Path(args.dir)
    if not directory.is_absolute():
        directory = root / directory
    directory = directory.resolve()

    if not directory.exists() or not directory.is_dir():
        raise SystemExit(f"目录不存在: {directory}")

    handler = lambda *handler_args, **handler_kwargs: http.server.SimpleHTTPRequestHandler(  # noqa: E731
        *handler_args,
        directory=os.fspath(directory),
        **handler_kwargs,
    )

    with ReusableTCPServer((args.host, args.port), handler) as httpd:
        print(f"Serving {directory}")
        print(f"Index URL: http://{args.host}:{args.port}/index.json")
        print("Press Ctrl+C to stop")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped")


if __name__ == "__main__":
    main()
