plugins {
    `java-library`
    // Fat jar: bundles the plugin's runtime dependencies into one deployable jar.
    id("com.gradleup.shadow") version "8.3.6"
}

group = "{{pkg}}"
version = "0.1.0"

repositories {
    mavenCentral()
    maven("https://repo.papermc.io/repository/maven-public/")
}

dependencies {
    // The Paper server provides this API at runtime, so it must not be bundled.
    compileOnly("io.papermc.paper:paper-api:{{paperApiVersion}}")
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of({{javaVersion}})
    }
}

tasks {
    // 薄 jar 和 shadowJar 默认都写 build/libs/<name>-0.1.0.jar：谁后跑谁覆盖，
    // 发布出去可能是不含依赖的版本，服务端运行时报 NoClassDefFoundError。
    // 给薄 jar 加 classifier，两个产物互不覆盖（发布仍用无 classifier 的 fat jar）。
    jar {
        archiveClassifier.set("thin")
    }
    shadowJar {
        archiveBaseName.set("{{name}}")
        archiveClassifier.set("")
    }
    assemble {
        dependsOn(shadowJar)
    }
    processResources {
        // Keep plugin.yml in sync with the build version.
        filesMatching("plugin.yml") {
            expand("version" to version)
        }
    }
}
