# Build
FROM golang:1.22-alpine AS build
WORKDIR /src

ARG VERSION=1.0.0
ARG COMMIT=unknown
ARG DATE=unknown

COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath \
	-ldflags="-s -w \
	  -X github.com/fallrising/clarkQ/internal/version.Version=${VERSION} \
	  -X github.com/fallrising/clarkQ/internal/version.Commit=${COMMIT} \
	  -X github.com/fallrising/clarkQ/internal/version.Date=${DATE}" \
	-o /out/clarkq ./cmd/clarkq

# Runtime
FROM alpine:3.20
RUN adduser -D -H -u 10001 clarkq \
	&& apk add --no-cache ca-certificates wget
USER clarkq
WORKDIR /app
COPY --from=build /out/clarkq /app/clarkq

ENV CLARKQ_ADDR=:8080
EXPOSE 8080
ENTRYPOINT ["/app/clarkq"]
