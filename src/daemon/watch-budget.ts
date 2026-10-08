export const DEFAULT_MAX_DIRECTORY_WATCHERS = 2_048;
export const DEFAULT_MAX_DAEMON_WATCHERS = 8_192;

/** Shared by every root in one daemon; reservations precede fs.watch. */
export class DirectoryWatchBudget {
  private registered = 0;

  constructor(readonly maximum = DEFAULT_MAX_DAEMON_WATCHERS) {
    if (!Number.isSafeInteger(maximum) || maximum < 1) {
      throw new RangeError(
        "The directory watch budget must be a positive integer.",
      );
    }
  }

  reserve(): boolean {
    if (this.registered >= this.maximum) return false;
    this.registered += 1;
    return true;
  }

  release(): void {
    this.registered = Math.max(0, this.registered - 1);
  }

  snapshot(): { registered: number; maximum: number } {
    return { registered: this.registered, maximum: this.maximum };
  }
}
