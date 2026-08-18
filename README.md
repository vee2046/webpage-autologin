# Webpage Auto Login

Chrome 扩展 (Manifest V3)，自动填写登录表单并提交。配置一次，每次打开目标网址都自动登录。

## 功能特性

- **多站点配置** —— 在页面上以拖拽面板形式添加站点，弹窗里集中管理、启用/禁用、编辑、删除
- **CSS 选择器自定义** —— 每个站点的用户名、密码、登录按钮、协议复选框分别指定选择器
- **URL 匹配** —— 支持精确、前缀、通配符（`*`）；查询字符串与 hash 自动忽略
- **协议自动勾选** —— 可选的复选框选择器，登录前自动勾选
- **兼容现代框架** —— 通过 `PointerEvent` + `MouseEvent` 链 + 原生 value setter 触发 React / Vue / Angular 响应式
- **密码本地加密** —— AES-GCM 256 + PBKDF2 100k 轮，密钥派生自扩展 ID，存储到 `chrome.storage.local` 的是密文
- **SPA 路由感知** —— 监听 `history.pushState` / `popstate`，单页应用跳转也能触发自动登录
- **防重入 / 冷却** —— 同一 URL 短时间内不会重复登录

## 安装

本项目没有构建步骤，直接以源码形式加载到 Chrome：

1. 下载本仓库全部文件到本地
2. 打开 Chrome，访问 `chrome://extensions/`
3. 右上角打开「开发者模式」
4. 点击「加载已解压的扩展程序」，选择本项目根目录

## 使用

1. 在任意网页上点击工具栏的扩展图标
2. 点击 popup 右上角的 **面板图标** —— 在当前页面右侧弹出拖拽式配置面板
3. 填写网址、用户名、密码
4. 在选择器字段右侧点击 **「🎯 拾取」**，然后在页面上点选目标元素 —— 选择器会自动填回表单
5. 保存。再次访问匹配的 URL 时自动登录

URL 支持通配符 `*`，例如 `https://*.example.com/login`。

## 文件结构

```
.
├── manifest.json          # Manifest V3 配置
├── background.js          # Service Worker - 消息路由、写入串行化
├── content.js             # Content Script - 页面注入、自动登录、拖拽面板
├── crypto.js              # 密码加密 / 解密 (AES-GCM + PBKDF2)
├── popup.html             # 弹窗 - 站点管理界面
├── popup.css              # 弹窗样式
├── popup.js               # 弹窗逻辑
├── icons/                 # 扩展图标 (16/48/128)
└── index.html             # 项目说明页 (非扩展本身的一部分)
```

## 数据与隐私

- 所有站点配置（含密码）都只存储在浏览器本地的 `chrome.storage.local`（IndexedDB 后端）
- 密码使用 AES-GCM 加密后再写入 storage；密钥派生自当前扩展的唯一 ID + 固定 salt + PBKDF2 100k 轮
- 同一份 storage 在不同 Chrome profile / 不同设备上**不能互通**，因为密钥里的扩展 ID 不同；首次加载到新环境时旧条目会被标记为「密码损坏」，需要重新编辑保存
- 扩展**不会**把任何数据上传到任何服务器

## 开发

无构建步骤。修改源码后到 `chrome://extensions/` 点击刷新按钮即可生效。

调试位置：
- Service Worker 日志：`chrome://extensions/` → 「Service worker」链接
- Content Script 日志：目标页面 DevTools，筛选 `[Auto Login]`
- Popup 日志：在 popup 图标上右键 → 「检查」

依赖说明：`sharp` 仅用于图标预处理，扩展运行时不依赖。

## License

MIT