export function parseDuration(value?: string): number {
  if (!value) return 0
  const parts = value.split(':').map(Number)
  if (parts.some(Number.isNaN)) return 0
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 1) return parts[0]
  return 0
}

/** 任务状态 */
export enum TaskStatus {
  Pending = 'pending',
  Running = 'running',
  Cancelled = 'cancelled',
  Completed = 'completed',
}

/** 任务取消错误 */
export class TaskCancelledError extends Error {
  constructor() {
    super('Task Cancelled')
  }
}

interface TaskItem<T> {
  execute: () => Promise<T>
  resolve: (value: T) => void
  reject: (reason: Error) => void
  status: TaskStatus
}

/**
 * 任务调度器（支持取消）
 */
export class Scheduler {
  private running = 0
  private queue: Array<TaskItem<unknown>> = []

  constructor(private readonly limit = 3) {}

  /** 添加任务，返回可取消的 Promise */
  add<T>(task: () => Promise<T>): { promise: Promise<T>; cancel: () => void } {
    let resolve!: (value: T) => void
    let reject!: (reason: Error) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })

    const taskItem: TaskItem<T> = {
      execute: task,
      resolve: resolve as (value: unknown) => void,
      reject: reject as (reason: Error) => void,
      status: TaskStatus.Pending,
    }

    const cancel = () => {
      if (taskItem.status === TaskStatus.Pending) {
        taskItem.status = TaskStatus.Cancelled
        taskItem.reject(new TaskCancelledError())
        // 从队列中移除
        const index = this.queue.indexOf(taskItem as TaskItem<unknown>)
        if (index !== -1) {
          this.queue.splice(index, 1)
        }
      }
    }

    this.enqueue(taskItem as TaskItem<unknown>)

    return { promise, cancel }
  }

  private async enqueue<T>(taskItem: TaskItem<T>): Promise<void> {
    if (this.running >= this.limit) {
      await new Promise<void>((resolve) => {
        const wait = () => {
          if (this.running < this.limit) {
            resolve()
          } else {
            this.queue.push({ execute: async () => {}, resolve: wait as () => void, reject: () => {}, status: TaskStatus.Pending })
          }
        }
        wait()
      })
    }

    // 检查是否已取消
    if (taskItem.status === TaskStatus.Cancelled) {
      return
    }

    this.running += 1
    taskItem.status = TaskStatus.Running

    try {
      const result = await taskItem.execute()
      if ((taskItem.status as TaskStatus) !== TaskStatus.Cancelled) {
        taskItem.status = TaskStatus.Completed
        ;(taskItem.resolve as (value: unknown) => void)(result)
      }
    } catch (error) {
      if ((taskItem.status as TaskStatus) !== TaskStatus.Cancelled) {
        ;(taskItem.reject as (reason: Error) => void)(error as Error)
      }
    } finally {
      this.running -= 1
      // 处理下一个等待的任务
      const next = this.queue.shift()
      if (next && typeof next.resolve === 'function') {
        next.resolve(undefined)
      }
    }
  }
}

/**
 * 创建可见性检测器
 * @param element 目标元素
 * @param onVisible 可见时回调
 * @param onHidden 不可见时回调
 * @param options IntersectionObserver 选项
 */
export function createVisibilityObserver(
  element: HTMLElement,
  onVisible: () => void,
  onHidden: () => void,
  options?: IntersectionObserverInit
): { destroy: () => void } {
  const observer = new IntersectionObserver(
    (entries) => {
      const entry = entries[0]
      if (entry?.isIntersecting) {
        onVisible()
      } else {
        onHidden()
      }
    },
    {
      threshold: 0,
      rootMargin: '100px',
      ...options,
    }
  )

  observer.observe(element)

  return {
    destroy: () => observer.disconnect(),
  }
}

/**
 * 创建滚动停止检测器
 * @param scrollTarget 滚动容器
 * @param onStop 滚动停止时回调
 * @param delay 停止判定延迟（毫秒）
 */
export function createScrollStopDetector(
  scrollTarget: HTMLElement | Window,
  onStop: () => void,
  delay = 150
): { destroy: () => void } {
  let timeoutId: number | undefined

  const onScroll = () => {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
    timeoutId = window.setTimeout(() => {
      onStop()
    }, delay)
  }

  scrollTarget.addEventListener('scroll', onScroll, { passive: true })

  return {
    destroy: () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      scrollTarget.removeEventListener('scroll', onScroll)
    },
  }
}

/**
 * 查找滚动容器
 * 从元素向上查找有滚动条的父容器
 */
export function findScrollContainer(element: HTMLElement): HTMLElement | Window {
  let parent = element.parentElement
  while (parent) {
    const { overflow, overflowY } = getComputedStyle(parent)
    if (/(auto|scroll)/.test(overflow + overflowY)) {
      return parent
    }
    parent = parent.parentElement
  }
  return window
}
