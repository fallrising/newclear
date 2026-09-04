# ADR-002: Java 25 LTS Baseline

- Status: Accepted
- Date: 2026-07-30
- Supersedes: ADR-001 Java language-level decision only

## Context

The repository compiles with a Java 25 toolchain and runs Java 25 container
images, but `--release 24` and several active documents still describe Java 24
as the language baseline. Java 24 is a superseded non-LTS release. Maintaining
two adjacent baselines adds ambiguity without providing a supported runtime
target.

Java 21 and Java 25 are LTS releases. As of this decision, Java 25 is the
current LTS, the existing build and runtime images already provide it, and
Eclipse Temurin publishes a long-term availability window for it.

## Decision

Compile, test, and run all Java components on Java 25 LTS. Use Eclipse
Temurin/OpenJDK images and standard `JAVA_TOOL_OPTIONS` injection at deployment
boundaries.

Do not promise Java 21 bytecode compatibility. Operators may set heap, GC,
diagnostic, and JFR flags through deployment configuration without rebuilding
images.

## Consequences

- Gradle toolchains and `options.release` both target Java 25.
- CI, SDK tests, build images, and runtime images stay on Java 25.
- Users need Java 25 to build or run unpackaged Java artifacts.
- Compose exposes `OJBQUAY_JAVA_TOOL_OPTIONS`; Kubernetes exposes the
  `java-tool-options` ConfigMap key as `JAVA_TOOL_OPTIONS`.
- JVM tuning remains environment-specific and requires load evidence.

## References

- [Oracle Java SE Support Roadmap](https://www.oracle.com/java/technologies/java-se-support-roadmap.html)
- [Eclipse Temurin Support Roadmap](https://adoptium.net/support/)
