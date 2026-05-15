#!/bin/sh
set -eu
python3 /tls_tcp_echo.py 6514 &
exec python3 /tcp_udp_echo.py
