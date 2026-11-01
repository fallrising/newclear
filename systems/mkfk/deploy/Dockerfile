# Built by `make image` from a context holding only the static broker
# binary, the Compose topology, and an empty data directory. No base image
# is pulled; the broker runs as an unprivileged user and writes only to the
# named volume mounted at /data.
FROM scratch
COPY --chown=65532:65532 data /data
COPY cluster.json /etc/mkfk/cluster.json
COPY mkfk /usr/local/bin/mkfk
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/mkfk"]
