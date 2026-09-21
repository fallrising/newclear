# This is a VM rootfs: sandbox's kernel/init/systemd/silkd remain in the base.
FROM ghcr.io/openhands/agent-server@sha256:8d015443e480ce5fa0f6f0b21b8031d5b2115840805e28eac89f5d82799ea51b AS agent
FROM ghcr.io/cocoonstack/sandbox/python@sha256:a70b7cd6828a9438ba9f346352f701ef3877254e8aef881fdd548ce56a5d0c1c
USER root
COPY --from=agent /usr/local/bin/openhands-agent-server /usr/local/bin/openhands-agent-server
RUN useradd --create-home --uid 2000 --shell /bin/bash agentprobe
ENV OPENHANDS_BUILD_GIT_SHA=856d99d48e4b11c70c5f1cab21e7830570dbc324
ENV HOME=/home/agentprobe
WORKDIR /home/agentprobe
CMD ["/sbin/init"]
