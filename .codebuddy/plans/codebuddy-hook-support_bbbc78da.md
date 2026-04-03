---
name: codebuddy-hook-support
overview: Add CodeBuddy hook support with platform-based statistics segmentation using API token platform tagging
todos:
  - id: db-auth-platform
    content: "数据库迁移与 Auth Token 平台支持: db.js 新增 platform 列和索引、平台过滤查询语句；auth.js Token 创建/列表支持 platform 字段；client types.ts 新增 Session.platform 和 ApiToken 类型"
    status: completed
  - id: hook-platform-events
    content: "Hook 事件处理平台标记与新事件类型: hooks.js processEvent 从 Token 派生 platform 写入 session；新增 UserPromptSubmit 和 PreCompact 事件处理；setup-info 端点支持 ?platform=codebuddy 生成 CodeBuddy 安装脚本"
    status: completed
    dependencies:
      - db-auth-platform
  - id: install-hooks-codebuddy
    content: "安装脚本 CodeBuddy 支持: install-hooks.js 支持 --platform codebuddy 参数，写入 ~/.codebuddy/settings.json，注册 CodeBuddy 支持的 7 种事件类型"
    status: completed
    dependencies:
      - hook-platform-events
  - id: api-platform-filter
    content: "Stats/Analytics/Sessions API 平台筛选: stats.js、analytics.js、sessions.js 支持 ?platform=claude|codebuddy 查询参数，调用平台过滤查询语句"
    status: completed
    dependencies:
      - db-auth-platform
  - id: client-platform-ui
    content: "客户端平台过滤与展示 UI: api.ts 增加 platform 参数；Settings.tsx Token 表单 Platform 下拉；Sessions.tsx 平台过滤器；Dashboard.tsx 平台标签；Analytics.tsx 平台切换器"
    status: completed
    dependencies:
      - api-platform-filter
---

## 用户需求

为 Claude-Code-Agent-Monitor 项目增加 CodeBuddy Hook 的全面支持，并通过 API Token 区分平台来源（claude / codebuddy），实现按平台维度的统计数据分片。

## 产品概述

当前项目仅支持 Claude Code 的 Hook 事件。需要扩展为同时支持 CodeBuddy（腾讯 CodeBuddy IDE 插件），两者 Hook 格式兼容但事件类型有差异。通过在 API Token 上标记平台归属，自动将 Hook 事件归类到对应平台，并在 Dashboard / Analytics / Sessions 等页面提供平台级别的数据筛选和展示。

## 核心功能

- **Token 平台标记**: Settings UI 创建 Token 时可选 Platform（Claude / CodeBuddy），Token 记录携带 platform 字段
- **Session 平台自动归因**: Hook 事件通过 X-API-Key 提交，服务端从 Token 解析 platform 并写入 session
- **CodeBuddy Hook 事件支持**: 处理 CodeBuddy 新增的事件类型（UserPromptSubmit、PreCompact）
- **CodeBuddy Hooks 安装**: 安装脚本支持 `--platform codebuddy`，写入 `~/.codebuddy/settings.json`，注册 CodeBuddy 支持的 7 种事件类型
- **统计 API 平台筛选**: stats、analytics、sessions API 支持 `?platform=claude|codebuddy` 查询参数
- **客户端平台过滤**: Sessions 页面增加平台筛选器，Dashboard 显示平台标签，Analytics 增加平台维度切换

## 技术栈

- 后端: Node.js + Express.js (JavaScript)
- 数据库: SQLite (better-sqlite3 / node:sqlite)
- 前端: React + TypeScript + Tailwind CSS
- 实时通信: WebSocket

## 实现方案

### 核心设计: Token 派生平台

平台身份通过 API Token 传递，hook-handler.js 无需任何修改。事件处理链路:

```
hook-handler.js (X-API-Key header)
  → POST /api/hooks/event
    → hooks.js: stmts.getTokenByValue(token) → { name, platform, ... }
      → processEvent(hookType, data, tokenName, platform)
        → ensureSession(sessionId, data, tokenName, platform) → 写入 sessions.platform
```

### 1. 数据库迁移 (`server/db.js`)

**api_tokens 表**新增 platform 列:

```sql
ALTER TABLE api_tokens ADD COLUMN platform TEXT NOT NULL DEFAULT 'claude'
```

**sessions 表**新增 platform 列:

```sql
ALTER TABLE sessions ADD COLUMN platform TEXT NOT NULL DEFAULT 'claude'
```

**新增索引**: `idx_sessions_platform ON sessions(platform)`

**新增平台过滤查询语句**:

- `statsByPlatform(platform)` — 按 platform 聚合 sessions/agents/events 计数
- `listSessionsByPlatform(platform, limit, offset)` — 按 platform 筛选 sessions
- `listSessionsByPlatformAndStatus(platform, status, limit, offset)` — platform + status 组合筛选
- `dailyEventCountsByPlatform(platform)` — 按平台分日事件数
- `dailySessionCountsByPlatform(platform)` — 按平台分日 session 数
- `toolUsageCountsByPlatform(platform)` — 按平台工具使用统计
- `eventTypeCountsByPlatform(platform)` — 按平台事件类型统计
- `avgEventsPerSessionByPlatform(platform)` — 按平台平均事件数
- `totalSubagentCountByPlatform(platform)` — 按平台 subagent 计数
- `agentTypeDistributionByPlatform(platform)` — 按平台 agent 类型分布

**修改现有语句**:

- `insertToken` — 增加 platform 参数
- `listTokens` — SELECT 增加 platform 列
- `insertSession` — 增加 platform 参数

### 2. Auth 路由 (`server/routes/auth.js`)

- `POST /api/auth/tokens`: body 增加 `platform` 字段，默认 `'claude'`，校验值必须为 `'claude' | 'codebuddy'`
- `POST /api/auth/tokens` 返回值增加 `platform` 字段
- `GET /api/auth/tokens` 返回列表增加 `platform` 字段

### 3. Hook 事件处理 (`server/routes/hooks.js`)

- `POST /event`: 从 token 行读取 `platform`，与 `tokenName` 一起传入 `processEvent`
- `processEvent` 签名变更: `(hookType, data, tokenName, platform)`
- `ensureSession` 签名变更: 增加 `platform` 参数，写入 sessions 表
- **新增事件处理**:
- `UserPromptSubmit`: 记录为普通 event，summary 为 "User prompt submitted"
- `PreCompact`: 记录为预压缩 event，summary 为 "Pre-compaction triggered"
- **setup-info 端点**: 支持 `?platform=codebuddy`，生成 CodeBuddy 安装脚本（写入 `~/.codebuddy/settings.json` 和 `~/.codebuddy/claude-dashboard.json`）

### 4. 安装脚本 (`scripts/install-hooks.js`)

- 新增 `--platform codebuddy` CLI 参数
- CodeBuddy 模式:
- 配置路径: `~/.codebuddy/settings.json`
- 事件类型: `SessionStart, SessionEnd, PreToolUse, PostToolUse, UserPromptSubmit, Stop, PreCompact`
- 不安装 Claude 专有类型: `SubagentStop, Notification, PermissionRequest`

### 5. Stats API (`server/routes/stats.js`)

- `GET /api/stats?platform=claude|codebuddy`
- 有 platform 参数时使用 `statsByPlatform` 查询
- 无参数时返回全量（向后兼容）

### 6. Analytics API (`server/routes/analytics.js`)

- `GET /api/analytics?platform=claude|codebuddy`
- 所有聚合查询增加 platform 条件

### 7. Sessions API (`server/routes/sessions.js`)

- `GET /api/sessions?platform=claude|codebuddy&status=active`
- platform 与 status 参数可组合使用
- 新增 platform 参数解析和对应的 prepared statement 调用

### 8. 客户端类型 (`client/src/lib/types.ts`)

- `Session` 接口新增 `platform: string`
- 新增 `ApiToken` 接口导出: `{ id, name, platform, created_at, last_used_at }`
- 新增 `PLATFORM_CONFIG` 常量: claude 和 codebuddy 的标签/颜色配置

### 9. 客户端 API (`client/src/lib/api.ts`)

- `api.auth.createToken(name, platform)` — 增加 platform 参数
- `api.sessions.list({ status, platform, limit, offset })` — 增加 platform
- `api.stats.get(platform?)` — 增加 platform
- `api.analytics.get(platform?)` — 增加 platform

### 10. 客户端 UI 修改

- **Settings.tsx**: Token 创建表单增加 Platform 下拉选择（默认 Claude），Token 列表显示平台标签
- **Sessions.tsx**: FILTER_OPTIONS 增加 Claude / CodeBuddy 选项，与 status 过滤器并排显示
- **Dashboard.tsx**: Session 和 Agent 卡片显示平台小标签
- **Analytics.tsx**: 页面顶部增加平台切换器（All / Claude / CodeBuddy），图表数据按平台过滤

### 性能与兼容性说明

- **向后兼容**: 所有 API 的 platform 参数可选，不传时返回全量数据
- **索引优化**: `idx_sessions_platform` 确保平台筛选查询高效
- **Token 兼容**: 已有 Token 默认 platform='claude'，不影响现有功能
- **Hook handler 零修改**: 平台信息从 Token 自动派生，hook-handler.js 不感知平台概念

## 目录结构

```
Claude-Code-Agent-Monitor/
├── server/
│   ├── db.js                          # [MODIFY] 新增 platform 迁移、索引、平台过滤查询语句
│   ├── routes/
│   │   ├── auth.js                    # [MODIFY] Token 创建/列表支持 platform 字段
│   │   ├── hooks.js                   # [MODIFY] processEvent 平台标记、UserPromptSubmit/PreCompact 事件处理、setup-info CodeBuddy 变体
│   │   ├── stats.js                   # [MODIFY] 支持 ?platform 查询参数
│   │   ├── analytics.js               # [MODIFY] 支持 ?platform 查询参数
│   │   └── sessions.js                # [MODIFY] 支持 ?platform 查询参数
├── scripts/
│   ├── hook-handler.js                # [NO CHANGE] 平台通过 Token 派生，无需修改
│   └── install-hooks.js               # [MODIFY] 支持 --platform codebuddy，写入 ~/.codebuddy/settings.json
├── client/src/
│   ├── lib/
│   │   ├── types.ts                   # [MODIFY] Session.platform、ApiToken 接口、PLATFORM_CONFIG
│   │   └── api.ts                     # [MODIFY] createToken/sessions.list/stats.get/analytics.get 增加 platform 参数
│   └── pages/
│       ├── Settings.tsx               # [MODIFY] Token 表单 Platform 下拉、列表平台标签
│       ├── Sessions.tsx               # [MODIFY] 增加 Claude/CodeBuddy 平台过滤器
│       ├── Dashboard.tsx              # [MODIFY] Session/Agent 卡片平台标签
│       └── Analytics.tsx              # [MODIFY] 平台切换器（All/Claude/CodeBuddy）
```