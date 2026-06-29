# opencli adapter 优先原则

**核心原则**：在 100+ opencli 已覆盖的站点上，**永远优先用专用 `opencli <site> <command>` adapter**，不要退化到 `opencli browser eval` 抓 DOM。

## 为什么

| 维度 | adapter | browser eval |
|------|---------|--------------|
| 反爬适配 | ✅ 已做（处理 cookie、签名、token）| ❌ 全靠 cookie + UA |
| 字段映射 | ✅ 结构化 JSON/table | ❌ 要自己写 selector |
| 分页 | ✅ 内置 | ❌ 要自己实现 |
| 错误处理 | ✅ 结构化错误码 | ❌ 字符串匹配 |
| 维护成本 | 跟着 opencli 升级 | 站点一改就失效 |

**反例（2026-06-22 实测）**：X.com 书签，本会话用 `opencli browser gxs46xbg eval` 抓 `[data-testid="tweet"]` 手动解析。**这其实有专用命令**：

```bash
opencli twitter bookmarks  # 一次返所有书签的结构化数据
```

虽然 X 强制登录会触发 OAuth 页（adapter 不一定能直接拿到），但至少有**完整 `opencli twitter` adapter 套件**（30+ 命令），eval 是兜底而非首选。

## 决策流程

```
需要从某网站拿数据
  ↓
1. opencli list | grep -i <site>   # 查有没有 adapter
  ↓ 有
2. opencli <site> --help            # 看有什么命令
  ↓
3. 跑 opencli <site> <command> 拿结构化数据
  ↓ 失败 / 没有想要的命令
4. opencli web read --url ...       # 公开页 → markdown
  ↓ 还要登录态或交互
5. opencli browser <s> <command>     # browser 兜底
```

## 吴亮常用站点的 opencli adapter 一览

| 站点 | opencli 站点名 | 关键命令 | cookie 策略 |
|------|----------------|----------|------|
| X / Twitter | `twitter` | trending, search, timeline, tweets, bookmarks, lists, profile, thread, post, reply, follow, like, download | cookie |
| 小红书 | `xiaohongshu` | search, note, comments, feed, user, saved, download, publish, follow | cookie |
| B 站 | `bilibili` | hot, search, me, favorite, history, feed, video, comments, dynamic, ranking, download | cookie |
| 知乎 | `zhihu` | hot, search, question, download, follow, like, favorite, comment, answer | cookie |
| 微信公众号 | `weixin` | download（导出 markdown）| cookie |
| Hacker News | `hackernews` | top, new, best, ask, show, jobs, search, user | public |
| Reddit | `reddit` | hot, frontpage, popular, search, subreddit, read, user, saved, upvote | cookie |
| 小宇宙 | `xiaoyuzhou` | download, transcript | local |
| Spotify | `spotify` | (需独立 skill) | local |
| 1688 | `1688` | download, search | cookie |
| arxiv | `arxiv` | search, fetch | public |
| LinkedIn | `linkedin` | connect, inbox, search, profile, post, salesnav-* | cookie |
| 抖音 | `douyin` | (部分) | cookie |
| 微博 | `weibo` | (部分) | cookie |
| Slack | `slock` | message-send, channel-list, task-list, dm-list | cookie |
| Amazon | `amazon` | bestsellers, search, product, movers-shakers, rankings | public |
| NotebookLM | `notebooklm` | list, open, summary, source-* | cookie |
| Claude | `claude` | ask, send, new, status, read | cookie |
| Gemini | `gemini` | new, ask, image, deep-research | cookie |

**完整列表**：`opencli list -f json` 是 source of truth（会更新），不要硬编码这里。

## cookie-strategy adapter 的硬要求

cookie 类 adapter（X/小红书/B 站等）需要：
1. **Chrome 里登录了目标站点**（X/小红书/B 站等）
2. **OpenCLI 扩展已安装并连接**（`opencli doctor` 验证）
3. cookie 通过 opencli bridge 复用，不需要重新登录

**未登录 / 验证码阻断时**：先在 Chrome 手动登录，adapter 才能拿到 cookie 跑通。

## 与 XFT 审批 skill 的边界

XFT skill 处理的是**薪福通**（招商银行企业费控），**薪福通没有 opencli adapter**（不在 100+ 站点列表里），所以 XFT skill 继续走 `opencli browser eval` 兜底是合理的。

**判别口诀**：
- 站点在 `opencli list` → 用 adapter
- 站点不在（含薪福通）→ 用 browser eval 兜底

## 实施日期
2026-06-22（从 X 书签会话发现：eval 抓 `[data-testid="tweet"]` 其实是 `opencli twitter bookmarks` 能替代的工作）
