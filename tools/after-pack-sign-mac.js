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

function resolveSigningIdentity() {
  let output = "";
  try {
    output = run("security", ["find-identity", "-v", "-p", "codesigning"]);
  } catch {
    return "-";
  }
  const quoted = [];
  for (const line of String(output || "").split("\n")) {
    const match = line.match(/"([^"]+)"/);
    if (match) quoted.push(match[1]);
  }
  const developerId = quoted.find((name) => name.startsWith("Developer ID Application:"));
  const appleDev = quoted.find((name) => name.startsWith("Apple Development:"));
  return developerId || appleDev || "-";
}

function signTarget(target, identity, extraArgs = []) {
  run("codesign", ["--force", "--sign", identity, ...extraArgs, target]);
}

function signMacAppAdhoc(appPath, entitlementsArgs) {
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
        signTarget(target, "-", ["--timestamp=none"]);
      } catch {
        // Continue signing remaining helpers/frameworks.
      }
    }
  }
  signTarget(appPath, "-", ["--deep", "--timestamp=none", ...entitlementsArgs]);
}

async function signMacApp(appPath, options = {}) {
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
  const identity = options.identity || resolveSigningIdentity();

  if (identity && identity !== "-") {
    const { signAsync } = require("@electron/osx-sign");
    await signAsync({
      app: appPath,
      identity,
      platform: "darwin",
      hardenedRuntime: false,
      optionsForFile: () => ({
        entitlements: options.entitlements,
        hardenedRuntime: false,
      }),
    });
  } else {
    signMacAppAdhoc(appPath, entitlementsArgs);
  }

  run("codesign", ["--verify", "--deep", "--verbose=2", appPath], { stdio: "inherit" });
  return { appPath, identity };
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
  await signMacApp(appPath, { entitlements });
}

module.exports = afterPack;
module.exports.default = afterPack;
module.exports.signMacApp = signMacApp;
module.exports.resolveSigningIdentity = resolveSigningIdentity;
