#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidenceRelative = ".codex-validation/cgb001-ws9-target-20260824";
const evidenceDir = path.join(root, evidenceRelative);
const basePath = path.join(evidenceDir, "preflight/device-global-retroarch.cfg");
if (!fs.existsSync(basePath)) throw new Error(`missing device base config: ${basePath}`);

const deviceRun = "/storage/emulated/0/RetroArch/config/.codex-validation/20260824-cgb-ws9";
const deviceShaderRoot = "/storage/emulated/0/RetroArch/shaders/.codex-validation/20260824-cgb-ws9/retro-display-lab";
const deviceEvidence = "/storage/emulated/0/RetroArch/.codex-validation/20260824-cgb-ws9";
const targetPresetRoot = `${deviceShaderRoot}/targets/konkr-gt78-vn/960x640-srgb-neutral/presets`;
const base = fs.readFileSync(basePath, "utf8");

function replaceSetting(source, key, value) {
  const line = `${key} = "${value}"`;
  const pattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")} = .*?$`, "m");
  if (pattern.test(source)) return source.replace(pattern, line);
  const anchor = /^video_shader_dir = .*?$/m;
  if (key === "video_shader" && anchor.test(source)) return source.replace(anchor, (match) => `${match}\n${line}`);
  throw new Error(`base RetroArch config has no setting: ${key}`);
}

const common = {
  aspect_ratio_index: "22",
  auto_overrides_enable: "false",
  auto_shaders_enable: "true",
  config_save_on_exit: "false",
  core_options_path: `${deviceRun}/cgb001-core-options.opt`,
  fastforward_ratio: "1.000000",
  frontend_log_level: "0",
  input_overlay_enable: "false",
  libretro_log_level: "0",
  log_dir: deviceEvidence,
  log_to_file: "false",
  log_to_file_timestamp: "false",
  log_verbosity: "true",
  rewind_enable: "false",
  run_ahead_enabled: "false",
  screenshot_directory: deviceEvidence,
  video_aspect_ratio: "1.111111",
  video_aspect_ratio_auto: "true",
  video_driver: "vulkan",
  video_fullscreen: "true",
  video_gpu_screenshot: "true",
  video_scale_integer: "true",
  video_scale_integer_overscale: "false",
  video_shader_enable: "true",
  video_shader_subframes: "1",
  video_smooth: "false",
  video_threaded: "true",
  video_vsync: "true",
};

const variants = new Map([
  ["reference", "cgb001-reference-d65-v1.slangp"],
  ["response", "cgb001-ws9-response-readback-v1.slangp"],
  ["retention", "cgb001-ws9-retention-readback-v1.slangp"],
  ["exposure", "cgb001-ws9-exposure-readback-v1.slangp"],
  ["lut", "cgb001-ws9-lut-readback-v1.slangp"],
  ["aperture", "cgb001-ws9-aperture-readback-v1.slangp"],
]);

const configDir = path.join(evidenceDir, "configs");
fs.mkdirSync(configDir, { recursive: true });
for (const [id, preset] of variants) {
  let config = base;
  for (const [key, value] of Object.entries({
    ...common,
    video_shader: `${targetPresetRoot}/${preset}`,
  })) config = replaceSetting(config, key, value);
  fs.writeFileSync(path.join(configDir, `retroarch-cgb-ws9-${id}.cfg`), config);
  fs.writeFileSync(
    path.join(configDir, `override-cgb-ws9-${id}.slangp`),
    `# Temporary WS9 override; the user's original Gambatte.slangp is held and hash-pinned.\n#reference "../../shaders/.codex-validation/20260824-cgb-ws9/retro-display-lab/targets/konkr-gt78-vn/960x640-srgb-neutral/presets/${preset}"\n`,
  );
}

fs.copyFileSync(
  path.join(root, "targets/konkr-gt78-vn/960x640-srgb-neutral/retroarch/cgb001-core-options.opt"),
  path.join(configDir, "cgb001-core-options.opt"),
);
process.stdout.write(`Wrote ${variants.size} isolated CGB WS9 device configurations.\n`);
