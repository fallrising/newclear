FROM postgres:16-bookworm
# Source pinned; base OS packages float for security updates (not a bitwise lock).
RUN apt-get update && apt-get install -y --no-install-recommends \
    postgresql-plpython3-16 python3 git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN git init /tmp/pg-jev && cd /tmp/pg-jev \
    && git remote add origin https://github.com/realZachi/pg-jev.git \
    && git fetch --depth 1 origin 8d9598d87d5ff460998d91ec070226176024a841 \
    && git checkout --detach FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = 8d9598d87d5ff460998d91ec070226176024a841 \
    && cp jev.control sql/jev--0.2.1.sql /usr/share/postgresql/16/extension/ \
    && mkdir -p /usr/share/doc/pg-jev \
    && cp LICENSE /usr/share/doc/pg-jev/LICENSE \
    && rm -rf /tmp/pg-jev
WORKDIR /lab
COPY . /lab
ENV POSTGRES_HOST_AUTH_METHOD=trust
# Trust applies only to this disposable, network-disabled synthetic container.
ENTRYPOINT ["bash", "/lab/scripts/container-test.sh"]
