/** node-cron has no bundled types — minimal declaration for what we use. */
declare module 'node-cron' {
  export interface ScheduledTask {
    start(): void
    stop(): void
    destroy(): void
  }
  export interface ScheduleOptions {
    scheduled?: boolean
    timezone?: string
  }
  export function schedule(
    expression: string,
    func: () => void,
    options?: ScheduleOptions,
  ): ScheduledTask
  export function validate(expression: string): boolean
  const _default: { schedule: typeof schedule; validate: typeof validate }
  export default _default
}
