#!/usr/bin/env node
/**
 * 删除 dist/ 目录（package 脚本的输出位置）。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const dist = path.resolve(__dirname, '..', 'dist');

if (fs.existsSync(dist)) {
  fs.rmSync(dist, { recursive: true, force: true });
  console.log('✓ 已清理 dist/');
} else {
  console.log('· dist/ 不存在，无需清理');
}