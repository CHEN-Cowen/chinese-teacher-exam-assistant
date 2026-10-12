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
  | "schedule";

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
  | "schedule_action_started"; // 日程页点击下一项行动

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
