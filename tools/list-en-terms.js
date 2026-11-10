#!/usr/bin/env node
/* 打印英文标词表，供人工审查「哪个英文词会被标到哪个词条」。
   node tools/list-en-terms.js          全部
   node tools/list-en-terms.js --single 只看单个词（最容易误标的那部分） */
"use strict";
const { loadData } = require("./lib");
const build = require("../assets/js/en-terms.js");

const kb = loadData("kb.js");
const onlySingle = process.argv.includes("--single");
const rows = build(kb)
  .filter((m) => !onlySingle || (!m.cs && !/[ \-–]/.test(m.txt)))
  .sort((a, b) => a.txt.toLowerCase().localeCompare(b.txt.toLowerCase()));

rows.forEach((m) => console.log((m.cs ? "[区分大小写] " : "") + m.txt + "  →  " + kb[m.ti].w));
console.log("\n共 " + rows.length + " 条" + (onlySingle ? "（单个词）" : ""));
