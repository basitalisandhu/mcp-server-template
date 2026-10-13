# syntax=docker/dockerfile:1.7
# Base image pinned by digest (python:3.12-slim, multi-arch manifest list, resolved on 2026-10-03).
# Update the tag and digest together: docker buildx imagetools inspect python:3.12-slim
FROM python:3.14-slim@sha256:f85c5697265c178cc6887276c55fe16cf3d14ca35c3df6a5eab3b360534a55d2 AS build
WORKDIR /app
COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install --no-cache-dir --upgrade pip && pip wheel --no-cache-dir --wheel-dir /wheels .

FROM python:3.14-slim@sha256:f85c5697265c178cc6887276c55fe16cf3d14ca35c3df6a5eab3b360534a55d2
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN groupadd --system mcp && useradd --system --gid mcp --home-dir /app --shell /usr/sbin/nologin mcp
WORKDIR /app
COPY --from=build /wheels /wheels
RUN pip install --no-cache-dir /wheels/*.whl && rm -rf /wheels
USER mcp
# stdio is the default transport. Set MCP_TRANSPORT=http and MCP_AUTH_TOKEN to expose HTTP; the
# HTTP transport binds to 127.0.0.1 unless MCP_HOST says otherwise.
EXPOSE 3000
ENTRYPOINT ["secure-mcp-server"]
