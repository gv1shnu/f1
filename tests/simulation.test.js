import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../public/js/circuit.js';
import { Car } from '../public/js/car.js';
import { drive } from '../scripts/simulation/driver.js';
test('three recording drivers finish valid laps on separate lines', () => {
  const track = new Circuit();
  for (let slot = 0; slot < 3; slot++) {
    const car = new Car(track, slot);
    let offTrack = 0;
    for (let frame = 0; frame < 120 * 60 && car.lap < 2; frame++) {
      const result = drive(
        car,
        1 / 60,
        [1, 0.996, 1.02][slot],
        [-3, 3, 0][slot],
      );
      if (result.offTrack) offTrack++;
    }
    assert.equal(offTrack, 0);
    assert.equal(car.lap, 2);
    assert.ok(car.bestLap > 60000 && car.bestLap < 120000);
  }
});
