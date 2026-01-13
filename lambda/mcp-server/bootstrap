#!/bin/bash
exec /var/lang/bin/python3.11 -m uvicorn lambda_handler:app --host 0.0.0.0 --port ${AWS_LWA_PORT:-8080}
