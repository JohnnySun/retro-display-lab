import { fitFirstOrder } from "./gtg-response.mjs";

function finite(name, value) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

function mean(values) {
  if (!values.length) throw new RangeError("cannot average an empty sample window");
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function parsePhotodiodeCsv(source) {
  if (typeof source !== "string") throw new TypeError("CSV source must be text");
  const lines = source.trim().split(/\r?\n/);
  if (lines[0] !== "time_seconds,detector_response,trigger") {
    throw new Error("photodiode CSV header must be time_seconds,detector_response,trigger");
  }
  const samples = lines.slice(1).map((line, index) => {
    const fields = line.split(",");
    if (fields.length !== 3) throw new Error(`CSV row ${index + 2} has the wrong column count`);
    const [timeSeconds, detectorResponse, trigger] = fields.map(Number);
    finite("time_seconds", timeSeconds);
    finite("detector_response", detectorResponse);
    finite("trigger", trigger);
    return { timeSeconds, detectorResponse, trigger };
  });
  if (samples.length < 3) throw new Error("photodiode CSV needs at least three samples");
  for (let index = 1; index < samples.length; index += 1) {
    if (samples[index].timeSeconds <= samples[index - 1].timeSeconds) {
      throw new Error("photodiode CSV time must be strictly increasing");
    }
  }
  return samples;
}

export function normalizePhotodiodeTransition({
  csv,
  transition,
  sampleRateHz,
  triggerThreshold = 0.5,
}) {
  const samples = parsePhotodiodeCsv(csv);
  const triggerIndex = samples.findIndex((sample, index) => (
    index > 0
    && sample.trigger >= triggerThreshold
    && samples[index - 1].trigger < triggerThreshold
  ));
  if (triggerIndex < 0) throw new Error(`${transition.transitionId}: trigger edge was not found`);
  const triggerTimeSeconds = samples[triggerIndex].timeSeconds;
  const aligned = samples.map((sample) => ({
    timeSeconds: sample.timeSeconds - triggerTimeSeconds,
    detectorResponse: sample.detectorResponse,
  }));
  const expectedStep = 1 / finite("sampleRateHz", sampleRateHz);
  const missingIntervals = [];
  for (let index = 1; index < aligned.length; index += 1) {
    const gap = aligned[index].timeSeconds - aligned[index - 1].timeSeconds;
    if (gap > expectedStep * 1.5) {
      missingIntervals.push({
        afterSeconds: aligned[index - 1].timeSeconds,
        beforeSeconds: aligned[index].timeSeconds,
        gapSeconds: gap,
      });
    }
  }
  const pretrigger = aligned.filter((sample) => (
    sample.timeSeconds <= -expectedStep * 2
  )).map((sample) => sample.detectorResponse);
  const tailStart = aligned[Math.max(0, Math.floor(aligned.length * 0.9))].timeSeconds;
  const tail = aligned.filter((sample) => sample.timeSeconds >= tailStart)
    .map((sample) => sample.detectorResponse);
  const fromPlateau = Number.isFinite(transition.fromPlateau)
    ? transition.fromPlateau
    : mean(pretrigger);
  const toPlateau = Number.isFinite(transition.toPlateau)
    ? transition.toPlateau
    : mean(tail);
  const span = toPlateau - fromPlateau;
  if (Math.abs(span) <= 1e-12) throw new Error(`${transition.transitionId}: plateau span is zero`);
  const post = aligned.filter((sample) => sample.timeSeconds >= 0);
  const timesSeconds = post.map((sample) => sample.timeSeconds);
  const normalizedResponse = post.map((sample) => (
    (sample.detectorResponse - fromPlateau) / span
  ));
  const fit = fitFirstOrder(timesSeconds, normalizedResponse);
  const rejectionReasons = [
    ...fit.rejectionReasons,
    ...(missingIntervals.length ? ["missing-samples"] : []),
    ...(normalizedResponse.at(-1) < 0.98 ? ["censored-settling"] : []),
  ];
  return {
    transitionId: transition.transitionId,
    sceneId: transition.sceneId,
    channel: transition.channel,
    fromCode: transition.fromCode,
    toCode: transition.toCode,
    repetition: transition.repetition,
    row: transition.row,
    frameParity: transition.frameParity,
    eventReference: transition.eventReference,
    triggerTimeSeconds,
    triggerUncertaintySeconds: transition.triggerUncertaintySeconds,
    fromPlateau,
    toPlateau,
    timesSeconds,
    normalizedResponse,
    missingIntervals,
    fit,
    status: rejectionReasons.length ? "rejected" : "accepted",
    rejectionReasons: [...new Set(rejectionReasons)],
  };
}
