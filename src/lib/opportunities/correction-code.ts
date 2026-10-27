/**
 * 纠错回执编号（M10）：提交成功后向用户展示，凭编号可在「我的」页
 * 的「我的纠错」中对账查询处理状态与结果。
 *
 * 规则：JC- + 记录 id 去除非字母数字后的末 6 位大写。
 * 只用于展示与人工对账，不作为鉴权凭证（状态查询仍走登录态
 * GET /opportunities/corrections/mine）。
 */
export function correctionTicketCode(id: string): string {
  const tail = id.replace(/[^a-zA-Z0-9]/g, "").slice(-6).toUpperCase();
  return `JC-${tail.padStart(6, "0")}`;
}
