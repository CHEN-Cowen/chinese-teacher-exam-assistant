/**
 * 数据指标与异常监控模块的跨层类型契约。
 *
 * 设计原则：
 * - 事件只记录“发生了什么动作”和有限的枚举型维度，不保存公告正文、反馈备注、
 *   纠错描述、链接全文等用户内容；userId 仅保存账号 ID（不保存昵称）。
 * - 指标口径唯一来源是 metrics/domain.ts，任何组件不得自行重复计算比率。
 */
import { UserRole } from "@/types";

/** 业务模块标识：异常定位到模块用，不携带用户内容 */
export type AnalyticsModule =
  | "profile"
  | "opportunity"
  | "target"
  | "evidence"
  | "review"
  | "material"
  | "resource"
  | "plan"
  | "feedback"
  | "replan"
  | "correction"
  | "privacy"
  | "storage"
  | "home"
  | "learn"
  | "schedule"
  | "subscription"
  | "notification";

/**
 * 事件类型。
 * 前 8 个 profile_* / opportunity_* / follow_* / task_started 为 v6.1 P0 闭环事件；
 * 其后 13 个为 v5.2 沿用的用户价值事件；再后为指标/异常所需的内部扩展事件。
 * 均在事件字典中登记，不允许出现“未登记的埋点”。
 */
export type AnalyticsEventType =
  // —— v6.1 P0 闭环事件（8 类；第 9 项“7 日内有效推进”为派生指标，见 metrics/domain） ——
  | "profile_completed"
  | "opportunity_revealed"
  | "match_basis_viewed"
  | "opportunity_followed"
  | "qualification_supplemented"
  | "follow_status_changed"
  | "primary_target_set"
  | "task_started"
  // —— v7.0 模块 7 受邀试用漏斗新增（服务端事件，见后端 trial 模块白名单） ——
  | "profile_step_completed" // 基础画像每步完成（含「暂不提供」，skipped 标记）
  | "opportunity_unfollowed" // 取消关注（不重复计后续漏斗）
  | "material_status_changed" // 报名材料进度变化（to=done 计入「材料完成」）
  | "register_entry_opened" // 进入官方报名入口（产品不代理报名）
  // —— 用户价值事件（13 类） ——
  | "target_created"
  | "evidence_viewed"
  | "source_opened"
  | "material_added"
  | "diagnosis_viewed"
  | "resource_viewed"
  | "resource_added_to_plan"
  | "plan_confirmed"
  | "task_feedback_submitted"
  | "plan_replanned"
  | "weekly_review_completed"
  | "correction_submitted"
  | "data_delete_requested"
  // —— 内部扩展事件（指标/异常） ——
  | "resource_used" // 资源实际使用（加入计划后置为使用中/已使用）
  | "review_completed" // 人工审核完成（记录处理时长、是否修正）
  | "extraction_failed" // AI 提取任务失败
  | "plan_generation_failed" // 计划生成失败（非"数据不足"的正常拦截）
  | "feedback_submit_failed" // 反馈保存失败
  | "critical_write_failed" // 关键数据写入失败
  // —— v6.1 模块 0A 页面体验优化补缺口事件（不含个人信息） ——
  | "home_start_match_clicked" // 首页点击「开始资格预筛」唯一主按钮
  | "learn_opened" // 打开 30 秒说明路径
  | "learn_start_match_clicked" // 从 30 秒说明路径点击"开始匹配"
  | "profile_resumed" // 从首页/草稿恢复上次进度进入问答
  | "preview_summary_edited" // 结果页"修改"回到对应问答组
  | "preview_revealed" // 初步结果曝光
  | "priority_opportunity_viewed" // 查看优先机会
  // —— v7.1 M3 用工形式偏好（结果页三选一，只影响筛选不形成资格结论） ——
  | "nature_preference_changed" // 切换用工形式偏好（public_only/official_open/undecided）
  | "schedule_action_started" // 日程页点击下一项行动
  // —— v7.1 M5 地图轻量入口（只记岗位 ID、入口与地点类别枚举，不记地址/搜索文本） ——
  | "map_entry_clicked"
  // —— v7.1 M9 分析事件与试用看板：为首次体验/地图/订阅/自动日程建立可解释、最少采集、可去重的行为数据 ——
  // 地区考虑程度三档（含「还没想好地区」），不记地区正文
  | "region_preference_selected" // level: determined/considering/undecided
  // 无结果三态曝光（未覆盖/无在报/资格不符），只记 reasonCode 枚举
  | "no_result_reason_viewed" // reasonCode, kind
  // 订阅创建/修改/关闭，只记 action 枚举，不记订阅条件正文
  | "subscription_changed" // action: created/modified/closed
  // 新机会提醒曝光（站内幂等），只记通知 ID 片段
  | "opportunity_notification_viewed" // notificationId
  // 新机会提醒点击跳转，只记通知 ID 片段
  | "opportunity_notification_clicked" // notificationId
  // 日程自动同步成功/失败，只记状态枚举与错误码，不记公告正文
  | "schedule_sync_completed" // status: success/failure, nodeCount, reasonCode
  // 日程节点查看（展开某节点），只记节点类型枚举
  | "schedule_node_viewed" // nodeKind
  // 时间冲突曝光，只记冲突数与涉及节点类型枚举
  | "schedule_conflict_viewed" // conflictCount, nodeKind
  // 公告改期通知查看，只记节点类型枚举，不记改期前后日期正文
  | "announcement_reschedule_viewed" // nodeKind
  // —— v7.2 保存后的下一步：只记动作级别/类型枚举与维度短枚举，绝不记问题正文/原文/答复 ——
  | "next_action_opened" // 保存后唯一主动作曝光：tier(1-5)、kind 枚举
  | "consultation_template_copied" // 复制官方确认问题：tpl 维度短枚举、edited 是否改过
  // —— v7.2 整合收口：结果工作台与定向补充流程（只记枚举，不记任何正文） ——
  | "result_tab_changed" // 结果页三标签切换：tab=priority/supplement/outOfScope
  | "supplement_opened" // 进入定向补充页：origin/bucket 枚举
  | "supplement_recomputed" // 补充保存后重算成功
  | "supplement_returned_to_result"; // 保存后从补充页返回机会结果页

/**
 * 统一分析事件。
 * props 仅允许 string/number/boolean 标量，禁止嵌套对象与自由文本，
 * 失败原因使用短错误码（reasonCode），不回传原始报错全文。
 */
export interface AnalyticsEvent {
  id: string;
  type: AnalyticsEventType;
  /** 发生时间 ISO */
  at: string;
  /** 操作者账号 ID（不含昵称等可识别信息） */
  userId: string;
  userRole: UserRole;
  module: AnalyticsModule;
  /** 关联考试目标 ID（可空） */
  targetId?: string;
  /** live=本浏览器真实操作；seed=演示种子（Mock） */
  source: "live" | "seed";
  props?: Record<string, string | number | boolean>;
}

/** 指标时间范围 */
export type MetricsRangeKey = "7d" | "30d" | "all";

/** 比率/计数的统一展示结构 */
export interface MetricValue {
  /** 分子 */
  numerator: number;
  /** 分母；计数类指标分母为 undefined */
  denominator?: number;
  /** 0-1 比率（分母为 0 时为 null，前端显示“—”） */
  rate: number | null;
}

/** 异常严重度 */
export type AnomalySeverity = "high" | "medium" | "low";

/** 异常监控条目（可定位到模块与时间，不含用户内容） */
export interface AnomalyItem {
  id: string;
  kind: AnalyticsEventType | "review_overdue" | "resource_dead";
  severity: AnomalySeverity;
  module: AnalyticsModule;
  at: string;
  /** 一句话说明（枚举/系统文案，无用户正文） */
  title: string;
  /** 补充细节（ID 片段、错误码等脱敏信息） */
  detail?: string;
  /** 后台处理入口 */
  href?: string;
  /** live=真实检出；seed=演示种子 */
  source: "live" | "seed";
}
