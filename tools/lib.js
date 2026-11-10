/* 各脚本共用：读取 data/*.js 里的数组（文件格式是「window.XXX = [ … ];」，每行一条 JSON） */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function loadData(file) {
  const src = fs.readFileSync(path.join(ROOT, "data", file), "utf8");
  const start = src.indexOf("= [");
  if (start < 0) throw new Error(file + "：找不到「= [」，文件格式不对");
  return JSON.parse(src.slice(start + 2).replace(/;\s*$/, ""));
}

function figuresOf(term) {
  return (term.fig ? [term.fig] : []).concat(term.figs || []);
}

module.exports = { ROOT, loadData, figuresOf };
