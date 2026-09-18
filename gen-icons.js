const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const log = (msg) => fs.appendFileSync('d:/downloads/webpage-autologin/gen-log.txt', msg + '\n');

const src = 'd:/downloads/webpage-autologin/icons/login.png';
const dst16 = 'd:/downloads/webpage-autologin/icons/icon16.png';
const dst48 = 'd:/downloads/webpage-autologin/icons/icon48.png';
const dst128 = 'd:/downloads/webpage-autologin/icons/icon128.png';

log('Starting');
log('Source exists: ' + fs.existsSync(src));

async function gen() {
  try {
    log('Generating 16');
    await sharp(src).resize(16, 16).png().toFile(dst16);
    log('16 done');

    log('Generating 48');
    await sharp(src).resize(48, 48).png().toFile(dst48);
    log('48 done');

    log('Generating 128');
    await sharp(src).resize(128, 128).png().toFile(dst128);
    log('128 done');

    log('All done');
  } catch(e) {
    log('Error: ' + e.message);
    log(e.stack);
  }
}

gen();