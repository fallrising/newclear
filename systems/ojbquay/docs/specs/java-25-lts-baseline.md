# Java 25 LTS Baseline

## Context

ojbquay currently uses a Java 25 toolchain, CI runner, build image, and runtime
image while compiling Java 24 bytecode and describing the split baseline in
active documentation. Java 24 is a non-LTS release that is no longer
maintained.

## Goal

Use one supported Java 25 LTS compile/runtime baseline and make JVM tuning
available through standard deployment configuration.

## Non-goals

- Prescribing production heap, GC, or JFR values without load evidence.
- Supporting Java 21 runtime or bytecode compatibility.
- Changing application behavior, APIs, schemas, or dependencies.
- Selecting a commercial JDK support vendor.

## Acceptance Criteria

- Given the Gradle build,
  when Java compilation is configured,
  then both the toolchain and `--release` target Java 25.
- Given CI and runtime container definitions,
  when they are inspected,
  then Java jobs and images use Java 25.
- Given the local Compose model,
  when `OJBQUAY_JAVA_TOOL_OPTIONS` is supplied,
  then all four Java services receive it as `JAVA_TOOL_OPTIONS`.
- Given the Kubernetes base,
  when `java-tool-options` is changed in the runtime ConfigMap,
  then all four Java deployments receive it as `JAVA_TOOL_OPTIONS`.
- Given the changed baseline,
  when the full Gradle build and deployment validation run,
  then they pass without application changes.

## Constraints

- Keep Spring limited to the control plane.
- Do not hard-code speculative JVM tuning defaults.
- Keep the supplied images on Eclipse Temurin/OpenJDK distributions.
- Preserve all existing resource requests and limits.

## Assumptions and Unknowns

- Java 25 is the current LTS and Eclipse Temurin publishes builds through at
  least September 2031.
- Actual GC and heap choices depend on production traffic, latency objectives,
  payload distribution, and container limits.

## Design

Set Gradle `options.release` to 25 so the compiler, bytecode, and runtime
baseline agree. Keep the existing Java 25 CI, Gradle, and Temurin images.

Compose maps the namespaced host variable `OJBQUAY_JAVA_TOOL_OPTIONS` to
`JAVA_TOOL_OPTIONS` for each Java service. Kubernetes maps a single
`java-tool-options` ConfigMap key into the same standard environment variable.
The empty default changes no runtime behavior.

## Steps

1. Record ADR-002 and update the product baseline.
2. Align Gradle compilation and active documentation with Java 25.
3. Add optional JVM-argument injection to Compose and Kubernetes.
4. Validate rendered deployment models and run the full Gradle build.
5. Re-run the retained Docker functional demo.

## Verification

- `./gradlew clean build --no-daemon --no-parallel`
- `make validate-deploy`
- `OJBQUAY_JAVA_TOOL_OPTIONS=-XX:+PrintCommandLineFlags make demo`
- Runtime inspection of `java.version` and `JAVA_TOOL_OPTIONS`
