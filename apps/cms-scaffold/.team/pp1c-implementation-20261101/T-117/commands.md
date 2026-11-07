# Exact Gradle commands

All executed in the assigned component directory. Output redirected to the named log; initial sandbox failure was rerun with authorized existing shared-cache access.

## C03-environment-failure.log

```sh
JAVA_HOME=/home/ckc/.cache/devbox/toolchains/jdk-25.0.5+8 timeout 900s ./gradlew test --tests '*RecoveryInventoryTests' --no-daemon --no-parallel > .team/pp1c-implementation-20261101/T-117/C03-environment-failure.log 2>&1
```

## C03-red.log

```sh
JAVA_HOME=/home/ckc/.cache/devbox/toolchains/jdk-25.0.5+8 timeout 900s ./gradlew test --tests '*RecoveryInventoryTests' --no-daemon --no-parallel > .team/pp1c-implementation-20261101/T-117/C03-red.log 2>&1
```

## C04a-green.log

```sh
JAVA_HOME=/home/ckc/.cache/devbox/toolchains/jdk-25.0.5+8 timeout 900s ./gradlew integrationTest --tests '*RecoveryInventoryIntegrationTests' --no-daemon --no-parallel > .team/pp1c-implementation-20261101/T-117/C04a-green.log 2>&1
```

## C04a-final-green.log

```sh
JAVA_HOME=/home/ckc/.cache/devbox/toolchains/jdk-25.0.5+8 timeout 900s ./gradlew test --tests '*RecoveryInventoryTests.PP1c_extraRelationRejected' integrationTest --tests '*RecoveryInventoryIntegrationTests' --no-daemon --no-parallel > .team/pp1c-implementation-20261101/T-117/C04a-final-green.log 2>&1
```

## C04d-red.log

```sh
JAVA_HOME=/home/ckc/.cache/devbox/toolchains/jdk-25.0.5+8 timeout 900s ./gradlew integrationTest --tests '*RecoveryInventoryIntegrationTests.PP1c_catalog*' --tests '*RecoveryInventoryIntegrationTests.PP1c_constraint*' --tests '*RecoveryInventoryIntegrationTests.PP1c_completeFlyway*' --tests '*RecoveryInventoryIntegrationTests.PP1c_unsupportedConstraint*' --no-daemon --no-parallel > .team/pp1c-implementation-20261101/T-117/C04d-red.log 2>&1
```

## C04d-green.log

```sh
JAVA_HOME=/home/ckc/.cache/devbox/toolchains/jdk-25.0.5+8 timeout 900s ./gradlew test --tests '*RecoveryInventoryTests.PP1c_canonical*' --tests '*RecoveryInventoryTests.PP1c_extraRelation*' integrationTest --tests '*RecoveryInventoryIntegrationTests' --no-daemon --no-parallel > .team/pp1c-implementation-20261101/T-117/C04d-green.log 2>&1
```

## C04c-ancestor-red.log

```sh
JAVA_HOME=/home/ckc/.cache/devbox/toolchains/jdk-25.0.5+8 timeout 900s ./gradlew test --tests '*RecoveryInventoryTests.PP1c_unrelatedAncestor*' --no-daemon --no-parallel > .team/pp1c-implementation-20261101/T-117/C04c-ancestor-red.log 2>&1
```

## C04b-red.log

```sh
JAVA_HOME=/home/ckc/.cache/devbox/toolchains/jdk-25.0.5+8 timeout 900s ./gradlew test --tests '*RecoveryInventoryTests' --no-daemon --no-parallel > .team/pp1c-implementation-20261101/T-117/C04b-red.log 2>&1
```

## C04b-green.log

```sh
JAVA_HOME=/home/ckc/.cache/devbox/toolchains/jdk-25.0.5+8 timeout 900s ./gradlew test --tests '*RecoveryInventoryTests' integrationTest --tests '*RecoveryInventoryIntegrationTests' --no-daemon --no-parallel > .team/pp1c-implementation-20261101/T-117/C04b-green.log 2>&1
```

## C04d-followup-red.log

```sh
JAVA_HOME=/home/ckc/.cache/devbox/toolchains/jdk-25.0.5+8 timeout 900s ./gradlew test --tests '*RecoveryInventoryTests.PP1c_canonicalRejects*' integrationTest --tests '*RecoveryInventoryIntegrationTests.PP1c_relationOutsidePublic*' --continue --no-daemon --no-parallel > .team/pp1c-implementation-20261101/T-117/C04d-followup-red.log 2>&1
```

## final-green.log

```sh
JAVA_HOME=/home/ckc/.cache/devbox/toolchains/jdk-25.0.5+8 timeout 900s ./gradlew test --tests '*RecoveryInventoryTests' integrationTest --tests '*RecoveryInventoryIntegrationTests' --no-daemon --no-parallel > .team/pp1c-implementation-20261101/T-117/final-green.log 2>&1
```

## C04c-red.log

```sh
JAVA_HOME=/home/ckc/.cache/devbox/toolchains/jdk-25.0.5+8 timeout 900s ./gradlew test --tests '*RecoveryInventoryTests.PP1c_unsafePath*' --tests '*RecoveryInventoryTests.PP1c_symlink*' --tests '*RecoveryInventoryTests.PP1c_hardlink*' --tests '*RecoveryInventoryTests.PP1c_sourceChanged*' --tests '*RecoveryInventoryTests.PP1c_rootSymlink*' --tests '*RecoveryInventoryTests.PP1c_sameBytes*' --tests '*RecoveryInventoryTests.PP1c_directoryMembership*' --tests '*RecoveryInventoryTests.PP1c_stableFiles*' --no-daemon --no-parallel > .team/pp1c-implementation-20261101/T-117/C04c-red.log 2>&1
```

## C04c-green.log

```sh
JAVA_HOME=/home/ckc/.cache/devbox/toolchains/jdk-25.0.5+8 timeout 900s ./gradlew test --tests '*RecoveryInventoryTests.PP1c_unsafePath*' --tests '*RecoveryInventoryTests.PP1c_symlink*' --tests '*RecoveryInventoryTests.PP1c_hardlink*' --tests '*RecoveryInventoryTests.PP1c_sourceChanged*' --tests '*RecoveryInventoryTests.PP1c_rootSymlink*' --tests '*RecoveryInventoryTests.PP1c_sameBytes*' --tests '*RecoveryInventoryTests.PP1c_directoryMembership*' --tests '*RecoveryInventoryTests.PP1c_stableFiles*' --no-daemon --no-parallel > .team/pp1c-implementation-20261101/T-117/C04c-green.log 2>&1
```

## C04c-final-green.log

```sh
JAVA_HOME=/home/ckc/.cache/devbox/toolchains/jdk-25.0.5+8 timeout 900s ./gradlew test --tests '*RecoveryInventoryTests.PP1c_unsafePath*' --tests '*RecoveryInventoryTests.PP1c_symlink*' --tests '*RecoveryInventoryTests.PP1c_hardlink*' --tests '*RecoveryInventoryTests.PP1c_sourceChanged*' --tests '*RecoveryInventoryTests.PP1c_rootSymlink*' --tests '*RecoveryInventoryTests.PP1c_sameBytes*' --tests '*RecoveryInventoryTests.PP1c_directoryMembership*' --tests '*RecoveryInventoryTests.PP1c_stableFiles*' --tests '*RecoveryInventoryTests.PP1c_unrelatedAncestor*' --no-daemon --no-parallel > .team/pp1c-implementation-20261101/T-117/C04c-final-green.log 2>&1
```


## C04c-invalid-utf8-red.log

```sh
JAVA_HOME=/home/ckc/.cache/devbox/toolchains/jdk-25.0.5+8 timeout 900s ./gradlew test --tests '*RecoveryInventoryTests.PP1c_invalidUtf8Names*' --no-daemon --no-parallel > .team/pp1c-implementation-20261101/T-117/C04c-invalid-utf8-red.log 2>&1
```

## C04c-invalid-utf8-green.log

```sh
JAVA_HOME=/home/ckc/.cache/devbox/toolchains/jdk-25.0.5+8 timeout 900s ./gradlew test --tests '*RecoveryInventoryTests' --no-daemon --no-parallel > .team/pp1c-implementation-20261101/T-117/C04c-invalid-utf8-green.log 2>&1
```

## C04c-invalid-utf8-final-green.log

```sh
JAVA_HOME=/home/ckc/.cache/devbox/toolchains/jdk-25.0.5+8 timeout 900s ./gradlew test --tests '*RecoveryInventoryTests' --no-daemon --no-parallel > .team/pp1c-implementation-20261101/T-117/C04c-invalid-utf8-final-green.log 2>&1
```

## C04c-membership-green.log

```sh
JAVA_HOME=/home/ckc/.cache/devbox/toolchains/jdk-25.0.5+8 timeout 900s ./gradlew test --tests '*RecoveryInventoryTests' --no-daemon --no-parallel > .team/pp1c-implementation-20261101/T-117/C04c-membership-green.log 2>&1
```

## C04c-frozen-membership-green.log

```sh
JAVA_HOME=/home/ckc/.cache/devbox/toolchains/jdk-25.0.5+8 timeout 900s ./gradlew test --tests '*RecoveryInventoryTests' --no-daemon --no-parallel > .team/pp1c-implementation-20261101/T-117/C04c-frozen-membership-green.log 2>&1
```
