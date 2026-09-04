# syntax=docker/dockerfile:1

FROM node:24-alpine AS frontend-build
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run lint
RUN npm run build

FROM maven:3.9-eclipse-temurin-17 AS backend-build
WORKDIR /build
COPY backend/pom.xml backend/pom.xml
RUN mvn -f backend/pom.xml -B dependency:go-offline
COPY backend/ backend/
COPY --from=frontend-build /build/frontend/dist/ backend/src/main/resources/static/
RUN mvn -f backend/pom.xml -B test package -DskipTests=false

FROM eclipse-temurin:17-jre-noble AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 app \
    && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin app \
    && mkdir -p /data /data/media \
    && chown 10001:10001 /data /data/media

WORKDIR /app
COPY --from=backend-build /build/backend/target/deck-1.0.0.jar /app/app.jar
RUN chown 10001:10001 /app/app.jar

USER 10001:10001
ENV SPRING_PROFILES_ACTIVE=prod
ENV APP_DB_PATH=/data/deck.db
ENV APP_MEDIA_PATH=/data/media
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/actuator/health || exit 1

ENTRYPOINT ["java", "-jar", "/app/app.jar"]