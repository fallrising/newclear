# The tag is descriptive; the verified manifest digest is the base boundary.
FROM python:3.11-slim@sha256:db3ff2e1800a8581e2c48a27c3995339d47bdf046da21c7627accd3d51053a93

LABEL org.opencontainers.image.title="ice-maker document service" \
      org.opencontainers.image.licenses="MIT AND GPL-2.0-or-later AND Apache-2.0 AND HPND AND BSD-3-Clause" \
      org.opencontainers.image.vendor="ice-maker" \
      org.opencontainers.image.base.digest="sha256:db3ff2e1800a8581e2c48a27c3995339d47bdf046da21c7627accd3d51053a93" \
      org.opencontainers.image.toolchain="poppler-utils=25.03.0-5+deb13u4;tesseract-ocr=5.5.0-1+b1;tesseract-ocr-eng=1:4.1.0-2;tesseract-ocr-chi-tra=1:4.1.0-2"

ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONHASHSEED=0

RUN set -eux; \
    sed -i \
      -e 's|URIs: http://deb.debian.org/debian$|URIs: https://snapshot.debian.org/archive/debian/20260713T000000Z|' \
      -e 's|URIs: http://deb.debian.org/debian-security$|URIs: https://snapshot.debian.org/archive/debian-security/20260713T000000Z|' \
      /etc/apt/sources.list.d/debian.sources; \
    apt-get -o Acquire::Check-Valid-Until=false update; \
    apt-get install --no-install-recommends -y \
      'poppler-utils=25.03.0-5+deb13u4' \
      'tesseract-ocr=5.5.0-1+b1' \
      'tesseract-ocr-eng=1:4.1.0-2' \
      'tesseract-ocr-chi-tra=1:4.1.0-2'; \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/*

WORKDIR /opt/ice-maker
COPY pyproject.toml ./
COPY src ./src
COPY config/document-ingestion.json ./config/document-ingestion.json
COPY knowledge/90-meta/taxonomy.yaml ./knowledge/90-meta/taxonomy.yaml
COPY scripts/loopback-uds-proxy.py ./scripts/loopback-uds-proxy.py
RUN set -eux; \
    python -m pip install --no-cache-dir --disable-pip-version-check \
      'annotated-doc==0.0.5' \
      'annotated-types==0.8.0' \
      'anyio==4.15.0' \
      'click==8.5.0' \
      'fastapi==0.141.1' \
      'h11==0.16.0' \
      'idna==3.19' \
      'packaging==26.2' \
      'Pillow==12.3.0' \
      'pydantic==2.13.5' \
      'pydantic_core==2.46.5' \
      'python-multipart==0.0.32' \
      'starlette==1.6.0' \
      'typing-inspection==0.4.4' \
      'typing_extensions==4.16.0' \
      'uvicorn==0.52.4'; \
    python -m pip install --no-cache-dir --disable-pip-version-check --no-deps .; \
    python -m pip check; \
    find /opt/ice-maker -type d -name __pycache__ -prune -exec rm -rf {} +; \
    find /opt/ice-maker -type d -exec chmod 0555 {} +; \
    find /opt/ice-maker -type f -exec chmod 0444 {} +; \
    groupadd --gid 65532 app; \
    useradd --uid 65532 --gid 65532 --no-create-home --shell /usr/sbin/nologin app

USER 65532:65532
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import http.client,socket; s=socket.socket(socket.AF_UNIX); s.settimeout(2); s.connect('/data/.document-service-runtime/service.sock'); s.sendall(b'GET /healthz HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n'); r=http.client.HTTPResponse(s); r.begin(); raise SystemExit(0 if r.status==200 and r.read()==b'{\"status\":\"ok\"}' else 1)"]
ENTRYPOINT ["document-service"]
CMD ["--state-root", "/data/state", "--config", "/opt/ice-maker/config/document-ingestion.json", "--uds", "/data/.document-service-runtime/service.sock", "--pdfinfo", "/usr/bin/pdfinfo", "--pdftotext", "/usr/bin/pdftotext", "--pdftoppm", "/usr/bin/pdftoppm", "--tesseract", "/usr/bin/tesseract", "--poppler-version", "25.03.0", "--tesseract-version", "5.5.0", "--installed-language", "chi_tra", "--installed-language", "eng"]
