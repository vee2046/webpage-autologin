# AGENTS.md - Auto Login Helper Chrome Extension

## 项目概览

Chrome 自动登录插件，支持配置多站点，打开目标网址时自动填写用户名、密码并点击登录按钮。

## 技术栈

- Chrome Extension Manifest V3
- 原生 HTML/CSS/JavaScript（无框架依赖）
- Chrome Storage API（本地数据持久化）

## 文件结构

```
├── manifest.json          # 插件配置文件 (Manifest V3)
├── background.js          # Service Worker - 监听标签页变化、消息通信
├── content.js             # Content Script - 注入页面，执行自动填充和登录
├── popup.html             # 弹出窗口 - 配置管理界面
├── popup.css              # 弹出窗口样式
├── popup.js               # 弹出窗口逻辑 - 站点 CRUD
├── icons/                 # 插件图标
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── index.html             # 安装说明页面
```

## 核心功能

1. **站点配置管理**：添加/编辑/删除/启用禁用站点
2. **自动填充**：匹配 URL 后自动填写用户名和密码
3. **协议勾选**：支持可选的协议复选框自动勾选
4. **CSS 选择器**：自定义用户名/密码/登录按钮/协议的选择器
5. **URL 匹配**：支持精确匹配、前缀匹配、通配符(*)
6. **框架兼容**：模拟真实用户输入，兼容 React/Vue/Angular 等框架

## 安装方式

1. 打开 Chrome 浏览器，访问 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本项目文件夹

## 使用方式

1. 点击浏览器工具栏中的插件图标
2. 点击右上角面板图标，在目标页面上打开配置面板
3. 填写网址、用户名、密码和对应的 CSS 选择器
4. 保存后，打开目标网址即自动登录

## CSS 选择器示例

| 场景 | 选择器示例 |
|------|-----------|
| ID 选择器 | `#username`, `#password`, `#login-btn` |
| 属性选择器 | `input[name='user']`, `input[type='password']` |
| 类选择器 | `.login-input`, `.submit-btn` |
| 组合选择器 | `form.login input[type='text']` |
| 按钮选择器 | `button[type='submit']`, `.btn-login` |
