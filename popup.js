/**
 * Popup Script - 站点配置管理界面
 */
(function () {
  'use strict';

  // 防止弹窗在外部点击时自动关闭
  // Chrome 弹窗会在失去焦点时关闭，这里尝试重新聚焦
  let blurTimer = null;
  window.addEventListener('blur', function () {
    // 延迟重新聚焦，避免立即关闭
    blurTimer = setTimeout(function () {
      window.focus();
    }, 10);
  });

  // 清理定时器
  window.addEventListener('focus', function () {
    if (blurTimer) {
      clearTimeout(blurTimer);
      blurTimer = null;
    }
  });

  // ========== DOM Elements ==========
  const $ = (sel) => document.querySelector(sel);

  const siteListEl = $('#siteList');
  const emptyStateEl = $('#emptyState');
  const siteCountEl = $('#siteCount');
  const btnTestCurrent = $('#btnTestCurrent');

  // Modal
  const modalOverlay = $('#modalOverlay');
  const modalTitle = $('#modalTitle');
  const siteForm = $('#siteForm');
  const editIdInput = $('#editId');
  const btnClose = $('#btnClose');
  const btnCancel = $('#btnCancel');
  const btnTogglePassword = $('#btnTogglePassword');

  // Confirm
  const confirmOverlay = $('#confirmOverlay');
  const btnConfirmCancel = $('#btnConfirmCancel');
  const btnConfirmDelete = $('#btnConfirmDelete');

  // Toast
  const toastEl = $('#toast');

  // Form fields
  const fields = {
    url: $('#siteUrl'),
    username: $('#siteUsername'),
    password: $('#sitePassword'),
    usernameSelector: $('#usernameSelector'),
    passwordSelector: $('#passwordSelector'),
    loginButtonSelector: $('#loginButtonSelector'),
    agreementSelector: $('#agreementSelector'),
  };

  // ========== State ==========
  let sites = [];
  let deleteTargetId = null;

  // 串行化所有写入操作,防止 PBKDF2 慢路径下两次写互相覆盖。
  // 每次 saveSites 都接到队列尾部,确保上一个写完才执行下一个。
  let writeQueue = Promise.resolve();

  // ========== Storage ==========
  // 跟踪正在执行的 reload,让 saveSites 等其完成,避免覆盖外部变更。
  let reloadInFlight = Promise.resolve();

  // 重新从 storage 同步内存 + 重新渲染。供初始加载和 onChanged 事件共用。
  function reloadSitesFromStorage() {
    reloadInFlight = (async () => {
      const result = await chrome.storage.local.get('sites');
      const rawSites = Array.isArray(result.sites) ? result.sites : [];
      // 过滤掉明显损坏的条目(不是对象、缺 id/url/password 等核心字段)
      const valid = rawSites.filter(isValidSiteShape);
      if (valid.length !== rawSites.length) {
        console.warn('[Auto Login] 过滤掉', rawSites.length - valid.length, '条损坏的站点配置');
      }
      sites = await Promise.all(valid.map(decryptSiteForUi));
      renderList();
    })().catch((e) => {
      console.error('[Auto Login] Reload failed:', e);
    });
    return reloadInFlight;
  }

  function isValidSiteShape(s) {
    return !!s && typeof s === 'object'
      && typeof s.id === 'string'
      && typeof s.url === 'string'
      && s.password != null
      && typeof s.usernameSelector === 'string'
      && typeof s.passwordSelector === 'string'
      && typeof s.loginButtonSelector === 'string';
  }

  // 监听 storage 变化 - 主要是为了同步来自 content script (drag-dialog) 的写入。
  // modal 打开时(用户正在编辑)跳过,避免覆盖未保存的表单数据。
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!changes.sites) return;
    if (modalOverlay.classList.contains('active')) return;
    reloadSitesFromStorage();
  });

  async function loadSites() {
    await reloadSitesFromStorage();
  }

  // UI 视图层用的 site 对象,密码是明文(只驻留在内存,不入 storage)。
  // 解密失败时,在 site 上打 broken=true,密码置空,但保留其余字段以便用户编辑修复。
  async function decryptSiteForUi(site) {
    try {
      const pw = await self.AutoLoginCrypto.decryptPassword(site.password);
      return Object.assign({}, site, { password: pw, broken: false });
    } catch (e) {
      console.error('[Auto Login] 解密站点密码失败', site.id, e);
      return Object.assign({}, site, { password: '', broken: true });
    }
  }

  // 把 UI 中的明文 site 加密后写入 storage
  async function encryptSiteForStorage(site) {
    const enc = await self.AutoLoginCrypto.encryptPassword(site.password);
    return Object.assign({}, site, { password: enc });
  }

  async function saveSites() {
    // 内存中 sites 的密码仍是明文(为了编辑),写 storage 时加密
    // 序列化所有写操作,防止快速连续点击/跨上下文写入产生 race(后写覆盖新数据)。
    return writeQueue = writeQueue.then(async () => {
      // 等待任何在飞的 reload(from storage.onChanged)完成,
      // 避免 reload 还没把外部写入合入内存就 snapshot,导致外部数据被回滚。
      await reloadInFlight;
      const snapshot = sites.slice();
      const encSites = await Promise.all(snapshot.map(encryptSiteForStorage));
      try {
        await chrome.storage.local.set({ sites: encSites });
      } catch (e) {
        console.error('[Auto Login] 写入 storage 失败', e);
        showToast('保存失败,请重试', 'error');
        throw e;
      }
    });
  }

  // ========== Render ==========
  function renderList() {
    const cards = siteListEl.querySelectorAll('.site-card');
    cards.forEach((c) => c.remove());

    if (sites.length === 0) {
      emptyStateEl.style.display = 'flex';
    } else {
      emptyStateEl.style.display = 'none';
      sites.forEach((site) => {
        const card = createSiteCard(site);
        siteListEl.insertBefore(card, emptyStateEl);
      });
    }

    siteCountEl.textContent = `${sites.length} 个站点`;
  }

  function createSiteCard(site) {
    const card = document.createElement('div');
    card.className = `site-card${site.enabled === false ? ' disabled' : ''}`;
    card.dataset.id = site.id;

    const faviconUrl = getFaviconUrl(site.url);
    const displayUrl = extractDomain(site.url);

    card.innerHTML = `
      <div class="card-top">
        <div class="card-url">
          <img class="favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'">
          <span class="url-text" title="${escapeHtml(site.url)}">${escapeHtml(displayUrl)}</span>
        </div>
        <div class="card-actions">
          <label class="toggle" title="${site.enabled === false ? '已禁用' : '已启用'}">
            <input type="checkbox" ${site.enabled !== false ? 'checked' : ''} data-action="toggle">
            <span class="toggle-slider"></span>
          </label>
          <button class="btn-icon edit" data-action="edit" title="编辑">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="btn-icon delete" data-action="delete" title="删除">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="card-info">
        <span><span class="label">用户:</span> ${escapeHtml(site.username)}</span>
        <span><span class="label">协议:</span> ${site.agreementSelector ? '有' : '无'}</span>
        ${site.broken ? '<span class="broken-badge" title="密码无法解密,请重新编辑后保存">⚠ 密码损坏</span>' : ''}
      </div>
    `;

    card.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]');
      if (!action) return;

      const type = action.dataset.action;
      if (type === 'toggle') {
        toggleSite(site.id);
      } else if (type === 'edit') {
        openEditModal(site.id);
      } else if (type === 'delete') {
        openConfirmDelete(site.id);
      }
    });

    return card;
  }

  // ========== CRUD ==========
  function toggleSite(id) {
    const site = sites.find((s) => s.id === id);
    if (site) {
      site.enabled = site.enabled === false ? true : false;
      saveSites().catch(() => { /* 已在 saveSites 内 toast */ });
      renderList();
      showToast(site.enabled ? '已启用' : '已禁用', 'success');
    }
  }

  // 在页面上打开右侧配置面板
  function openSidePanel() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      const tabId = tabs[0].id;
      chrome.tabs.sendMessage(tabId, { type: 'OPEN_SIDE_PANEL' }, (response) => {
        if (chrome.runtime.lastError) {
          // Content script not injected yet, inject it first
          chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js'],
          }).then(() => {
            chrome.tabs.sendMessage(tabId, { type: 'OPEN_SIDE_PANEL' });
          }).catch((err) => {
            console.error('Failed to inject content script:', err);
            showToast('无法打开面板，请刷新页面后重试', 'error');
          });
        }
      });
    });
    window.close();
  }

  function openEditModal(id) {
    const site = sites.find((s) => s.id === id);
    if (!site) return;

    modalTitle.textContent = '编辑站点';
    editIdInput.value = site.id;
    fields.url.value = site.url;
    fields.username.value = site.username;
    fields.password.value = site.password;
    fields.usernameSelector.value = site.usernameSelector;
    fields.passwordSelector.value = site.passwordSelector;
    fields.loginButtonSelector.value = site.loginButtonSelector;
    fields.agreementSelector.value = site.agreementSelector || '';

    modalOverlay.classList.add('active');
  }

  function closeModal() {
    modalOverlay.classList.remove('active');
    siteForm.reset();
    editIdInput.value = '';
  }

  async function handleFormSubmit(e) {
    e.preventDefault();

    const data = {
      url: fields.url.value.trim(),
      username: fields.username.value.trim(),
      password: fields.password.value,
      usernameSelector: fields.usernameSelector.value.trim(),
      passwordSelector: fields.passwordSelector.value.trim(),
      loginButtonSelector: fields.loginButtonSelector.value.trim(),
      agreementSelector: fields.agreementSelector.value.trim(),
    };

    if (!data.url || !data.username || !data.password || !data.usernameSelector || !data.passwordSelector || !data.loginButtonSelector) {
      showToast('请填写所有必填项', 'error');
      return;
    }

    const editId = editIdInput.value;

    if (editId) {
      const idx = sites.findIndex((s) => s.id === editId);
      if (idx !== -1) {
        sites[idx] = { ...sites[idx], ...data };
        showToast('站点已更新', 'success');
      }
    } else {
      sites.push({
        id: generateId(),
        ...data,
        enabled: true,
        createdAt: Date.now(),
      });
      showToast('站点已添加', 'success');
    }

    try {
      await saveSites();
      renderList();
      closeModal();
    } catch (err) {
      // 保存失败,保留 modal 让用户重试
    }
  }

  function openConfirmDelete(id) {
    deleteTargetId = id;
    confirmOverlay.classList.add('active');
  }

  function closeConfirm() {
    confirmOverlay.classList.remove('active');
    deleteTargetId = null;
  }

  function handleDelete() {
    if (deleteTargetId) {
      sites = sites.filter((s) => s.id !== deleteTargetId);
      saveSites().catch(() => { /* toast 已在 saveSites 内 */ });
      renderList();
      showToast('已删除', 'success');
    }
    closeConfirm();
  }

  // ========== Test Current Page ==========
  function testCurrentPage() {
    chrome.runtime.sendMessage({ type: 'REINJECT_CONTENT_SCRIPT' }, (res) => {
      if (res && res.success) {
        showToast('已在当前页面重新执行自动登录', 'success');
      } else {
        showToast('执行失败: ' + (res?.error || '未知错误'), 'error');
      }
    });
  }

  // ========== Password Toggle ==========
  function togglePasswordVisibility() {
    const input = fields.password;
    const eyeOpen = btnTogglePassword.querySelector('.eye-open');
    const eyeClosed = btnTogglePassword.querySelector('.eye-closed');

    if (input.type === 'password') {
      input.type = 'text';
      eyeOpen.style.display = 'none';
      eyeClosed.style.display = 'block';
    } else {
      input.type = 'password';
      eyeOpen.style.display = 'block';
      eyeClosed.style.display = 'none';
    }
  }

  // ========== Toast ==========
  let toastTimer = null;
  function showToast(message, type = '') {
    clearTimeout(toastTimer);
    toastEl.textContent = message;
    toastEl.className = 'toast' + (type ? ` ${type}` : '');
    void toastEl.offsetWidth;
    toastEl.classList.add('show');
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
    }, 2000);
  }

  // ========== Utilities ==========
  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function extractDomain(url) {
    try {
      const cleanUrl = url.replace(/\*/g, 'wildcard');
      const parsed = new URL(cleanUrl);
      return parsed.hostname + parsed.pathname;
    } catch {
      return url.length > 35 ? url.slice(0, 35) + '...' : url;
    }
  }

  function getFaviconUrl(url) {
    try {
      const cleanUrl = url.replace(/\*/g, 'wildcard');
      const parsed = new URL(cleanUrl);
      // chrome://favicon 由 Chromium 内部实现,不发起网络请求,不暴露浏览历史
      return `chrome://favicon/?pageUrl=${encodeURIComponent(parsed.origin)}&size=16`;
    } catch {
      return '';
    }
  }

  // ========== Event Listeners ==========
  const btnSidePanel = $('#btnSidePanel');

  btnSidePanel.addEventListener('click', openSidePanel);
  btnClose.addEventListener('click', closeModal);
  btnCancel.addEventListener('click', closeModal);
  siteForm.addEventListener('submit', handleFormSubmit);
  btnConfirmCancel.addEventListener('click', closeConfirm);
  btnConfirmDelete.addEventListener('click', handleDelete);
  btnTogglePassword.addEventListener('click', togglePasswordVisibility);
  btnTestCurrent.addEventListener('click', testCurrentPage);

  // 点击遮罩关闭
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });
  confirmOverlay.addEventListener('click', (e) => {
    if (e.target === confirmOverlay) closeConfirm();
  });

  // ESC 关闭弹窗
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (confirmOverlay.classList.contains('active')) {
        closeConfirm();
      } else if (modalOverlay.classList.contains('active')) {
        closeModal();
      }
    }
  });

  // ========== Init ==========
  loadSites();
})();
