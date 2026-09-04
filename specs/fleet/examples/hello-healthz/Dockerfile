# syntax=docker/dockerfile:1
FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod main.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /hello-healthz .

FROM gcr.io/distroless/static:nonroot
COPY --from=build /hello-healthz /hello-healthz
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/hello-healthz"]
