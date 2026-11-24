import { parseArgs } from 'node:util';
import { GRAVITY, FLUME_LENGTH, gateRelease } from '../web/lib/solver.mjs';
import { wetBedReference } from '../web/lib/reference.mjs';
import { STANDARD, FRAME_SECONDS, meanDepthError } from '../web/lib/experiment.mjs';

const { values } = parseArgs({ options: {
  upstream: { type: 'string', default: String(STANDARD.leftDepth) },
  downstream: { type: 'string', default: String(STANDARD.rightDepth) },
  cells: { type: 'string', default: String(STANDARD.cells) },
  time: { type: 'string', default: '4' },
  csv: { type: 'boolean' }, help: { type: 'boolean' }
} });
if (values.help) {
  console.log('node scripts/run.mjs [--upstream METRES] [--downstream METRES] [--cells EVEN_N] [--time SECONDS] [--csv]');
} else {
  try {
    const leftDepth = Number(values.upstream), rightDepth = Number(values.downstream);
    const time = Number(values.time), cells = Number(values.cells);
    const ref = wetBedReference(leftDepth, rightDepth, GRAVITY);
    const wall = (FLUME_LENGTH / 2) / Math.max(-ref.head, ref.shock);
    if (!(Number.isFinite(time) && time >= 0 && time < wall)) {
      throw new RangeError('Select a finite time before the first wall arrival at ' + wall.toFixed(3) + ' s.');
    }
    const f = gateRelease({ leftDepth, rightDepth, cells });
    const initialVolume = f.volume();
    // Match the browser output times, with an optional final partial frame.
    for (let i = 1; i * FRAME_SECONDS < time; i++) f.advanceTo(i * FRAME_SECONDS);
    f.advanceTo(time);
    if (values.csv) {
      const rows = ['x_center_m,depth_m,discharge_m2_per_s,velocity_m_per_s,exact_cell_mean_depth_m'];
      for (let i = 0; i < cells; i++) {
        const x = f.center(i);
        rows.push([x, f.h[i], f.q[i], f.q[i] / f.h[i], ref.meanDepth(x - f.dx / 2, x + f.dx / 2, time)].join(','));
      }
      console.log(rows.join('\n'));
    } else {
      console.log(JSON.stringify({
        cells, upstream_m: leftDepth, downstream_m: rightDepth, time_s: f.time,
        steps: f.steps, max_courant: f.maxCourant,
        abs_volume_drift_m2: Math.abs(f.volume() - initialVolume),
        mean_abs_depth_error_m: meanDepthError(f.h, f.dx, time, ref)
      }, null, 2));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
