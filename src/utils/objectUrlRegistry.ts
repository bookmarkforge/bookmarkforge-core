/** Tracks temporary Blob URLs so callers can release them with their owner. */
export class ObjectUrlRegistry {
  private readonly urls = new Set<string>();

  create(value: Blob | MediaSource): string {
    const url = URL.createObjectURL(value);
    this.urls.add(url);
    return url;
  }

  revoke(url: string): void {
    if (!this.urls.delete(url)) {return;}
    URL.revokeObjectURL(url);
  }

  revokeAll(): void {
    for (const url of this.urls) {
      URL.revokeObjectURL(url);
    }
    this.urls.clear();
  }

  /** Revoke tracked URLs no longer referenced by the current editor value. */
  revokeUnreferenced(value: unknown): void {
    const referenced = new Set<string>();
    const visited = new WeakSet<object>();
    const collect = (current: unknown): void => {
      if (typeof current === "string") {
        if (this.urls.has(current)) {referenced.add(current);}
        return;
      }
      if (!current || typeof current !== "object") {return;}
      if (visited.has(current)) {return;}
      visited.add(current);
      for (const child of Object.values(current)) {
        collect(child);
      }
    };

    try {
      collect(value);
    } catch (_err) {
      // If the editor value cannot be inspected, retain URLs rather than
      // revoking an image that may still be in use.
      return;
    }

    for (const url of this.urls) {
      if (!referenced.has(url)) {this.revoke(url);}
    }
  }

  get size(): number {
    return this.urls.size;
  }
}
