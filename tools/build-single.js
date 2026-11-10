#!/usr/bin/env node
/* 把整个站点打包成一个可以离线打开、方便用微信等渠道转发的 HTML 文件。
   node tools/build-single.js  →  dist/宝宝文献.html
   样式、脚本、数据全部内联，配图转成 data URI，所以成品约 15 MB。 */
"use strict";
const fs = require("fs");
const path = require("path");
const { ROOT } = require("./lib");

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".gif": "image/gif", ".webp": "image/webp" };
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const inlineScript = (code) => "<script>\n" + code.replace(/<\/script/gi, "<\\/script") + "\n</script>";

let html = read("index.html");
let inlined = 0;

html = html.replace(/<link rel="stylesheet" href="([^"]+)" \/>/g, (m, href) => "<style>\n" + read(href) + "\n</style>");
html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
  let code = read(src);
  if (src === "data/kb.js") {
    code = code.replace(/"img":"(assets\/figures\/[^"]+)"/g, (mm, rel) => {
      const mime = MIME[path.extname(rel).toLowerCase()];
      if (!mime) throw new Error("不认识的图片类型：" + rel);
      inlined++;
      return '"img":"data:' + mime + ";base64," + fs.readFileSync(path.join(ROOT, rel)).toString("base64") + '"';
    });
  }
  return inlineScript(code);
});

const outDir = path.join(ROOT, "dist");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "宝宝文献.html");
fs.writeFileSync(outFile, html);
console.log("已生成 " + path.relative(ROOT, outFile) + "（" + (fs.statSync(outFile).size / 1048576).toFixed(1) + " MB，内联配图 " + inlined + " 处）");
