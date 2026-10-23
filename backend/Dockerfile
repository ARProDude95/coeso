# syntax=docker/dockerfile:1
# Roster backend — multi-stage build: Maven (Java 21) → JRE-only runtime.
# Used by docker-compose.prod.yml; tests are not run here (they need
# Testcontainers/Docker — run `mvn test` in CI instead).

# ----------------------------------------------------------- build stage
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build

# Dependencies first, so source edits reuse the cached layer.
COPY pom.xml ./
RUN mvn -q -B dependency:go-offline

COPY src ./src
# -DskipTests compiles the test sources (parity with a local build) but does
# not execute them; the deploy image must not need Docker-in-Docker.
RUN mvn -q -B -DskipTests package

# --------------------------------------------------------- runtime stage
# JRE only — no compilers in the final image. curl is added purely for the
# HEALTHCHECK below.
FROM eclipse-temurin:21-jre
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 1001 --create-home roster

WORKDIR /app
# spring-boot repackage produces the executable fat jar; the original is
# left as *.jar.original, so this glob matches exactly one file.
COPY --from=build /build/target/roster-backend-*.jar app.jar

USER roster
EXPOSE 8080

# Flyway migrates on boot, hence the generous start period; after that a
# hung JVM is replaced by compose's restart policy.
HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=10 \
  CMD curl -fsS http://localhost:8080/actuator/health || exit 1

ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75.0", "-jar", "/app/app.jar"]
