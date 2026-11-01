# Official multi-platform index verified against registry-1.docker.io.
FROM golang:1.26.8-bookworm@sha256:dc9ad6c05acc7a88e5b71bde60a5fe3bd4b9f0db209011711b464107438a8107 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY web/embed.go ./web/embed.go
COPY web/dist/ ./web/dist/
RUN CGO_ENABLED=0 go build -tags timetzdata -trimpath -ldflags='-s -w' -o /signalhub ./cmd/signalhub

FROM scratch
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /signalhub /signalhub
USER 65532:65532
ENTRYPOINT ["/signalhub"]
