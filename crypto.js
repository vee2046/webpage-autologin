/**
 * 站点配置的密码加密/解密工具
 *
 * 加密方案:
 * - 算法: AES-GCM,256-bit 密钥
 * - 密钥派生: 从扩展 ID + 固定 salt 做 PBKDF2(SHA-256, 100k 轮)
 * - 密文格式: { v: 1, iv: <base64>, ct: <base64> }
 *
 * 威胁模型: 防止磁盘级明文读取(浏览器 storage 是 IndexedDB 后端,
 * 不加密存储)。无法对抗同主机运行任意代码的攻击者,但这是合理防御。
 *
 * 注意: 扩展 ID 在所有设备/所有浏览器 profile 上是不同的,所以
 * 同一份 storage 在不同环境下无法互通 - 这意味着: 用户在 Chrome A
 * 创建的站点,在 Chrome B (不同 ID) 装上时会失败并被识别为 "损坏"。
 * 通过 versioned 字段 v=1 留出未来迁移空间。
 */

var ENC_VERSION = 1;
var PBKDF2_ITERATIONS = 100000;
var FIXED_SALT_TEXT = 'auto-login-helper/v1/password-encryption';

function getSubtle() {
  if (typeof crypto !== 'undefined' && crypto.subtle) return crypto.subtle;
  if (typeof msCrypto !== 'undefined' && msCrypto.subtle) return msCrypto.subtle;
  throw new Error('Web Crypto API not available');
}

function bytesToBase64(bytes) {
  var bin = '';
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64) {
  var bin = atob(b64);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

var _keyPromise = null;

function getEncryptionKey() {
  if (_keyPromise) return _keyPromise;
  var subtle = getSubtle();
  // 优先使用 chrome.runtime.id(每个扩展安装唯一),在 background/popup 可用;
  // content script 里没有 runtime,但扩展 ID 在所有上下文都通过
  // chrome.runtime.getURL('/_locales/...') 等方式可间接拿到,这里我们
  // 退化为固定字符串 - content 端只读不写,写入发生在 popup。
  var idPart = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id)
    ? chrome.runtime.id
    : 'content-script-context';
  var keyMaterialText = 'auto-login-helper|' + idPart;

  _keyPromise = subtle.importKey(
    'raw',
    new TextEncoder().encode(keyMaterialText),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  ).then(function (km) {
    return subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: new TextEncoder().encode(FIXED_SALT_TEXT),
        iterations: PBKDF2_ITERATIONS,
        hash: 'SHA-256',
      },
      km,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  });
  return _keyPromise;
}

async function encryptPassword(plaintext) {
  if (plaintext === '' || plaintext == null) return null;
  var key = await getEncryptionKey();
  var iv = crypto.getRandomValues(new Uint8Array(12));
  var ct = await getSubtle().encrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  return {
    v: ENC_VERSION,
    iv: bytesToBase64(iv),
    ct: bytesToBase64(new Uint8Array(ct)),
  };
}

async function decryptPassword(encrypted) {
  if (!encrypted) return '';
  if (typeof encrypted === 'string') {
    // 旧格式明文密码 - 直接返回(向后兼容)
    return encrypted;
  }
  if (encrypted.v !== ENC_VERSION) {
    throw new Error('Unsupported password encryption version: ' + encrypted.v);
  }
  var key = await getEncryptionKey();
  var iv = base64ToBytes(encrypted.iv);
  var ct = base64ToBytes(encrypted.ct);
  var pt = await getSubtle().decrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    ct
  );
  return new TextDecoder().decode(pt);
}

// 检测密文格式
function isEncryptedPassword(value) {
  return value != null && typeof value === 'object' && value.v === ENC_VERSION && typeof value.ct === 'string';
}

// 暴露接口 - background / popup 用 ES5 风格的全局挂载
if (typeof self !== 'undefined') {
  self.AutoLoginCrypto = {
    encryptPassword: encryptPassword,
    decryptPassword: decryptPassword,
    isEncryptedPassword: isEncryptedPassword,
  };
}