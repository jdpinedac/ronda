import { describe, it, expect } from 'vitest';
import { createProfile, addToProfile, profileMs, nearestProfile } from '../src/engine/profiles.js';

/**
 * A profile is what an introduction leaves behind: the embeddings of one
 * named person, summarised as a duration-weighted centroid. Attribution then
 * asks which centroid a new sample is nearest to, and by how much.
 */
const unit = (...xs: number[]) => { const n = Math.hypot(...xs); return Float32Array.from(xs, (x) => x / n); };

describe('a speaker profile', () => {
  it('starts empty, with no centroid and no speech', () => {
    const p = createProfile();
    expect(p.centroid).toBeNull();
    expect(profileMs(p)).toBe(0);
  });

  it('weights its centroid by how long each sample lasted', () => {
    const p = createProfile();
    addToProfile(p, unit(1, 0), 3000);
    addToProfile(p, unit(0, 1), 1000);
    expect(profileMs(p)).toBe(4000);
    const c = p.centroid!;
    expect(c[0]).toBeCloseTo(3 / Math.hypot(3, 1), 5);
    expect(c[1]).toBeCloseTo(1 / Math.hypot(3, 1), 5);
  });
});

describe('nearestProfile', () => {
  it('is null when no profile has heard anyone yet', () => {
    expect(nearestProfile(unit(1, 0), [createProfile(), createProfile()])).toBeNull();
  });

  it('names the closest profile and how far the runner-up was', () => {
    const a = createProfile(); addToProfile(a, unit(1, 0), 1000);
    const b = createProfile(); addToProfile(b, unit(0, 1), 1000);
    const empty = createProfile();
    const hit = nearestProfile(unit(0.9, 0.1), [empty, a, b])!;
    expect(hit.index).toBe(1);
    expect(hit.distance).toBeLessThan(0.1);
    // Margin: runner-up's distance minus the winner's. Here nearly 1.
    expect(hit.margin).toBeGreaterThan(0.8);
  });

  it('reports no margin when only one profile exists', () => {
    const a = createProfile(); addToProfile(a, unit(1, 0), 1000);
    expect(nearestProfile(unit(0, 1), [a])!.margin).toBe(Infinity);
  });
});
