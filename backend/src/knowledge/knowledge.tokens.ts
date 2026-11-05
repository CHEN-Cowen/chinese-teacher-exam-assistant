/** W2：知识索引队列契约 */

/** BullMQ 队列名 */
export const KNOWLEDGE_QUEUE_NAME = 'knowledge-index';

/** 任务名 */
export const KNOWLEDGE_INDEX_JOB = 'knowledge.index';

/** 任务载荷：只放业务任务 id，内容以数据库为准（Redis 不存原文） */
export interface KnowledgeIndexPayload {
  jobId: string;
}
