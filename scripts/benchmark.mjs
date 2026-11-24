import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { Flume, CFL, FLUME_LENGTH, GRAVITY, gateRelease } from '../web/lib/solver.mjs';
import { wetBedReference } from '../web/lib/reference.mjs';
import { FRAME_SECONDS, STANDARD, meanDepthError } from '../web/lib/experiment.mjs';

const time = 4;
const grids = [120, 240, 480, 960];

function shockPosition(solver, level) {
  // From downstream, interpolate the first crossing of half the shock jump.
  for (let i = solver.cells - 1; i > 0; i--) {
    if (solver.h[i] <= level && solver.h[i - 1] > level) {
      return solver.center(i - 1) + solver.dx * (solver.h[i - 1] - level) / (solver.h[i - 1] - solver.h[i]);
    }
  }
  throw new Error('The numerical shock did not cross its half-height.');
}

function damBreak(cells, reference) {
  const solver = gateRelease({ ...STANDARD, cells });
  const initialVolume = solver.volume();
  let maxVolumeDrift = 0;
  for (let frame = 1; frame <= Math.round(time / FRAME_SECONDS); frame++) {
    solver.advanceTo(frame * FRAME_SECONDS);
    maxVolumeDrift = Math.max(maxVolumeDrift, Math.abs(solver.volume() - initialVolume));
  }
  const x = shockPosition(solver, (reference.middleDepth + STANDARD.rightDepth) / 2);
  return {
    cells, dx_m: solver.dx, steps: solver.steps,
    mean_abs_depth_error_m: meanDepthError(solver.h, solver.dx, time, reference),
    shock_position_m: x, shock_position_abs_error_m: Math.abs(x - reference.shock * time),
    max_sampled_volume_drift_m2: maxVolumeDrift, max_courant: solver.maxCourant
  };
}

function smoothWave(cells) {
  // The right-running simple wave holds u - 2 sqrt(gh) constant. At its crest,
  // the characteristic speed is constant until characteristics intersect.
  const mean = 1, amplitude = 0.02, start = -15;
  const k = 2 * Math.PI / FLUME_LENGTH;
  const crestDepth = mean + amplitude;
  const expectedSpeed = 3 * Math.sqrt(GRAVITY * crestDepth) - 2 * Math.sqrt(GRAVITY * mean);
  const solver = new Flume({ cells, boundary: 'periodic', initial: x => {
    const h = mean + amplitude * Math.cos(k * (x - start));
    return [h, h * 2 * (Math.sqrt(GRAVITY * h) - Math.sqrt(GRAVITY * mean))];
  } });
  solver.advanceTo(time);
  let peak = 0;
  for (let i = 1; i < cells; i++) if (solver.h[i] > solver.h[peak]) peak = i;
  const a = solver.h[(peak + cells - 1) % cells], b = solver.h[peak], c = solver.h[(peak + 1) % cells];
  const offset = 0.5 * (a - c) / (a - 2 * b + c);
  const position = solver.center(peak) + offset * solver.dx;
  const speed = (position - start) / time;
  return {
    cells, expected_crest_speed_m_per_s: expectedSpeed, measured_crest_speed_m_per_s: speed,
    relative_speed_error: Math.abs(speed / expectedSpeed - 1)
  };
}

export function benchmark() {
  const ref = wetBedReference(STANDARD.leftDepth, STANDARD.rightDepth, GRAVITY);
  const dam = grids.map(n => damBreak(n, ref));
  for (let j = 1; j < dam.length; j++) {
    dam[j].observed_depth_error_order = Math.log2(dam[j - 1].mean_abs_depth_error_m / dam[j].mean_abs_depth_error_m);
  }
  return {
    protocol: 1,
    method: 'First-order finite volume, local Lax-Friedrichs flux, forward Euler',
    channel_length_m: FLUME_LENGTH, g_m_per_s2: GRAVITY, target_courant: CFL,
    gate_release: {
      upstream_m: STANDARD.leftDepth, downstream_m: STANDARD.rightDepth, sample_time_s: time,
      volume_sample_interval_s: FRAME_SECONDS, initial_volume_per_unit_width_m2: (STANDARD.leftDepth + STANDARD.rightDepth) * FLUME_LENGTH / 2,
      exact_plateau_depth_m: ref.middleDepth, exact_shock_position_m: ref.shock * time,
      exact_shock_speed_m_per_s: ref.shock, grids: dam
    },
    periodic_simple_wave: {
      initial_depth_m: '1 + 0.02 cos(2π(x + 15)/120)', sample_time_s: time,
      grids: grids.map(smoothWave)
    }
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { values } = parseArgs({ options: { write: { type: 'string' } } });
  const output = JSON.stringify(benchmark(), null, 2) + '\n';
  if (values.write) await writeFile(values.write, output);
  else process.stdout.write(output);
}
