export class Logger {
  name: string
  constructor(name: string) {
    this.name = name
  }
  sub(name: string) {
    return new Logger(`${this.name}:${name}`)
  }
  enableSilentMode() {}
  debug(...args: any[]) {
    // console.debug(`[${this.name}]`, ...args)
  }
  info(...args: any[]) {
    // console.info(`[${this.name}]`, ...args)
  }
  warn(...args: any[]) {
    console.warn(`[${this.name}]`, ...args)
  }
  error(...args: any[]) {
    console.error(`[${this.name}]`, ...args)
  }
  clearLogs() {}
}
export const appLogger = new Logger('115Master')
