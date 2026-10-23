# Build context contains only an official, already installed Cursor Agent version
# directory named cursor-agent/. Never copy ~/.cursor or any login state here.
ARG BASE_IMAGE=debian:bookworm-slim
FROM ${BASE_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends bash ca-certificates libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /home/cursor /workspace && chown 1000:1000 /home/cursor /workspace
COPY cursor-agent/ /opt/cursor-agent/
ENV PATH="/opt/cursor-agent:${PATH}" HOME=/home/cursor
USER 1000:1000
WORKDIR /workspace
ENTRYPOINT ["cursor-agent"]
