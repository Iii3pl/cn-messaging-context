# `opencli web read` — 任意 URL → Markdown

薪福通 skill 之外，opencli 还内置一个独立的 "URL → Markdown" 工具。**这是处理"把任意网页转 markdown"的统一入口**——比手工 `browser eval` 抓 DOM 稳定得多。

## 一行命令

```bash
opencli web read --url "<URL>" --stdout -f plain
```

输出 Markdown 到 stdout。也可以 `--output <dir>` 保存到文件（默认 `./web-articles/<title>.md`）。

## 关键参数

| 参数 | 默认 | 说明 |
|------|------|------|
| `--url <value>` | 必填 | 任意 web URL |
| `--stdout` | false | 输出到 stdout 而非保存到文件 |
| `-f plain` / `-f json` / `-f md` | table | 输出格式，agent 用 `-f plain` |
| `--wait-for <css>` | - | 等某个 CSS 选择器出现（AJAX SPA 必备） |
| `--wait-until domstable\|networkidle` | domstable | 网络空闲策略 |
| `--wait <秒>` | 3 | 页面 load 后硬等 |
| `--download-images true\|false` | true | 是否下载图片到本地 |
| `--frames relevant-same-origin\|all-same-origin\|none` | relevant | iframe 展开策略 |
| `--diagnose` | false | 打印诊断信息（frame、empty container、XHR）到 stderr |
| `--trace retain-on-failure` | off | 失败时留 trace 帮调试 |

## 典型场景

### 1. 拉一篇文章 → 落知识库
```bash
opencli web read --url "https://mp.weixin.qq.com/s/abc" --output ~/knowledge/articles/
# 等待后看 ./articles/ 下的 .md
```

### 2. SPA 异步内容（AJAX 壳页）
```bash
opencli web read --url "https://example.com/dashboard" \
  --wait-for ".main-content" \
  --wait-until networkidle \
  --diagnose
# --diagnose 帮看 frame/empty container/XHR 是否真的拿到内容
```

### 3. iframe 嵌套页面（如旧版 Notion / 飞书云文档）
```bash
opencli web read --url "https://example.com/article" \
  --frames all-same-origin
```

### 4. Agent 流式获取（不落盘）
```bash
md=$(opencli web read --url "$URL" --stdout -f plain 2>/dev/null)
# 直接喂给后续 LLM 摘要
```

## 与 `browser eval` 抓 DOM 的对比

| 维度 | `web read` | `browser eval` |
|------|------------|----------------|
| 是否需要登录 | 不需要（公开页）| 需要（用绑定 tab）|
| iframe 友好 | ✅（默认展开 same-origin）| ❌（要手动 --frame）|
| SPA 等待策略 | wait-for + wait-until | 自己 sleep + 轮询 |
| 输出格式 | Markdown 结构化 | 任意 JS 返回 |
| 错误处理 | 结构化 trace | 裸字符串 |
| 适合场景 | 一次性内容抓取 | 登录后交互、填表、点击 |

**原则**：能 `web read` 就别 `browser eval`。`web read` 是只读 + 公开场景的稳定路径；只有需要登录态或交互时才退化到 `browser eval`。

## 适用网站（来自 opencli 文档）

- 微信公众号文章（`mp.weixin.qq.com/s/...`）→ Markdown
- 知乎专栏（`zhuanlan.zhihu.com/p/...`）→ Markdown（含图片下载）
- 任意公开网页 → Markdown

## 已验证样本（2026-06-22）

- `https://github.com/jackwener/OpenCLI` README → 完整 Markdown，含标题/列表/代码块/链接，~30s 完成
- X 公开推文（`x.com/<user>/status/<id>`）需要登录，**用 `opencli twitter thread` 或 `read` 替代**，不要用 `web read`

## 失败处理

`web read` 偶发返回空（多见于 SPA 异步内容）：

1. 加 `--wait-for <具体选择器>` 替代默认 3s wait
2. 加 `--wait-until networkidle` 而非 `domstable`
3. 加 `--diagnose` 看 stderr 诊断输出
4. 真失败时启用 `--trace retain-on-failure`，输出会指向 summary.md，按 OpenCLI 文档自愈流程修

## 与 opencli adapter 的边界

**`web read` 适合任意公开页**。**对于有 opencli adapter 的站点**（X/小红书/B站/知乎/Reddit/HackerNews/...），优先用专用 adapter——adapter 已经做了解析、字段映射、分页，比 `web read` 拿到的 markdown 再让 agent 解析更可靠。

| 场景 | 工具 |
|------|------|
| 拉任意 URL 的可读内容 | `opencli web read` |
| X 用户书签/时间线/搜索 | `opencli twitter bookmarks/timeline/search` |
| B 站热门/搜索/视频 | `opencli bilibili hot/search/video` |
| 知乎热门/搜索/问题/文章 | `opencli zhihu hot/search/question/download` |
| 小红书搜索/笔记/收藏 | `opencli xiaohongshu search/note/saved` |

详见 `references/opencli-adapter-commands.md` 的"优先 adapter 原则"。

## 反例：什么时候**不要**用 web read

- 登录后才看得到的内容（公司内网、付费墙、OAuth 后页面）→ 用 `browser eval` 走用户已登录 tab
- 需要点击/填表/导航的交互流程 → 用 `browser click/type/select`
- 频繁轮询（每 5s 刷一次）→ 用专用 adapter command，不要 `web read` 循环
- 想要结构化数据（表格/JSON）→ 用 `browser network --detail <key>` 抓 API 响应，比 markdown 解析稳定

## 实施日期
2026-06-22
