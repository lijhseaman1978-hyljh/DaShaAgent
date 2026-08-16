# YOUR_SITE 聊天室项目参考

## 项目结构

```
/path/to/your-site\
├── chat.php                  # 聊天室前台（1179行）：HTML + 内联CSS + JS
├── chat_ajax.php             # AJAX 后端（消息/用户/心跳/正在播放/退出）
├── chat_upload.php           # 文件上传（图片/文件/语音）
├── chat_media_browser.php    # 媒体浏览（管理员播放音乐/视频）
├── chat_video.php            # 视频聊天信令服务器（WebRTC 信令交换）
├── install_chat.php          # 数据库表安装
├── css/chat.css              # 聊天室专用样式（~400行）
├── admin/chat_admin.php      # 后台管理（公告/踢人/拉黑/删除消息/日志）
├── uploads/chat/             # 上传文件目录
└── includes/{navbar,footer,config}.php
```

## 数据库表（共7张）

| 表名 | 用途 |
|------|------|
| `chat_messages` | 聊天消息 |
| `chat_users` | 在线用户 |
| `chat_blacklist` | 黑名单/禁言 |
| `chat_announcements` | 公告 |
| `chat_kick_log` | 操作日志 |
| `chat_now_playing` | 正在播放 |
| `video_room` | 视频聊天房间 |
| `video_signals` | WebRTC 信令 |

## 架构特点

- **连接方式**：纯 AJAX 轮询（3秒消息 + 5秒播放状态 + 10秒用户列表 + 1.5秒视频信令）
- **数据库**：MariaDB on 127.0.0.1:3307, root/空密码
- **管理员**：admin / admin123（MD5），admin/check_login.php 验证
- **实时性**：轮询实现，无 WebSocket（因原有项目无异步框架）

## URL 路由

| URL | 功能 |
|-----|------|
| `http://localhost/your-site/chat.php` | 前台聊天室 |
| `http://localhost/your-site/admin/chat_admin.php` | 后台管理 |
| `http://localhost/your-site/install_chat.php` | 数据库安装 |

## 已知问题

- MySQL 记录锁定死锁 (`Deadlock found when trying to get lock`) — `INSERT ... ON DUPLICATE KEY UPDATE` 在并发时偶发，MariaDB 行为
- WampServer 从 WSL 无法重启服务 (Access Denied)
