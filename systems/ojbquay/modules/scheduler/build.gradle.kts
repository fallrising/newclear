plugins {
    java
    application
}

dependencies {
    implementation(project(":modules:common"))
    implementation(libs.jackson.databind)
    implementation(libs.kafka.clients)
    implementation(libs.postgresql)
    runtimeOnly(libs.slf4j.simple)

    testImplementation(platform(libs.junit.bom))
    testImplementation(platform(libs.testcontainers.bom))
    testImplementation(project(":modules:gateway-produce"))
    testImplementation(project(":sdk:java"))
    testImplementation(libs.assertj.core)
    testImplementation(libs.grpc.netty.shaded)
    testImplementation(libs.junit.jupiter)
    testImplementation(libs.testcontainers.junit)
    testImplementation(libs.testcontainers.kafka)
    testImplementation(libs.testcontainers.postgresql)
    testRuntimeOnly(libs.junit.platform.launcher)
}

application {
    mainClass = "dev.ojbk.scheduler.SchedulerRuntime"
    applicationDefaultJvmArgs = listOf("--enable-native-access=ALL-UNNAMED")
}
