plugins {
    java
    application
}

dependencies {
    implementation(project(":modules:common"))
    implementation(libs.grpc.netty.shaded)
    implementation(libs.kafka.clients)
    runtimeOnly(libs.slf4j.simple)

    testImplementation(platform(libs.junit.bom))
    testImplementation(platform(libs.testcontainers.bom))
    testImplementation(project(":sdk:java"))
    testImplementation(libs.assertj.core)
    testImplementation(libs.grpc.inprocess)
    testImplementation(libs.grpc.testing)
    testImplementation(libs.junit.jupiter)
    testImplementation(libs.testcontainers.junit)
    testImplementation(libs.testcontainers.kafka)
    testRuntimeOnly(libs.junit.platform.launcher)
}

application {
    mainClass = "dev.ojbk.gateway.produce.GatewayProduceRuntime"
    applicationDefaultJvmArgs = listOf("--enable-native-access=ALL-UNNAMED")
}
