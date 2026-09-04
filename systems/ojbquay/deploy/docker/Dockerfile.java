FROM gradle:9.6.1-jdk25 AS build

WORKDIR /workspace
COPY gradle/ ./gradle/
COPY gradlew build.gradle.kts settings.gradle.kts gradle.properties ./
COPY proto/ ./proto/
COPY modules/ ./modules/
COPY sdk/java/ ./sdk/java/
RUN ./gradlew \
      :modules:console-api:bootJar \
      :modules:gateway-produce:installDist \
      :modules:gateway-consume:installDist \
      :modules:scheduler:installDist \
      --no-daemon

FROM eclipse-temurin:25-jre-noble AS runtime
RUN apt-get update \
    && apt-get install --no-install-recommends -y curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --create-home ojbquay
USER 10001

FROM runtime AS console-api
WORKDIR /opt/ojbquay
COPY --from=build /workspace/modules/console-api/build/libs/console-api-*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/opt/ojbquay/app.jar"]

FROM runtime AS gateway-produce
WORKDIR /opt/ojbquay
COPY --from=build /workspace/modules/gateway-produce/build/install/gateway-produce/ ./
EXPOSE 9100 9200
ENTRYPOINT ["/opt/ojbquay/bin/gateway-produce"]

FROM runtime AS gateway-consume
WORKDIR /opt/ojbquay
COPY --from=build /workspace/modules/gateway-consume/build/install/gateway-consume/ ./
EXPOSE 9101 9202
ENTRYPOINT ["/opt/ojbquay/bin/gateway-consume"]

FROM runtime AS scheduler
WORKDIR /opt/ojbquay
COPY --from=build /workspace/modules/scheduler/build/install/scheduler/ ./
EXPOSE 9201
ENTRYPOINT ["/opt/ojbquay/bin/scheduler"]
