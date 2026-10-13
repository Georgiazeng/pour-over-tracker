// ── Pour segmentation algorithm ───────────────────────────────────────────────
function segmentPours(triples) {
  // triples: [[time_ms, beverage_weight_str, scale_weight_str], ...]
  // Column 1 is the beverage (yield) weight, which stays 0 until the end of the brew.
  // Column 2 is the cumulative water on the scale, which is what pours are split from.
  const points = triples.map(t => ({
    ms: Number(t[0]),
    w: parseFloat(t[2])
  }));

  if (points.length === 0) {
    return { pours: [], totalWater: 0, totalTime: 0 };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Step 1: Smooth out large transient spikes
  // ────────────────────────────────────────────────────────────────────────────
  const smoothed = points.map((p, i) => {
    if (i === 0 || i >= points.length - 2) return p;

    const prev = points[i - 1].w;
    const next1 = points[i + 1].w;
    const delta = p.w - prev;
    const recovery = next1 - p.w;

    // If there is a large spike that immediately reverses,
    // replace it with an interpolated value.
    if (
      Math.abs(delta) > 5 &&
      Math.sign(recovery) === -Math.sign(delta)
    ) {
      return {
        ms: p.ms,
        w: (prev + next1) / 2
      };
    }

    return p;
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Step 1b: Remove multi-sample bumps
  //
  // Water on the scale only rises during a pour, so weight that shoots up and
  // falls back within SPIKE_WINDOW_MS is a bump (e.g. leaning on the dripper),
  // not water. Real example from brew 258231: 180 → 338 → 180 g in ~1 s.
  // Each point is capped at the lowest weight seen over the next window
  // (plus a noise allowance). During a real pour the future is higher, so
  // pour points are left untouched.
  // ────────────────────────────────────────────────────────────────────────────
  const SPIKE_WINDOW_MS = 2500;
  const SPIKE_TOLERANCE = 1.0;
  const despiked = smoothed.map((p, i) => {
    let futureMin = p.w;
    for (let j = i + 1; j < smoothed.length && smoothed[j].ms - p.ms <= SPIKE_WINDOW_MS; j++) {
      if (smoothed[j].w < futureMin) futureMin = smoothed[j].w;
    }
    return p.w > futureMin + SPIKE_TOLERANCE ? { ms: p.ms, w: futureMin } : p;
  });
  smoothed.splice(0, smoothed.length, ...despiked);

  // ────────────────────────────────────────────────────────────────────────────
  // Step 2: Parameters
  // ────────────────────────────────────────────────────────────────────────────

  // Look ahead this far to decide whether weight is actually increasing.
  const WINDOW_MS = 500;

  // Minimum cumulative increase over WINDOW_MS to count as active pouring.
  const POUR_THRESHOLD = 0.3;

  // Small scale fluctuations below this are treated as noise.
  const NOISE_TOLERANCE = 0.2;

  // A plateau must last this long before it is considered a real
  // separation between pours.
  const PLATEAU_MIN_DURATION_MS = 2000;

  // Short interruptions during an otherwise continuous pour are tolerated.
  const JITTER_GAP_MS = 1500;

  // ────────────────────────────────────────────────────────────────────────────
  // Step 3: Identify "rising" windows
  // ────────────────────────────────────────────────────────────────────────────
  const rising = smoothed.map((p, i) => {
    const tEnd = p.ms + WINDOW_MS;

    const future = smoothed.filter(
      q => q.ms > p.ms && q.ms <= tEnd
    );

    if (future.length === 0) return false;

    const maxAhead = Math.max(...future.map(q => q.w));

    // Only count meaningful increases.
    // ±0.1–0.2g scale fluctuations do not count as pouring.
    return (maxAhead - p.w) > POUR_THRESHOLD;
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Step 4: Merge short gaps caused by scale noise
  // ────────────────────────────────────────────────────────────────────────────
  const merged = [...rising];

  for (let i = 1; i < smoothed.length - 1; i++) {
    // Only bridge gaps that interrupt a pour (previous point pouring);
    // bridging a plateau would drag the next pour's start time earlier.
    if (!merged[i] && merged[i - 1]) {
      const gapEnd = smoothed.findIndex(
        (p, j) => j > i && merged[j]
      );

      if (gapEnd !== -1) {
        const gapDuration =
          smoothed[gapEnd].ms - smoothed[i - 1].ms;

        if (gapDuration < JITTER_GAP_MS) {
          for (let k = i; k < gapEnd; k++) {
            merged[k] = true;
          }
        }
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Step 5: Extract pour segments
  // ────────────────────────────────────────────────────────────────────────────
  const segments = [];

  let inPour = false;
  let pourStart = 0;

  for (let i = 0; i < smoothed.length; i++) {
    // Start of a pour
    if (merged[i] && !inPour) {
      inPour = true;
      pourStart = i;
      continue;
    }

    // Potential end of a pour
    if (!merged[i] && inPour) {
      const plateauStart = smoothed[i].ms;

      const nextRising = smoothed.findIndex(
        (p, j) => j > i && merged[j]
      );

      const plateauEnd =
        nextRising !== -1
          ? smoothed[nextRising].ms
          : smoothed[smoothed.length - 1].ms;

      const plateauDuration =
        plateauEnd - plateauStart;

      if (
        plateauDuration >= PLATEAU_MIN_DURATION_MS ||
        nextRising === -1
      ) {
        // ─────────────────────────────────────────────────────────────────────
        // IMPORTANT:
        //
        // Do not automatically use i - 1 as the pour endpoint.
        //
        // The scale can fluctuate:
        //
        //   32.3
        //   32.4
        //   32.5  <- actual end of pouring
        //   32.4
        //   32.5
        //   32.4
        //
        // The final points are scale noise, not additional pouring.
        //
        // Find the highest meaningful weight reached before the plateau.
        // ─────────────────────────────────────────────────────────────────────

        let endIdx = i - 1;
        let maxWeight = smoothed[endIdx].w;

        for (let j = i - 1; j >= pourStart; j--) {
          const weight = smoothed[j].w;

          // If this point is meaningfully higher, use it as the endpoint.
          if (weight > maxWeight + NOISE_TOLERANCE) {
            maxWeight = weight;
            endIdx = j;
          }
        }

        // More robustly, find the LAST point that is within the noise
        // tolerance of the maximum weight reached during the pour.
        //
        // This prevents a tiny 0.1–0.2g fluctuation from moving the endpoint.
        const stableMaxWeight = maxWeight;

        for (let j = i - 1; j >= pourStart; j--) {
          if (
            stableMaxWeight - smoothed[j].w <= NOISE_TOLERANCE
          ) {
            endIdx = j;
          } else {
            break;
          }
        }

        segments.push({
          startIdx: pourStart,
          endIdx
        });

        inPour = false;
      }
    }
  }

  // Close final pour
  if (inPour) {
    let endIdx = smoothed.length - 1;

    // Find maximum weight during final pour.
    let maxWeight = smoothed[endIdx].w;

    for (let j = endIdx - 1; j >= pourStart; j--) {
      if (smoothed[j].w > maxWeight) {
        maxWeight = smoothed[j].w;
        endIdx = j;
      }
    }

    // Move endpoint backward through insignificant fluctuations.
    for (let j = endIdx - 1; j >= pourStart; j--) {
      if (
        maxWeight - smoothed[j].w <= NOISE_TOLERANCE
      ) {
        endIdx = j;
      } else {
        break;
      }
    }

    segments.push({
      startIdx: pourStart,
      endIdx
    });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Step 6: Build pour objects
  // ────────────────────────────────────────────────────────────────────────────
  const pourLabels = [
    "Bloom",
    "2nd Pour",
    "3rd Pour",
    "4th Pour",
    "5th Pour"
  ];

  const pours = segments.map((seg, idx) => {
    const startPt = smoothed[seg.startIdx];
    const endPt = smoothed[seg.endIdx];

    // Previous stable endpoint.
    const prevEnd =
      idx > 0
        ? smoothed[segments[idx - 1].endIdx].w
        : 0;

    const volume =
      Math.round(
        (endPt.w - prevEnd) * 10
      ) / 10;

    const startSec =
      Math.round(startPt.ms / 100) / 10;

    const endSec =
      Math.round(endPt.ms / 100) / 10;

    const durationSec =
      Math.round(
        (endPt.ms - startPt.ms) / 100
      ) / 10;

    const avgSpeed =
      durationSec > 0
        ? Math.round(
            (volume / durationSec) * 10
          ) / 10
        : 0;

    return {
      label: pourLabels[idx] || `Pour ${idx + 1}`,
      startSec,
      endSec,
      durationSec,
      volume,
      cumulativeWater:
        Math.round(endPt.w * 10) / 10,
      avgSpeedGps: avgSpeed
    };
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Step 7: Overall brew information
  // ────────────────────────────────────────────────────────────────────────────
  const totalTime =
    smoothed.length > 0
      ? Math.round(
          smoothed[smoothed.length - 1].ms / 100
        ) / 10
      : 0;

  const totalWater =
    smoothed.length > 0
      ? Math.round(
          smoothed[smoothed.length - 1].w * 10
        ) / 10
      : 0;

  return {
    pours,
    totalWater,
    totalTime
  };
}

module.exports = { segmentPours };
