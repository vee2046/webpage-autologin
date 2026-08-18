/**
 * Background Service Worker
 * 协调添加站点写入、标签页操作、扩展页面通信
 */

// 所有写入 sites 的请求都走这个串行队列,防止 popup / content script
// 同时 read-modify-write 时互相覆盖。
let sitesWriteQueue = Promise.resolve();

// ========== 消息处理 ==========

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // 获取当前活动标签页 URL
  if (message.type === 'GET_CURRENT_TAB_URL') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        sendResponse({ url: tabs[0].url });
      } else {
        sendResponse({ url: '' });
      }
    });
    return true;
  }

  // 重新注入 content script
  if (message.type === 'REINJECT_CONTENT_SCRIPT') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          files: ['content.js'],
        }).then(() => {
          sendResponse({ success: true });
        }).catch((err) => {
          sendResponse({ success: false, error: err.message });
        });
      }
    });
    return true;
  }

  // 添加站点 (来自 content script 的 drag-dialog)
  // 密码已在 content 端加密为 {v, iv, ct}; 这里只负责原子 read-modify-write。
  if (message.type === 'ADD_SITE') {
    const nextWrite = sitesWriteQueue.then(async () => {
      const { sites = [] } = await chrome.storage.local.get('sites');
      sites.push(message.site);
      await chrome.storage.local.set({ sites });
    });
    sitesWriteQueue = nextWrite.catch((e) => {
      // 让后续写入继续,但保留日志
      console.error('[Auto Login] ADD_SITE failed:', e);
    });
    nextWrite.then(
      () => sendResponse({ success: true }),
      (e) => sendResponse({ success: false, error: e && e.message })
    );
    return true;
  }
});

// ========== 安装时初始化 ==========

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get('sites', (result) => {
    if (!result.sites) {
      chrome.storage.local.set({ sites: [] });
    }
  });
});