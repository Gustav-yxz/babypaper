#!/usr/bin/env node
/* 由词库里的配图信息生成 CREDITS.md。增删配图后重新跑一遍：node tools/build-credits.js */
"use strict";
const fs = require("fs");
const path = require("path");
const { ROOT, loadData, figuresOf } = require("./lib");

const byFile = new Map();
loadData("kb.js").forEach((t) => {
  figuresOf(t).forEach((f) => {
    if (!byFile.has(f.img)) byFile.set(f.img, { credit: f.credit, link: f.link, terms: [] });
    const row = byFile.get(f.img);
    if (row.terms.indexOf(t.w) < 0) row.terms.push(t.w);
  });
});

const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const rows = Array.from(byFile.keys()).sort().map((img) => {
  const r = byFile.get(img);
  return "| [`" + path.basename(img) + "`](" + encodeURI(img) + ") | " + cell(r.credit) + " | [原图页](" + r.link + ") | " + cell(r.terms.join("、")) + " |";
});

const out = [
  "# 配图署名与许可证",
  "",
  "本文件由 `node tools/build-credits.js` 根据 `data/kb.js` 自动生成，请不要手动修改。",
  "",
  "`assets/figures/` 下的图片**不属于本项目的原创内容**，版权归各自作者所有，按下表所列的许可证使用。",
  "标注为 CC BY-SA 的图片，再分发或改编时须保留署名并沿用相同许可证。",
  "PubChem 结构式由美国国家生物技术信息中心（NCBI）提供，属公共领域。",
  "",
  "共 " + rows.length + " 张图。",
  "",
  "| 文件 | 作者与许可证 | 来源 | 用于词条 |",
  "| --- | --- | --- | --- |"
].concat(rows).join("\n") + "\n";

fs.writeFileSync(path.join(ROOT, "CREDITS.md"), out);
console.log("CREDITS.md 已生成，共 " + rows.length + " 张图");
