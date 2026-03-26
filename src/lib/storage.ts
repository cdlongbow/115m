/**
 * Chrome Storage 封装
 */

const DEFAULT_AREA = chrome.storage.local

export interface PlayHistoryItem {
  pickCode: string
  fileName: string
  currentTime: number
  duration: number
  quality: string
  updatedAt: number
}

export interface StorageSchema {
  playHistory: Record<string, PlayHistoryItem>
  settings: {
    defaultQuality: number
    volume: number
    playbackRate: number
  }
}

const DEFAULT_STORAGE: StorageSchema = {
  playHistory: {},
  settings: {
    defaultQuality: 9999, // Ultra
    volume: 100,
    playbackRate: 1,
  },
}

class Storage {
  private cache: StorageSchema | null = null

  private async load(): Promise<StorageSchema> {
    if (this.cache) return this.cache
    const data = await DEFAULT_AREA.get('data')
    if (data && typeof data.data === 'string') {
      try {
        this.cache = { ...DEFAULT_STORAGE, ...JSON.parse(data.data) }
      }
      catch {
        this.cache = { ...DEFAULT_STORAGE }
      }
    }
    else {
      this.cache = { ...DEFAULT_STORAGE }
    }
    return this.cache as StorageSchema
  }

  private async save(): Promise<void> {
    if (!this.cache) return
    await DEFAULT_AREA.set({ data: JSON.stringify(this.cache) })
  }

  async getPlayHistory(pickCode: string): Promise<PlayHistoryItem | null> {
    const data = await this.load()
    return data.playHistory[pickCode] ?? null
  }

  async setPlayHistory(item: PlayHistoryItem): Promise<void> {
    const data = await this.load()
    data.playHistory[item.pickCode] = item
    // 只保留最近 200 条
    const entries = Object.entries(data.playHistory)
    if (entries.length > 200) {
      entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      data.playHistory = Object.fromEntries(entries.slice(0, 200))
    }
    await this.save()
  }

  async getSettings(): Promise<StorageSchema['settings']> {
    const data = await this.load()
    return data.settings
  }

  async setSettings(settings: Partial<StorageSchema['settings']>): Promise<void> {
    const data = await this.load()
    data.settings = { ...data.settings, ...settings }
    await this.save()
  }
}

export const storage = new Storage()
