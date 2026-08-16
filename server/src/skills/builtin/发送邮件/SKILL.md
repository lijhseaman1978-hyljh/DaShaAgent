---
name: 发送邮件
description: 通过 SMTP 发送邮件，支持附件。配置见 .env（AH_SMTP_*）。From 头必须是纯邮箱地址。
trigger: 发邮件|邮件|email|发送到邮箱
---

# 发送邮件

1. 用 send_email 工具（to / subject / body / attachment）
2. SMTP 配置来自环境变量 AH_SMTP_HOST / AH_SMTP_PORT / AH_SMTP_USER / AH_SMTP_PASS
3. From 头必须纯邮箱，不能用 "Name <email>" 格式（否则 550）
4. 大附件超时：用独立小脚本发送