pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        mavenCentral()
    }
}

rootProject.name = "ojbquay"

include(
    "modules:common",
    "modules:console-api",
    "modules:gateway-produce",
    "modules:gateway-consume",
    "modules:scheduler",
    "sdk:java",
)
