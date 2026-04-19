# tmux send-keys 完全指南：从外层控制 tmux 内部键盘事件

## 概述

`send-keys` 是 tmux 提供的一个强大命令，允许用户从外层终端（Shell）直接向 tmux 会话内部发送键盘事件。这对于自动化脚本、远程控制 CLI 程序（如 Code Agent、vim、数据库客户端等）以及构建开发工具链非常有用。

## 1. 基础语法与目标定位

### 1.1 命令格式
```bash
tmux send-keys -t <目标> <按键序列>
```

### 1.2 目标（`-t`）的指定方式
目标参数遵循 `[session]:[window].[pane]` 的层级结构。

| 格式 | 示例 | 说明 |
| :--- | :--- | :--- |
| `会话名` | `dev` | 指向该会话的**当前活动面板** |
| `会话名:窗口名` | `dev:vim` | 指向特定窗口的**当前活动面板** |
| `会话名:窗口索引.面板索引` | `dev:0.0` | **最精确的写法**，指向特定面板 |
| `%面板ID` | `%4` | 使用 `tmux list-panes` 获取的全局唯一 ID |

### 1.3 查看会话结构
在执行 `send-keys` 前，建议先确认目标结构：
```bash
# 列出所有会话
tmux ls

# 列出特定会话的所有窗口
tmux list-windows -t dev

# 列出特定窗口的所有面板
tmux list-panes -t dev:0
```

## 2. 常用按键映射表

| 目标按键 | tmux 写法 | 使用场景 |
| :--- | :--- | :--- |
| `Enter` | `Enter` | 执行当前命令行 |
| `Ctrl + C` | `C-c` | 发送 SIGINT，中断前台进程 |
| `Ctrl + D` | `C-d` | 发送 EOF，常用于退出 Shell 或 Python 解释器 |
| `Ctrl + Z` | `C-z` | 挂起前台进程 |
| `Ctrl + L` | `C-l` | 清屏 |
| `Esc` | `Escape` | 退出 vim 插入模式 / 取消菜单 |
| `Backspace` | `BSpace` | 删除前一个字符 |
| `Tab` | `Tab` | 自动补全 |
| `上/下/左/右` | `Up` `Down` `Left` `Right` | 浏览历史命令或移动光标 |
| `F1` ~ `F12` | `F1` ~ `F12` | 功能键 |
| `PageUp / PageDown` | `PageUp` `PageDown` | 翻页 |

> **注意**：组合键中的 `Ctrl` 用大写 `C` 表示，且与字母之间用连字符 `-` 连接，如 `C-space`、`M-x`（Alt+x）。

## 3. 实战场景与技巧

### 3.1 发送单条指令并执行
向运行 Code Agent 的面板发送测试命令：
```bash
tmux send-keys -t dev:0.0 "npm run test" Enter
```

### 3.2 发送多行文本（如代码块）
**方法一：使用 `-l` 参数（推荐）**
`-l` (literal) 参数会原样发送字符，避免 `$`、`"` 等特殊字符被 Shell 解析。
```bash
tmux send-keys -t dev:0.0 -l 'const msg = "Hello World";'
tmux send-keys -t dev:0.0 Enter
```

**方法二：管道输入**
适用于发送大段内容到 vim 或 cat 命令中：
```bash
echo "这是通过管道输入的内容" | tmux load-buffer -b tmp -
tmux paste-buffer -b tmp -t dev:0.0
```

### 3.3 精确控制输入节奏
对于交互式 CLI（如 fzf、lazygit），过快输入可能导致卡顿或吞字符。建议添加 `sleep` 延迟：
```bash
tmux send-keys -t dev:0.0 -l "ls -la"
sleep 0.1
tmux send-keys -t dev:0.0 Enter
```

### 3.4 模拟复杂快捷键
*   **在 vim 中保存并退出**：
    ```bash
    tmux send-keys -t dev:0.0 Escape ":wq" Enter
    ```
*   **在 less 中退出**：
    ```bash
    tmux send-keys -t dev:0.0 "q"
    ```

## 4. 与 Shell 脚本的集成

你可以将 `send-keys` 写入自动化脚本，根据外部条件触发 tmux 内部行为。

```bash
#!/bin/bash
# 文件名: trigger_build.sh

SESSION="code-test0"
PANE="node.0"

echo "[INFO] 正在向 $SESSION:$PANE 发送构建指令..."

# 发送中断信号（预防之前的任务还在运行）
tmux send-keys -t "$SESSION:$PANE" C-c
sleep 0.5

# 发送清理和构建命令
tmux send-keys -t "$SESSION:$PANE" "clear" Enter
tmux send-keys -t "$SESSION:$PANE" "cargo build --release" Enter

echo "[INFO] 指令已发送，请在 tmux 内查看输出。"
```

## 5. 进阶：控制模式 (Control Mode)

对于需要**读取** tmux 内部输出并根据输出内容决定下一步**输入**的复杂场景，`send-keys` 能力有限（它是单向的）。

此时可以使用 **tmux 控制模式**：
```bash
# 连接控制模式（会阻塞终端，显示原始 VT100 控制序列）
tmux -C attach -t code-test0
```

在控制模式下，你可以通过程序解析 tmux 输出的 `%output` 通知，实现类似 Expect 脚本的自动化交互闭环。

## 6. 常见问题排查

| 错误现象 | 可能原因 | 解决方案 |
| :--- | :--- | :--- |
| `can't find pane` | 目标面板索引错误或窗口名称写错 | 使用 `tmux list-panes -t SESSION` 核对索引 |
| 特殊字符被转义或丢失 | Shell 对 `$`、`!`、`"` 的解析 | 给文本加上**单引号**，或使用 `-l` 参数 |
| 输入卡住不执行 | 忘记发送 `Enter` 键 | 命令末尾添加 `Enter` |
| 发送后 tmux 内无反应 | 目标面板处于非活动状态或被 Zoom | 检查面板状态，可先用 `select-pane` 激活 |

---

*最后更新：2026-04*