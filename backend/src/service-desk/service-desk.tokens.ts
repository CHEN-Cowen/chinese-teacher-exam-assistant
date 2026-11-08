/** 人工任务内部时限队列（BullMQ） */
export const SERVICE_DESK_QUEUE = 'service-desk-sla';
export const SERVICE_DESK_SCAN_JOB = 'service-desk-scan';
/** 内部试运行扫描间隔：默认 5 分钟；隔离演练可用环境变量缩短（不得用于生产） */
const configuredInterval = Number(process.env.SERVICE_DESK_SCAN_INTERVAL_MS);
export const SERVICE_DESK_SCAN_INTERVAL_MS =
  Number.isFinite(configuredInterval) && configuredInterval > 0
    ? configuredInterval
    : 5 * 60 * 1000;
