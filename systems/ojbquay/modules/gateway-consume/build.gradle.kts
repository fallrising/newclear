plugins {
    java
    application
}

dependencies {
    implementation(project(":modules:common"))
    implementation(libs.jackson.databind)
    implementation(libs.grpc.netty.shaded)
    implementation(libs.json.path)
    implementation(libs.kafka.clients)
    runtimeOnly(libs.slf4j.simple)

    testImplementation(platform(libs.junit.bom))
    testImplementation(platform(libs.testcontainers.bom))
    testImplementation(project(":modules:gateway-produce"))
    testImplementation(project(":modules:scheduler"))
    testImplementation(project(":sdk:java"))
    testImplementation(libs.assertj.core)
    testImplementation(libs.grpc.inprocess)
    testImplementation(libs.junit.jupiter)
    testImplementation(libs.postgresql)
    testImplementation(libs.testcontainers.junit)
    testImplementation(libs.testcontainers.kafka)
    testImplementation(libs.testcontainers.postgresql)
    testRuntimeOnly(libs.junit.platform.launcher)
}

application {
    mainClass = "dev.ojbk.gateway.consume.GatewayConsumeRuntime"
    applicationDefaultJvmArgs = listOf("--enable-native-access=ALL-UNNAMED")
}

tasks.register<JavaExec>("pullInteropServer") {
    group = "verification"
    description = "Runs the Java side of the Java/Go pull interoperability check."
    dependsOn(tasks.testClasses)
    classpath = sourceSets.test.get().runtimeClasspath
    mainClass = "dev.ojbk.gateway.consume.PullInteropServer"
    jvmArgs("--enable-native-access=ALL-UNNAMED")
}
