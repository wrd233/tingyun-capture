# 03 Capture 采集引擎需求

## 1. 采集引擎定位

Capture Engine 是整个系统的核心事实记录组件。

它负责：

- 管理 Dedicated Chromium 生命周期。
- 观察目标 Origin 内的 Tab、Frame、URL、页面操作和网络事实。
- 把重要事实增量写入 Raw。
- 在 Session / Step 边界上保持一致的归属规则。
- 遇到无法继续保证高保真时诚实中断。

它不负责：

- 页面自动化探索。
- 请求重放。
- AI 分析。
- 业务语义推断。

## 2. Dedicated Chromium

### 2.1 由 Capture 自己启动和管理

v1 采用专用 Chromium：

- Capture 启动时拉起。
- 使用持久化 Profile。
- 用户手工登录。
- 尽量保留登录状态。
- Capture 停止时关闭浏览器进程。
- 下次启动复用 Profile，重新拉起进程。

保留的是 Profile，不是旧浏览器进程。

### 2.2 浏览器是长生命周期探索环境

```text
Capture start
→ Browser start / restore profile
→ 用户登录与准备
→ Session start
→ 记录
→ Session end
→ Browser 继续存在
→ 可开始下一 Session
```

Session 生命周期与 Browser 生命周期分离。

### 2.3 Browser 关闭

Active Session 期间 Browser 一旦关闭：

```text
Session → INTERRUPTED
reason = browser_closed
```

不得自动重拉后继续原 Session。

## 3. Tab 模型

### 3.1 所有目标 Origin Tab 自动纳入

Active Session 期间：

- Dedicated Chromium 中所有目标 Origin Tab 自动跟踪。
- 一个 Step 可以跨多个 Tab。
- 不需要用户手工“添加 Tab”。

### 3.2 Tab 稳定身份

每个 Tab 创建时立即获得稳定无语义 ID，例如：

```text
tab-0002
```

至少记录：

- `tab_id`
- 创建时间
- opener / 来源 Tab（底层可确定时）
- 首个目标 Origin URL
- 当前 URL
- title
- 激活切换
- 关闭时间

### 3.3 Active Tab

需要记录用户实际活动 Tab 变化，便于：

- 时间点备注绑定。
- 页面操作上下文。
- Step 阅读路径。

### 3.4 离开目标 Origin

采用极简规则：

```text
目标 Origin 内
→ 正常采集

离开目标 Origin
→ 完全忽略外部内容

返回目标 Origin
→ 恢复采集
```

不建设外部 Origin 轻量跟踪。

## 4. Frame / iframe

### 4.1 轻量上下文

Frame 不是用户级产品概念。

每个 Frame 可以有：

- `frame_id`
- 所属 `tab_id`
- `parent_frame_id`
- Frame URL
- 创建时间
- 销毁时间

### 4.2 事件引用

页面操作和网络事件发生在 iframe 时，可以引用 `frame_id`。

Sidecar 和 Review 默认不突出 Frame。

### 4.3 不做

- 不把 iframe 当独立 Tab。
- 不建独立 Step。
- 不建独立 Review 工作区。

## 5. Session 起点

### 5.1 硬边界

Session 开始时间是网络归属硬边界。

```text
request.started_at < session.start_time
→ 整条请求不属于当前 Session
```

即使 Response 在 Session 开始后返回，也不保存半条 Response。

### 5.2 不向前追溯

不做：

- 前 5 秒网络回溯。
- 浏览器历史请求导入。
- Session 前请求补录。

### 5.3 起始现场由 Baseline 解释

Baseline 负责记录开始时已有页面状态。

## 6. 网络采集总策略

### 6.1 范围

只采集配置的 `target_origin`。

### 6.2 所有事件至少有索引

目标 Origin 内每个观察到的网络事件至少记录：

- event / request ID
- 时间
- URL
- Method
- resource type
- Tab
- Frame（需要时）
- Step context
- status（获得后）
- 大小（能获得时）
- initiator（能获得时）

### 6.3 Full content 策略

默认完整保存：

- Document / Navigation。
- XHR。
- Fetch。
- 表单提交。
- WebSocket / EventSource 的轻量消息事实。
- 下载相关业务请求。
- 其他明显非静态业务请求。

明显静态资源默认只保存元数据：

- JS。
- CSS。
- 图片。
- 字体。
- Source Map。

这是采集策略，不是“重要性判断”。

### 6.4 不按 API 前缀过滤

任何业务前缀都不能成为底层白名单。

## 7. Request 生命周期

### 7.1 发起即落事实

Request 一旦在 Session 内发起：

```text
status = pending
```

立即写入 Raw。

### 7.2 终态

允许：

- `completed`
- `failed`
- `canceled`（底层能明确区分时）
- `incomplete`

### 7.3 原始错误

保存底层真实提供的错误信息。

Capture 不自行推断：

- DNS。
- TCP。
- TLS。
- CORS。
- 服务端故障。

如果底层不能区分失败和取消，不强行分类。

### 7.4 Step 归属

Request 的 Step 归属由发起时间决定。

示例：

```text
15:01:58 Request A started in Step 1
15:02:00 Step 1 ended
15:02:04 Request A completed
```

记录：

- `started_in = step-001`
- `completed_after_step = true`

Step 结束后新发起的请求不属于前一个 Step。

### 7.5 Session 归属

同理：

- Session 结束前发起 → 属于该 Session。
- Session 结束后发起 → 不属于该 Session。

## 8. Session Finalization

### 8.1 结束时间立即固定

点击 End Session：

```text
session.end_time = now
```

立即固定。

### 8.2 普通 in-flight 请求

默认 10 秒收尾窗口：

- 允许已发起普通请求继续完成。
- 不接受新请求。
- 超时仍未完成 → `incomplete`。

### 8.3 长连接

WebSocket / EventSource 不阻塞 Session 封存。

记录 Session 结束时：

- 仍打开。
- 已关闭。

## 9. WebSocket / EventSource

只记录轻量原始事实：

- open time
- URL
- close time / still open
- message time
- direction：incoming / outgoing
- type：text / binary
- raw content 或文件引用

不做：

- 协议解析。
- 自动 JSON 展开。
- 订阅识别。
- 请求响应配对。
- 业务分类。

## 10. Request / Response Headers

### 10.1 Raw

保存底层能够可靠提供的全部 Request / Response Headers。

包括未知自定义 Header。

如果底层能直接给出：

- 重复 Header。
- 原始顺序。
- HTTP/2 伪 Header。

可保存。

### 10.2 不做虚假承诺

Capture 只承诺：

> 保存浏览器调试接口实际观察到的 Header。

不宣称与线路原始字节完全相同。

## 11. Body

### 11.1 保存内容

以浏览器能够可靠获得的实际正文为准：

- JSON → 可读 JSON 文件。
- 文本 → 文本文件。
- 二进制 → 原字节文件。

保留 Content-Encoding 等 Header 元数据。

不额外保存线路压缩字节。

### 11.2 单 Body 大小上限

业务 Body 默认完整保存，但设置一个简单、可配置的硬上限。

超过上限：

- 不静默截断。
- 明确标记未完整保存。
- 保留元数据、Header、Content-Type、已知大小。
- 记录完整性缺口。

具体默认值在设计阶段确定。

### 11.3 二进制

二进制 Body：

- 独立文件。
- 不 Base64 塞入 JSONL。
- 不自动解析。
- 不自动解压。
- 不猜协议。

## 12. Redirect

每个跳转中的 Request / Response 都独立保存。

通过轻量关系连接：

- `redirect_chain_id`
- `redirected_from`
- `redirected_to`

不折叠成最终请求。

不建设复杂关系图。

## 13. Cache

保持浏览器自然缓存行为：

- 不主动清缓存。
- 不强制 disable cache。
- 不为抓更多请求改变真实环境。

底层若可靠提供：

- fromDiskCache
- fromMemoryCache
- fromServiceWorker

则附带记录。

拿不到不补偿。

## 14. Initiator

浏览器 / CDP 能可靠提供时，保存：

- initiator type
- script URL
- function name
- line number
- 有限调用栈

不做：

- 下载分析整站 JS。
- Source Map 还原。
- 前端调用链推理。

## 15. Timing

必须保存：

- `started_at`
- `response_received_at`（存在时）
- `completed_at`
- `duration_ms`

底层直接可得、几乎无额外成本时，可附带原始 Timing：

- queueing
- DNS
- connect
- SSL
- send
- wait
- receive

这些细节：

- 只作为 Raw 附带事实。
- 不进入 Sidecar 主界面。
- 不做性能诊断。
- 不建瀑布图。

## 16. URL 变化

### 16.1 完整 URL

Raw 保存：

- scheme
- host
- port
- path
- query
- hash

不主动删除业务 ID。

### 16.2 SPA

需要记录可确定观察到的：

- 真正导航。
- `pushState`。
- `replaceState`。
- `hashchange`。

事件保存：

- 时间。
- Tab。
- Frame（必要时）。
- before URL。
- after URL。
- change type（能确定时）。
- 当前 Step（如有）。

不判断 URL 稳定性。

## 17. 下载

用户真实触发 Download 时保存：

- `download_id`
- start / complete time
- source Tab
- source page URL
- suggested filename
- actual filename
- MIME type
- size
- success / failure
- request_id（能确定时）

保存实际文件本身，受大小安全限制。

不：

- 主动下载。
- 自动解压。
- 自动解析。

## 18. 页面操作采集

### 18.1 操作类型

记录关键离散操作：

- Click。
- Input final value。
- Select。
- Checkbox / Radio。
- Enter / Submit。
- Tab create / switch / close。
- Navigation。

### 18.2 Input 最终值固化

不记录每次键盘输入。

在以下确定性节点固化最终值：

- blur。
- change。
- Enter。
- 页面提交。
- 页面离开。
- Tab 关闭。
- Step / Session 结束。

用户无需在 Capture 里额外“提交”。

### 18.3 敏感输入

普通业务输入记录最终值。

明确敏感输入：

- `input[type=password]`
- 浏览器可明确识别的密码字段
- 高置信度凭据字段

只记录：

```text
发生过修改
value = ***NOT_CAPTURED***
```

网络层 Raw 仍按网络事实策略保存。

### 18.4 控件上下文

操作保存轻量语义控件快照：

- tag
- role
- visible text
- label / accessible name
- type
- placeholder
- nearby text（必要时）
- 少量明确稳定属性，如 id / name / data-* / ARIA

不保存：

- 完整 DOM。
- 长 CSS Selector。
- XPath。
- 多套 fallback selector。
- Replay 定位评分。

## 19. Playwright Trace

正式证据链不依赖 Playwright Trace。

默认：

```text
OFF
```

仅开发者排查 Capture 自身故障时可显式开启。

它：

- 不属于 Raw 真相源。
- 不进入 AI-ready。
- 不用于正式 Session 分析。
- 不启用截图。
