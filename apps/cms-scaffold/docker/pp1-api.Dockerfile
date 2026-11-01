# Local-only: BASE_IMAGE is the full immutable ID of an existing JRE25/curl image.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG BASE_IMAGE
ARG PP1_SOURCE_COMMIT
ARG PP1_JAR_SHA256
LABEL org.cms.pp1.source-commit=$PP1_SOURCE_COMMIT \
      org.cms.pp1.jar-sha256=$PP1_JAR_SHA256 \
      org.cms.pp1.base-image=$BASE_IMAGE
WORKDIR /app
COPY services/cms-api/build/libs/*.jar /app/app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
