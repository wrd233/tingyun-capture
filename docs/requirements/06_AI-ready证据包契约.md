# 06 AI-ready 证据包契约

## 1. 定位

AI-ready 是 Raw Evidence 的脱敏派生视图。

它的目标不是给 Capture 自己使用，而是让一个外部 Agent 在没有额外口头背景的情况下，能够：

1. 知道从哪里开始读。
2. 理解 Session 和 Step 主线。
3. 找到具体 Request / Response。
4. 按稳定 ID 回引证据。
5. 知道哪些事实缺失。
6. 区分用户说明、确定事实和 AI 自己的推理。

## 2. Capture 内部零 LLM

AI-ready 的全部生成必须是：

```text
纯代码
+
确定性模板
+
确定性脱敏规则
```

Capture 内部不允许：

- 模型 API Key。
- LLM 请求。
- Prompt 管理。
- 自动摘要。
- 自动分析 Endpoint。
- 自动判断请求重要性。
- 自动生成 Skill。
- AI 自动评分。

## 3. 生成时机

### 3.1 正常 Session

```text
ACTIVE
→ FINALIZING
→ SEALED
→ 自动生成 AI-ready
```

### 3.2 Interrupted Session

异常时先保 Raw：

```text
ACTIVE
→ INTERRUPTED
```

不自动生成 AI-ready。

用户后续：

```text
Review
→ 明确封存
→ SEALED
→ 生成完整性摘要
→ 生成 AI-ready
```

### 3.3 可重新生成

AI-ready 来源：

```text
Raw Evidence
+
当前 Human Notes
+
当前 Redaction Rules
```

人工说明或脱敏配置修改后：

```text
AI-ready status = STALE
```

用户可手工重新生成。

v1 只保留最新 AI-ready，不做复杂版本历史。

## 4. 状态独立

Session / Raw 状态与 AI-ready 状态独立。

```text
Session / Raw:
SEALED

AI-ready:
READY
FAILED
STALE
```

AI-ready 生成失败：

- Session 仍然 SEALED。
- Raw 不受影响。
- Review 提供重新生成。

## 5. 唯一阅读入口

AI-ready 必须只有一个明确入口：

```text
README_FOR_AI.md
```

所有外部 Agent 都应被指示：

> 永远先读 `README_FOR_AI.md`。

不生成一份包含所有 Body 的巨大 Markdown。

## 6. 目录契约

建议结构：

```text
ai-ready/
├── README_FOR_AI.md
├── session.json
├── events.jsonl
├── network-index.jsonl
├── integrity.json
├── timeline.md              # 可选但推荐，作为人类/AI 主线阅读
└── evidence/
    ├── requests/
    └── responses/
```

核心要求不是文件数量，而是：

- 单一入口。
- 稳定机器索引。
- 证据独立存放。
- ID 引用一致。

## 7. README_FOR_AI.md 内容

必须由确定性模板生成。

建议包含：

### 7.1 Session 信息

- Session 名称。
- 时间。
- 状态。
- 用户整体总结，如有。
- 是否存在完整性缺口。

### 7.2 阅读顺序

明确告诉 Agent：

1. 先读本文件。
2. 再读 Session / Step 主线。
3. 需要时查询 `network-index.jsonl`。
4. 按 evidence ID 打开具体 Request / Response。

### 7.3 事实类型说明

区分：

- Raw-derived facts。
- Human annotations。
- Automatic grouping / index。

明确：

> Capture 没有做业务因果推断。

### 7.4 Step 主线

按 Step 展示：

- Step 意图。
- 起止时间。
- 用户结果 / 观察。
- 主要页面 / Tab 变化。
- 操作和 Request 的证据入口。

### 7.5 无 Step 过渡区间

完整 Session 事实不能因没有 Step 而删除。

AI-ready 可以用轻量方式呈现：

```text
自动记录的过渡区间
```

例如：

- 时间范围。
- 网络事件数量。
- 页面变化。
- 跨 Step 完成的请求。

用户不需要知道 `between_steps` 术语。

### 7.6 时间点备注

列出：

- note ID。
- 用户文字。
- 时间。
- 当时 Tab / URL。
- 当前 Step（如有）。

### 7.7 客观事件分组

允许做确定性分组：

- 提交候选附近请求。
- 失败请求。
- 页面导航请求。
- 普通业务请求。

不允许写：

- 核心 Endpoint。
- 最重要请求。
- 参数来源结论。
- 级联因果结论。

### 7.8 建议分析任务

可以固定模板提示外部 AI 分析：

- 哪些请求可能是候选 Endpoint。
- 哪些参数可能来自前一步。
- 表单级联链路是什么。
- 最终提交 Request / Response 在哪里。
- 用户探索路径能否抽象成可复用流程。
- 哪些 URL 值得进一步验证。
- 哪些结论不确定。

但 Capture 自己不回答这些问题。

## 8. 机器可读索引

### 8.1 session.json

包含简要结构：

- Session。
- Steps。
- Tabs。
- Notes。
- 状态。
- 时间。
- 证据文件入口。

### 8.2 events.jsonl

脱敏后的时间线事实。

保持稳定 ID。

### 8.3 network-index.jsonl

每个 Request 至少提供：

- request_id。
- method。
- URL。
- status。
- lifecycle state。
- Step context。
- Tab / Frame。
- timing basics。
- Request body ref。
- Response body ref。
- integrity flags。

## 9. 业务 Body

### 9.1 默认纳入

目标 Origin 内已成功保存的动态 / 业务 Request / Response Body：

```text
脱敏后
→ 默认进入 AI-ready evidence/
```

Capture 不替 AI 挑“重要 Body”。

### 9.2 静态资源

明显静态资源默认仍只保留元数据。

### 9.3 过大 Body

AI-ready 中明确写：

- Body 未完整保存。
- 原因。
- 原始元数据。

## 10. 二进制与下载

无法可靠脱敏的二进制内容：

- Raw 中完整保留。
- 不复制进 AI-ready。
- 不复制进 ZIP。

AI-ready 只保留：

- ID。
- 文件名。
- MIME Type。
- 大小。
- 来源 Tab / URL。
- 关联 Request（能确定时）。
- 未包含原因。

原则：

```text
能用确定性规则可靠脱敏
→ 进入 AI-ready

无法可靠脱敏
→ 只保留元数据
```

## 11. 脱敏规则

### 11.1 总原则

宽松、保留分析价值。

只处理高置信度凭据类秘密。

### 11.2 默认 Header

至少包括：

- Authorization。
- Cookie。
- Set-Cookie。
- Proxy-Authorization。

### 11.3 Query / JSON / Form 字段

按字段名大小写不敏感匹配高置信度字段，例如：

- password。
- passwd。
- access_token。
- refresh_token。
- api_key。
- apikey。
- client_secret。

规则应偏松：

不因为字段名模糊包含以下内容就自动遮盖：

- key。
- session。
- user。
- account。
- ip。
- name。

### 11.4 允许少量额外字段

配置文件可追加项目特定敏感字段名。

不建设复杂脱敏 DSL。

### 11.5 不做通用 DLP / PII

不自动识别：

- 姓名。
- 手机号。
- 邮箱。
- IP。
- 身份证。
- 业务字段。

避免误伤 APM 分析价值。

## 12. URL 脱敏

Raw 完整保存 URL。

AI-ready：

- 保留 Path / Query / Hash。
- 保留业务 ID，如 applicationId、actionId、traceGuid。
- 只脱敏高置信度凭据参数。

Capture 不判断 URL 是否稳定可复用。

## 13. 完整性摘要

封存时纯代码生成。

至少汇总：

- 业务请求总数。
- completed。
- failed。
- canceled（若能确定）。
- incomplete。
- Body 超限。
- Body 保存失败。
- 下载失败。
- 文件写入异常。
- Session 中断来源（如果是 Interrupted 后封存）。

机器形式可包含：

```json
{
  "capture_complete": false,
  "gaps": [
    {
      "type": "body_too_large",
      "request_id": "request-0042"
    }
  ]
}
```

不做：

- 完整性评分。
- 可信度评分。
- 数字签名。
- 哈希树。
- 取证系统。

## 14. AI-ready ZIP

Review 提供：

```text
[打包 AI-ready]
```

生成：

```text
<session>-ai-ready.zip
```

规则：

- 只包含当前 AI-ready。
- 不包含 Raw。
- 不自动上传。
- 不做 ZIP 历史版本管理。

## 15. 证据引用规则

所有分析都应尽量引用稳定 ID。

例如：

```text
用户在 interaction-0088 点击了保存。
提交前表单状态见 form-state-0017。
附近请求包括 request-0042 和 request-0043。
```

避免：

- “第三个请求”。
- “列表里第 12 条”。
- 依赖排序的脆弱引用。
