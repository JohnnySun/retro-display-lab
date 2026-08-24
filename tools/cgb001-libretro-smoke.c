#include <dlfcn.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "libretro.h"

static const char *scratch_directory;
static FILE *output_stream;
static enum retro_pixel_format requested_format = RETRO_PIXEL_FORMAT_0RGB1555;
static unsigned captured_width;
static unsigned captured_height;
static size_t captured_pitch;
static unsigned video_callbacks;
static unsigned duplicate_callbacks;
static unsigned captured_callbacks;
static uint16_t framebuffer[160 * 144];

static const char *option_value(const char *key) {
  if (!strcmp(key, "gambatte_gb_bootloader")) return "disabled";
  if (!strcmp(key, "gambatte_mix_frames")) return "disabled";
  if (!strcmp(key, "gambatte_gbc_color_correction")) return "disabled";
  if (!strcmp(key, "gambatte_gbc_color_correction_mode")) return "accurate";
  if (!strcmp(key, "gambatte_gbc_frontlight_position")) return "central";
  if (!strcmp(key, "gambatte_dark_filter_level")) return "0";
  if (!strcmp(key, "gambatte_audio_resampler")) return "sinc";
  if (!strcmp(key, "gambatte_up_down_allowed")) return "disabled";
  if (!strcmp(key, "gambatte_turbo_period")) return "4";
  if (!strcmp(key, "gambatte_rumble_level")) return "0";
  if (!strcmp(key, "gambatte_gb_colorization")) return "GBC";
  if (!strcmp(key, "gambatte_gb_internal_palette")) return "GBC - Dark Green";
  if (!strcmp(key, "gambatte_gb_hwmode")) return "Auto";
  return NULL;
}

static bool environment(unsigned command, void *data) {
  switch (command) {
    case RETRO_ENVIRONMENT_GET_CAN_DUPE:
      *(bool *)data = true;
      return true;
    case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT:
      requested_format = *(enum retro_pixel_format *)data;
      return requested_format == RETRO_PIXEL_FORMAT_RGB565;
    case RETRO_ENVIRONMENT_GET_VARIABLE: {
      struct retro_variable *variable = (struct retro_variable *)data;
      variable->value = option_value(variable->key);
      return variable->value != NULL;
    }
    case RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE:
      *(bool *)data = false;
      return true;
    case RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY:
    case RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY:
      *(const char **)data = scratch_directory;
      return true;
    case RETRO_ENVIRONMENT_GET_LANGUAGE:
      *(unsigned *)data = RETRO_LANGUAGE_ENGLISH;
      return true;
    case RETRO_ENVIRONMENT_SET_CORE_OPTIONS:
    case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_INTL:
    case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2:
    case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2_INTL:
      return true;
    case RETRO_ENVIRONMENT_SET_INPUT_DESCRIPTORS:
    case RETRO_ENVIRONMENT_SET_PERFORMANCE_LEVEL:
    case RETRO_ENVIRONMENT_SET_SUPPORT_NO_GAME:
    case RETRO_ENVIRONMENT_SET_CONTROLLER_INFO:
    case RETRO_ENVIRONMENT_SET_MEMORY_MAPS:
    case RETRO_ENVIRONMENT_SET_SUPPORT_ACHIEVEMENTS:
    case RETRO_ENVIRONMENT_SET_SERIALIZATION_QUIRKS:
      return true;
    default:
      return false;
  }
}

static void video_refresh(const void *data, unsigned width, unsigned height, size_t pitch) {
  video_callbacks++;
  if (!data) {
    duplicate_callbacks++;
    return;
  }
  if (width != 160 || height != 144 || pitch < width * sizeof(uint16_t)) return;
  const uint8_t *source = (const uint8_t *)data;
  for (unsigned y = 0; y < height; y++) {
    memcpy(framebuffer + y * width, source + y * pitch, width * sizeof(uint16_t));
  }
  captured_width = width;
  captured_height = height;
  captured_pitch = pitch;
  if (output_stream && fwrite(framebuffer, sizeof(uint16_t), 160 * 144, output_stream) == 160 * 144)
    captured_callbacks++;
}

static void audio_sample(int16_t left, int16_t right) {
  (void)left;
  (void)right;
}

static size_t audio_sample_batch(const int16_t *data, size_t frames) {
  (void)data;
  return frames;
}

static void input_poll(void) {}

static int16_t input_state(unsigned port, unsigned device, unsigned index, unsigned id) {
  (void)port;
  (void)device;
  (void)index;
  (void)id;
  return 0;
}

static void *load_symbol(void *library, const char *name) {
  void *symbol = dlsym(library, name);
  if (!symbol) fprintf(stderr, "missing libretro symbol: %s\n", name);
  return symbol;
}

static uint8_t *read_file(const char *path, size_t *size) {
  FILE *file = fopen(path, "rb");
  if (!file) return NULL;
  if (fseek(file, 0, SEEK_END) || (*size = (size_t)ftell(file)) == 0 || fseek(file, 0, SEEK_SET)) {
    fclose(file);
    return NULL;
  }
  uint8_t *buffer = (uint8_t *)malloc(*size);
  if (!buffer || fread(buffer, 1, *size, file) != *size) {
    free(buffer);
    fclose(file);
    return NULL;
  }
  fclose(file);
  return buffer;
}

int main(int argc, char **argv) {
  if (argc != 6) {
    fprintf(stderr, "usage: cgb001-libretro-smoke CORE ROM RUNS OUTPUT SCRATCH\n");
    return 2;
  }
  const unsigned runs = (unsigned)strtoul(argv[3], NULL, 10);
  scratch_directory = argv[5];
  void *library = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
  if (!library) {
    fprintf(stderr, "cannot load core: %s\n", dlerror());
    return 3;
  }

#define LOAD(name) __typeof__(name) *name##_fn = (__typeof__(name) *)load_symbol(library, #name)
  LOAD(retro_set_environment);
  LOAD(retro_set_video_refresh);
  LOAD(retro_set_audio_sample);
  LOAD(retro_set_audio_sample_batch);
  LOAD(retro_set_input_poll);
  LOAD(retro_set_input_state);
  LOAD(retro_init);
  LOAD(retro_deinit);
  LOAD(retro_get_system_info);
  LOAD(retro_get_system_av_info);
  LOAD(retro_load_game);
  LOAD(retro_unload_game);
  LOAD(retro_run);
#undef LOAD
  if (!retro_set_environment_fn || !retro_set_video_refresh_fn || !retro_set_audio_sample_fn
      || !retro_set_audio_sample_batch_fn || !retro_set_input_poll_fn || !retro_set_input_state_fn
      || !retro_init_fn || !retro_deinit_fn || !retro_get_system_info_fn || !retro_get_system_av_info_fn
      || !retro_load_game_fn || !retro_unload_game_fn || !retro_run_fn) {
    dlclose(library);
    return 4;
  }

  size_t rom_size = 0;
  uint8_t *rom = read_file(argv[2], &rom_size);
  if (!rom) {
    fprintf(stderr, "cannot read ROM\n");
    dlclose(library);
    return 5;
  }
  output_stream = fopen(argv[4], "wb");
  if (!output_stream) {
    fprintf(stderr, "cannot open framebuffer output\n");
    free(rom);
    dlclose(library);
    return 5;
  }
  retro_set_environment_fn(environment);
  retro_set_video_refresh_fn(video_refresh);
  retro_set_audio_sample_fn(audio_sample);
  retro_set_audio_sample_batch_fn(audio_sample_batch);
  retro_set_input_poll_fn(input_poll);
  retro_set_input_state_fn(input_state);
  retro_init_fn();

  struct retro_system_info system_info = {0};
  struct retro_system_av_info av_info = {0};
  retro_get_system_info_fn(&system_info);
  retro_get_system_av_info_fn(&av_info);
  struct retro_game_info game = { argv[2], rom, rom_size, NULL };
  if (!retro_load_game_fn(&game)) {
    fprintf(stderr, "retro_load_game failed\n");
    retro_deinit_fn();
    fclose(output_stream);
    free(rom);
    dlclose(library);
    return 6;
  }
  for (unsigned run = 0; run < runs; run++) retro_run_fn();
  if (captured_width != 160 || captured_height != 144 || captured_callbacks == 0) {
    fprintf(stderr, "no complete 160x144 framebuffer was captured\n");
    fclose(output_stream);
    retro_unload_game_fn();
    retro_deinit_fn();
    free(rom);
    dlclose(library);
    return 7;
  }
  fclose(output_stream);
  printf("library=%s\nversion=%s\nextensions=%s\nformat=%u\nbase=%ux%u\nmax=%ux%u\nfps=%.12f\n"
         "sample_rate=%.12f\ncallbacks=%u\nduplicates=%u\ncaptures=%u\ncaptured=%ux%u\npitch=%zu\n",
    system_info.library_name, system_info.library_version, system_info.valid_extensions,
    (unsigned)requested_format,
    av_info.geometry.base_width, av_info.geometry.base_height,
    av_info.geometry.max_width, av_info.geometry.max_height,
    av_info.timing.fps, av_info.timing.sample_rate,
    video_callbacks, duplicate_callbacks, captured_callbacks, captured_width, captured_height, captured_pitch);

  retro_unload_game_fn();
  retro_deinit_fn();
  free(rom);
  dlclose(library);
  return 0;
}
