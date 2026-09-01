/**
 * scripts/build-brand-assets.mts
 * -----------------------------------------------------------------------------
 * 把 public/brand/logo-mark.svg 转成 PNG 多尺寸 + favicon.ico + apple-icon.png
 * 用法：pnpm tsx scripts/build-brand-assets.mts
 * 不动源码；幂等（直接覆写产物）。
 * -----------------------------------------------------------------------------
 */

// pnpm phantom dep：sharp 在 .pnpm store 里被 hoist，但不在 app/node_modules 顶层
// 直接 require 真实安装路径
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const sharpPath = "/root/shop-saas/app/node_modules/.pnpm/sharp@0.35.3_@types+node@20.19.43/node_modules/sharp/dist/index.cjs";
const sharp = require(sharpPath);
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "public/brand/logo-mark.svg");

// 加载源 SVG
const svgBuf = readFileSync(SRC);

// 各目标输出
type Target = {
  file: string; // 相对 ROOT
  size: number; // 正方形 px
  format: "png" | "ico";
};
const targets: Target[] = [
  { file: "public/brand/logo-512.png", size: 512, format: "png" },
  { file: "public/brand/logo-256.png", size: 256, format: "png" },
  { file: "public/brand/logo-192.png", size: 192, format: "png" },
  { file: "public/brand/logo-128.png", size: 128, format: "png" },
  { file: "public/brand/logo-64.png", size: 64, format: "png" },
  { file: "app/apple-icon.png", size: 180, format: "png" }, // iOS Apple Touch Icon 标准
];

async function renderPng(size: number): Promise<Buffer> {
  // density=384 保证矢量在缩到任何尺寸时都不糊（sharp 默认 72）
  return await sharp(svgBuf, { density: 384 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function buildIco(): Promise<Buffer> {
  // 把 16/32/48 三张 PNG 拼成 ICO（多分辨率 ICO）
  const sizes = [16, 32, 48];
  const pngBuffers = await Promise.all(sizes.map((s) => renderPng(s)));

  // ICO header + dir entries
  // 参考：https://en.wikipedia.org/wiki/ICO_(file_format)
  const headerSize = 6;
  const dirEntrySize = 16;
  const numImages = pngBuffers.length;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = icon
  header.writeUInt16LE(numImages, 4);

  const dirEntries: Buffer[] = [];
  const imageData: Buffer[] = [];
  let offset = headerSize + dirEntrySize * numImages;

  pngBuffers.forEach((buf, i) => {
    const size = sizes[i];
    const entry = Buffer.alloc(dirEntrySize);
    entry.writeUInt8(size === 256 ? 0 : size, 0); // width (0 means 256)
    entry.writeUInt8(size === 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // colors in palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(buf.length, 8); // size of image data
    entry.writeUInt32LE(offset, 12); // offset of image data
    dirEntries.push(entry);
    imageData.push(buf);
    offset += buf.length;
  });

  return Buffer.concat([header, ...dirEntries, ...imageData]);
}

async function main() {
  for (const t of targets) {
    const out = join(ROOT, t.file);
    mkdirSync(dirname(out), { recursive: true });
    const buf = await renderPng(t.size);
    writeFileSync(out, buf);
    console.log(`✓ ${t.file}  (${t.size}×${t.size}, ${buf.length} bytes)`);
  }

  // favicon.ico 多分辨率
  const icoOut = join(ROOT, "app/favicon.ico");
  mkdirSync(dirname(icoOut), { recursive: true });
  const icoBuf = await buildIco();
  writeFileSync(icoOut, icoBuf);
  console.log(`✓ app/favicon.ico  (16/32/48 multi-res, ${icoBuf.length} bytes)`);

  // OG Image 1200×630 from public/brand/og-source.svg
  const ogSrc = join(ROOT, "public/brand/og-source.svg");
  const ogOut = join(ROOT, "app/opengraph-image.png");
  mkdirSync(dirname(ogOut), { recursive: true });
  const ogBuf = await sharp(readFileSync(ogSrc), { density: 192 })
    .resize(1200, 630, { fit: "contain", background: { r: 250, g: 250, b: 250, alpha: 1 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(ogOut, ogBuf);
  console.log(`✓ app/opengraph-image.png  (1200×630, ${ogBuf.length} bytes)`);
}

main().catch((err) => {
  console.error("✗ build-brand-assets failed:", err);
  process.exit(1);
});