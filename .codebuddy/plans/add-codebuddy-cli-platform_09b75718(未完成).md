---
name: add-codebuddy-cli-platform
overview: 定位 hooks 自动下载/安装链路，并规划为项目新增 `codebuddy-cli` code-agent client 的全链路支持，包括后端 platform 校验、安装脚本、前端平台展示与文档同步。
todos:
  - id: audit-platform-refs
    content: 用[subagent:code-explorer]复核 platform 引用并锁定改动面
    status: pending
  - id: backend-platform-support
    content: 扩展后端 platform 校验，新增 codebuddy-cli 并保留 legacy
    status: pending
    dependencies:
      - audit-platform-refs
  - id: installer-chain
    content: 完善 setup-info、install-hooks、hook-handler 的新客户端链路
    status: pending
    dependencies:
      - backend-platform-support
  - id: client-platform-ui
    content: 更新 Settings、Sessions、Analytics、AgentCard 的平台展示
    status: pending
    dependencies:
      - installer-chain
  - id: tests-docs
    content: 补齐测试并同步 README、SETUP、INSTALL、HOOKS 文档
    status: pending
    dependencies:
      - client-platform-ui
---

## User Requirements

- 先定位当前自动配置 hooks 时，实际负责下载与安装的脚本链路。
- 在现有客户端支持基础上，新增一个新的 code-agent client：`codebuddy-cli`。
- 新客户端需要沿用现有接入体验：可创建对应平台 token、生成一键安装命令、安装 hooks、把事件回传到面板。
- 参考官方 CodeBuddy CLI hooks 事件定义补齐接入能力，同时保留现有数据可继续使用。

## Product Overview

- 当前一键接入流程会由服务端动态生成 shell 脚本，自动下载 handler 与 installer，再写入目标客户端的 hooks 配置。
- 新增后，用户应能在界面中明确看到 `CodeBuddy CLI` 选项，并生成对应安装命令；历史 `codebuddy` 数据继续可见、可筛选，不被强制替换。
- 页面视觉变化以现有风格为主，只增加新的平台标签、筛选项与更准确的说明文案，不做大幅界面改版。

## Core Features

- 明确自动下载链路：服务端生成安装脚本，脚本再下载 handler 与 installer 并写入客户端配置。
- 新增 `codebuddy-cli` 平台的 token、安装命令、hooks 配置写入与事件上报支持。
- 按官方事件集合补齐 CodeBuddy CLI hooks，确保安装后事件覆盖完整。
- 保持旧 `codebuddy` 记录兼容显示，平台标签与筛选结果清晰可区分。

## Tech Stack Selection

- 前端：React + TypeScript
- 后端：Node.js + Express
- 数据存储：SQLite
- hooks 安装链路：服务端动态 shell + Node 脚本安装器 + Node hook 转发器

## Implementation Approach

- 采用“新增 `codebuddy-cli`，保留 legacy `codebuddy` 兼容”的方案，而不是直接重命名旧平台。这样不会破坏已有 token、session 与筛选结果，同时能把新客户端命名收敛到更准确的 `CodeBuddy CLI`。
- hooks 下载主链路继续复用现有实现：`server/routes/hooks.js` 的 `/api/hooks/setup-info` 生成安装脚本，脚本下载 `scripts/hook-handler.js` 与 `scripts/install-hooks.js`，再写入目标客户端的 `settings.json`。实现上只扩展平台分支，不重写链路。
- CodeBuddy 家族统一落到 `~/.codebuddy/settings.json`，并按官方文档补齐 9 个 hooks 事件；Claude 专属事件继续只保留在 Claude 分支中，避免把不支持的事件写进 CodeBuddy CLI 配置。
- 服务端事件入口继续复用 `/api/hooks/event` 与现有 `processEvent` 流程，避免新增 ingestion 通道。安装配置写入复杂度为 O(k)，k 为 hook 事件数且为小常量；单次事件处理维持现有 O(1) 数据更新路径，性能瓶颈不变。
- 关键兼容决策：
- 新建 token 入口面向 `codebuddy-cli`
- 旧 `codebuddy` 继续允许被读取、过滤、展示
- 不做数据库迁移，因为当前 platform 字段为普通文本列，新增值可直接落库

## Implementation Notes

- 当前真正执行“下载”的核心不是本地静态脚本，而是 `server/routes/hooks.js` 中 `/api/hooks/setup-info` 动态返回的 shell；文档与实现都应围绕这条链路更新。
- `scripts/hook-handler.js` 现在只读取 `~/.claude-internal/claude-dashboard.json`，这会让 CodeBuddy 家族远程安装后的本地配置读取不完整；新增平台时应一并修正为兼容 Claude 与 `.codebuddy` 配置位置。
- `scripts/install-hooks.js` 里现有 `codebuddy` 事件集合少于官方文档，需要补上 `Notification` 与 `SubagentStop`，同时保留非阻塞、失败静默的 hook 行为。
- 保持改动聚焦：不做无关重构，不改事件语义，不批量改历史数据，只扩大平台识别与安装覆盖面。
- `server/routes/stats.js` 当前存在 `incldes` 拼写问题；由于本次会触碰该文件的平台校验，建议顺手修正，避免新平台过滤失效。
- `client/src/pages/Analytics.tsx` 当前平台切换依赖不完整；新增平台过滤时应一起修正重新加载逻辑，避免前端表现与后端能力不一致。

## Architecture Design

- 平台元信息流：
- Settings 创建 token
- token 记录 platform
- `/api/hooks/setup-info` 按 platform 生成安装脚本
- 安装脚本下载 handler 与 installer
- installer 写入目标客户端 hooks 配置
- hook-handler 把事件转发到 `/api/hooks/event`
- 服务端根据 token.platform 记录 session.platform
- 前端通过平台配置表统一显示标签、筛选项与说明文案
- 兼容策略：
- `codebuddy-cli` 为新平台主入口
- `codebuddy` 作为 legacy 平台仅保留读取与展示能力
- CodeBuddy 家族共用 `.codebuddy` 配置目录与同一套官方 hooks 事件

## Directory Structure

本次改动围绕现有 hooks 安装链路做增量扩展，不预计新增数据库迁移文件。

```text
/Users/havoc420/Documents/Projects/tools/Claude-Code-Agent-Monitor/
├── server/routes/hooks.js                           # [MODIFY] 扩展 setup-info 平台枚举与平台族判断；为 codebuddy-cli 生成正确的一键安装脚本与平台参数。
├── server/routes/auth.js                            # [MODIFY] 扩展 token 创建平台校验；允许新平台创建并保留 legacy codebuddy 兼容输入。
├── server/routes/sessions.js                        # [MODIFY] 扩展 sessions 平台过滤白名单，确保新平台查询正常。
├── server/routes/analytics.js                       # [MODIFY] 扩展 analytics 平台过滤白名单，支持 codebuddy-cli。
├── server/routes/stats.js                           # [MODIFY] 扩展 stats 平台过滤白名单，并修正现有 includes 拼写错误。
├── scripts/install-hooks.js                         # [MODIFY] 支持 --platform codebuddy-cli；统一 CodeBuddy 家族配置路径并补齐官方 hooks 事件集合。
├── scripts/hook-handler.js                          # [MODIFY] 兼容读取 Claude 与 CodeBuddy 家族的本地 dashboard 配置，保证下载后可正确上报。
├── client/src/lib/types.ts                          # [MODIFY] 扩展 Platform 类型与 PLATFORM_CONFIG，区分 codebuddy-cli 与 legacy codebuddy。
├── client/src/pages/Settings.tsx                    # [MODIFY] 新增 CodeBuddy CLI token 与安装命令入口；调整说明文案，避免继续创建 legacy 平台。
├── client/src/pages/Sessions.tsx                    # [MODIFY] 新增平台过滤与标签展示，兼容 legacy codebuddy 历史数据。
├── client/src/pages/Analytics.tsx                   # [MODIFY] 新增平台过滤项并修正切换后的重新加载逻辑；同步相关标题文案。
├── client/src/components/AgentCard.tsx             # [MODIFY] 改为统一复用 PLATFORM_CONFIG 渲染平台徽标，正确显示 CodeBuddy CLI 与 legacy 标签。
├── server/__tests__/api.test.js                     # [MODIFY] 覆盖 token 平台、setup-info 输出、平台过滤与 legacy 兼容回归。
├── client/src/components/__tests__/AgentCard.test.tsx # [MODIFY] 补充新平台与 legacy 平台标签显示测试。
├── docs/HOOKS.md                                    # [MODIFY] 以当前真实链路更新 hooks 下载/安装说明，并同步 CodeBuddy CLI 官方事件。
├── README.md                                        # [MODIFY] 更新平台支持说明、远程一键安装命令与 install-hooks 用法。
├── SETUP.md                                         # [MODIFY] 补充 codebuddy-cli 安装与接入说明。
└── INSTALL.md                                       # [MODIFY] 补充 codebuddy-cli hooks 安装命令与注意事项。
```

## Key Code Structures

- 平台类型将从双值扩展为三值：`claude`、`codebuddy`、`codebuddy-cli`
- 前端展示配置继续集中在 `PLATFORM_CONFIG`
- 后端保持按 route 内白名单校验平台值，不额外引入大范围新抽象，以降低改动面

## Agent Extensions

### SubAgent

- **code-explorer**
- Purpose: 在实施阶段复核仓库内所有 `claude`、`codebuddy`、`codebuddy-cli` 引用，避免遗漏平台分支、文案或测试。
- Expected outcome: 得到完整受影响文件清单，并在实现后确认没有残留的不一致平台逻辑。