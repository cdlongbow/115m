export function parseDuration(value?: string): number {
  if (!value) return 0
  const parts = value.split(':').map(Number)
  if (parts.some(Number.isNaN)) return 0
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 1) return parts[0]
  return 0
}

export class Scheduler {
  private running = 0
  private queue: Array<() => void> = []

  constructor(private readonly limit = 2) {}

  async add<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve))
    }
    this.running += 1
    try {
      return await task()
    }
    finally {
      this.running -= 1
      this.queue.shift()?.()
    }
  }
}
