plugins {
    `java-library`
    alias(libs.plugins.protobuf)
}

val grpcVersion = libs.grpc.stub.get().versionConstraint.requiredVersion
val protobufVersion = libs.protobuf.java.get().versionConstraint.requiredVersion

dependencies {
    api(libs.grpc.protobuf)
    api(libs.grpc.stub)
    api(libs.protobuf.java)
    implementation(libs.cel)
    implementation(libs.jackson.databind)
    implementation(libs.jackson.jsr310)
    implementation(libs.json.path)
    implementation(libs.kafka.clients)
    compileOnly(libs.javax.annotation)

    testImplementation(platform(libs.junit.bom))
    testImplementation(platform(libs.testcontainers.bom))
    testImplementation(libs.assertj.core)
    testImplementation(libs.junit.jupiter)
    testImplementation(libs.testcontainers.junit)
    testImplementation(libs.testcontainers.kafka)
    testRuntimeOnly(libs.junit.platform.launcher)
}

sourceSets {
    main {
        proto {
            srcDir("../../proto")
        }
    }
}

protobuf {
    protoc {
        artifact = "com.google.protobuf:protoc:$protobufVersion"
    }
    plugins {
        create("grpc") {
            artifact = "io.grpc:protoc-gen-grpc-java:$grpcVersion"
        }
    }
    generateProtoTasks {
        all().configureEach {
            plugins {
                create("grpc")
            }
        }
    }
}
