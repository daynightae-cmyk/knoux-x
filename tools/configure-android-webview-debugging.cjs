#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MODES = new Set(["debug", "acceptance", "production"]);
const [, , androidDirArg, modeArg] = process.argv;
const mode = modeArg || "debug";
const androidDir = path.resolve(androidDirArg || "android");
const configPath = path.join(androidDir, "app", "src", "main", "assets", "capacitor.config.json");

if (!MODES.has(mode)) {
  console.error(`Unknown Android WebView debugging mode: ${mode} (expected debug, acceptance, or production)`);
  process.exit(2);
}
if (!fs.existsSync(configPath)) {
  console.error(`Capacitor Android config is missing: ${configPath}`);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
config.android = config.android && typeof config.android === "object" ? config.android : {};

if (mode === "production") {
  delete config.android.webContentsDebuggingEnabled;
} else {
  config.android.webContentsDebuggingEnabled = true;
}

fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

const enabled = config.android.webContentsDebuggingEnabled === true;
if (enabled !== (mode !== "production")) {
  console.error(`Failed to set WebView debugging for ${mode} builds (effective=${enabled}).`);
  process.exit(1);
}

console.log(`KNOUX Android WebView debugging=${enabled ? "enabled" : "disabled"} for ${mode} builds`);
console.log(`config=${configPath}`);
