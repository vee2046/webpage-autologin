#!/usr/bin/env node
/**
 * 把 Chrome 扩展打包成纯净的 zip 文件。
 *
 * 「纯净」= 只包含扩展运行所需的文件，过滤掉所有开发期产物
 * （node_modules、.git、文档、配置脚本等）。
 *
 * 输出: dist/webpage-autologin-v<version>.zip
 */

'use strict';

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// 白名单：要打进 zip 的扩展文件（相对于 ROOT）
// 改这里 = 改 zip 内容；其它任何文件都不会被包含。
const EXTENSION_FILES = [
  'manifest.json',
  'background.js',
  'content.js',
  'crypto.js',
  'popup.html',
  'popup.css',
  'popup.js',
  'icons/',
];

function main() {
  const pkg = require(path.join(ROOT, 'package.json'));
  const version = pkg.version || '0.0.0';
  const outName = `webpage-autologin-v${version}.zip`;
  const outPath = path.join(DIST, outName);

  // 校验白名单里的文件都存在
  for (const rel of EXTENSION_FILES) {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) {
      console.error(`✗ 白名单文件不存在: ${rel}`);
      process.exit(1);
    }
  }

  if (!fs.existsSync(DIST)) {
    fs.mkdirSync(DIST, { recursive: true });
  }

  const output = fs.createWriteStream(outPath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  output.on('close', () => {
    const bytes = archive.pointer();
    const kb = (bytes / 1024).toFixed(1);
    console.log(`✓ 已打包: ${outName} (${kb} KB)`);
  });

  archive.on('warning', (err) => {
    if (err.code !== 'ENOENT') throw err;
  });

  archive.on('error', (err) => {
    console.error('✗ 打包失败:', err.message);
    process.exit(1);
  });

  archive.pipe(output);

  for (const rel of EXTENSION_FILES) {
    const full = path.join(ROOT, rel);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      // 目录整体打入（如 icons/），保持目录结构
      archive.directory(full, rel);
    } else {
      // 单文件打入 zip 根
      archive.file(full, { name: rel });
    }
  }

  archive.finalize();
}

main();