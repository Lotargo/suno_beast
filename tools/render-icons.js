// Development asset build only; the shipped extension does not depend on sharp.
// Set SUNO_BEAST_SHARP to a sharp module path if it is not installed locally.
const path = require('node:path');
const sharp = require(process.env.SUNO_BEAST_SHARP || 'sharp');
const assets = path.resolve(__dirname, '../extension/assets');
async function main() {
  for (const size of [16, 24, 32, 48, 64, 128]) {
    await sharp(path.join(assets, 'suno-beast-icon.svg'), { density: 384 })
      .resize(size, size).png().toFile(path.join(assets, `icon-${size}.png`));
  }
  console.log('Rendered Suno Beast icons: 16, 24, 32, 48, 64, 128 px');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
