## User Requirements

- 找到当前自动配置 hooks 时，实际负责下载与安装的脚本链路。
- 在现有客户端支持基础上，补充对 `codebuddy-cli` 的正式接入能力。
- 参考官方 CodeBuddy CLI hooks 文档，保证支持的事件和配置方式与实际客户端一致。
- 保持现有 Claude 与已有 CodeBuddy 历史数据、已有安装方式尽量不受影响。

## Product Overview

- 系统需要明确展示并支持 `CodeBuddy CLI` 客户端的一键接入流程。
- 用户在生成 Token、复制安装命令、查看平台标签和筛选平台时，能直观看到 `CodeBuddy CLI`。
- 安装后，客户端应持续上报会话开始结束、工具调用、通知、上下文压缩等事件。

## Core Features

- 明确 hooks 自动下载入口，并沿用现有一键安装链路。
- 补齐 CodeBuddy CLI 官方 hooks 事件集合。
- 兼容旧的 CodeBuddy 标识与历史记录，避免数据断层或平台分裂。
- 在设置页、会话页、分析页、卡片标签中统一显示 `CodeBuddy CLI`。

## Tech Stack Selection

- 后端沿用现有 Node.js + Express 路由结构。
- 前端沿用现有 React + TypeScript 页面与类型配置。
- hooks 安装与转发继续复用现有 Node 脚本链路。
- 数据层继续使用现有 SQLite 结构，不新增不必要的数据迁移。

## Implementation Approach

### 总体策略

基于现有已存在的 `codebuddy` 支持做“官方 CodeBuddy CLI 化升级”，而不是新开一套完全独立的安装链路。最优方案是：对外接受并展示 `codebuddy-cli`，同时把旧 `codebuddy` 作为兼容别名保留，避免历史数据、统计维度和旧 token 被拆成两个平台桶。

### 关键技术决策

1. **安装链路继续复用 `/api/hooks/setup-info`**

- 已确认自动下载入口在 `server/routes/hooks.js` 的 `GET /api/hooks/setup-info`。
- 该接口动态生成 shell，再下载 `handler.js` 与 `install-hooks.js`，这是现有最稳定的接入链路，应继续沿用。

2. **`codebuddy-cli` 采用“别名兼容”而非新增持久化平台值**

- 现有代码已把 `codebuddy` 指向 `~/.codebuddy/settings.json`，与官方 CodeBuddy CLI 目录一致。
- 若直接新增第三个平台值，会导致旧 `codebuddy` 历史会话、筛选、分析统计被拆分。
- 更合理的方式是：API、安装命令、前端文案支持 `codebuddy-cli`，后端读取时兼容 `codebuddy`，必要时统一归一到现有 `codebuddy` 语义。

3. **补齐 CodeBuddy CLI 官方事件集合**

- 当前服务端事件处理已经支持 `Notification`、`SubagentStop`、`UserPromptSubmit`、`PreCompact` 等。
- 真正缺口在 `scripts/install-hooks.js` 给 CodeBuddy 写入的 hooks 列表少了 `Notification` 与 `SubagentStop`。
- 因此重点是安装器配置补齐，而不是重写事件接收层。

4. **修正 `hook-handler.js` 的配置读取路径**

- 现有远程 setup 在 CodeBuddy 模式下把 dashboard 配置写到 `~/.codebuddy/claude-dashboard.json`。
- 但 `scripts/hook-handler.js` 目前固定读取 `~/.claude-internal/claude-dashboard.json`，这会让 CodeBuddy 路径不可靠。
- 应改为按安装目录或双路径回退方式读取，确保 Claude 与 CodeBuddy CLI 都能找到对应配置。

### 性能与可靠性

- 平台别名归一与查询校验均为常量级判断，额外开销可忽略。
- 安装器补齐事件仅是遍历 hooks 列表，复杂度为 O(n)，n 为事件数量，规模很小。
- hooks 事件上报主链路保持不变，继续沿用现有 fail-safe 机制、超时退出策略与单次 HTTP 转发，避免引入额外阻塞。
- 不新增数据库迁移，可降低升级风险与回滚成本。

## Implementation Notes

- 保持 `claude` 现有行为完全不变，不改动其安装路径、事件处理和超时策略。
- `codebuddy-cli` 与旧 `codebuddy` 必须共存兼容，避免历史 session/filter/analytics 断层。
- `scripts/hook-handler.js` 需要优先修复配置读取路径问题，否则远程 CodeBuddy CLI 安装链路即使写入成功也可能无法上报。
- 触达平台校验时，顺手修复 `server/routes/stats.js` 中 `incldes` 的拼写问题，避免平台筛选失效。
- 文档需与真实实现保持一致：当前很多说明仍偏向 Claude-only 或旧路径，需同步修正。
- 当前工作区存在与本需求无关的 `client/src/pages/KanbanBoard.tsx` 未提交改动，实施时应避免触碰。

## Architecture Design

现有结构保持不变，只在已有链路内补强平台兼容：

- **安装入口层**：`/api/hooks/setup-info` 生成平台对应的一键安装脚本。
- **脚本安装层**：`scripts/install-hooks.js` 写入目标客户端 `settings.json` 的 hooks 配置。
- **事件转发层**：`scripts/hook-handler.js` 读取 dashboard 配置并 POST 到 `/api/hooks/event`。
- **事件接收层**：`server/routes/hooks.js` 继续负责会话、Agent、事件落库与广播。
- **展示层**：前端页面与类型配置统一显示 `CodeBuddy CLI`，但兼容旧平台值。

## Directory Structure

本次实现建议修改以下文件：

- `server/routes/hooks.js`  [MODIFY]  
负责远程一键安装脚本生成与 hooks 事件接收。需支持 `codebuddy-cli` 作为 setup 参数别名，统一平台文案，并保证生成的下载脚本仍复用现有 handler/installer 链路。

- `server/routes/auth.js`  [MODIFY]  
负责创建 API Token。需接受 `codebuddy-cli` 输入并做兼容归一，避免与旧 `codebuddy` 平台割裂。

- `server/routes/sessions.js`  [MODIFY]  
负责会话列表平台筛选。需兼容 `codebuddy-cli` 查询语义，确保历史 `codebuddy` 记录仍能被同一平台视图看到。

- `server/routes/analytics.js`  [MODIFY]  
负责分析接口平台筛选。需兼容 `codebuddy-cli` 与旧值聚合，避免统计拆分。

- `server/routes/stats.js`  [MODIFY]  
负责统计总览平台筛选。需兼容 `codebuddy-cli`，并修复现有 `incldes` 拼写问题。

- `scripts/install-hooks.js`  [MODIFY]  
负责向目标客户端 `settings.json` 写入 hooks。需支持 `codebuddy-cli` 参数别名，补齐官方 CodeBuddy CLI 的事件集合，并保持 Claude 配置不变。

- `scripts/hook-handler.js`  [MODIFY]  
负责读取 dashboard 配置并转发事件。需修复 CodeBuddy CLI 配置文件读取逻辑，保证从 `.codebuddy` 安装时也能正确找到配置。

- `client/src/lib/types.ts`  [MODIFY]  
负责平台类型与展示映射。需统一 `CodeBuddy CLI` 文案，并为前端平台显示提供兼容配置。

- `client/src/pages/Settings.tsx`  [MODIFY]  
负责 Token 创建与一键安装命令展示。需把平台选项、复制命令和说明文案更新为 `CodeBuddy CLI` 语义，并兼容旧值。

- `client/src/pages/Sessions.tsx`  [MODIFY]  
负责会话平台筛选。需统一显示 `CodeBuddy CLI`，避免旧平台名继续暴露给用户。

- `client/src/pages/Analytics.tsx`  [MODIFY]  
负责分析页平台筛选。需统一显示 `CodeBuddy CLI`，与后端平台兼容逻辑保持一致。

- `client/src/components/AgentCard.tsx`  [MODIFY]  
负责 Agent 平台标签渲染。需将平台胶囊标签改为 `CodeBuddy CLI` 展示，兼容旧记录。

- `server/__tests__/api.test.js`  [MODIFY]  
现有后端集成测试入口。需增加 `codebuddy-cli` 别名、`/api/hooks/setup-info` 生成脚本、平台筛选兼容与 hooks 事件覆盖的断言。

- `client/src/components/__tests__/AgentCard.test.tsx`  [MODIFY]  
现有前端组件测试。需更新平台标签显示断言，覆盖 `CodeBuddy CLI` 文案兼容。

- `docs/HOOKS.md`  [MODIFY]  
hooks 体系说明文档。需从旧的 Claude/.githooks 叙述调整为当前真实下载链路，并补充 CodeBuddy CLI 官方事件集合与配置路径。

- `README.md`  [MODIFY]  
对外主文档。需同步平台名称、安装说明、hooks 路径与一键接入方式。

- `SETUP.md`  [MODIFY]  
安装与运行指引。需同步当前 hooks 自动配置逻辑、CodeBuddy CLI 支持范围与路径说明。

- `INSTALL.md`  [MODIFY]  
部署安装说明。需明确本地 Claude 自动安装与 CodeBuddy CLI 远程 token 安装的边界和用法。

## Key Code Structures

本次更适合沿用现有结构并做兼容归一，不建议额外引入新的抽象层。核心约束应保持为：

- 后端所有平台入口统一接受 `claude`、`codebuddy`、`codebuddy-cli`
- 对外展示统一为 `Claude` / `CodeBuddy CLI`
- 安装路径仍映射到 `~/.claude-internal` 与 `~/.codebuddy`
- hooks 事件接收接口继续使用现有 `/api/hooks/event`