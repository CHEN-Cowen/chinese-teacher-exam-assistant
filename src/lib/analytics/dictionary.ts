/**
 * 事件字典与指标字典：统一口径的唯一登记处。
 *
 * - 新增埋点必须先在 EVENT_DICTIONARY 登记；
 * - 指标的名称、口径、数据来源、是否随时间范围变化以 METRIC_DICTIONARY 为准，
 *   UI 与 README 均从这里取说明，避免不同组件各自解释。
 */
import { AnalyticsEventType } from "./types";

export interface EventDictionaryEntry {
  type: AnalyticsEventType;
  label: string;
  /** 触发时机（在哪个动作/模块写入） */
  trigger: string;
  /** 记录的维度（不含用户正文） */
  properties: string;
  /** 是否需求规定的 13 类用户价值事件 */
  core: boolean;
}

export const EVENT_DICTIONARY: EventDictionaryEntry[] = [
  // —— v6.1 P0 闭环事件（9 项漏斗口径；第 9 项为派生指标 meaningful_progress_7d） ——
  {
    type: "profile_completed",
    label: "完成基础画像",
    trigger: "访客五组问答（地区/学历/专业/毕业状态/教资）走到最后一步并生成初步结果；同一用户只记一次",
    properties: "问答步数 stepCount；不含任何画像正文",
    core: false,
  },
  {
    type: "opportunity_revealed",
    label: "获得至少一个有效机会",
    trigger: "画像/补问提交后匹配成功，且初步符合分组至少 1 个机会；同一用户同画像只记一次",
    properties: "有效机会数 validCount、机会单元ID",
    core: false,
  },
  {
    type: "match_basis_viewed",
    label: "查看匹配依据",
    trigger: "机会详情/预览卡展开官方依据（同一会话每机会只记一次）",
    properties: "机会单元ID、依据字段数",
    core: false,
  },
  {
    type: "opportunity_followed",
    label: "关注机会",
    trigger: "机会详情点击“关注/我在跟这个机会”且后端关注成功",
    properties: "机会单元ID、关注前所在分组",
    core: false,
  },
  {
    type: "qualification_supplemented",
    label: "补充资格信息",
    trigger: "机会详情补问表单（年龄/户籍/社保/经历/特有条件）保存成功并触发重算",
    properties: "机会单元ID、补问维度枚举、字段数；不记录答案正文",
    core: false,
  },
  {
    type: "follow_status_changed",
    label: "标记报名状态",
    trigger: "关注机会上标记准备报名/已报名（或其他报名状态流转）成功",
    properties: "机会单元ID、流转前后状态枚举 from/to",
    core: false,
  },
  {
    type: "primary_target_set",
    label: "设为主要目标",
    trigger: "机会详情“设为主要目标”确认成功（含与旧主目标的替换）",
    properties: "机会单元ID",
    core: false,
  },
  {
    type: "task_started",
    label: "开始第一项学习任务",
    trigger: "备考页首个任务点击“开始做”进入执行；同一用户只记一次",
    properties: "计划ID、任务序号",
    core: false,
  },
  // —— v7.0 模块 7 受邀试用漏斗新增（同时登记在后端 trial 白名单） ——
  {
    type: "profile_step_completed",
    label: "完成画像单步",
    trigger: "基础画像每组问答点「下一步」完成时（选「暂不提供」同样记录，skipped=1）",
    properties: "步号 step、是否暂不提供 skipped；不含任何答案正文",
    core: false,
  },
  // —— v7.1 M3 用工形式偏好（结果页三选一，只影响筛选不形成资格结论） ——
  {
    type: "nature_preference_changed",
    label: "切换用工形式偏好",
    trigger: "结果页用工形式偏好卡点选「只看事业编/也接受其他官方用工形式/暂不确定」时",
    properties: "偏好枚举 value（public_only/official_open/undecided）；不含任何画像正文",
    core: false,
  },
  {
    type: "opportunity_unfollowed",
    label: "取消关注机会",
    trigger: "机会详情「取消关注」成功",
    properties: "机会单元ID；取消后不重复计后续漏斗阶段",
    core: false,
  },
  {
    type: "material_status_changed",
    label: "报名材料进度变化",
    trigger: "报名材料清单某项完成状态保存成功（只记进度枚举，不采集证件信息）",
    properties: "机会单元ID、新状态枚举 to（done 计入「材料完成」）",
    core: false,
  },
  {
    type: "register_entry_opened",
    label: "进入官方报名入口",
    trigger: "点击「进入官方报名入口」在新标签打开官方地址（同一用户同机会只记一次）",
    properties: "机会单元ID；不记录 URL 与报名操作内容",
    core: false,
  },
  {
    type: "target_created",
    label: "创建目标考试",
    trigger: "目标澄清页/我的考试页保存目标成功后（examTargetService.persistNew）",
    properties: "目标ID、是否达到计划门禁 ready、目标状态；无地区正文",
    core: true,
  },
  {
    type: "evidence_viewed",
    label: "查看证据卡",
    trigger: "用户在我的考试页打开“考情画像”标签（同一会话每目标只记一次）",
    properties: "目标ID",
    core: true,
  },
  {
    type: "source_opened",
    label: "打开原始来源",
    trigger: "在证据卡点击“打开原始来源”链接",
    properties: "目标ID、字段枚举；不记录链接 URL",
    core: true,
  },
  {
    type: "material_added",
    label: "新增私有资料",
    trigger: "资料页新增资料成功（materialService.create）",
    properties: "目标ID、资料来源类型枚举",
    core: true,
  },
  {
    type: "diagnosis_viewed",
    label: "查看资料诊断",
    trigger: "资料页打开“诊断与缺口”标签（同一会话每目标只记一次）",
    properties: "目标ID",
    core: true,
  },
  {
    type: "resource_viewed",
    label: "查看公共资源",
    trigger: "点击资源“查看来源”（resourceService.recordView，不去重）",
    properties: "资源ID",
    core: true,
  },
  {
    type: "resource_added_to_plan",
    label: "资源加入计划",
    trigger: "缺口资源点击“加入本周计划”成功（resourceService.addToPlan）",
    properties: "目标ID、资源ID、缺口模块枚举",
    core: true,
  },
  {
    type: "plan_confirmed",
    label: "确认周计划",
    trigger: "草稿计划被确认执行（planService.confirmPlan；kind=initial 首版 / replan 重排版）",
    properties: "目标ID、计划ID、开始日期、版本、首版/重排",
    core: true,
  },
  {
    type: "task_feedback_submitted",
    label: "提交任务反馈",
    trigger: "今天页提交执行反馈成功（feedbackService.submit，修改不计新事件）",
    properties: "目标/计划ID、日期、第几天、完成状态枚举、是否核心任务；不记录备注",
    core: true,
  },
  {
    type: "plan_replanned",
    label: "确认重排计划",
    trigger: "重排草稿被确认（confirmPlan 中版本 v2+ 或重排面板确认）",
    properties: "目标ID、计划ID、前后版本号",
    core: true,
  },
  {
    type: "weekly_review_completed",
    label: "完成周复盘",
    trigger: "第 7 天/计划完结后生成周复盘（replanService.generateReview）",
    properties: "目标ID、计划ID",
    core: true,
  },
  {
    type: "correction_submitted",
    label: "提交纠错",
    trigger: "用户提交纠错成功（correctionService.submit）",
    properties: "目标ID、纠错对象类型枚举；不记录描述与建议正文",
    core: true,
  },
  {
    type: "data_delete_requested",
    label: "申请删除个人数据",
    trigger: "设置/治理页发起删除申请（privacyService.initiateDeletion）",
    properties: "目标ID、申请范围类别总数",
    core: true,
  },
  {
    type: "resource_used",
    label: "资源实际使用（扩展）",
    trigger: "加入计划的资源状态变为使用中/已使用（updateLinkStatus）",
    properties: "目标ID、资源ID、新阶段枚举",
    core: false,
  },
  {
    type: "review_completed",
    label: "人工审核完成（扩展）",
    trigger: "后台提交审核动作成功（adminReviewService.submitReview）",
    properties: "动作枚举、处理时长分钟、是否高影响、是否修正、证据归属用户ID",
    core: false,
  },
  {
    type: "extraction_failed",
    label: "AI提取失败（扩展）",
    trigger: "公告提取任务结束为失败（evidenceService.startExtraction catch）",
    properties: "目标ID、任务ID、错误码",
    core: false,
  },
  {
    type: "plan_generation_failed",
    label: "计划生成失败（扩展）",
    trigger: "门禁通过后的计划生成/持久化失败（“数据不足”的正常拦截不计）",
    properties: "目标ID、错误码",
    core: false,
  },
  {
    type: "feedback_submit_failed",
    label: "反馈保存失败（扩展）",
    trigger: "反馈写入存储失败（feedbackService.submit 持久化异常）",
    properties: "目标ID、错误码",
    core: false,
  },
  {
    type: "critical_write_failed",
    label: "关键写入失败（扩展）",
    trigger: "目标/资料/纠错/删除申请等关键写入持久化失败",
    properties: "模块枚举、存储键名、错误码；不含报错原文",
    core: false,
  },
  // —— v6.1 模块 0A 页面体验优化补缺口事件（不含个人信息） ——
  {
    type: "home_start_match_clicked",
    label: "首页开始资格预筛",
    trigger: "首页点击「开始资格预筛」唯一主按钮（v7.1 M1 单一入口）",
    properties: "无；不含画像正文",
    core: false,
  },
  {
    type: "learn_opened",
    label: "打开 30 秒说明",
    trigger: "从首页「先了解我们怎么判断」入口进入 /learn",
    properties: "无",
    core: false,
  },
  {
    type: "learn_start_match_clicked",
    label: "从说明开始匹配",
    trigger: "在 /learn 页面点击「开始匹配」",
    properties: "无",
    core: false,
  },
  {
    type: "profile_resumed",
    label: "恢复上次进度",
    trigger: "首页因访客草稿进行中而 replace 到 /onboarding",
    properties: "无",
    core: false,
  },
  {
    type: "preview_summary_edited",
    label: "回答摘要修改",
    trigger: "结果页顶部摘要中点击「修改」回到对应问答组",
    properties: "步号 step；不含答案正文",
    core: false,
  },
  {
    type: "preview_revealed",
    label: "初步结果曝光",
    trigger: "结果页首次渲染出至少一个机会",
    properties: "优先机会数；不含机会正文",
    core: false,
  },
  {
    type: "priority_opportunity_viewed",
    label: "查看优先机会",
    trigger: "结果页/列表页点击查看优先机会",
    properties: "机会单元ID",
    core: false,
  },
  {
    type: "schedule_action_started",
    label: "日程行动",
    trigger: "日程页点击下一项行动按钮",
    properties: "机会单元ID、行动类型枚举",
    core: false,
  },
  // —— v7.1 M9 分析事件与试用看板（为首次体验/地图/订阅/自动日程建立可解释行为数据） ——
  {
    type: "region_preference_selected",
    label: "地区考虑程度选择",
    trigger: "画像地区步骤选择三档（确定该地区/还在考虑/还没想好）时",
    properties: "level 枚举（determined/considering/undecided）；不记地区正文",
    core: false,
  },
  {
    type: "no_result_reason_viewed",
    label: "无结果原因曝光",
    trigger: "无结果反馈组件首次渲染（未覆盖/无在报/资格不符三态）",
    properties: "reasonCode 枚举、kind 枚举；不记机会正文",
    core: false,
  },
  {
    type: "subscription_changed",
    label: "订阅创建/修改/关闭",
    trigger: "用户创建、修改或关闭新机会订阅",
    properties: "action 枚举（created/modified/closed）；不记订阅条件正文",
    core: false,
  },
  {
    type: "opportunity_notification_viewed",
    label: "新机会提醒曝光",
    trigger: "站内新机会提醒首次展示给用户（幂等，每通知每用户只记一次）",
    properties: "通知ID片段；不记机会正文",
    core: false,
  },
  {
    type: "opportunity_notification_clicked",
    label: "新机会提醒点击",
    trigger: "用户点击新机会提醒跳转到机会详情",
    properties: "通知ID片段；不记机会正文",
    core: false,
  },
  {
    type: "schedule_sync_completed",
    label: "日程自动同步",
    trigger: "多岗位日程自动同步完成（成功或失败）",
    properties: "status 枚举（success/failure）、节点数 nodeCount、失败时 reasonCode；不记公告正文",
    core: false,
  },
  {
    type: "schedule_node_viewed",
    label: "日程节点查看",
    trigger: "用户在日程页展开/查看某个报考节点",
    properties: "nodeKind 枚举；不记节点正文",
    core: false,
  },
  {
    type: "schedule_conflict_viewed",
    label: "时间冲突曝光",
    trigger: "日程页检测到时间冲突并首次向用户展示冲突提醒",
    properties: "conflictCount、nodeKind 枚举；不记冲突正文",
    core: false,
  },
  {
    type: "announcement_reschedule_viewed",
    label: "公告改期通知查看",
    trigger: "用户查看公告改期/延期通知",
    properties: "nodeKind 枚举；不记改期前后日期正文",
    core: false,
  },
  // —— v7.2 保存后的下一步 + 官方确认（只记枚举，不记任何正文） ——
  {
    type: "next_action_opened",
    label: "保存后下一步曝光",
    trigger: "保存机会后，保存区唯一主动作面板随动作 key 变化曝光",
    properties: "tier 数字 1-5、kind 动作类型枚举；不记岗位以外的任何正文",
    core: false,
  },
  {
    type: "consultation_template_copied",
    label: "复制官方确认问题",
    trigger: "MANUAL_REVIEW 官方确认面板点击复制咨询问题",
    properties: "tpl 维度短枚举（如 major）、edited 布尔；绝不记问题正文/原文/答复",
    core: false,
  },
];

export type MetricCategory = "user_value" | "quality_ops" | "stock" | "trial";

export interface MetricDictionaryEntry {
  key: string;
  label: string;
  category: MetricCategory;
  /** 统一口径 */
  formula: string;
  /** 数据来源说明 */
  dataSource: string;
  /** 是否随时间范围筛选变化（存量类指标恒为 false） */
  timeFiltered: boolean;
}

export const METRIC_DICTIONARY: MetricDictionaryEntry[] = [
  {
    key: "p0_funnel",
    label: "P0 闭环漏斗",
    category: "user_value",
    formula:
      "9 个去重用户阶段：①完成基础画像 ②获得至少一个有效机会 ③查看匹配依据 ④关注机会 ⑤补充资格信息 ⑥标记准备报名/已报名 ⑦设为主要目标 ⑧开始第一项学习任务 ⑨7 日内完成有效推进动作；⑤⑥对同批用户不要求全部经过，⑥取 follow_status_changed 到达 preparing/registered，⑨=画像完成后 7 天内出现 任务反馈/计划确认/报名状态推进 的去重用户",
    dataSource:
      "profile_completed / opportunity_revealed / match_basis_viewed / opportunity_followed / qualification_supplemented / follow_status_changed / primary_target_set / task_started 事件 + 派生（task_feedback_submitted、plan_confirmed）",
    timeFiltered: true,
  },
  {
    key: "meaningful_progress_7d",
    label: "7日内有效推进率",
    category: "user_value",
    formula:
      "完成画像后 7×24 小时内出现任意有效推进动作（开始任务/提交任务反馈/确认计划/标记准备报名或已报名/设为主要目标）的去重用户数 ÷ 完成基础画像的去重用户数",
    dataSource: "profile_completed 及上述推进类事件的 at 时间差",
    timeFiltered: true,
  },
  {
    key: "first_fill_rate",
    label: "首次填写完成率",
    category: "user_value",
    formula: "时间范围内创建目标且达到计划门禁的去重用户数 ÷ 创建目标的去重用户数",
    dataSource: "target_created 事件（live 真实操作 / seed 演示种子）",
    timeFiltered: true,
  },
  {
    key: "evidence_view_rate",
    label: "证据卡查看率",
    category: "user_value",
    formula: "时间范围内查看过证据卡的去重用户数 ÷ 创建目标的去重用户数（同队列）",
    dataSource: "evidence_viewed / target_created 事件",
    timeFiltered: true,
  },
  {
    key: "plan_confirm_rate",
    label: "计划确认率",
    category: "user_value",
    formula: "时间范围内确认首版计划（kind=initial）的去重用户数 ÷ 创建目标的去重用户数",
    dataSource: "plan_confirmed / target_created 事件",
    timeFiltered: true,
  },
  {
    key: "feedback_day_rates",
    label: "第1/4/7天反馈完成率",
    category: "user_value",
    formula:
      "分母=已到达第 N 天的首版计划数（开始日期+N-1 ≤ 今天）；分子=第 N 天存在任意任务反馈的计划数",
    dataSource: "plan_confirmed 与 task_feedback_submitted 事件（planId/startDate/dayIndex）",
    timeFiltered: true,
  },
  {
    key: "core_completed_days",
    label: "7天内完成核心任务的平均天数",
    category: "user_value",
    formula:
      "对时间范围内确认、且有反馈的首版计划，统计核心任务（isCore=1）反馈为“完成”的不同日期数，再求平均",
    dataSource: "task_feedback_submitted 事件",
    timeFiltered: true,
  },
  {
    key: "restart_rate",
    label: "中断后重新开始率",
    category: "user_value",
    formula:
      "出现过“未完成”反馈、且其后又出现“完成/部分完成”反馈的去重用户数 ÷ 出现过“未完成”反馈的去重用户数",
    dataSource: "task_feedback_submitted 事件",
    timeFiltered: true,
  },
  {
    key: "resource_conversion",
    label: "资源查看→加入→使用转化",
    category: "user_value",
    formula:
      "三级去重用户数：查看资源 / 加入本周计划 / 实际使用（使用中或已使用）；逐级计算转化率",
    dataSource: "resource_viewed / resource_added_to_plan / resource_used 事件",
    timeFiltered: true,
  },
  {
    key: "closed_loop_users",
    label: "完整闭环用户数",
    category: "user_value",
    formula:
      "同一时间范围内同时具备 确认首版计划 + 提交任务反馈 + 完成周复盘 的去重用户数",
    dataSource: "plan_confirmed / task_feedback_submitted / weekly_review_completed 事件",
    timeFiltered: true,
  },
  {
    key: "pending_high_impact",
    label: "高影响事实待审核数量",
    category: "stock",
    formula: "全部证据中 reviewStatus=pending_review 且属于 5 个高影响字段的条目数（实时存量）",
    dataSource: "kb_evidence_items 业务数据（本地 Mock）",
    timeFiltered: false,
  },
  {
    key: "review_avg_minutes",
    label: "审核平均处理时间",
    category: "quality_ops",
    formula: "时间范围内 review_completed 事件 durationMinutes 的算术平均（提交/上次更新→审核完成）",
    dataSource: "review_completed 事件",
    timeFiltered: true,
  },
  {
    key: "ai_edit_rate",
    label: "AI提取人工修正率",
    category: "quality_ops",
    formula: "approve_with_edit 次数 ÷（通过 + 修改后通过 + 驳回）次数",
    dataSource: "review_completed 事件 action 维度",
    timeFiltered: true,
  },
  {
    key: "correction_count",
    label: "用户纠错数量",
    category: "quality_ops",
    formula: "时间范围内 correction_submitted 事件数（另展示待处理存量）",
    dataSource: "correction_submitted 事件 + kb_corrections 存量",
    timeFiltered: true,
  },
  {
    key: "retraction_count",
    label: "错误结论撤回数量",
    category: "quality_ops",
    formula: "时间范围内创建的撤回留痕条数",
    dataSource: "kb_retraction_logs 业务数据",
    timeFiltered: true,
  },
  {
    key: "affected_users",
    label: "受影响用户数量",
    category: "quality_ops",
    formula: "时间范围内撤回记录 impact.userIds 的去重并集",
    dataSource: "kb_retraction_logs 业务数据",
    timeFiltered: true,
  },
  {
    key: "resource_dead_rate",
    label: "资源链接失效率",
    category: "stock",
    formula:
      "（链接不可访问 + 已过失效时间）资源数 ÷ 除“已停用”外的资源总数；超 180 天未复核单列预警",
    dataSource: "kb_public_resources 业务数据（实时存量）",
    timeFiltered: false,
  },
  {
    key: "plan_fail_rate",
    label: "计划生成失败率",
    category: "quality_ops",
    formula: "plan_generation_failed 事件数 ÷（首版计划确认数 + 计划生成失败数）",
    dataSource: "plan_generation_failed / plan_confirmed 事件",
    timeFiltered: true,
  },
  {
    key: "feedback_fail_rate",
    label: "反馈提交失败率",
    category: "quality_ops",
    formula: "feedback_submit_failed 事件数 ÷（反馈成功数 + 反馈失败数）",
    dataSource: "feedback_submit_failed / task_feedback_submitted 事件",
    timeFiltered: true,
  },
  {
    key: "review_minutes_per_user",
    label: "单个用户人工审核时间",
    category: "quality_ops",
    formula: "时间范围内审核总时长 ÷ 被审核证据的去重归属用户数",
    dataSource: "review_completed 事件 durationMinutes / ownerId",
    timeFiltered: true,
  },
  {
    key: "critical_write_failures",
    label: "关键数据写入失败数量",
    category: "quality_ops",
    formula: "时间范围内 critical_write_failed 事件数",
    dataSource: "critical_write_failed 事件",
    timeFiltered: true,
  },
];

/**
 * 受邀试用指标字典（v7.0 模块 7）：/admin/trial 看板的唯一口径登记处。
 * 数据源全部为服务端 trial_events 表（不是 localStorage Mock），
 * 按四个隔离分群（受邀真实 / 受邀员工 / 演示环境 / 演示种子）各自独立计算，绝不混算。
 */
export const TRIAL_METRIC_DICTIONARY: MetricDictionaryEntry[] = [
  {
    key: "north_star_progress_7d",
    label: "北极星 · 7日有效目标推进率",
    category: "trial",
    formula:
      "分母=获得真实有效机会（真实监测台账 dataset=real）且满 7×24 小时观察期的去重用户（排除 seed/员工/演示环境）；分子=其中 7 日内关注并完成有效推进动作（准备报名/已报名/设为主要目标/进入官方报名入口/材料完成/补信息导致结论变化）的去重人数。未满 7 日者单列「观察中」，不进分母",
    dataSource: "trial_events 服务端事件（opportunity_revealed + 推进类，按事件发生时间算窗口）",
    timeFiltered: false,
  },
  {
    key: "opportunity_valid_rate",
    label: "有效机会获得率",
    category: "trial",
    formula: "获得至少 1 个有效机会（opportunity_revealed validCount≥1）的去重用户 ÷ 完成基础画像的去重用户",
    dataSource: "trial_events：opportunity_revealed / profile_completed",
    timeFiltered: false,
  },
  {
    key: "profile_step_funnel",
    label: "画像各步完成",
    category: "trial",
    formula: "每步 profile_step_completed 的去重用户数；比率=该步 ÷ 第 1 步完成人数（含「暂不提供」，以 skipped 维度区分）",
    dataSource: "trial_events：profile_step_completed（按用户+步号去重）",
    timeFiltered: false,
  },
  {
    key: "match_basis_understood",
    label: "依据理解",
    category: "trial",
    formula: "查看过逐项官方依据（match_basis_viewed）的去重用户 ÷ 获得有效机会的用户",
    dataSource: "trial_events：match_basis_viewed（按用户+机会去重）",
    timeFiltered: false,
  },
  {
    key: "follow_rate",
    label: "关注机会",
    category: "trial",
    formula: "关注过机会（opportunity_followed）的去重用户 ÷ 获得有效机会的用户；取消关注（opportunity_unfollowed）不回退本行，但后续阶段不再计",
    dataSource: "trial_events：opportunity_followed / opportunity_unfollowed",
    timeFiltered: false,
  },
  {
    key: "conclusion_change_rate",
    label: "补信息导致结论变化",
    category: "trial",
    formula: "补充资格信息后匹配结论发生变化（qualification_supplemented conclusionChanged=1）的去重用户 ÷ 获得有效机会的用户",
    dataSource: "trial_events：qualification_supplemented（前端对比补问前后结论）",
    timeFiltered: false,
  },
  {
    key: "material_done_rate",
    label: "材料完成",
    category: "trial",
    formula: "把任一报名材料标记为完成（material_status_changed to=done）的去重用户 ÷ 关注机会的用户",
    dataSource: "trial_events：material_status_changed",
    timeFiltered: false,
  },
  {
    key: "preparing_rate",
    label: "准备报名",
    category: "trial",
    formula: "标记准备报名（follow_status_changed to=preparing）的去重用户 ÷ 关注机会的用户",
    dataSource: "trial_events：follow_status_changed",
    timeFiltered: false,
  },
  {
    key: "register_entry_rate",
    label: "进入官方报名入口",
    category: "trial",
    formula: "进入官方报名入口（register_entry_opened）的去重用户 ÷ 准备报名的用户；报名始终在官方入口完成，产品不代理",
    dataSource: "trial_events：register_entry_opened（按用户+机会去重）",
    timeFiltered: false,
  },
  {
    key: "registered_rate",
    label: "已报名",
    category: "trial",
    formula: "标记已报名（follow_status_changed to=registered）的去重用户 ÷ 进入官方报名入口的用户",
    dataSource: "trial_events：follow_status_changed",
    timeFiltered: false,
  },
  {
    key: "primary_target_rate",
    label: "主要目标",
    category: "trial",
    formula: "设为主要目标（primary_target_set）的去重用户 ÷ 关注机会的用户",
    dataSource: "trial_events：primary_target_set",
    timeFiltered: false,
  },
  // —— v7.1 M9 新增指标：让看板能回答首页理解/无结果/订阅/地图/日程同步与冲突/7日推进 7 个问题 ——
  {
    key: "home_understanding_rate",
    label: "首页是否理解（主按钮点击）",
    category: "trial",
    formula: "点击首页唯一主按钮（home_start_match_clicked）的去重用户 ÷ 到达首页的去重用户（以画像首步完成人数近似）",
    dataSource: "trial_events：home_start_match_clicked / profile_step_completed step=1",
    timeFiltered: false,
  },
  {
    key: "no_result_reason_distribution",
    label: "无结果原因分布",
    category: "trial",
    formula: "无结果三态（未覆盖/无在报/资格不符）各自曝光次数（no_result_reason_viewed 按 reasonCode 分组）；展示具体次数而非比例，10 人样本不伪装成稳定总体",
    dataSource: "trial_events：no_result_reason_viewed（按 reasonCode 分组计数）",
    timeFiltered: false,
  },
  {
    key: "subscription_usage_rate",
    label: "订阅使用",
    category: "trial",
    formula: "创建过订阅（subscription_changed action=created）的去重用户 ÷ 获得有效机会的用户；另列关闭订阅数（action=closed）",
    dataSource: "trial_events：subscription_changed（按 action 维度）",
    timeFiltered: false,
  },
  {
    key: "map_usage_rate",
    label: "地图使用",
    category: "trial",
    formula: "点击地图入口（map_entry_clicked）的去重用户 ÷ 查看过机会详情的用户",
    dataSource: "trial_events：map_entry_clicked / match_basis_viewed",
    timeFiltered: false,
  },
  {
    key: "schedule_sync_health",
    label: "日程同步健康度",
    category: "trial",
    formula: "日程自动同步成功次数 ÷（成功 + 失败）次数（schedule_sync_completed 按 status）；另列失败原因 reasonCode 分布",
    dataSource: "trial_events：schedule_sync_completed（按 status/reasonCode）",
    timeFiltered: false,
  },
  {
    key: "schedule_conflict_rate",
    label: "时间冲突曝光率",
    category: "trial",
    formula: "看到过时间冲突提醒（schedule_conflict_viewed）的去重用户 ÷ 关注机会的用户",
    dataSource: "trial_events：schedule_conflict_viewed / opportunity_followed",
    timeFiltered: false,
  },
];
