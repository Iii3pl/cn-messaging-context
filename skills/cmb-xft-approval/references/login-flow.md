# 薪福通登录流程

> 验证环境：macOS + opencli v1.7.8 + Chrome 自动化窗口  
> 最后验证：2026-05-02

---

## 前置条件

- 自动化窗口是**独立 Chrome profile**，不共享用户主 Chrome 的 Cookie
- 用户主 Chrome 登录了薪福通 ≠ 自动化窗口有登录态

---

## 完整登录步骤

### Step 1: 打开薪福通
```bash
opencli browser open 'https://xft.cmbchina.com/'
```

### Step 2: 点击「登录」
```
页面状态：招商银行薪福通 首页
目标元素：<a href="/#/index">登录</a>
命令：opencli browser eval 找到并 click
```

### Step 3: 切换登录方式
```
页面 URL: /#/index
默认 tab: 手机号登录（短信验证码）
需要切到: 密码登录

DOM 结构：
  <div role="tab" id="rc-tabs-0-tab-password" aria-selected="true">密码登录</div>
  <input id="passwordLogin_phone" type="text" placeholder="请输入手机号">
  <input id="passwordLogin_password" type="password" placeholder="请输入密码">

命令：
  opencli browser type [phone_input_ref] '手机号'
  opencli browser type [password_input_ref] '密码'
```

### Step 4: 点击登录
```
目标：登录按钮（.ant-btn 或包含「登录」文本的 button）
命令：opencli browser click [ref]
```

### Step 5: 滑块验证码（⚠️ 不可自动化）
```
如果出现：按住左方滑块，向右拖动滑块完成拼图
→ 用户必须手动拖动
→ Agent 等待页面 URL 变更或 title 变更
→ 成功后进入 /#/workbench
```

### Step 6: 进入智能费控
```
工作台 (/#/workbench)
  → 找到「智能费控」应用卡片
  → 点击 .FullApplication_item__3Ruc3（textContent 含「智能费控」）
  → 跳转到 TripMainWeb
```

---

## 登录成功标志

- Title 变为「智能费控·薪福通」或「工作台·薪福通」
- TripMainWeb URL 可正常访问

---

## 常见失败

| 现象 | 原因 | 处理 |
|------|------|------|
| 长时间未操作弹窗 | 30 分钟无操作 | 点击「重新登录」按钮 |
| 滑块一直出现 | 反爬机制 | 用户手动完成 |
| 登录后 TripMainWeb 空白 | 需从工作台进入 | 先访问 /#/workbench → 再进智能费控 |

---

## 登录态持久化

- Cookie 绑定 opencli browser profile
- 跨 session 可复用（如果服务端未踢出）
- keepalive cron 推荐每 20 分钟执行一次
