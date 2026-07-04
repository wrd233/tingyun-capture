# 02 用户流程与 Sidecar 交互

## 1. Sidecar 定位

Sidecar 是独立本地 Web UI：

- 不注入听云页面。
- 不占用 Dedicated Chromium 中的 Tab。
- 自身网络请求不能进入 Capture 证据。

Sidecar 只负责：

- 控制 Session / Step。
- 写用户说明。
- 显示轻量实时状态。
- 打开 Session Review。
- 处理 Interrupted。
- 重新生成 AI-ready。
- 删除 Session。

Sidecar 不是：

- DevTools。
- Network 分析台。
- AI 分析台。
- Session 知识库。

## 2. 工具启动流程

```text
一条命令启动
        ↓
Capture Engine 启动
        ↓
恢复 / 创建持久化 Browser Profile
        ↓
启动 Dedicated Chromium
        ↓
启动 Sidecar
        ↓
自动打开 Sidecar
```

浏览器为长生命周期探索环境。

用户可以在 Session 之外：

- 登录。
- 准备页面。
- 自由浏览。

这些行为不属于任何 Session。

## 3. 首页

### 3.1 当前状态区

状态可能为：

- IDLE。
- ACTIVE。
- FINALIZING。
- INTERRUPTED 待处理。

### 3.2 最近 Session 列表

只显示必要信息：

- Session 名称。
- 状态。
- 开始时间。
- 大致持续时间。
- Step 数量。
- 中断原因，如有。
- AI-ready 状态。

允许进入 Review。

不做：

- 标签。
- 分类。
- 收藏。
- 项目分组。
- 批量管理。
- 复杂搜索。

## 4. 开始 Session

### 4.1 必填项

只要求：

```text
Session 名称
```

不强制填写：

- 目标。
- 背景。
- 成功标准。
- 分类。
- 标签。

Session 名称由用户填写；不使用 LLM 自动命名。

### 4.2 允许无目标页面启动

如果当前没有目标 Origin 页面：

```text
Session = ACTIVE
Baseline target tabs = 0
```

之后用户真实进入目标 Origin 时开始正常采集。

### 4.3 起始基线

Session 开始时，对已有目标 Origin 页面建立轻量 Baseline：

- 已有 Tab。
- 当前活动 Tab。
- URL。
- Title。
- Frame 基本上下文。
- 当前明确可读取的表单状态。

不保存：

- 完整 DOM。
- 截图。
- 页面全文。
- Session 开始前操作历史。
- Session 开始前网络历史。

## 5. Active Session

### 5.1 实时主界面

显示：

- Session 名称。
- 持续时间。
- 当前 Step，如有。
- 当前 Step 持续时间。
- 动态业务请求数量。
- 失败请求数量。
- 新 Tab 数量。
- URL 变化次数。

### 5.2 最近少量高价值事件

只显示最近少量：

- 动态业务请求。
- 页面导航。
- 新 Tab。
- 请求失败。

不显示：

- 完整 Header。
- 完整 Body。
- 所有静态资源。
- 网络瀑布图。

目标只是：

> 让用户确认 Capture 正常工作，刚才的真实操作确实产生了记录。

## 6. Step 交互

### 6.1 开始 Step

全局规则：

- 一个 Session 同时最多一个 Active Step。
- 开始新 Step 前必须结束当前 Step。

开始时要求一句短的操作意图，例如：

```text
查看具体 Trace 能获得哪些信息
```

### 6.2 结束 Step

点击结束后：

- 立即固定 `step.end_time`。
- 不等待网络静止。
- 不弹出阻塞性总结表单。

结果 / 观察：

- 可选。
- 可稍后补充。
- 封存后仍可编辑文字。

### 6.3 Step 之间

用户界面不出现 `between_steps` 概念。

用户只看到：

```text
当前没有正在进行的操作
```

后台仍持续记录 Session 事实。

## 7. 时间点备注

### 7.1 始终可用

只要 Session Active：

```text
[记一下……]
```

始终可用。

### 7.2 自动上下文

保存：

- note_id。
- 时间。
- Session。
- 当前 Step，如有。
- 活动 Tab。
- 当前 URL。
- 页面标题。
- 用户文字。

### 7.3 用户不需要选择证据

不要求：

- 选择 Request。
- 选择 Response。
- 选择 Tab。
- 选择时间段。

后续 AI 按时间查附近事实。

### 7.4 不增加“标记当前页面”按钮

用户需要标记重要页面时，直接写备注：

```text
这个页面可能适合作为报告中的问题现场入口。
```

系统已经自动绑定 URL 上下文。

## 8. 结束 Session

### 8.1 点击结束时

立即：

1. 固定 `session.end_time`。
2. 不再接受该 Session 的新发起请求。
3. 进入 FINALIZING。

### 8.2 可选整体总结

结束后可以填写：

```text
本次探索总结（可选）
```

不阻塞 Session 收尾与封存。

Capture 不自动总结。

### 8.3 收尾

默认 10 秒：

- 允许 Session 结束前已经发起的普通请求完成。
- 新发起请求不属于该 Session。
- WebSocket / EventSource 不阻塞。

结束后：

```text
FINALIZING
→ SEALED
```

## 9. Interrupted 处理

### 9.1 触发来源

可能包括：

- Capture 崩溃。
- Browser 关闭。
- Engine 停止。
- 磁盘危急。
- 关键持久化失败。

### 9.2 用户可做的事

进入 Review：

- 查看已有事实。
- 查看中断原因。
- 编辑人工文字。
- 明确封存。
- 或删除整个 Session。

### 9.3 不允许继续同一个 Session

```text
INTERRUPTED
≠
可恢复 ACTIVE
```

继续探索必须新建 Session。

### 9.4 未处理 Interrupted 会阻止新 Session

必须先：

- 封存；或
- 删除。

## 10. Sidecar 关闭或刷新

Sidecar 只是 UI。

```text
关闭 / 刷新 Sidecar
→ 不影响 Engine
→ Session 继续
→ Step 继续
```

重新打开后恢复当前状态。

## 11. Session Review

### 11.1 清爽的三级结构

```text
第 1 层：Session
    ↓
第 2 层：Step
    ↓
第 3 层：Request / Response
```

### 11.2 Session 层

显示：

- 名称。
- 状态。
- 时间。
- 总结。
- Step 列表。
- 基础统计。
- 完整性摘要。
- AI-ready 状态。

### 11.3 Step 层

显示：

- 操作意图。
- 起止时间。
- 结果 / 观察。
- 涉及 Tab。
- 页面变化。
- 关键操作。
- 业务请求列表。

### 11.4 Request 层

用户主动点击后查看：

- 方法。
- URL。
- Query。
- Header。
- Request Body。
- Response 状态。
- Response Header。
- Response Body。
- 生命周期。
- 基础时间。
- Initiator 原始信息。

### 11.5 默认 Raw

Review 默认展示本地 Raw 真实证据，并明显标记：

```text
RAW · PRIVATE · 本地私有证据
```

不默认脱敏。

## 12. Review 搜索

仅在 Step 的网络请求区域提供：

```text
[搜索 URL / Path……]
[全部] [失败]
```

搜索可匹配：

- Method。
- Host。
- Path。
- Status。

不做：

- 查询语法。
- JSONPath。
- Body 全文搜索。
- 多条件组合。
- 保存筛选器。

## 13. 参考 cURL

### 13.1 默认

```text
[复制参考 cURL]
```

默认使用高置信度凭据脱敏。

### 13.2 原始版本

更多操作中提供：

```text
复制原始 cURL
```

明确提示：可能包含真实 Cookie / Token，仅限本地使用。

### 13.3 边界

cURL：

- 纯代码临时生成。
- 不自动执行。
- 不自动验证。
- 不属于 Raw。
- 不代表 Replay 已实现。

## 14. AI-ready 操作

Review 中允许：

- 查看当前 AI-ready 状态。
- 重新生成。
- 一键打包 AI-ready ZIP。

状态：

- READY。
- FAILED。
- STALE。

ZIP：

- 只包含脱敏 AI-ready。
- 永远不包含 Raw。

## 15. 删除 Session

只允许删除：

- SEALED。
- INTERRUPTED。

不允许删除：

- ACTIVE。
- FINALIZING。

删除必须明确确认，并整包删除：

- Raw。
- 人工说明。
- AI-ready。
- 其他派生产物。

不做：

- 回收站。
- 恢复。
- 自动清理。
