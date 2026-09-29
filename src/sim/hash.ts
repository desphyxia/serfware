/** Incremental FNV-1a style hashing of simulation state, used for desync checksums. */
export class StateHasher {
  private h = 0x811c9dc5;

  int(v: number): this {
    this.h = Math.imul(this.h ^ (v | 0), 0x01000193) >>> 0;
    return this;
  }

  /** Hash a float by its exact bit pattern. */
  float(v: number): this {
    FLOAT_VIEW[0] = v;
    return this.int(INT_VIEW[0] as number).int(INT_VIEW[1] as number);
  }

  str(s: string): this {
    for (let i = 0; i < s.length; i++) this.int(s.charCodeAt(i));
    return this.int(s.length);
  }

  value(): number {
    return this.h >>> 0;
  }
}

const BUFFER = new ArrayBuffer(8);
const FLOAT_VIEW = new Float64Array(BUFFER);
const INT_VIEW = new Int32Array(BUFFER);
