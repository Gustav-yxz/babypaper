#!/usr/bin/env node
/* 数据自检：提交前跑一遍，CI 里也会跑。node tools/check-data.js */
"use strict";
const fs = require("fs");
const path = require("path");
const { ROOT, loadData, figuresOf } = require("./lib");

const errors = [];
const warnings = [];
const kb = loadData("kb.js");
const chains = loadData("chains.js");
const exps = loadData("experiments.js");

/* ---- 词库 ---- */
const names = new Map();
kb.forEach((t, i) => {
  const where = "词条 #" + (i + 1) + "「" + (t.w || "?") + "」";
  ["w", "en", "cat", "def", "plain", "use"].forEach((k) => {
    if (typeof t[k] !== "string" || !t[k].trim()) errors.push(where + " 缺少必填字段 " + k);
  });
  if (names.has(t.w)) errors.push(where + " 与词条 #" + names.get(t.w) + " 重名");
  names.set(t.w, i + 1);
  if (/<\/?[a-z][^>]*>/i.test(JSON.stringify(t))) errors.push(where + " 含 HTML 标签（界面按纯文本显示，请去掉）");
  figuresOf(t).forEach((f) => {
    ["img", "cap", "credit", "link"].forEach((k) => {
      if (!f[k]) errors.push(where + " 的配图缺少 " + k);
    });
    if (f.img && !fs.existsSync(path.join(ROOT, f.img))) errors.push(where + " 的配图文件不存在：" + f.img);
  });
  if (t.figs && t.figs.length && !t.fig) errors.push(where + " 有 figs 但没有 fig");
});
kb.forEach((t) => {
  if (t.chain && t.chain.indexOf(t.w) < 0) warnings.push("词条「" + t.w + "」的逻辑位置里没有它自己");
});

/* ---- 配图目录里有没有没被引用的文件 ---- */
const used = new Set();
kb.forEach((t) => figuresOf(t).forEach((f) => used.add(path.basename(f.img || ""))));
const figDir = path.join(ROOT, "assets", "figures");
if (fs.existsSync(figDir)) {
  fs.readdirSync(figDir).forEach((f) => {
    if (!f.startsWith(".") && !used.has(f)) warnings.push("assets/figures/" + f + " 没有被任何词条引用");
  });
}

/* ---- 逻辑链 ---- */
chains.forEach((c, i) => {
  const where = "逻辑链 #" + (i + 1);
  if (!c.title || !c.q) errors.push(where + " 缺少 title 或 q");
  if (!Array.isArray(c.nodes) || c.nodes.length < 2) errors.push(where + " 至少要有 2 个节点");
  (c.nodes || []).forEach((n, k) => {
    if (!n.t || !n.d || !n.n) errors.push(where + " 的节点 #" + (k + 1) + " 缺少 t / d / n");
  });
});

/* ---- 实验 ---- */
exps.forEach((e, i) => {
  const where = "实验 #" + (i + 1) + "「" + (e.name || "?") + "」";
  ["name", "en", "cat", "use", "scoreText", "notes", "scope"].forEach((k) => {
    if (typeof e[k] !== "string" || !e[k].trim()) errors.push(where + " 缺少必填字段 " + k);
  });
  if (!Array.isArray(e.scores) || e.scores.length !== 5 || e.scores.some((s) => !(s >= 1 && s <= 5))) errors.push(where + " 的 scores 应为 5 个 1–5 的数");
  if (!Array.isArray(e.steps) || !e.steps.length) errors.push(where + " 缺少 steps");
  if (!e.source || !e.source.text) errors.push(where + " 缺少 source.text");
});

/* ---- 出处整体情况（只汇总，不逐条刷屏） ---- */
const count = (re) => kb.filter((t) => re.test(t.src || "")).length;
const status = [
  "只引网络百科类来源 " + kb.filter((t) => /wikipedia/i.test(t.src || "") && !/《/.test(t.src || "")).length + " 条",
  "引《中国药典》2020 年版 " + count(/药典 ?2020/) + " 条（2025 年版已实施，待对照更新）",
  "引人卫《药剂学》第 8 版 " + count(/药剂学》第 8 版/) + " 条、《药理学》第 9 版 " + count(/药理学》[^；。]*第 9 版/) + " 条（请确认是否已有新版）"
];
kb.forEach((t) => figuresOf(t).forEach((f) => {
  if (!(f.w > 0 && f.h > 0) && !/h-donor-acceptor\.svg$/.test(f.img || "")) warnings.push("配图 " + f.img + " 没有尺寸，跑一遍 node tools/fig-sizes.js");
}));

warnings.forEach((w) => console.log("提示  " + w));
console.log("\n出处：\n  " + status.join("\n  "));
errors.forEach((e) => console.error("错误  " + e));
console.log("\n词条 " + kb.length + " · 配图 " + used.size + " · 逻辑链 " + chains.length + " · 实验 " + exps.length
  + " ｜ 错误 " + errors.length + " · 提示 " + warnings.length);
process.exit(errors.length ? 1 : 0);
