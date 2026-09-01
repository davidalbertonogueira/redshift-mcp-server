import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const composeFile = fileURLToPath(new URL("./docker-compose.yml", import.meta.url));

export default async function setup() {
  execFileSync("docker", ["compose", "-f", composeFile, "up", "-d", "--wait"], {
    stdio: "inherit",
  });

  return async function teardown() {
    if (process.env.KEEP_TEST_DB === "true") {
      console.log("KEEP_TEST_DB=true set, leaving the test database running.");
      return;
    }
    execFileSync("docker", ["compose", "-f", composeFile, "down", "-v"], {
      stdio: "inherit",
    });
  };
}
