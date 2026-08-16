---
name: php-realtime-browser-features
description: 为 PHP/Apache/MySQL 网站添加浏览器实时通信功能（WebRTC 视频聊天、语音录制、媒体播放），含浏览器安全策略绕坑和 WampServer 管理
triggers:
  - 用户要在 PHP 网站上加视频聊天/语音录制
  - 用户反馈 getUserMedia/navigator.mediaDevices 不可用
  - 浏览器自动播放（autoplay）被拦截
  - WampServer HTTPS/SSL 配置
  - WebRTC 信令设计（PHP+MySQL 作为信令通道）
---

# PHP 实时浏览器功能开发

## 浏览器安全策略核心规则

所有现代浏览器（Chrome/Edge/Firefox）对 `getUserMedia`（摄像头/麦克风）和 `AudioContext` 有严格的安全上下文要求：

| 访问方式 | `navigator.mediaDevices` | `play()` autoplay |
|----------|--------------------------|-------------------|
| `localhost` | ✅ 可用 | ✅ 可用 |
| HTTPS (任何域名) | ✅ 可用 | ✅ 可用 |
| HTTP + IP地址 | ❌ **undefined** | ❌ 被拦截 |
| HTTP + 域名 | ❌ undefined | ❌ 被拦截 |

**关键坑**：HTTP + IP 时 `navigator.mediaDevices` 整个对象为 `undefined`，不是 getUserMedia 函数不可用，而是 `mediaDevices` 属性不存在。检测时要区分。

## getUserMedia 调用（兼容所有情况）

```javascript
// 完整检测链（标准API + 旧版前缀API）
const getUserMedia = (
    (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) ||
    navigator.getUserMedia ||
    navigator.webkitGetUserMedia ||
    navigator.mozGetUserMedia
);

if (!getUserMedia) {
    alert('需要通过 localhost 或 HTTPS 访问才能使用摄像头/麦克风。');
    return;
}

const getMediaFn = getUserMedia.bind(navigator.mediaDevices || navigator);
getMediaFn({ video: true, audio: true })
    .then(stream => { /* use stream */ })
    .catch(e => {
        // e.name 可区分的错误类型：
        // NotAllowedError / PermissionDeniedError → 权限被拒绝
        // NotFoundError → 无设备
        // NotReadableError → 被其他程序占用
    });
```

## 浏览器自动播放策略绕过

### 方法一：AudioContext 解锁（推荐）

```javascript
// 在页面加载时注册
window.unlockAudio = function() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        ctx.resume();
        return true;
    } catch(e) { return false; }
};

['click', 'keydown', 'touchstart'].forEach(evt =>
    document.addEventListener(evt, window.unlockAudio, {once: true})
);
// 立即尝试
window.unlockAudio();
```

在用户点击"进入聊天室"时显式调用 `window.unlockAudio()`。

### 方法二：safePlay 重试 + 静音保底

```javascript
function safePlay(el, maxRetries=5) {
    if (!el || !el.src) return;
    let attempts = 0;
    function tryPlay() {
        attempts++;
        el.play().then(() => {
            if (el.muted) setTimeout(() => { el.muted = false; }, 300);
        }).catch(() => {
            if (attempts < maxRetries) {
                setTimeout(tryPlay, 800 * attempts); // 指数退避
            } else if (el.tagName === 'VIDEO') {
                el.muted = true;  // 浏览器允许静音自动播放
                el.play().then(() => setTimeout(() => { el.muted = false; }, 500));
            }
        });
    }
    tryPlay();
}
```

## WebRTC 多人视频聊天（网格拓扑）

### 信令设计（PHP + MySQL 轮询）

```
每个参与者 ─── PeerConnection ─── 每个其他参与者（N人 = N(N-1)/2 连接）
```

**数据库表**：

```sql
-- 房间参与者
video_room (id, nickname UNIQUE, joined_at, last_heartbeat)

-- 信令交换
video_signals (id, from_user, to_user, signal_type, signal_data, consumed)
```

**信令流程**：
1. 用户加入 → INSERT into video_room，心跳每1.5秒UPDATE
2. 新用户获取参与者列表 → 为每个在线者创建 RTCPeerConnection + 发送 SDP Offer
3. 在线者轮询 `get_signals` → 收到 Offer → 创建 Answer → INSERT 回信令表
4. 新用户轮询收到 Answer → 设置 remoteDescription → 连接建立
5. ICE Candidate 通过相同机制双向交换
6. 30秒无心跳自动清理 room，离开时 DELETE 自身

**关键代码模式**：

```javascript
// STUN 服务器（Google 公共）
const VIDEO_STUN = { iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
]};

// 创建 PeerConnection
const pc = new RTCPeerConnection(VIDEO_STUN);
localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

pc.ontrack = (event) => {
    const [stream] = event.streams;
    addRemoteVideo(nickname, stream);
};
pc.onicecandidate = (event) => {
    if (event.candidate) sendSignal(nickname, 'ice_candidate', JSON.stringify(event.candidate));
};
pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
        // 清理远程视频
    }
};

// 发送 Offer
const offer = await pc.createOffer();
await pc.setLocalDescription(offer);
sendSignal(targetName, 'offer', JSON.stringify(pc.localDescription));

// 处理收到的 Offer
await pc.setRemoteDescription(new RTCSessionDescription(data));
const answer = await pc.createAnswer();
await pc.setLocalDescription(answer);
sendSignal(from, 'answer', JSON.stringify(pc.localDescription));
```

### 页面关闭自动离开

```javascript
window.addEventListener('beforeunload', function() {
    navigator.sendBeacon('chat_video.php?action=leave&nickname=' + encodeURIComponent(myNickname));
});
```

## MediaRecorder 语音录制

### 动态 MIME 类型选择

```javascript
let mimeType = 'audio/webm';
if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
    mimeType = 'audio/webm;codecs=opus';  // Chrome
} else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
    mimeType = 'audio/ogg;codecs=opus';   // Firefox
} else if (MediaRecorder.isTypeSupported('audio/mp4')) {
    mimeType = 'audio/mp4';               // Safari
}
mediaRecorder = new MediaRecorder(stream, { mimeType: mimeType });
```

### Blob 上传

```javascript
mediaRecorder.onstop = () => {
    stream.getTracks().forEach(t => t.stop());
    const blob = new Blob(audioChunks, { type: mimeType });
    if (blob.size < 1000) return;
    uploadAudioBlob(blob);
};

function uploadAudioBlob(blob) {
    const formData = new FormData();
    formData.append('file', blob, 'voice_' + Date.now() + '.webm');
    fetch('upload.php', { method: 'POST', body: formData })
        .then(r => r.json())
        .then(data => { if (data.ok) { /* send as message */ } })
        .catch(e => alert('上传失败: ' + e.message));
}
```

## PHP 后端注意事项

### PHP 8+ 三元运算符优先级

```php
// ❌ PHP 8 Fatal Error
'type' => $cond ? 'image' : $mime ?: 'default';

// ✅ 正确：加括号
'type' => $cond ? 'image' : ($mime ?: 'default');
```

### WampServer 上传配置

编辑 `<WAMP_ROOT>\bin\php\php[X.Y.Z]\php.ini`：

```ini
upload_max_filesize = 100M
post_max_size = 200M
memory_limit = 128M
```

修改后需重启 Apache（从 WampServer 托盘图标 Restart All Services）。

## WampServer HTTPS 配置

### 生成自签名证书（含 IP SAN）

```bash
# 创建证书配置文件 _cert_config.cnf
[req]
default_bits = 2048
prompt = no
default_md = sha256
x509_extensions = v3_req
distinguished_name = dn

[dn]
CN = localhost

[v3_req]
subjectAltName = @alt_names
[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
IP.2 = <你的局域网IP>
```

```bash
# 生成证书（10年有效期）
openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
  -keyout server.key -out server.crt -config _cert_config.cnf
```

### Apache 配置

修改 `<WAMP_ROOT>\bin\apache\apache[X.Y.Z]\conf\httpd.conf`：

```apache
LoadModule socache_shmcb_module modules/mod_socache_shmcb.so
LoadModule ssl_module modules/mod_ssl.so
Include conf/extra/httpd-ssl.conf
```

修改 `conf/extra/httpd-ssl.conf`：

```apache
DocumentRoot "${INSTALL_DIR}/www"
ServerName localhost:443
<Directory "${INSTALL_DIR}/www/">
    Options +Indexes +FollowSymLinks +MultiViews
    AllowOverride All
    Require all granted
</Directory>
```

### 重启：托盘图标 → Restart All Services

## 参考资料

见 `references/` 目录下的具体文件。

## 陷阱清单

1. ❗ `getUserMedia` 在 HTTP + IP 下完全不可用，必须 HTTPS 或 localhost
2. ❗ `el.play()` 返回 Promise，不 `.catch()` 会抛出未处理异常
3. ❗ PHP 8 不支持未加括号的复合三元表达式 `a ? b : c ?: d`
4. ❗ WampServer 的 Apache 和 MySQL 服务无法从 WSL 重启（Access Denied），必须通过 Windows 托盘
5. ❗ WSL 下创建的文件/目录在 Windows 侧可能有权限问题（`move_uploaded_file` 失败）
6. ❗ `MediaRecorder.start()` 无 timeslice 参数时，只在 stop() 时触发一次 `ondataavailable`
7. ❗ 某些浏览器在 HTTP 下 `navigator.mediaDevices` 为 `undefined` 但 `navigator.getUserMedia` 可能仍有定义
