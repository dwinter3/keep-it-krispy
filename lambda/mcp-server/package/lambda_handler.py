"""Lambda handler for Keep It Krispy MCP Server.

This handler is designed to work with AWS Lambda Web Adapter (LWA)
which properly handles ASGI app lifespan for serverless.

Configure Lambda with:
- AWS_LWA_INVOKE_MODE=RESPONSE_STREAM
- AWS_LWA_PORT=8080
- Layer: arn:aws:lambda:<region>:753240598075:layer:LambdaAdapterLayerX86:24
"""

import os

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route, Mount

from server import mcp

# API key configuration
MCP_API_KEY = os.environ.get("MCP_API_KEY")
API_KEY_HEADER = "x-api-key"
AUTH_HEADER = "authorization"


class ApiKeyAuthMiddleware(BaseHTTPMiddleware):
    """Middleware to validate API key authentication."""

    async def dispatch(self, request: Request, call_next):
        # Skip auth for health check and OPTIONS
        if request.url.path == "/health" or request.method == "OPTIONS":
            return await call_next(request)

        # Check X-API-Key header (case-insensitive)
        api_key = request.headers.get(API_KEY_HEADER)

        # Fall back to Authorization: Bearer <key>
        if not api_key:
            auth_header = request.headers.get(AUTH_HEADER, "")
            if auth_header.lower().startswith("bearer "):
                api_key = auth_header[7:]

        # If no API key configured, allow all requests (dev mode)
        if not MCP_API_KEY:
            return await call_next(request)

        # Validate API key
        if api_key != MCP_API_KEY:
            return JSONResponse(
                {"error": "Invalid or missing API key"},
                status_code=401,
            )

        return await call_next(request)


async def health_check(request: Request) -> JSONResponse:
    """Health check endpoint."""
    return JSONResponse({
        "status": "healthy",
        "service": "krisp-mcp",
        "version": "1.0.0",
    })


# Create MCP app with stateless_http for Lambda compatibility
# path="/" since it's mounted at /mcp via Starlette Mount
mcp_app = mcp.http_app(path="/", stateless_http=True)

# Create combined app
app = Starlette(
    routes=[
        Route("/health", health_check, methods=["GET"]),
        Mount("/mcp", app=mcp_app),
    ],
    middleware=[
        Middleware(ApiKeyAuthMiddleware),
    ],
    lifespan=mcp_app.lifespan,
)


# Placeholder handler for direct Lambda invocations (not used when Web Adapter is active)
def handler(event, context):
    """Fallback handler - Web Adapter should intercept Function URL requests."""
    return {
        "statusCode": 200,
        "body": '{"message": "Use Function URL for MCP requests"}'
    }


# For Lambda Web Adapter - this file should be run with uvicorn
# The adapter will start: uvicorn lambda_handler:app --host 0.0.0.0 --port 8080
if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("AWS_LWA_PORT", "8080"))
    uvicorn.run(app, host="0.0.0.0", port=port)
