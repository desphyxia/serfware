/** Binary min-heap on (priority, id) pairs. Ties break on id, so results are deterministic. */
export class MinHeap {
  private readonly pri: number[] = [];
  private readonly ids: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: number, priority: number): void {
    this.pri.push(priority);
    this.ids.push(id);
    let i = this.ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }

  /** Remove and return the id with the lowest priority, or -1 if empty. */
  pop(): number {
    const n = this.ids.length;
    if (n === 0) return -1;
    const top = this.ids[0] as number;
    const lastId = this.ids.pop() as number;
    const lastPri = this.pri.pop() as number;
    if (n > 1) {
      this.ids[0] = lastId;
      this.pri[0] = lastPri;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.ids.length && this.less(l, m)) m = l;
        if (r < this.ids.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  peekPriority(): number {
    return this.pri[0] ?? Infinity;
  }

  private less(a: number, b: number): boolean {
    const pa = this.pri[a] as number;
    const pb = this.pri[b] as number;
    return pa < pb || (pa === pb && (this.ids[a] as number) < (this.ids[b] as number));
  }

  private swap(a: number, b: number): void {
    const p = this.pri[a] as number;
    this.pri[a] = this.pri[b] as number;
    this.pri[b] = p;
    const d = this.ids[a] as number;
    this.ids[a] = this.ids[b] as number;
    this.ids[b] = d;
  }
}
