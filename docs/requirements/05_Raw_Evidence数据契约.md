# 05 Raw Evidence 数据契约

## 1. 核心原则

### 1.1 Raw 是唯一真相源

```text
Raw Evidence
= 唯一不可替代事实源
```

Review、索引、AI-ready 都必须可从 Raw + 当前人工说明重建。

### 1.2 文件系统优先

v1 不引入 SQLite。

使用：

- 小型元数据文件。
- Append-only JSONL 事件日志。
- 独立 Body 文件。
- 独立下载文件。

### 1.3 增量持久化

不能等 Session 结束再一次性保存。

发生即尽快落盘：

```text
Session created
→ 写元数据

Step started
→ 立即写事件

Request started
→ 立即写事件

Body available
→ 尽快写独立文件

Step ended
→ 立即写事件

Session ended
→ 收尾、索引、封存
```

## 2. 逻辑目录层次

推荐逻辑结构：

```text
session-root/
├── raw/                       # 私有、唯一事实层
│   ├── manifest.json
│   ├── events.jsonl
│   ├── bodies/
│   │   ├── requests/
│   │   └── responses/
│   └── downloads/
├── annotations/               # 当前人工说明，可编辑
│   └── current.json
└── derived/                   # 可重建
    ├── review-index/
    └── ai-ready/
```

物理文件名可以在设计阶段微调，但逻辑分层必须满足：

```text
immutable raw facts
≠
editable human annotations
≠
rebuildable derived artifacts
```

## 3. manifest

至少包含：

- `session_id`
- `capture_schema_version`
- 创建时间
- Session 状态
- start time
- end time（存在时）
- sealed time（存在时）
- interruption reason（存在时）
- target origin
- Capture version

注意：

- Session 名称属于人工说明层，可编辑。
- 不要因为名称可改而修改封存事实。

## 4. events.jsonl

### 4.1 Append-only

运行过程中只能追加，不回写历史行。

### 4.2 一个事实一条记录

示例事件类型：

- `session_started`
- `session_end_requested`
- `session_sealed`
- `session_interrupted`
- `step_started`
- `step_ended`
- `note_created`
- `tab_created`
- `tab_activated`
- `tab_closed`
- `frame_created`
- `frame_destroyed`
- `url_changed`
- `interaction_recorded`
- `form_state_recorded`
- `request_started`
- `response_received`
- `request_completed`
- `request_failed`
- `download_started`
- `download_completed`

具体事件枚举在设计阶段固定，但必须支持完整重建事实时间线。

## 5. 稳定 ID

### 5.1 创建即分配

核心事实在创建时立即获得稳定无语义 ID。

包括：

- Session。
- Step。
- Tab。
- Frame。
- Interaction。
- Note。
- Request。
- Response。
- Form State。
- Download。
- Submit observation window。

### 5.2 ID 不承载业务语义

允许：

```text
request-0042
```

不允许：

```text
request-save-alarm-config
```

因为 Capture 不负责业务判断。

### 5.3 唯一范围

- `session_id` 全局唯一。
- 其余 ID 至少在 Session 内唯一且稳定。

## 6. Request / Response Body 文件

### 6.1 独立保存

事件日志只保存：

- body ref
- content type
- size
- encoding / kind
- save status

正文不嵌入 JSONL。

### 6.2 文本

尽量保存可读形式：

- `.json`
- `.txt`
- `.html`
- 其他确定性文本后缀

### 6.3 二进制

原字节保存：

```text
.bin 或合适原始后缀
```

不 Base64。

### 6.4 超限

记录：

- Body 未完整保存。
- 原因：too large。
- 已知大小。
- Content-Type。
- 关联 Request / Response。

不得静默截断。

## 7. 人工说明

### 7.1 可编辑字段

包括：

- Session 名称。
- Session 整体总结。
- Step 标题 / 意图。
- Step 结果 / 观察。
- 时间点备注文字。

### 7.2 不可编辑上下文

封存后不可修改：

- 时间。
- Step 边界。
- Note 创建时间。
- Note 当时 Tab。
- Note 当时 URL。
- Request 归属。
- Tab / Frame 归属。

### 7.3 不做文字版本历史

v1 只保留当前最新人工文字。

修改后：

```text
AI-ready → STALE
```

## 8. 封存不变性

### 8.1 SEALED 后 Raw 不可修改

不可修改：

- events.jsonl 历史事实。
- Body。
- Downloads。
- Session / Step / Note 的时间与归属。

### 8.2 软件升级不原地迁移 Raw

每个 Session 记录：

```text
capture_schema_version
```

新版本：

- 尽量兼容读取。
- 可在内存或 Derived 层转换。
- 不自动重写旧 Raw。

未来真需迁移：

```text
显式生成副本
```

不能覆盖旧目录。

## 9. Raw 与 AI-ready 分离

Raw：

- 本地私有。
- 尽量完整。
- 可能包含 Cookie / Token / 业务数据。

AI-ready：

- 脱敏。
- 可重新生成。
- 面向外部 Agent。

二者不能互相覆盖。

## 10. Raw 安全边界

v1 不做加密和密钥管理。

安全边界：

```text
本机
+
当前 macOS 用户权限
```

工程措施：

- Raw 目录明显标记私有。
- 尽量限制当前用户读写。
- 默认 `.gitignore` 防止误提交。
- UI 不提供 Raw 一键分享。
- 文档明确 Raw 可能包含凭据。

## 11. 完整性缺口

Raw 必须显式记录：

- 请求失败。
- Request 未完成。
- Body 超限。
- Body 获取失败。
- 下载失败。
- 文件写入异常。
- Session 中断原因。

原则：

> 没看到证据，不能与证据没抓到混淆。
