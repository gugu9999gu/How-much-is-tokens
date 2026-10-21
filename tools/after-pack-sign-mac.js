"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    stdio: options.stdio || "pipe",
    encoding: "utf8",
  });
}

function signTarget(target, extraArgs = []) {
  run("codesign", ["--force", "--sign", "-", "--timestamp=none", ...extraArgs, target]);
}

function signMacApp(appPath, options = {}) {
  if (!appPath || !fs.existsSync(appPath)) {
    throw new Error(`macOS app bundle not found: ${appPath || "(empty path)"}`);
  }

  try {
    run("xattr", ["-cr", appPath]);
  } catch {
    // Newly packed apps often have no quarantine xattr yet.
  }

  const entitlementsArgs = options.entitlements && fs.existsSync(options.entitlements)
    ? ["--entitlements", options.entitlements]
    : [];

  const frameworksDir = path.join(appPath, "Contents", "Frameworks");
  if (fs.existsSync(frameworksDir)) {
    const nested = fs.readdirSync(frameworksDir)
      .map((name) => path.join(frameworksDir, name))
      .filter((full) => {
        try {
          return fs.lstatSync(full).isDirectory() && (full.endsWith(".app") || full.endsWith(".framework"));
        } catch {
          return false;
        }
      })
      .sort((left, right) => Number(right.endsWith(".app")) - Number(left.endsWith(".app")));

    for (const target of nested) {
      try {
        signTarget(target);
      } catch {
        // Continue signing remaining helpers/frameworks.
      }
    }
  }

  signTarget(appPath, ["--deep", ...entitlementsArgs]);
  run("codesign", ["--verify", "--deep", "--verbose=2", appPath], { stdio: "inherit" });
  return appPath;
}

async function afterPack(context) {
  if (!context || context.electronPlatformName !== "darwin") return;
  const appName = context.packager && context.packager.appInfo
    ? context.packager.appInfo.productFilename
    : null;
  if (!appName) return;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  const projectDir = context.packager.projectDir || process.cwd();
  const entitlements = path.join(projectDir, "build", "entitlements.mac.plist");
  signMacApp(appPath, { entitlements });
}

module.exports = afterPack;
module.exports.default = afterPack;
module.exports.signMacApp = signMacApp;
