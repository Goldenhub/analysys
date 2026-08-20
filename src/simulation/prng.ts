/**
 * Seeded PRNG using xoshiro128** algorithm.
 * Produces deterministic float sequences in [0, 1) given a seed.
 */
export class SeededRNG {
  private state: Uint32Array;

  constructor(seed: number) {
    this.state = new Uint32Array(4);
    let s = seed >>> 0;
    for (let i = 0; i < 4; i++) {
      s += 0x9e3779b9;
      let t = s ^ (s >>> 16);
      t = Math.imul(t, 0x21f0aaad);
      t ^= t >>> 15;
      t = Math.imul(t, 0x735a2d97);
      t ^= t >>> 15;
      this.state[i] = t >>> 0;
    }
  }

  /** Returns a float in [0, 1) */
  next(): number {
    const s = this.state;
    const result = this.rotl(Math.imul(s[1]!, 5), 7);
    const out = (Math.imul(result, 9) >>> 0) / 0x100000000;

    const t = s[1]! << 9;
    s[2] = s[2]! ^ s[0]!;
    s[3] = s[3]! ^ s[1]!;
    s[1] = s[1]! ^ s[2]!;
    s[0] = s[0]! ^ s[3]!;
    s[2] = s[2]! ^ t;
    s[3] = this.rotl(s[3]!, 11);

    return out;
  }

  /** Exponential distribution (for Poisson inter-arrival times) */
  exponential(rate: number): number {
    // -ln(1 - U) / rate, where U ~ Uniform(0,1)
    return -Math.log(1 - this.next()) / rate;
  }

  /** Poisson-distributed sample using inverse transform */
  poisson(lambda: number): number {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1.0;
    do {
      k++;
      p *= this.next();
    } while (p > L);
    return k - 1;
  }

  /** Normal distribution via Box-Muller transform */
  normal(mean: number, stdDev: number): number {
    const u1 = this.next();
    const u2 = this.next();
    const z = Math.sqrt(-2 * Math.log(u1 || 1e-10)) * Math.cos(2 * Math.PI * u2);
    return mean + z * stdDev;
  }

  /** Returns a non-negative sample from a normal distribution (clamped at 0) */
  normalPositive(mean: number, stdDev: number): number {
    return Math.max(0, this.normal(mean, stdDev));
  }

  private rotl(x: number, k: number): number {
    return (x << k) | (x >>> (32 - k));
  }
}
