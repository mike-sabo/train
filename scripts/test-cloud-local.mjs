import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

const directory = mkdtempSync(join(tmpdir(), "train-together-pg-"));
const socket = createServer();
await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error || result.status !== 0)
    throw new Error(
      `${command} failed: ${result.error?.message || result.stderr || result.stdout}`,
    );
}
try {
  run("initdb", [
    "-D",
    directory,
    "--auth=trust",
    "--no-locale",
    "--encoding=UTF8",
  ]);
  run("pg_ctl", [
    "-D",
    directory,
    "-l",
    join(directory, "server.log"),
    "-o",
    `-h 127.0.0.1 -p ${port} -k ${directory}`,
    "-w",
    "start",
  ]);
  run("createdb", ["-h", "127.0.0.1", "-p", String(port), "tt_test_backend"]);
  const result = spawnSync(
    process.execPath,
    ["--test", "tests/cloud/backend.test.js"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        TT_TEST_DATABASE_URL: `postgresql://${encodeURIComponent(userInfo().username)}@127.0.0.1:${port}/tt_test_backend`,
      },
    },
  );
  process.exitCode = result.status ?? 1;
} finally {
  spawnSync("pg_ctl", ["-D", directory, "-m", "immediate", "-w", "stop"], {
    stdio: "ignore",
  });
  rmSync(directory, { recursive: true, force: true });
}
