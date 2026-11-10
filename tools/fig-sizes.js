#!/usr/bin/env node
/* 把每张配图的像素尺寸写进词库（fig.w / fig.h），页面据此预留位置，图片加载时不再跳动。
   增删或替换配图后跑一遍：node tools/fig-sizes.js */
"use strict";
const fs = require("fs");
const path = require("path");
const { ROOT, figuresOf } = require("./lib");

function sizeOf(file) {
  const buf = fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase();
  if (ext === ".png") return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  if (ext === ".gif") return [buf.readUInt16LE(6), buf.readUInt16LE(8)];
  if (ext === ".jpg" || ext === ".jpeg") {
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return null;
  }
  if (ext === ".svg") {
    const tag = (/<svg[^>]*>/i.exec(buf.toString("utf8")) || [""])[0];
    const attr = (name) => { const m = new RegExp("\\s" + name + '="([^"]+)"').exec(tag); return m ? parseFloat(m[1]) : NaN; };
    const vb = (/viewBox="([^"]+)"/.exec(tag) || [])[1];
    let w = attr("width"), h = attr("height");
    if (/\swidth="[^"]*%/.test(tag)) w = NaN;
    if (/\sheight="[^"]*%/.test(tag)) h = NaN;
    if (!(w > 0 && h > 0) && vb) { const p = vb.trim().split(/[\s,]+/).map(Number); w = p[2]; h = p[3]; }
    return w > 0 && h > 0 ? [Math.round(w), Math.round(h)] : null;
  }
  return null;
}

const file = path.join(ROOT, "data", "kb.js");
const src = fs.readFileSync(file, "utf8");
const at = src.indexOf("= [");
const kb = JSON.parse(src.slice(at + 2).replace(/;\s*$/, ""));
let done = 0, failed = 0;
kb.forEach((t) => {
  figuresOf(t).forEach((f) => {
    let size = null;
    try { size = sizeOf(path.join(ROOT, f.img)); } catch (e) { size = null; }
    if (size) { f.w = size[0]; f.h = size[1]; done++; } else { delete f.w; delete f.h; failed++; console.log("读不出尺寸：" + f.img); }
  });
});
fs.writeFileSync(file, src.slice(0, at + 3) + "\n" + kb.map((x) => JSON.stringify(x)).join(",\n") + "\n];\n");
console.log("已写入 " + done + " 处配图尺寸" + (failed ? "，" + failed + " 处失败" : ""));
