import test from 'node:test'
import assert from 'node:assert/strict'
import { sampleRouteAtFraction } from '../src/routePlayback.ts'

const route = { status: 'ok', path: [[0, 0], [0, 1], [3, 1]], profile: {
  dist: [0, 10, 40], time: [0, 5, 20], energy: [0, 2, 8], slope: [1, 2, 4], risk: [.1, .2, .4],
} }

test('unequal segments are sampled by distance rather than vertex count', () => {
  const sample = sampleRouteAtFraction(route, .5)
  assert.deepEqual(sample.traveler, [1, 1])
  assert.equal(sample.distance, 20)
  assert.equal(sample.time, 10)
  assert.equal(sample.energy, 4)
  assert.ok(Math.abs(sample.index - 4 / 3) < 1e-10)
})

test('arrival and replay positions land exactly on the selected endpoints', () => {
  assert.deepEqual(sampleRouteAtFraction(route, 1).traveler, [3, 1])
  assert.equal(sampleRouteAtFraction(route, 1).index, 2)
  assert.equal(sampleRouteAtFraction(route, 1).energy, 8)
  assert.deepEqual(sampleRouteAtFraction(route, 0).traveler, [0, 0])
})

test('seeking handles the vertex boundary and clamps out-of-range values', () => {
  assert.equal(sampleRouteAtFraction(route, .25).index, 1)
  assert.deepEqual(sampleRouteAtFraction(route, -1).traveler, [0, 0])
  assert.deepEqual(sampleRouteAtFraction(route, 2).traveler, [3, 1])
  assert.deepEqual(sampleRouteAtFraction(route, NaN).traveler, [0, 0])
})

test('unreachable or incomplete route geometry cannot animate', () => {
  assert.equal(sampleRouteAtFraction(undefined, .5), null)
  assert.equal(sampleRouteAtFraction({ status: 'unreachable' }, .5), null)
  assert.equal(sampleRouteAtFraction({ ...route, profile: { ...route.profile, dist: [0] } }, .5), null)
  assert.equal(sampleRouteAtFraction({ ...route, path: [[0, 0]] }, .5), null)
})
