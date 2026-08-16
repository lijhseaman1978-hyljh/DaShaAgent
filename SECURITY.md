# Security Policy · 安全政策

## Supported Versions · 受支持版本

| Version  | Supported          |
|----------|--------------------|
| 3.0.x    | ✅ 积极维护         |
| < 3.0    | ❌ 预开源内部版本，不公开维护 |

---

## Reporting a Vulnerability · 报告漏洞

> ⚠️ **请勿通过公开 Issue 报告安全漏洞。** 公开 Issue 会暴露细节并可能被滥用。

请使用以下**私有**渠道之一：

1. **GitHub Private Vulnerability Reporting（推荐）**
   在本仓库页面点击 **Security → Report a vulnerability**，提交私有安全通告。
   这是最安全、响应最快的渠道，报告内容仅维护团队可见，不会进入公开时间线。

2. **GitHub Security Advisory（私有）**
   若你已获得 Advisory 起草权限，可直接起草私有 Advisory 并 @ 维护者。

我们**不会**在修复前公开漏洞细节，也不会将你的报告转交任何第三方。

### 报告中请包含
- **漏洞类型**与受影响模块（尽量精确到 `server/src/...` 路径或具体接口）。
- **复现步骤**（尽量最小可复现）。
- **潜在影响**与攻击前置条件（是否需要登录、本地访问、特定配置等）。
- 如有可能，附上 **PoC** 或**补丁建议**。

### 响应时限
- **确认收到**：收到报告后 **3 个工作日内** 确认并分配处理人。
- **初步评估**：**10 个工作日内** 给出严重等级（Critical / High / Medium / Low）与修复排期。
- **修复与披露**：修复合入后，经双方协商在 Advisory 中**致谢**报告者（如你愿意具名）。

---

## Security Design Defaults · 安全设计默认值

DaSha Agent 以「本地优先」为设计核心，**默认不向外发送任何用户数据**：

- **数据不出本机**：默认 `AH_PROVIDER=ollama`，所有对话、记忆、知识库均存于本机 `data/`，不上云。仅当你显式配置 `cloud` / `mock` 并填入 API Key 时，才会与对应 LLM 服务商通信。
- **同源控制面（无 CORS 头）**：生产入口 `server/src/unified.ts` 经网关 `web.ts` 与 `api/controlRoutes.ts` 对外服务，二者**不设置任何 CORS 响应头**，仅接受同源请求，避免跨域越权调用。
- **两级 / 三级安全护栏**：
  - `Permission` —— 敏感操作（文件写、命令执行、网络访问）需经权限引擎授权；
  - `Threat` —— 威胁检测拦截提示注入与危险指令；
  - `Audit` —— 所有授权决策写入审计日志。
- **沙箱隔离**：`SANDBOX_ENABLED=true`（默认）开启命令规范化与隔离边界，降低本地代码执行风险。
- **密钥管理**：所有密钥仅通过 `.env` 注入，`.env` 已被 `.gitignore` 排除，**绝不入库**。

---

## Hardening Checklist · 部署加固建议

- 不要将 `AH_CONTROL_PORT`（默认 3001）直接暴露到公网；如须远程访问，请置于**反向代理（HTTPS + 鉴权）**之后。
- 仅在可信网络启用 `cloud` 模式；`AH_CLOUD_KEY` 等密钥应来自环境变量，勿写入代码或提交。
- 定期运行 `npm audit` 并跟进依赖更新。
- 启用 `SANDBOX_ENABLED=true`，不要让本地代码执行脱离隔离边界。

---

如对本政策有疑问，可在 **GitHub Discussions**（公开、非敏感问题）中提问；涉及敏感信息，请走上方**私有漏洞上报渠道**。
