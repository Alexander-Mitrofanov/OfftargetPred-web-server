#!/usr/bin/env python3
"""Run real API acceptance through loopback Nginx using PROXY protocol v2.

Run on the backend VM with no active jobs. The documentation-only address
192.0.2.123 represents the original client and exercises trusted forwarding.
No public listener or Tailscale connection is created by this check.
"""
import http.client
import socket
import struct
import sys
from unittest.mock import patch

import smoke_api


def main():
    original_connect = http.client.HTTPConnection.connect

    def proxy_connect(connection):
        if connection.host != "127.0.0.1" or connection.port != 8082:
            raise RuntimeError("This check only connects to loopback Nginx:8082.")
        original_connect(connection)
        addresses = (
            socket.inet_aton("192.0.2.123")
            + socket.inet_aton("127.0.0.1")
            + struct.pack("!HH", 54321, 443)
        )
        header = b"\r\n\r\n\x00\r\nQUIT\n" + struct.pack("!BBH", 0x21, 0x11, len(addresses))
        connection.sock.sendall(header + addresses)

    with patch.object(http.client.HTTPConnection, "connect", proxy_connect):
        with patch.object(sys, "argv", ["smoke_api.py", "--api-origin", "http://127.0.0.1:8082"]):
            return smoke_api.main()


if __name__ == "__main__":
    raise SystemExit(main())
