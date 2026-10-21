# 比赛现场「开放注册」方案（demo 子域 + 复用 kbzs 真实岗位）

> 生成日期：2026-10-21
> 需求收敛结果：访客自助注册 + 真实岗位数据 + 注册写库 + 国内直连 + 复用 kbzs 数据。
> 结论：在已备案域名 `kbzs.al.qich.top` 上加子域 `demo.kbzs.al.qich.top`，
> 复用现有后端/数据库（真实岗位），多开一个「公开注册」端点，改动很小。

---

## 一、需求与约束（已与用户逐项确认）

| 要素 | 结论 |
|---|---|
| 现场使用方式 | 访客自助注册（输入邮箱+密码即建号登录） |
| 岗位数据 | 真实岗位（来自自动抓取→审核→发布闭环） |
| 数据去向 | 注册写库（真实落 PostgreSQL，与真实岗位一致） |
| 网络 | 国内直连，不依赖境外；不能用 Vercel（境外，境内超时） |
| 域名 | `kbzs.al.qich.top` 已备案，可加子域 |
| 数据关系 | 复用 kbzs 现有后端 + 数据库（真实岗位已在库） |

---

## 二、现状（已核实代码事实）

- 后端 `auth.service.createUser()` 已存在，可复用来建号；目前只在
  `admin.controller` 的 `POST /admin/users`（挂 `AdminGuard`）暴露，仅管理员可建。
- 前端 `HttpAuthProvider`（invited 模式）只有 `login`，没有 `register`。
- 登录页 `src/app/login/page.tsx` 在 invited 模式显示「仅限受邀测试用户，不开放公开注册」。
- 密码安全已就绪：`createUser` 内部 bcrypt 哈希（10 轮），不落明文。
- 会话：HttpOnly cookie，7 天过期。

---

## 三、改动清单（很小，共 3 处）

### 1. 后端：新增公开注册端点

文件 `backend/src/auth/auth.controller.ts`，新增：

```ts
@Post('register')
async register(
  @Body() body: { email?: unknown; name?: unknown; password?: unknown },
  @Req() req: AuthenticatedRequest,
  @Res({ passthrough: true }) res: Response,
) {
  // 环境开关：仅现场这套栈置 PUBLIC_REGISTRATION=true 才开放；默认关闭
  if (process.env.PUBLIC_REGISTRATION !== 'true') {
    throw new UnauthorizedException('当前环境未开放公开注册');
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || password.length < 6) {
    throw new BadRequestException('邮箱不能为空，密码至少 6 位');
  }
  // 邮箱查重
  const existing = await this.prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new ConflictException('该邮箱已注册，请直接登录');
  }
  // 固定 role=user，防止提权；现场体验账号统一备考用户角色
  const user = await this.authService.createUser({
    email,
    name: typeof body.name === 'string' ? body.name : undefined,
    role: 'user',
    password,
  });
  // 注册即登录：签发会话并写 cookie
  const { token } = await this.authService.createSession(
    user.id,
    req.headers['user-agent'] as string | undefined,
  );
  res.cookie(COOKIE_NAME, token, cookieOptions(req));
  return { user: { id: user.id, email: user.email, name: user.name, role: user.role } };
}
```

- 需补 import：`BadRequestException`、`ConflictException`。
- `PUBLIC_REGISTRATION` 环境变量只在这套现场栈的 `backend.env` 设 `true`；
  kbzs 试用环境不设（保持「不开放注册」）。

### 2. 前端：HttpAuthProvider 加 register

文件 `src/lib/auth/HttpAuthProvider.ts`，新增方法（与 login 对称）：

```ts
async register(input: { email: string; password: string; name?: string }): Promise<Session> {
  const res = await fetch(`${API_BASE}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || '注册失败，请稍后重试');
  }
  const data = (await res.json()) as { user: User };
  this.session = this.buildSession(data.user);
  this.emitChange();
  return this.session;
}
```

同时 `types.ts` 的 `AuthService` 接口加 `register`（DemoAuthProvider 可抛「当前环境不支持注册」）。

### 3. 前端：登录页加注册表单

文件 `src/app/login/page.tsx`，在 invited 模式下加「注册」切换：
- 加一个「注册体验账号」标签页/链接，切换后显示「邮箱 + 昵称 + 密码」三个字段。
- 提交走 `register()`，成功后同登录一样进入机会页。
- 保留现有「仅限受邀测试用户」文案作为默认，仅在 `PUBLIC_REGISTRATION` 打开的环境显示注册入口
  （前端可用 `NEXT_PUBLIC_PUBLIC_REGISTRATION=true` 镜像控制，构建期内联）。

---

## 四、部署（demo 子域，复用 kbzs 后端）

> 关键点：现场栈与 kbzs 试用环境共用同一套 backend + PostgreSQL（真实岗位），
> 只是前端多一个子域入口 + 打开注册开关。

### 4.1 DNS

在阿里云 DNS 加 A 记录：`demo` → 服务器公网 IP（`47.101.32.47`），与主域同 IP。

### 4.2 环境变量

现场栈的 `backend.env` 增：`PUBLIC_REGISTRATION=true`（其余与 kbzs 一致，指向同一 DB）。
前端构建时设 `NEXT_PUBLIC_PUBLIC_REGISTRATION=true`。

### 4.3 Caddy

`Caddyfile` 增 demo 子域站点（复用同一 frontend，或独立 frontend 容器绑定 demo 域）：

```caddyfile
demo.kbzs.al.qich.top {
	encode zstd gzip
	reverse_proxy frontend:3000
}
```

### 4.4 与「自动抓取验收」的关系

- 自动抓取（worker + redis）与现场开放注册**共用同一套后端**。
- 真实岗位数据来自：自动抓取 → 解析 → 人工审核 → 发布（`PublishedAnnouncementVersion`）
  → 用户端 `match` 读取。现场访客注册后走 `/opportunities` 即看到真实岗位。
- 因此「自动抓取验收」与「现场开放注册」是同一个交付物：一套国内直连、带 worker、
  开放注册的完整栈。

---

## 五、风险与注意

1. **注册写库 = 真实数据**：现场访客注册的账号会真实落库。比赛结束后若想清空，
   可用现有 `DELETE /auth/account`（注销）或管理员批量清理；或赛后 `deleteTestData`。
2. **开放注册的合规**：面向公众开放注册可能涉及用户协议/隐私政策。现场演示属
   短时测试，但若长期开放需补合规文件（现有 DEPLOYMENT.md 已标记为待办）。
3. **防提权**：register 固定 `role:'user'`，绝不允许客户端传 role。
4. **邮箱不验证**：现场体验不做邮箱验证（降低门槛）；若要防滥用可加简单验证，但会增复杂度，建议现场阶段不做。

---

## 六、下一步（待用户确认）

1. 先做代码改动（后端 register 端点 + 前端注册表单 + 开关），本地验证 + 测试。
2. 提交推送（按 Git 铁律，等用户明确说「提交」）。
3. 部署：DNS 子域 + 环境变量 + Caddy + 起 worker/redis。
4. 现场验收：访客注册 → 看到真实岗位 → 走完匹配/关注流程。
