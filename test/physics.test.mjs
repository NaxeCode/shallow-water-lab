import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { Flume, GRAVITY, gateRelease } from '../web/lib/solver.mjs';
import { runExperiment, STANDARD } from '../web/lib/experiment.mjs';
import { wetBedReference } from '../web/lib/reference.mjs';
import { benchmark } from '../scripts/benchmark.mjs';

function near(actual, expected, tolerance) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
}

test('an undisturbed pool stays exactly at rest through multiple wall travel times', () => {
  const f = gateRelease({ ...STANDARD, leftDepth: 1.5, rightDepth: 1.5, cells: 120 });
  f.advanceTo(70);
  assert.ok(f.h.every(h => h === 1.5));
  assert.ok(f.q.every(q => q === 0));
  assert.equal(f.time, 70);
});

test('a periodic, moving uniform state keeps both conserved quantities exactly', () => {
  const f = new Flume({ cells: 80, initial: () => [1.2, 1.8], boundary: 'periodic' });
  f.advanceTo(8);
  assert.ok(f.h.every(h => h === 1.2));
  assert.ok(f.q.every(q => q === 1.8));
});

test('the wet-bed reference satisfies both shock jump equations and the fan invariant', () => {
  const l = 2.4, r = 0.6, g = GRAVITY, t = 2;
  const ref = wetBedReference(l, r, g);
  const h = ref.middleDepth, u = ref.velocity, s = ref.shock;
  near(s * (h - r), h * u, 1e-12);
  near(s * h * u, h * u * u + g * (h * h - r * r) / 2, 1e-12);
  const x = (ref.head + ref.tail) * t / 2;
  const [depth, q] = ref.sample(x, t);
  near(q / depth + 2 * Math.sqrt(g * depth), 2 * Math.sqrt(g * l), 1e-12);
  near(ref.meanDepth(s * t - 0.25, s * t + 0.25, t), (h + r) / 2, 1e-12);
  near(ref.meanDepth(-60, 60, t), (l + r) / 2, 1e-12);
  near(ref.meanDepth(-0.75, 0.25, 0), l * 0.75 + r * 0.25, 1e-12);
});

test('extreme controls and still-water baseline stay wet and within the analytical window', () => {
  for (const [leftDepth, rightDepth] of [[3.5, 0.3], [1.5, 1.5]]) {
    const exp = runExperiment({ leftDepth, rightDepth, cells: 120 });
    const last = exp.frames.at(-1);
    assert.ok(last.t * Math.max(-exp.reference.head, exp.reference.shock) < 60);
    for (const frame of exp.frames) {
      assert.ok(frame.h.every(h => Number.isFinite(h) && h > 0));
      assert.ok(frame.q.every(Number.isFinite));
      assert.ok(Math.abs(frame.volumeDifference) < 1e-8);
    }
  }
});

test('after wave reflections, a closed flume still conserves volume', () => {
  const f = gateRelease({ ...STANDARD, cells: 120 });
  const v = f.volume();
  f.advanceTo(45);
  assert.ok(f.h.every(h => h > 0));
  near(f.volume(), v, 1e-9);
});

test('reject dry beds, misaligned gates, excessive CFL and backward integration', () => {
  assert.throws(() => gateRelease({ ...STANDARD, rightDepth: 0 }), /wet/);
  assert.throws(() => gateRelease({ ...STANDARD, cells: 121 }), /even/);
  assert.throws(() => new Flume({ cells: 80, initial: () => [1, 0], cfl: 1 }), /CFL/);
  assert.throws(() => new Flume({ cells: 80, initial: () => [NaN, 0] }), /positive/);
  assert.throws(() => wetBedReference(1, 2, GRAVITY), RangeError);
  const f = gateRelease(STANDARD);
  f.advanceTo(0.1);
  assert.throws(() => f.advanceTo(0), /target/);
  assert.throws(() => f.step(0), /advance/);
});

test('grid refinement resolves the wet-bed release and the independent smooth-wave speed', () => {
  const b = benchmark();
  const dam = b.gate_release.grids, wave = b.periodic_simple_wave.grids;
  const receipt = JSON.parse(readFileSync(new URL('../web/benchmark.json', import.meta.url), 'utf8'));
  assert.deepEqual(receipt.gate_release.grids.map(row => row.cells), dam.map(row => row.cells));
  assert.ok(dam.at(-1).mean_abs_depth_error_m < 0.007);
  assert.ok(dam.at(-1).shock_position_abs_error_m < dam.at(-1).dx_m);
  for (let i = 0; i < dam.length; i++) {
    near(dam[i].mean_abs_depth_error_m, receipt.gate_release.grids[i].mean_abs_depth_error_m, 1e-10);
    near(wave[i].measured_crest_speed_m_per_s, receipt.periodic_simple_wave.grids[i].measured_crest_speed_m_per_s, 1e-8);
    assert.ok(dam[i].max_sampled_volume_drift_m2 < 1e-9);
    assert.ok(dam[i].max_courant <= 0.45 + 1e-14);
    if (i === 0) continue;
    assert.ok(dam[i].observed_depth_error_order > 0.5);
    assert.ok(wave[i].relative_speed_error < wave[i - 1].relative_speed_error);
  }
  assert.ok(wave.at(-1).relative_speed_error < 0.00012);
});
