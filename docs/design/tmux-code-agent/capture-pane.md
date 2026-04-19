# tmux capture-pane 完全指南：从外层获取终端输出与历史 Log

## 概述

`capture-pane` 是 tmux 内置的"截屏"与"日志导出"工具。它能够将指定面板的**当前可见内容**以及**滚出屏幕的历史记录（History Buffer）** 提取为标准文本流。配合 `send-keys` 使用，可以实现"发送指令 → 等待执行 → 抓取结果"的完整自动化闭环。

## 1. 基础语法与目标定位

### 1.1 命令格式
```bash
tmux capture-pane -p -t <目标> [-S 起始行] [-E 结束行] [-e]
```

### 1.2 核心参数说明

| 参数 | 含义 | 关键用法 |
| :--- | :--- | :--- |
| `-p` | 输出到标准输出 (stdout) | **必须加**，否则数据只会存入 tmux 内部粘贴板而不显示 |
| `-t` | 指定目标面板 | 语法同 `send-keys`，如 `code-test:node.0` 或 `%4` |
| `-S` | 起始行号 | 用于提取**超出屏幕**的历史 log 或指定范围 |
| `-E` | 结束行号 | 配合 `-S` 截取特定区间，默认为当前屏幕末尾 |
| `-e` | 保留 ANSI 转义序列 | 若想去掉颜色代码则不加此参数；若要保留颜色则**必须加** |
| `-J` | 保留尾随空格 | 防止自动 trim 行尾空格（tmux 3.3+） |

### 1.3 查看会话结构
在抓取前确认目标：
```bash
# 列出所有会话
tmux ls

# 列出特定会话的所有面板及尺寸
tmux list-panes -t code-test
```

## 2. 行号索引规则（关键）

理解 `-S` 和 `-E` 的行号逻辑是抓取历史 log 的核心：

| 行号写法 | 代表的含义 |
| :--- | :--- |
| `0` | 当前屏幕的**第一行**（最顶部可见行） |
| 正数 (如 `10`) | 从屏幕顶部向下数的第 N 行 |
| `-` (单独使用) | 一个特殊标记：用于 `-S` 表示**历史缓冲区的开头**；用于 `-E` 表示**当前光标位置** |
| 负数 (如 `-500`) | 从屏幕顶部**向上**回溯的历史行数 |
| 末尾省略 | 如果不指定 `-E`，默认一直捕获到屏幕末尾 |

> **记忆口诀**：`-S` 是"从哪里开始"，`-E` 是"到哪里结束"。用负数就是"向上翻历史"。

## 3. 实战场景与命令速查

### 3.1 获取当前屏幕所有可见内容（截屏）
```bash
tmux capture-pane -p -t code-test:node.0
```

### 3.2 获取包含历史的完整 Log（最常用）
```bash
# 获取当前屏幕 + 向上回溯 2000 行历史
tmux capture-pane -p -S -2000 -t code-test:node.0

# 获取该面板从创建到现在的所有历史（全量导出）
tmux capture-pane -p -S - -E - -t code-test:node.0
```

### 3.3 仅获取最近 N 行（如查看最新输出）
```bash
# 只抓取最后 50 行（从历史缓冲区中截取尾部）
tmux capture-pane -p -S -50 -t code-test:node.0
```

### 3.4 保留 ANSI 颜色代码
用于后续渲染或分析（必须加 `-e`）：
```bash
tmux capture-pane -e -p -S -500 -t code-test:node.0
```

### 3.5 在管道中实时查看彩色输出
```bash
# less -R 可以解释 ANSI 颜色代码
tmux capture-pane -e -p -S -200 -t code-test:node.0 | less -R
```

## 4. 处理 ANSI 颜色：从原始代码到可视化

`capture-pane -e` 抓取到的是包含 `\x1b[32m` 这类转义序列的**原始文本流**。若要得到渲染后的效果，需要接入转换工具。

### 4.1 转换为 HTML（可在浏览器查看）

**方案 A：使用 `ansi2html`（推荐，精准）**
```bash
# 安装 (Ubuntu/Debian)
# sudo apt install colorized-logs

tmux capture-pane -e -p -S -500 -t code-test:node.0 | ansi2html > output.html
```

**方案 B：使用 `aha`（轻量通用）**
```bash
# 安装 (Ubuntu: apt install aha, MacOS: brew install aha)
tmux capture-pane -e -p -S -500 -t code-test:node.0 | aha > output.html
```

### 4.2 直接去除颜色代码（获取纯文本）
```bash
# 方法一：不带 -e 参数（tmux 默认会剥离大部分控制序列）
tmux capture-pane -p -S -500 -t code-test:node.0

# 方法二：用 sed 强制清除残留的 ANSI 序列
tmux capture-pane -e -p -S -500 -t code-test:node.0 | sed 's/\x1b\[[0-9;]*m//g'
```

### 4.3 对比：不同抓取模式的效果

| 命令 | 输出内容 | 适用场景 |
| :--- | :--- | :--- |
| `capture-pane -p` | 纯文本，无颜色 | 喂给 grep/awk 做文本分析 |
| `capture-pane -e -p` | 带 `[32m` 等原始 ANSI 代码 | 需要保留颜色信息以备后续渲染 |
| `... \| ansi2html` | 彩色 HTML 网页 | 存档、分享、视觉复盘 |

## 5. 与 Shell 脚本的集成：自动化闭环

结合 `send-keys`，可实现"发送命令 → 等待 → 抓取结果 → 判断"的自动化流程。

```bash
#!/bin/bash
# 文件名: fetch_agent_log.sh

SESSION="code-test"
PANE="node.0"
OUTPUT_FILE="/tmp/agent_output.html"

# 1. 发送指令（可选）
tmux send-keys -t "$SESSION:$PANE" "systemctl status agent" Enter
sleep 2

# 2. 抓取带颜色的历史输出并转为 HTML
tmux capture-pane -e -p -t "$SESSION:$PANE" -S -1000 | ansi2html > "$OUTPUT_FILE"

# 3. 提取纯文本用于关键词告警
RAW_LOG=$(tmux capture-pane -p -t "$SESSION:$PANE" -S -200)
if echo "$RAW_LOG" | grep -q "ERROR"; then
    echo "[ALERT] 发现错误日志！"
fi

echo "Log 已保存至: $OUTPUT_FILE"
```

## 6. 进阶技巧与注意事项

### 6.1 调整历史缓冲区大小
tmux 默认保留的历史行数有限（通常约 2000 行）。如果经常需要抓取大量历史，建议在 `~/.tmux.conf` 中调大限制：
```bash
# 设置每个面板最多保留 10000 行历史
set -g history-limit 10000
```
保存后执行 `tmux source-file ~/.tmux.conf`，之后**新创建**的面板才会生效。

### 6.2 捕获特定矩形区域
使用 `-S` 和 `-E` 配合，可以截取面板内的指定矩形区块（注意坐标是相对于屏幕可见区域的）：
```bash
# 截取第 3 行到第 10 行的内容
tmux capture-pane -p -t code-test:node.0 -S 3 -E 10
```

### 6.3 实时监控：持续抓取并 diff
```bash
# 每 2 秒抓取一次，并与上一次对比（简单实现 tail -f 效果）
while true; do
    tmux capture-pane -p -t code-test:node.0 -S -50 > /tmp/current.log
    clear
    cat /tmp/current.log
    sleep 2
done
```

## 7. 常见问题排查

| 错误现象 | 可能原因 | 解决方案 |
| :--- | :--- | :--- |
| 输出为空或只有几行 | `-S` 回溯行数不够，或面板确实无输出 | 增大负数行号，如 `-S -5000` |
| `can't find pane` | 目标面板索引错误或会话名写错 | 使用 `tmux list-panes -t SESSION` 核对 |
| HTML 中没有颜色 | 抓取时未加 `-e` 参数 | 必须使用 `capture-pane -e -p` |
| 颜色代码显示为乱码 | 直接用 `cat` 查看带 ANSI 的文件 | 改用 `less -R` 或转换为 HTML 查看 |
| 抓取内容被截断 | 面板宽度限制导致长行被折叠 | 抓取的是 tmux 内部缓冲区的原始格式，如需完整长行，确保终端宽度足够或使用 `-J` |

---

*最后更新：2026-04*