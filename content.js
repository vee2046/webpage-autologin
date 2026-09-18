(function () {
  'use strict';

  // ========== 工具函数 ==========

  function waitForElement(selector, timeout) {
    timeout = timeout || 10000;
    return new Promise(function (resolve, reject) {
      var element = document.querySelector(selector);
      if (element) {
        resolve(element);
        return;
      }

      var observer = new MutationObserver(function (mutations, obs) {
        var el = document.querySelector(selector);
        if (el) {
          obs.disconnect();
          resolve(el);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      setTimeout(function () {
        observer.disconnect();
        reject(new Error('Element with selector "' + selector + '" not found within ' + timeout + 'ms'));
      }, timeout);
    });
  }

  function simulateInput(element, value) {
    element.focus();
    var nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    ).set;
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(element, value);
    } else {
      element.value = value;
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function simulateClick(element) {
    // 触发顺序: focus -> pointerdown -> mousedown -> pointerup -> mouseup -> click
    // 框架(React/Vue/Angular)通常通过事件委托监听 pointerdown/click,
    // 且部分框架会忽略非 trusted 事件 - element.click() 会创建 trusted 事件,
    // 因此优先调用,失败/委托捕获不到时再合成完整事件链。
    element.focus();

    var rect = element.getBoundingClientRect();
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;

    var init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: cx,
      clientY: cy,
      button: 0,
      buttons: 1,
      pointerType: 'mouse',
      isPrimary: true,
      view: window,
    };

    var pdown = new PointerEvent('pointerdown', init);
    var mdown = new MouseEvent('mousedown', init);
    var pup = new PointerEvent('pointerup', init);
    var mup = new MouseEvent('mouseup', init);
    var clk = new MouseEvent('click', init);

    element.dispatchEvent(pdown);
    element.dispatchEvent(mdown);
    element.dispatchEvent(pup);
    element.dispatchEvent(mup);
    element.dispatchEvent(clk);

    // 兜底: 部分老旧页面只监听 element.onclick,直接调用
    if (typeof element.click === 'function') {
      element.click();
    }
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  // 输入框成功闪烁提示(填充成功/拾取成功后调用)
  function flashSuccess(input, ms) {
    if (!input) return;
    ms = ms || 1500;
    input.style.borderColor = '#22c55e';
    input.style.boxShadow = '0 0 0 2px rgba(34,197,94,0.2)';
    setTimeout(function () {
      input.style.borderColor = '';
      input.style.boxShadow = '';
    }, ms);
  }

  // ========== CSS 选择器生成 ==========

  function generateSelector(element) {
    // 1. ID 选择器
    if (element.id) {
      return '#' + CSS.escape(element.id);
    }

    // 2. name 属性
    if (element.name) {
      var tag = element.tagName.toLowerCase();
      var type = element.type ? "[type='" + element.type + "']" : '';
      return tag + "[name='" + element.name + "']" + type;
    }

    // 3. 常用属性
    var attrs = ['data-testid', 'data-id', 'aria-label', 'placeholder'];
    for (var i = 0; i < attrs.length; i++) {
      var attr = attrs[i];
      var value = element.getAttribute(attr);
      if (value) {
        var selector = element.tagName.toLowerCase() + '[' + attr + "='" + value + "']";
        if (document.querySelectorAll(selector).length === 1) {
          return selector;
        }
      }
    }

    // 4. class 组合
    if (element.classList.length > 0) {
      var classes = Array.from(element.classList).filter(function (c) {
        return !c.match(/^(active|hover|focus|selected|visible|show|hide|open|close)/i) && !c.match(/^-/);
      });
      if (classes.length > 0) {
        var classSelector = classes.map(function (c) { return '.' + CSS.escape(c); }).join('');
        var tagSelector = element.tagName.toLowerCase();
        var fullSelector = tagSelector + classSelector;
        if (document.querySelectorAll(fullSelector).length === 1) {
          return fullSelector;
        }
      }
    }

    // 5. 路径选择器
    return getPathSelector(element);
  }

  function getPathSelector(element) {
    var parts = [];
    var current = element;
    while (current && current !== document.body && current !== document.documentElement) {
      var part = current.tagName.toLowerCase();
      if (current.id) {
        parts.unshift('#' + current.id);
        break;
      }
      var parent = current.parentElement;
      if (parent) {
        var siblings = Array.from(parent.children).filter(function (s) {
          return s.tagName === current.tagName;
        });
        if (siblings.length > 1) {
          var index = siblings.indexOf(current) + 1;
          part += ':nth-child(' + index + ')';
        }
      }
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  // ========== 拾取模式 ==========

  var pickerActive = false;
  var hoverOverlay = null;
  var tooltip = null;
  var lastHoveredElement = null;
  var currentPickField = null;

  // 把 field 名(camelCase,来自 data-field)映射到 drag dialog 中对应输入框的 id。
  // 之前直接用 'drag-' + fieldName 拼接会得到 drag-usernameSelector 之类的字符串,
  // 但实际 HTML id 是 kebab-case(drag-username-selector),导致 getElementById 返回 null,
  // 拾取结果无法回填。
  var DRAG_INPUT_IDS = {
    usernameSelector: 'drag-username-selector',
    passwordSelector: 'drag-password-selector',
    loginButtonSelector: 'drag-login-button-selector',
    agreementSelector: 'drag-agreement-selector',
  };

  function startPickerMode(field) {
    if (pickerActive) return;

    // 如果页面内 drag dialog 已经打开,临时让它的 overlay + dialog 都不接收鼠标事件,
    // 否则它们会盖住页面、截获事件,导致 picker 拿到的 target 是 dialog 自身。
    // 半透明化以便用户看到底下的页面元素。
    if (dragDialog && dragDialogOverlay) {
      dragDialogOverlay.dataset.prevPointerEvents = dragDialogOverlay.style.pointerEvents || '';
      dragDialog.dataset.prevPointerEvents = dragDialog.style.pointerEvents || '';
      dragDialogOverlay.style.pointerEvents = 'none';
      dragDialog.style.pointerEvents = 'none';
      dragDialogOverlay.style.opacity = '0.4';
      dragDialog.style.opacity = '0.7';
    }

    pickerActive = true;
    currentPickField = field;

    hoverOverlay = document.createElement('div');
    hoverOverlay.id = '__auto_login_picker_overlay';
    hoverOverlay.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #4f6ef7;background:rgba(79,110,247,0.15);border-radius:3px;transition:all 0.1s ease;display:none;';
    document.body.appendChild(hoverOverlay);

    tooltip = document.createElement('div');
    tooltip.id = '__auto_login_picker_tooltip';
    tooltip.style.cssText = 'position:fixed;z-index:2147483647;background:#1f2937;color:#fff;padding:6px 12px;border-radius:6px;font-size:12px;font-family:monospace;pointer-events:none;display:none;max-width:400px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    document.body.appendChild(tooltip);

    var banner = document.createElement('div');
    banner.id = '__auto_login_picker_banner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#4f6ef7;color:#fff;padding:10px 20px;font-size:13px;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;gap:12px;box-shadow:0 2px 8px rgba(0,0,0,0.15);pointer-events:none;';
    banner.innerHTML = '<span style="font-weight:500;"> 选择器拾取模式</span><span style="opacity:0.85;">点击目标元素自动捕获 | ESC 取消</span>';
    document.body.appendChild(banner);

    document.body.style.cursor = 'crosshair';
    document.addEventListener('mouseover', onPickerMouseMove, true);
    document.addEventListener('click', onPickerClick, true);
    document.addEventListener('keydown', onPickerKeyDown, true);
  }

  function stopPickerMode() {
    pickerActive = false;
    currentPickField = null;
    lastHoveredElement = null;
    document.body.style.cursor = '';

    var overlay = document.getElementById('__auto_login_picker_overlay');
    if (overlay) overlay.remove();

    var tip = document.getElementById('__auto_login_picker_tooltip');
    if (tip) tip.remove();

    var banner = document.getElementById('__auto_login_picker_banner');
    if (banner) banner.remove();

    document.removeEventListener('mouseover', onPickerMouseMove, true);
    document.removeEventListener('click', onPickerClick, true);
    document.removeEventListener('keydown', onPickerKeyDown, true);

    // 恢复 drag dialog 的事件接收和透明度
    if (dragDialog && dragDialogOverlay) {
      dragDialogOverlay.style.pointerEvents = dragDialogOverlay.dataset.prevPointerEvents || '';
      dragDialog.style.pointerEvents = dragDialog.dataset.prevPointerEvents || '';
      dragDialogOverlay.style.opacity = '';
      dragDialog.style.opacity = '';
      delete dragDialogOverlay.dataset.prevPointerEvents;
      delete dragDialog.dataset.prevPointerEvents;
    }
  }

  function onPickerMouseMove(e) {
    if (!pickerActive) return;
    var target = e.target;
    if (target.id && target.id.indexOf('__auto_login_picker') === 0) return;
    if (target.closest && target.closest('#auto-login-drag-dialog')) return;

    lastHoveredElement = target;

    var rect = target.getBoundingClientRect();
    var overlay = document.getElementById('__auto_login_picker_overlay');
    var tip = document.getElementById('__auto_login_picker_tooltip');

    if (overlay) {
      overlay.style.display = 'block';
      overlay.style.left = rect.left + 'px';
      overlay.style.top = rect.top + 'px';
      overlay.style.width = rect.width + 'px';
      overlay.style.height = rect.height + 'px';
    }

    if (tip) {
      var selector = generateSelector(target);
      tip.textContent = selector;
      tip.style.display = 'block';
      tip.style.left = (e.clientX + 15) + 'px';
      tip.style.top = (e.clientY + 15) + 'px';
    }
  }

  function onPickerClick(e) {
    if (!pickerActive) return;
    e.preventDefault();
    e.stopPropagation();

    var target = e.target;
    if (target.id && target.id.indexOf('__auto_login_picker') === 0) return;
    if (target.closest && target.closest('#auto-login-drag-dialog')) return;

    var selector = generateSelector(target);

    showPickerResult(selector);

    // 填充到当前 drag dialog 的对应输入框
    var input = currentPickField && document.getElementById(DRAG_INPUT_IDS[currentPickField]);
    if (input) {
      input.value = selector;
      flashSuccess(input);
    }

    stopPickerMode();
  }

  function onPickerKeyDown(e) {
    if (e.key === 'Escape') {
      stopPickerMode();
    }
  }

  function showPickerResult(selector) {
    var notification = document.createElement('div');
    notification.id = '__auto_login_picker_toast';
    notification.style.cssText = 'position:fixed;top:60px;right:20px;z-index:2147483647;background:#22c55e;color:#fff;padding:12px 20px;border-radius:8px;font-size:13px;font-family:-apple-system,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,0.15);pointer-events:none;';
    notification.innerHTML = '<div style="font-weight:600;margin-bottom:4px;">选择器已捕获</div><div style="font-family:monospace;font-size:12px;opacity:0.9;">' + selector + '</div>';
    document.body.appendChild(notification);
    setTimeout(function () {
      notification.style.opacity = '0';
      notification.style.transition = 'opacity 0.3s ease';
      setTimeout(function () { notification.remove(); }, 300);
    }, 2000);
  }

  // ========== 可拖拽弹窗 ==========

  var dragDialog = null;
  var dragDialogOverlay = null;
  var isDragging = false;
  var dragOffset = { x: 0, y: 0 };

  function createDragDialog() {
    dragDialogOverlay = document.createElement('div');
    dragDialogOverlay.id = 'auto-login-drag-overlay';
    dragDialogOverlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.3);z-index:2147483645;opacity:0;transition:opacity 0.3s ease;';

    dragDialog = document.createElement('div');
    dragDialog.id = 'auto-login-drag-dialog';
    dragDialog.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:420px;background:#fff;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,0.2);z-index:2147483646;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;opacity:0;transition:opacity 0.3s ease;';

    dragDialog.innerHTML = `
      <div id="drag-dialog-header" style="padding:16px 20px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between;cursor:move;user-select:none;">
        <h2 style="margin:0;font-size:16px;font-weight:600;color:#1f2937;">添加站点配置</h2>
        <button id="drag-dialog-close" style="background:none;border:none;font-size:20px;cursor:pointer;color:#6b7280;padding:0;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:6px;">&times;</button>
      </div>
      <form id="drag-dialog-form" style="padding:20px;max-height:60vh;overflow-y:auto;">
        <div style="margin-bottom:14px;">
          <label style="display:block;margin-bottom:5px;font-size:12px;font-weight:500;color:#374151;">网址 *</label>
          <input type="text" id="drag-url" required style="width:100%;padding:7px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;box-sizing:border-box;" placeholder="https://example.com/login">
        </div>
        <div style="margin-bottom:14px;">
          <label style="display:block;margin-bottom:5px;font-size:12px;font-weight:500;color:#374151;">用户名 *</label>
          <input type="text" id="drag-username" required style="width:100%;padding:7px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;box-sizing:border-box;" placeholder="your_username">
        </div>
        <div style="margin-bottom:14px;">
          <label style="display:block;margin-bottom:5px;font-size:12px;font-weight:500;color:#374151;">密码 *</label>
          <input type="password" id="drag-password" required style="width:100%;padding:7px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;box-sizing:border-box;" placeholder="your_password">
        </div>
        <div style="margin-bottom:14px;">
          <label style="display:block;margin-bottom:5px;font-size:12px;font-weight:500;color:#374151;">用户名选择器 *</label>
          <div style="display:flex;gap:6px;">
            <input type="text" id="drag-username-selector" required style="flex:1;padding:7px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;box-sizing:border-box;" placeholder="#username">
            <button type="button" class="pick-btn" data-field="usernameSelector" style="padding:7px 12px;border:1px solid #d1d5db;border-radius:6px;background:#fff;color:#4f6ef7;font-size:12px;cursor:pointer;white-space:nowrap;">🎯 拾取</button>
          </div>
        </div>
        <div style="margin-bottom:14px;">
          <label style="display:block;margin-bottom:5px;font-size:12px;font-weight:500;color:#374151;">密码选择器 *</label>
          <div style="display:flex;gap:6px;">
            <input type="text" id="drag-password-selector" required style="flex:1;padding:7px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;box-sizing:border-box;" placeholder="input[type='password']">
            <button type="button" class="pick-btn" data-field="passwordSelector" style="padding:7px 12px;border:1px solid #d1d5db;border-radius:6px;background:#fff;color:#4f6ef7;font-size:12px;cursor:pointer;white-space:nowrap;">🎯 拾取</button>
          </div>
        </div>
        <div style="margin-bottom:14px;">
          <label style="display:block;margin-bottom:5px;font-size:12px;font-weight:500;color:#374151;">登录按钮选择器 *</label>
          <div style="display:flex;gap:6px;">
            <input type="text" id="drag-login-button-selector" required style="flex:1;padding:7px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;box-sizing:border-box;" placeholder="button[type='submit']">
            <button type="button" class="pick-btn" data-field="loginButtonSelector" style="padding:7px 12px;border:1px solid #d1d5db;border-radius:6px;background:#fff;color:#4f6ef7;font-size:12px;cursor:pointer;white-space:nowrap;">🎯 拾取</button>
          </div>
        </div>
        <div style="margin-bottom:18px;">
          <label style="display:block;margin-bottom:5px;font-size:12px;font-weight:500;color:#374151;">协议勾选选择器 <span style="color:#9ca3af;font-weight:normal;">(可选)</span></label>
          <div style="display:flex;gap:6px;">
            <input type="text" id="drag-agreement-selector" style="flex:1;padding:7px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;box-sizing:border-box;" placeholder="#agree">
            <button type="button" class="pick-btn" data-field="agreementSelector" style="padding:7px 12px;border:1px solid #d1d5db;border-radius:6px;background:#fff;color:#4f6ef7;font-size:12px;cursor:pointer;white-space:nowrap;"> 拾取</button>
          </div>
        </div>
        <div style="display:flex;gap:10px;">
          <button type="button" id="drag-dialog-cancel" style="flex:1;padding:9px;border:1px solid #d1d5db;border-radius:6px;background:#fff;color:#374151;font-size:13px;font-weight:500;cursor:pointer;">取消</button>
          <button type="submit" style="flex:1;padding:9px;border:none;border-radius:6px;background:#4f6ef7;color:#fff;font-size:13px;font-weight:500;cursor:pointer;">保存</button>
        </div>
      </form>
    `;

    document.body.appendChild(dragDialogOverlay);
    document.body.appendChild(dragDialog);

    // 拖拽事件
    var header = document.getElementById('drag-dialog-header');
    header.addEventListener('mousedown', startDrag);
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', endDrag);

    // 关闭事件
    document.getElementById('drag-dialog-close').addEventListener('click', hideDragDialog);
    document.getElementById('drag-dialog-cancel').addEventListener('click', hideDragDialog);
    dragDialogOverlay.addEventListener('click', hideDragDialog);

    // 拾取按钮事件
    var pickBtns = dragDialog.querySelectorAll('.pick-btn');
    pickBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var field = this.getAttribute('data-field');
        startPickerMode(field);
      });
    });

    // 表单提交
    document.getElementById('drag-dialog-form').addEventListener('submit', function (e) {
      e.preventDefault();
      saveSiteFromDragDialog();
    });
  }

  function startDrag(e) {
    isDragging = true;
    var rect = dragDialog.getBoundingClientRect();
    dragOffset.x = e.clientX - rect.left;
    dragOffset.y = e.clientY - rect.top;
    dragDialog.style.transition = 'none';
    e.preventDefault();
  }

  function onDrag(e) {
    if (!isDragging || !dragDialog) return;
    var x = e.clientX - dragOffset.x;
    var y = e.clientY - dragOffset.y;
    dragDialog.style.left = x + 'px';
    dragDialog.style.top = y + 'px';
    dragDialog.style.transform = 'none';
  }

  function endDrag() {
    isDragging = false;
    if (dragDialog) {
      dragDialog.style.transition = 'opacity 0.3s ease';
    }
  }

  function showDragDialog() {
    if (!dragDialog) {
      createDragDialog();
    }

    document.getElementById('drag-url').value = window.location.origin + window.location.pathname;

    dragDialogOverlay.style.opacity = '1';
    dragDialog.style.opacity = '1';

    setTimeout(function () {
      document.getElementById('drag-url').focus();
    }, 300);
  }

  function hideDragDialog() {
    if (dragDialog) {
      dragDialog.style.opacity = '0';
      dragDialogOverlay.style.opacity = '0';
      setTimeout(function () {
        if (dragDialogOverlay) {
          dragDialogOverlay.remove();
          dragDialog.remove();
          dragDialog = null;
          dragDialogOverlay = null;
        }
      }, 300);
    }
  }

  function saveSiteFromDragDialog() {
    var site = {
      id: Date.now().toString(),
      url: document.getElementById('drag-url').value.trim(),
      username: document.getElementById('drag-username').value.trim(),
      password: document.getElementById('drag-password').value,
      usernameSelector: document.getElementById('drag-username-selector').value.trim(),
      passwordSelector: document.getElementById('drag-password-selector').value.trim(),
      loginButtonSelector: document.getElementById('drag-login-button-selector').value.trim(),
      agreementSelector: document.getElementById('drag-agreement-selector').value.trim(),
      enabled: true,
      createdAt: new Date().toISOString(),
    };

    window.AutoLoginCrypto.encryptPassword(site.password).then(function (encPw) {
      var storedSite = Object.assign({}, site, { password: encPw });
      // 通过 background 统一写入,避免与 popup 并发 read-modify-write 时丢数据
      chrome.runtime.sendMessage({
        type: 'ADD_SITE',
        site: storedSite,
      }, function (response) {
        var toast = document.createElement('div');
        var success = !!(response && response.success);
        toast.textContent = success ? '站点配置已保存' : '保存失败,请重试';
        toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:' +
          (success ? '#22c55e' : '#ef4444') +
          ';color:#fff;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:500;z-index:2147483647;box-shadow:0 4px 12px rgba(0,0,0,0.15);';
        document.body.appendChild(toast);
        setTimeout(function () {
          toast.style.opacity = '0';
          toast.style.transition = 'opacity 0.3s ease';
          setTimeout(function () { toast.remove(); }, 300);
        }, 2000);

        if (success) {
          hideDragDialog();
        }
      });
    });
  }

  // ========== 自动登录 ==========

  async function autoLogin(config) {
    try {
      console.log('[Auto Login] Starting auto login for:', config.url);

      if (config.agreementSelector) {
        try {
          var agreementEl = await waitForElement(config.agreementSelector);
          if (agreementEl && !agreementEl.checked) {
            simulateClick(agreementEl);
            console.log('[Auto Login] Agreement checkbox clicked');
            await delay(300);
          }
        } catch (e) {
          console.warn('[Auto Login] Agreement selector not found:', config.agreementSelector);
        }
      }

      var usernameEl = await waitForElement(config.usernameSelector);
      simulateInput(usernameEl, config.username);
      console.log('[Auto Login] Username filled');
      await delay(300);

      var passwordEl = await waitForElement(config.passwordSelector);
      simulateInput(passwordEl, config.password);
      console.log('[Auto Login] Password filled');
      await delay(300);

      var loginBtnEl = await waitForElement(config.loginButtonSelector);
      simulateClick(loginBtnEl);
      console.log('[Auto Login] Login button clicked');

    } catch (error) {
      console.error('[Auto Login] Auto login failed:', error);
    }
  }

  function urlMatches(urlPattern, currentUrl) {
    try {
      // 剥离 query string 和 fragment,使以下三种写法互相等价:
      //   https://example.com/login
      //   https://example.com/login?redirect=/user/home
      //   https://example.com/login#section
      function stripSuffix(u) {
        var i = u.indexOf('#');
        if (i !== -1) u = u.slice(0, i);
        i = u.indexOf('?');
        if (i !== -1) u = u.slice(0, i);
        return u;
      }
      var p = stripSuffix(urlPattern);
      var c = stripSuffix(currentUrl);
      if (c === p) return true;
      if (c.startsWith(p)) return true;
      // 先转义正则元字符,再把 \* 还原为 .*
      var escaped = p.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
      var pattern = escaped.replace(/\*/g, '.*');
      var regex = new RegExp('^' + pattern + '$');
      return regex.test(c);
    } catch (e) {
      return false;
    }
  }

  var isLoggingIn = false;
  var lastLoginUrl = null;
  var loginCooldownUntil = 0;

  async function tryAutoLogin() {
    if (isLoggingIn) return;
    if (Date.now() < loginCooldownUntil) return;

    var currentUrl = window.location.href;
    if (currentUrl === lastLoginUrl) return;

    try {
      var result = await chrome.storage.local.get('sites');
      var rawSites = Array.isArray(result.sites) ? result.sites : [];
      // 过滤掉损坏的条目,避免 null 访问崩溃
      var sites = rawSites.filter(function (s) {
        return !!s && typeof s === 'object' && typeof s.url === 'string';
      });

      for (var i = 0; i < sites.length; i++) {
        var site = sites[i];
        if (site.enabled && urlMatches(site.url, currentUrl)) {
          // 解密密码(向后兼容旧明文格式)
          var username, password;
          try {
            username = site.username;
            password = await window.AutoLoginCrypto.decryptPassword(site.password);
          } catch (e) {
            console.error('[Auto Login] Failed to decrypt password for site:', site.url, e);
            return;
          }

          var loginConfig = {
            url: site.url,
            username: username,
            password: password,
            usernameSelector: site.usernameSelector,
            passwordSelector: site.passwordSelector,
            loginButtonSelector: site.loginButtonSelector,
            agreementSelector: site.agreementSelector,
          };

          isLoggingIn = true;
          lastLoginUrl = currentUrl;
          try {
            await delay(500 + Math.random() * 1000);
            await autoLogin(loginConfig);
          } finally {
            isLoggingIn = false;
            // 提交后 10 秒内不再尝试,避免登录成功后的页面跳转触发重复登录
            loginCooldownUntil = Date.now() + 10000;
          }
          return;
        }
      }
    } catch (error) {
      console.error('[Auto Login] Auto login check failed:', error);
    }
  }

  async function init() {
    await tryAutoLogin();
    installSpaNavigationListener();
  }

  // ========== SPA 路由监听 ==========

  var urlChangeDebounceTimer = null;

  function installSpaNavigationListener() {
    // popstate:浏览器后退/前进触发
    window.addEventListener('popstate', function () {
      scheduleUrlCheck();
    });

    // patch pushState / replaceState:Vue Router / React Router 等通过这两个 API 切换路由
    ['pushState', 'replaceState'].forEach(function (method) {
      var original = history[method];
      history[method] = function () {
        var rv = original.apply(this, arguments);
        // 异步触发,等待 history 状态更新完毕
        scheduleUrlCheck();
        return rv;
      };
    });
  }

  function scheduleUrlCheck() {
    if (urlChangeDebounceTimer) clearTimeout(urlChangeDebounceTimer);
    urlChangeDebounceTimer = setTimeout(function () {
      urlChangeDebounceTimer = null;
      tryAutoLogin();
    }, 200);
  }

  // ========== 消息监听 ==========

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (message.type === 'OPEN_SIDE_PANEL') {
      showDragDialog();
      sendResponse({ success: true });
      return;
    }
  });

  // ========== 初始化 ==========

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();
