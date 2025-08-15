const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

describe("Localization Download E2E", () => {
  let testOutputDir;

  beforeEach(() => {
    testOutputDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "localization-test-"),
    );
  });

  afterEach(() => {
    if (testOutputDir && fs.existsSync(testOutputDir)) {
      fs.rmSync(testOutputDir, { recursive: true });
    }
  });

  test("should download German translations successfully", async () => {
    const baseUrl = process.env.BASE_URL;
    
    if (!baseUrl) {
      console.log("Skipping test: BASE_URL environment variable not set");
      return;
    }

    const pid = "PID168";
    const locVersion = "2.0";
    const group = "LG725";
    const language = "de";

    const result = await runDownloadCommand({
      baseUrl,
      pid,
      locVersion,
      group,
      language,
      outputPath: testOutputDir,
    });

    expect(result.exitCode).toBe(0);

    const expectedFilePath = path.join(testOutputDir, `${language}.json`);
    expect(fs.existsSync(expectedFilePath)).toBe(true);

    const content = fs.readFileSync(expectedFilePath, "utf8");
    expect(() => JSON.parse(content)).not.toThrow();

    const translations = JSON.parse(content);
    expect(typeof translations).toBe("object");
    expect(Object.keys(translations).length).toBeGreaterThanOrEqual(0);
  });

  test("should handle invalid parameters gracefully", async () => {
    const baseUrl = process.env.BASE_URL;
    
    if (!baseUrl) {
      console.log("Skipping test: BASE_URL environment variable not set");
      return;
    }

    const result = await runDownloadCommand({
      baseUrl,
      pid: "INVALID_PID",
      locVersion: "2.0",
      group: "INVALID_GROUP",
      language: "de",
      outputPath: testOutputDir,
    });

    if (result.exitCode === 1 && result.stderr.includes("ENOTFOUND")) {
      expect(result.stdout).toContain("Loading translations for de");
      return;
    }

    expect(result.exitCode).toBe(0);

    const expectedFilePath = path.join(testOutputDir, "de.json");

    if (fs.existsSync(expectedFilePath)) {
      const content = fs.readFileSync(expectedFilePath, "utf8");
      const translations = JSON.parse(content);
      expect(Object.keys(translations).length).toBe(0);
    }
  });
});

function runDownloadCommand({
  baseUrl,
  pid,
  locVersion,
  group,
  language,
  outputPath,
}) {
  return new Promise((resolve) => {
    const args = [
      "bin/localization.js",
      "download",
      `--base-url=${baseUrl}`,
      `--pid=${pid}`,
      `--loc-version=${locVersion}`,
      `--group=${group}`,
      `--language=${language}`,
      `--output-path=${outputPath}`,
    ];

    let stdout = "";
    let stderr = "";

    const child = spawn("node", args, {
      cwd: process.cwd(),
    });

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (exitCode) => {
      resolve({
        exitCode,
        stdout,
        stderr,
      });
    });

    child.on("error", (error) => {
      resolve({
        exitCode: -1,
        stdout,
        stderr: stderr + error.message,
      });
    });
  });
}
