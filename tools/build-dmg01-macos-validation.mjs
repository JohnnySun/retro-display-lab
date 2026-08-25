#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const outputFlag = process.argv.indexOf("--output-directory");
const outputDirectory = outputFlag >= 0 ? process.argv[outputFlag + 1] : null;
if (!outputDirectory) {
  console.error("usage: node tools/build-dmg01-macos-validation.mjs --output-directory <path>");
  process.exit(1);
}

const output = path.resolve(outputDirectory);
for (const directory of ["logs", "playlists", "recordings", "saves", "screenshots", "states", "system"]) {
  fs.mkdirSync(path.join(output, directory), { recursive: true });
}

const quote = (value) => `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
const settings = {
  audio_enable: false,
  auto_overrides_enable: false,
  auto_shaders_enable: false,
  config_save_on_exit: false,
  content_history_path: path.join(output, "playlists", "content_history.lpl"),
  content_image_history_path: path.join(output, "playlists", "content_image_history.lpl"),
  content_music_history_path: path.join(output, "playlists", "content_music_history.lpl"),
  content_video_history_path: path.join(output, "playlists", "content_video_history.lpl"),
  core_options_path: path.join(output, "gambatte.opt"),
  fastforward_ratio: "1.000000",
  global_core_options: true,
  history_list_enable: false,
  input_autodetect_enable: false,
  input_overlay_enable: false,
  log_dir: path.join(output, "logs"),
  log_to_file: false,
  log_verbosity: true,
  menu_pause_libretro: false,
  pause_nonactive: false,
  playlist_directory: path.join(output, "playlists"),
  recording_output_directory: path.join(output, "recordings"),
  rewind_enable: false,
  run_ahead_enabled: false,
  savefile_directory: path.join(output, "saves"),
  savestate_directory: path.join(output, "states"),
  screenshot_directory: path.join(output, "screenshots"),
  system_directory: path.join(output, "system"),
  video_adaptive_vsync: false,
  video_driver: "metal",
  video_fullscreen: false,
  video_gpu_record: true,
  video_gpu_screenshot: true,
  video_scale: "6.000000",
  video_scale_integer: true,
  video_scale_integer_overscale: false,
  video_shader_enable: true,
  video_shader_subframes: "1",
  video_smooth: false,
  video_swap_interval: "1",
  video_threaded: false,
  video_variable_refresh: false,
  video_vsync: true,
  video_windowed_fullscreen: false,
};
fs.writeFileSync(
  path.join(output, "retroarch.cfg"),
  `${Object.entries(settings).map(([key, value]) => `${key} = ${quote(value)}`).join("\n")}\n`,
);
fs.writeFileSync(
  path.join(output, "gambatte.opt"),
  [
    'gambatte_gb_bootloader = "disabled"',
    'gambatte_gb_colorization = "disabled"',
    'gambatte_mix_frames = "disabled"',
  ].join("\n") + "\n",
);

console.log(`Wrote isolated macOS RetroArch validation configuration to ${output}.`);
