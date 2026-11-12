/* SPDX-License-Identifier: MIT */
/* ============================================================
   宝宝文献 · 交互脚本
   无构建、无依赖：数据来自 data/*.js 里的三个全局变量。
   pdf.js 与 Tesseract.js 只在导入 PDF / 使用 OCR 时才按需加载。
   ============================================================ */
(function () {
  "use strict";

  var CONFIG = {
    /* 发布到 GitHub 后填上仓库地址，顶栏会出现源码入口 */
    repoUrl: "https://github.com/GustavPharm/babypaper",
    maxChars: 80000,
    ocrMaxPages: 10,
    pdfjsBase: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/",
    tesseractSrc: "https://cdn.jsdelivr.net/npm/tesseract.js@5.0.5/dist/tesseract.min.js"
  };

  var KB = window.LP_KB || [];
  var CHAINS = window.LP_CHAINS || [];
  var EXPS = window.LP_EXPS || [];

  /* ================= 小工具 ================= */
  function $(id) { return document.getElementById(id); }
  function $$(sel, scope) { return Array.prototype.slice.call((scope || document).querySelectorAll(sel)); }
  var ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }
  function num(n) { return Number(n).toLocaleString("zh-CN"); }
  function isWide() { return window.matchMedia("(min-width: 960px)").matches; }

  /* 偏好与生词本存在 localStorage；隐私模式下读写失败就退回内存 */
  var store = {
    get: function (k, d) {
      try { var v = localStorage.getItem("lp:" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set: function (k, v) { try { localStorage.setItem("lp:" + k, JSON.stringify(v)); } catch (e) {} }
  };

  var toastTimer = 0;
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2200);
  }

  var scriptCache = {};
  function loadScript(src) {
    if (!scriptCache[src]) {
      scriptCache[src] = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = src;
        s.onload = resolve;
        s.onerror = function () { delete scriptCache[src]; s.remove(); reject(new Error("script-load")); };
        document.head.appendChild(s);
      });
    }
    return scriptCache[src];
  }

  /* 正文里的「1. …。2. …。」排成有序列表，其余按一段输出 */
  function splitNumbered(s) {
    var idx = [], pos = 0;
    for (var n = 1; n <= 20; n++) {
      var tok = n + ". ", i = pos, found = -1;
      while ((i = s.indexOf(tok, i)) > -1) {
        if (i === 0 || /[。；;！？!?\s：:）)]/.test(s.charAt(i - 1))) { found = i; break; }
        i += tok.length;
      }
      if (found < 0) break;
      idx.push(found); pos = found + tok.length;
    }
    if (idx.length < 2) return null;
    return {
      lead: s.slice(0, idx[0]).trim(),
      items: idx.map(function (st, k) {
        return s.slice(st + String(k + 1).length + 2, k + 1 < idx.length ? idx[k + 1] : s.length).trim();
      })
    };
  }
  function rich(text) {
    var s = String(text || "");
    var list = splitNumbered(s);
    if (!list) return "<p>" + esc(s) + "</p>";
    return (list.lead ? "<p>" + esc(list.lead) + "</p>" : "")
      + "<ol>" + list.items.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ol>";
  }
  /* 出处里的网址变成可点的短链接（先转义，再包链接） */
  function linkify(text) {
    return esc(text).replace(/https?:\/\/[^\s（）；，、。<"']+/g, function (u) {
      var label = u.replace(/^https?:\/\//, "").replace(/&amp;/g, "&");
      if (label.length > 44) label = label.slice(0, 42) + "…";
      return '<a href="' + u + '" target="_blank" rel="noopener">' + esc(label) + "</a>";
    });
  }

  /* ================= 分类 ================= */
  var CAT_ORDER = ["药物化学", "药理学", "药物分析", "药剂学", "生药学", "人名反应", "抗病毒核苷", "分子基础", "酶与蛋白",
    "基础支撑", "前药策略", "立体化学", "药物作用", "数据指标", "病毒学", "逻辑概念", "通用科研"];
  var CAT_HUE = {
    "药物化学": "blue", "前药策略": "blue", "药理学": "brown", "药物作用": "brown", "药物分析": "purple", "立体化学": "purple",
    "抗病毒核苷": "green", "酶与蛋白": "green", "病毒学": "green", "分子基础": "olive", "数据指标": "slate",
    "人名反应": "indigo", "药剂学": "rose", "生药学": "leaf", "基础支撑": "gray", "通用科研": "gray", "逻辑概念": "gray"
  };
  function catTag(cat) {
    return '<span class="tag" style="--cat:var(--c-' + (CAT_HUE[cat] || "gray") + ')"><i class="dot"></i>' + esc(cat) + "</span>";
  }
  function sortCats(list) {
    return list.slice().sort(function (a, b) {
      var ia = CAT_ORDER.indexOf(a), ib = CAT_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  }

  /* ================= 词库索引与查词 ================= */
  function norm(s) {
    return String(s || "").toLowerCase()
      .replace(/[₀-₉]/g, function (c) { return String(c.charCodeAt(0) - 0x2080); })
      .replace(/[\s\-_·、，。；：'"“”‘’「」]/g, "");
  }
  function aliasesOf(t) {
    return t.alias ? t.alias.split(/[；;]/).map(function (a) { return a.trim(); }).filter(Boolean) : [];
  }
  var NAME = KB.map(function (t) { return norm(t.w); });
  var EN = KB.map(function (t) { return norm(t.en); });
  var exact = new Map();
  function addKey(k, t) { k = norm(k); if (k && !exact.has(k)) exact.set(k, t); }
  KB.forEach(function (t) { addKey(t.w, t); });
  KB.forEach(function (t) { addKey(t.en, t); addKey(String(t.en || "").split(/[（(；;,，]/)[0], t); });
  KB.forEach(function (t) { aliasesOf(t).forEach(function (a) { addKey(a, t); }); });

  function exactTerm(raw) { return exact.get(norm(raw)) || null; }
  /* 选区里包含的全部词条，按出现位置排序；长词盖住它内部的短词 */
  function termsWithin(raw) {
    var q = norm(raw), hits = [];
    KB.forEach(function (t, i) {
      var w = NAME[i], at = w.length >= 2 ? q.indexOf(w) : -1;
      if (at > -1) hits.push({ t: t, at: at, end: at + w.length });
    });
    hits = hits.filter(function (h) {
      return !hits.some(function (o) { return o !== h && o.at <= h.at && o.end >= h.end && (o.end - o.at) > (h.end - h.at); });
    });
    hits.sort(function (a, b) { return a.at - b.at; });
    return hits.map(function (h) { return h.t; });
  }
  /* 模糊查词：先精确（词条名 / 英文名 / 别名），再看包含关系 */
  function findTerm(raw) {
    var q = norm(raw);
    if (!q) return null;
    if (exact.has(q)) return exact.get(q);
    var best = -1, i;
    for (i = 0; i < KB.length; i++) {            /* 选区包含词条名：取最长的 */
      if (NAME[i].length >= 2 && q.indexOf(NAME[i]) > -1 && (best < 0 || NAME[i].length > NAME[best].length)) best = i;
    }
    if (best > -1) return KB[best];
    if (q.length >= 2) {
      for (i = 0; i < KB.length; i++) {          /* 选区是词条名的一部分：取最短的 */
        if (NAME[i].indexOf(q) > -1 && (best < 0 || NAME[i].length < NAME[best].length)) best = i;
      }
      if (best > -1) return KB[best];
    }
    if (q.length >= 4 && /^[a-z0-9]+$/.test(q)) {
      for (i = 0; i < KB.length; i++) {
        if (EN[i].indexOf(q) > -1 && (best < 0 || EN[i].length < EN[best].length)) best = i;
      }
    }
    return best > -1 ? KB[best] : null;
  }
  /* 查不到时给几个字面上最接近的词条 */
  function suggestions(raw, limit) {
    var q = norm(raw), scored = [];
    if (!q) return [];
    var ascii = /^[a-z0-9]+$/.test(q), qs = {};
    q.split("").forEach(function (c) { qs[c] = 1; });
    KB.forEach(function (t, i) {
      var s = 0;
      if (ascii) {
        if (q.length >= 4 && EN[i].indexOf(q.slice(0, 4)) > -1) s = 1 / Math.sqrt(EN[i].length || 1);
      } else {
        var seen = {};
        NAME[i].split("").forEach(function (c) { if (qs[c] && !seen[c]) { seen[c] = 1; s++; } });
        s = s >= Math.min(2, q.length) ? s / Math.sqrt(NAME[i].length) : 0;
      }
      if (s > 0) scored.push([s, t]);
    });
    scored.sort(function (a, b) { return b[0] - a[0]; });
    return scored.slice(0, limit || 6).map(function (x) { return x[1]; });
  }

  /* ---------- 自动标词用的匹配表 ---------- */
  var matchers = [], matcherSeen = {};
  /* cs = 区分大小写（缩写必须区分，否则 PEG 会标进 peg）；infl = 允许英文复数（kinase → kinases） */
  function addMatcher(txt, term, cs, infl) {
    if (!txt || !term) return;
    var key = (cs ? "=" : "~") + (cs ? txt : txt.toLowerCase());
    if (matcherSeen[key]) return;
    matcherSeen[key] = 1;
    matchers.push({ txt: txt, low: txt.toLowerCase(), term: term, cs: !!cs, infl: !!infl });
  }
  KB.forEach(function (t) { addMatcher(t.w, t); });
  ["EC50", "CC50", "IC50"].forEach(function (a) { addMatcher(a, findTerm(a)); });
  KB.forEach(function (t) {
    aliasesOf(t).forEach(function (a) { if (a.length >= 2 && /[一-鿿]/.test(a)) addMatcher(a, t); });
  });
  [["pKa", "解离常数 pKa"], ["Kd", "解离常数 Kd"], ["Ki", "抑制常数"], ["logP", "脂水分配系数"], ["logD", "分布系数"], ["LipE", "亲脂效率"],
    ["Cmax", "峰浓度"], ["Tmax", "峰浓度"], ["Emax", "最大效应"]]
    .forEach(function (p) { addMatcher(p[0], findTerm(p[1]), true); });
  addMatcher("Lipinski", findTerm("Lipinski 五规则"));
  addMatcher("Veber", findTerm("Veber 规则"));
  /* 英文文献：由词条的英文名和英文别名推导出来的标词表，规则见 en-terms.js */
  (window.LP_buildEnMatchers ? window.LP_buildEnMatchers(KB) : []).forEach(function (m) {
    addMatcher(m.txt, KB[m.ti], m.cs, m.infl);
  });
  /* 按首字符分桶，桶内长词优先：同一位置先命中 Lipinski，就轮不到它里面的 Ki */
  var byFirst = new Map();
  matchers.sort(function (a, b) { return b.txt.length - a.txt.length; });
  matchers.forEach(function (m) {
    var k = m.low.charAt(0);
    if (!byFirst.has(k)) byFirst.set(k, []);
    byFirst.get(k).push(m);
  });

  /* 英文字母 / 数字组成的词只在独立成词时命中：ATP 不会标进 ATPase。中文没有空格分词，不受此限 */
  var WORD_CH = /[A-Za-z0-9_]/;
  function isWordCh(text, i) { return i >= 0 && i < text.length && WORD_CH.test(text.charAt(i)); }
  /* 匹配器 m 在 text 的 i 处命中了多长（0 = 没命中）。英文词允许带复数的 s / es */
  function matchLen(text, i, m) {
    var len = m.txt.length;
    if (i + len > text.length) return 0;
    var chunk = text.substr(i, len);
    if (m.cs ? chunk !== m.txt : chunk.toLowerCase() !== m.low) return 0;
    var end = i + len;
    if (!WORD_CH.test(m.txt.charAt(len - 1)) || !isWordCh(text, end)) return len;
    if (m.infl) {
      var c = text.charAt(end).toLowerCase(), c2 = text.charAt(end + 1).toLowerCase();
      if (c === "s" && !isWordCh(text, end + 1)) return len + 1;
      if (c === "e" && c2 === "s" && !isWordCh(text, end + 2)) return len + 2;
    }
    return 0;
  }
  /* 找出一段文字里所有能标的词：[{at, len, term}]，从左到右、互不重叠 */
  function scan(text, all) {
    var hits = [], i = 0;
    while (i < text.length) {
      var ch = text.charAt(i);
      /* 英文单词中间的位置不可能是词的开头，整桶跳过 */
      if (WORD_CH.test(ch) && isWordCh(text, i - 1)) { i++; continue; }
      var cands = byFirst.get(ch.toLowerCase()), got = 0, hit = null;
      if (cands) {
        for (var k = 0; k < cands.length && !got; k++) {
          if (!all && isMastered(cands[k].term)) continue;
          got = matchLen(text, i, cands[k]);
          if (got) hit = cands[k];
        }
      }
      if (hit) { hits.push({ at: i, len: got, term: hit.term }); i += got; } else { i++; }
    }
    return hits;
  }
  function termSpan(name, inner) {
    return '<span class="term" tabindex="0" role="button" data-term="' + esc(name) + '">' + inner + "</span>";
  }
  function highlight(text) {
    var out = "", from = 0, hits = scan(text);
    hits.forEach(function (h) {
      out += esc(text.slice(from, h.at)) + termSpan(h.term.w, esc(text.substr(h.at, h.len)));
      from = h.at + h.len;
    });
    return { html: out + esc(text.slice(from)), count: hits.length };
  }

  /* ================= 已掌握的词 =================
     标成「已掌握」的词不再自动加底色（划选和术语库里照样能查） */
  var mastered = {};
  (store.get("mastered", []) || []).forEach(function (w) { mastered[w] = 1; });
  function isMastered(term) { return mastered[term.w] === 1; }
  function masteredList() { return Object.keys(mastered); }

  /* ================= 生词本数据 ================= */
  var notes = (store.get("notes", []) || []).filter(function (w) { return !!exactTerm(w); });
  function hasNote(w) { return notes.indexOf(w) > -1; }

  /* ================= 词条解释卡 ================= */
  var SRC_BY_CAT = {
    "分子基础": "教科书：《生物化学与分子生物学》（人卫，第 9 版）、Lehninger《生物化学原理》；别名核对：OpenStax《Biology 2e / Chemistry 2e》、PubChem。",
    "酶与蛋白": "教科书：Lehninger《生物化学原理》酶学部分、《药理学》（人卫，第 9 版）；别名核对：PubChem、OpenStax《Biology 2e》。",
    "药物作用": "教科书：《药理学》（杨宝峰、陈建国，人卫，第 9 版）药效学部分、Katzung《基础与临床药理学》、Goodman & Gilman《治疗学的药理学基础》；活性数据口径核对：ChEMBL、PubChem BioAssay。",
    "前药策略": "教科书：《药物化学》（尤启冬，人卫）与 Foye《药物化学原理》的前药章节；化合物别名核对：PubChem。",
    "数据指标": "教科书：《药理学》（人卫，第 9 版）量效关系部分、Katzung《基础与临床药理学》；数据记录口径核对：ChEMBL、PubChem BioAssay。",
    "立体化学": "教科书：Clayden《有机化学》立体化学部分、《药物化学》（人卫）手性药物部分；概念表述核对：RDKit / DeepChem 开源教程。",
    "病毒学": "教科书：《医学微生物学》（人卫）、Alberts《细胞的分子生物学》；别名核对：OpenStax《Biology 2e》。",
    "逻辑概念": "教科书：《药理学》（人卫，第 9 版）、Alberts《细胞的分子生物学》；基础概念表述核对：OpenStax 开放教科书。",
    "通用科研": "教科书：《医学统计学》（人卫）、Katzung《基础与临床药理学》临床试验部分。",
    "药物化学": "教科书：人卫《药物化学》、Foye《药物化学原理》、Clayden《有机化学》；术语口径：IUPAC《Glossary of Terms Used in Medicinal Chemistry》；别名核对：PubChem、OpenStax《Organic Chemistry》。",
    "抗病毒核苷": "教科书：人卫《药物化学》《医学微生物学》、Goodman & Gilman；开放核对：PMC 开放文献、Stanford HIVDB 的耐药口径。",
    "药理学": "教科书：人卫《药理学》（第 9 版）、Katzung《基础与临床药理学》（第 15 版）、Goodman & Gilman（第 14 版）、Rang & Dale《药理学》；开放核对：NCBI Bookshelf / StatPearls、PMC 文献。",
    "药物分析": "规范：ICH Q2(R2) 分析方法验证、Q1A / Q3 / Q6A；美国药典 USP 通则、中国药典通则、欧洲药典；FDA / EMA 生物分析方法验证指导原则。"
  };
  function srcFor(term) {
    return term.src || SRC_BY_CAT[term.cat] || "教科书：相关学科规划教材。别名核对：PubChem、OpenStax 开放教科书。";
  }

  var defCard = $("defCard"), defBody = $("defBody"), scrim = $("scrim");
  var defHome = { parent: defCard.parentNode, next: defCard.nextSibling };
  var defHistory = [];        /* 卡片内连续点词的历史，供「返回上一个词条」用 */
  var currentTerm = null;
  var drawerOpener = null;    /* 抽屉关闭后把焦点还给它 */
  var curTab = "read";

  var EMPTY_HTML = '<div class="def-empty"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5V6a2 2 0 0 1 2-2h9l5 5v10.5a.5.5 0 0 1-.5.5H6a2 2 0 0 1-2-.5Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 12h8M8 15.5h5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'
    + "点一个带底色的词，或划选任意词语，<br />解释会显示在这里。</div>";

  function sec(title, inner, cls) {
    return '<section class="def-sec' + (cls ? " " + cls : "") + '"><h3>' + esc(title) + "</h3>" + inner + "</section>";
  }
  function figHTML(term, f) {
    var label = (f.linkLabel || "Wikimedia Commons 文件页").replace(/\s*↗\s*$/, "");
    return '<figure class="figbox' + (f.struct ? " struct" : "") + '">'
      + '<img src="' + esc(f.img) + '" alt="' + esc(term.w + "：" + f.cap) + '"'
      + (f.w && f.h ? ' width="' + f.w + '" height="' + f.h + '"' : "") + ' loading="lazy" data-zoom />'
      + "<figcaption>" + esc(f.cap) + '<span class="credit">' + esc(f.credit)
      + ' <a href="' + esc(f.link) + '" target="_blank" rel="noopener">' + esc(label) + " ↗</a></span></figcaption></figure>";
  }
  function nodeBtn(t, label) {
    return '<button type="button" class="node" data-lookup="' + esc(t.w) + '">' + esc(label || t.w) + "</button>";
  }
  function termHTML(term) {
    var aliases = aliasesOf(term);
    var h = '<div class="def-head"><h2 class="def-word' + (term.w.length > 14 ? " long" : "") + '">' + esc(term.w) + "</h2>"
      + '<p class="def-en">' + esc(term.en) + "</p>"
      + '<div class="def-meta">' + catTag(term.cat) + (aliases.length ? "<span>又称：" + esc(aliases.join("、")) + "</span>" : "") + "</div></div>"
      + '<p class="def-plain">' + esc(term.plain) + "</p>"
      + sec("基础定义", rich(term.def))
      + sec("为什么重要", rich(term.use));
    if (term.trap) h += sec("常见误解", rich(term.trap), "trap");
    if (term.chain && term.chain.length) {
      h += sec("逻辑位置", '<div class="def-chain">' + term.chain.map(function (c, i) {
        var arrow = i > 0 ? '<span class="arr" aria-hidden="true">→</span>' : "";
        var found = exactTerm(c) || findTerm(c);
        if (c === term.w) return arrow + '<span class="node cur">' + esc(c) + "</span>";
        return arrow + (found ? nodeBtn(found, c) : '<span class="node">' + esc(c) + "</span>");
      }).join("") + "</div>");
    }
    if (term.fig) {
      h += sec("配图", figHTML(term, term.fig)
        + (term.figs && term.figs.length ? '<div class="fig-grid">' + term.figs.map(function (f) { return figHTML(term, f); }).join("") + "</div>" : ""));
    } else if (term.figPending) {
      h += sec("配图", '<p>有一张候选的开放图片，许可证还在复核，暂不直接展示。可以先到 <a href="' + esc(term.figPending)
        + '" target="_blank" rel="noopener">Wikimedia Commons 文件页 ↗</a> 查看原图。</p>', "fig-idea");
    }
    /* 补充小节默认收起，卡片先只给最要紧的几段；只写了「无可靠典型值」的小节没有信息量，不显示。
       用户展开过一次，之后的卡片就都保持展开 */
    var extras = (term.extra || []).filter(function (x) { return !/^无可靠典型值。?$/.test(String(x.p || "").trim()); });
    var moreLabels = extras.map(function (x) { return x.h; });
    var more = extras.map(function (x) { return sec(x.h, rich(x.p)); }).join("");
    if (!term.fig && !term.figPending && term.figIdea) {
      moreLabels.push("示意图思路");
      more += sec("示意图思路", "<p>" + esc(term.figIdea) + "</p>", "fig-idea");
    }
    if (more) {
      h += '<details class="def-more"' + (store.get("moreOpen", false) ? " open" : "") + "><summary>补充："
        + esc(moreLabels.join(" · ")) + "</summary>" + more + "</details>";
    }
    if (term.unverified) h += '<p class="callout warn">待核实：' + esc(term.unverified) + "</p>";
    var inNotes = hasNote(term.w), known = isMastered(term);
    h += '<div class="def-actions">'
      + '<button type="button" class="btn' + (inNotes ? "" : " primary") + '" id="noteToggle" aria-pressed="' + inNotes + '">'
      + (inNotes ? "✓ 已在生词本" : "加入生词本") + "</button>"
      + (chainFor(term) ? '<button type="button" class="btn" id="gotoChain">在逻辑链中查看</button>' : "")
      + '<button type="button" class="btn ghost" id="masterToggle" aria-pressed="' + known + '" title="已掌握的词不再自动加底色，划选和术语库里照样能查">'
      + (known ? "✓ 已掌握 · 恢复标出" : "已掌握，不再标") + "</button>"
      + "</div>"
      + '<div class="def-foot"><p><b>出处</b>　' + linkify(srcFor(term)) + "</p>"
      + (term.srclink ? '<p><a href="' + esc(term.srclink) + '" target="_blank" rel="noopener">在线核对来源 ↗</a></p>' : "")
      + "<p>定义按来源的通行表述转写，高亮的一句话是通俗解释。正式引用请查原文。</p></div>";
    return h;
  }
  function missHTML(raw, within) {
    var h = '<div class="def-head"><h2 class="def-word' + (raw.length > 14 ? " long" : "") + '">「' + esc(raw) + "」</h2></div>";
    if (within.length) {
      h += "<p>这段文字里有 " + within.length + " 个词库收录的词，点一个看解释：</p>"
        + '<div class="def-chain">' + within.map(function (t) { return nodeBtn(t); }).join("") + "</div>";
    } else {
      var sugs = suggestions(raw, 6);
      h += "<p>词库里还没有这个词，它可能是更专门的术语。"
        + (sugs.length ? "先看看下面这些相近的基础词，通常足够读通这句话。" : "试着只选其中两三个字，或者到术语库里搜索。") + "</p>";
      if (sugs.length) h += sec("相近的词条", '<div class="def-chain">' + sugs.map(function (t) { return nodeBtn(t); }).join("") + "</div>");
    }
    h += '<div class="def-actions"><button type="button" class="btn" id="searchLib">到术语库搜索</button></div>';
    return h;
  }

  function shouldDock() { return isWide() && curTab === "read"; }
  function drawerIsOpen() { return defCard.classList.contains("is-drawer") && defCard.classList.contains("open"); }
  /* 桌面端阅读页：卡片停靠在右栏。其他情况（手机、其他页签）：卡片搬到 body 下做抽屉，
     否则它所在的面板一旦 display:none，position:fixed 也画不出来 */
  function placeDef(open) {
    if (shouldDock()) {
      if (defCard.parentNode !== defHome.parent) defHome.parent.insertBefore(defCard, defHome.next);
      defCard.classList.remove("is-drawer", "open");
      defCard.classList.add("is-docked");
      defCard.removeAttribute("role"); defCard.removeAttribute("aria-modal");
      scrim.hidden = true;
      return;
    }
    if (defCard.parentNode !== document.body) document.body.appendChild(defCard);
    defCard.classList.remove("is-docked");
    defCard.classList.add("is-drawer");
    defCard.setAttribute("role", "dialog"); defCard.setAttribute("aria-modal", "true");
    if (open && !drawerIsOpen()) {
      drawerOpener = document.activeElement;
      void defCard.offsetWidth;                 /* 让过渡动画从关闭态开始 */
      defCard.classList.add("open");
      scrim.hidden = false;
      $("defClose").focus({ preventScroll: true });
    }
  }
  function closeDrawer() {
    if (!drawerIsOpen()) return;
    defCard.classList.remove("open");
    scrim.hidden = true;
    if (drawerOpener && document.contains(drawerOpener) && drawerOpener.focus) drawerOpener.focus({ preventScroll: true });
    drawerOpener = null;
  }
  function paintDef(html) {
    defBody.innerHTML = html;
    var hasBack = defHistory.length > 1;
    $("defBack").hidden = !hasBack;
    defCard.querySelector(".def-toolbar").classList.toggle("has-back", hasBack);
    placeDef(true);
    defCard.scrollTop = 0;
  }
  /* fresh：从卡片外面打开（清空历史）；否则是卡片内部跳转（压入历史） */
  function showTerm(term, fresh) {
    if (fresh) defHistory = [];
    if (defHistory[defHistory.length - 1] !== term.w) defHistory.push(term.w);
    currentTerm = term;
    paintDef(termHTML(term));
  }
  function showMiss(raw, within) {
    defHistory = []; currentTerm = null;
    paintDef(missHTML(raw, within));
    defBody.setAttribute("data-miss", raw);
  }
  /* 划词 / 外部入口：精确命中直接看；选了一长段就列出里面的词条 */
  function lookup(raw) {
    raw = String(raw || "").trim();
    var hit = exactTerm(raw);
    if (hit) return showTerm(hit, true);
    /* 英文词的复数等写法（kinases）靠标词表认出来 */
    var hits = scan(raw, true);
    if (hits.length === 1 && hits[0].len >= raw.length - 1) return showTerm(hits[0].term, true);
    var within = termsWithin(raw);
    hits.forEach(function (h) { if (within.indexOf(h.term) < 0) within.push(h.term); });
    if (within.length === 1 && norm(raw).length <= norm(within[0].w).length + 2) return showTerm(within[0], true);
    if (within.length) return showMiss(raw, within);
    hit = findTerm(raw);
    if (hit) return showTerm(hit, true);
    showMiss(raw, []);
  }
  function resetDef() {
    defHistory = []; currentTerm = null;
    defBody.innerHTML = EMPTY_HTML;
    $("defBack").hidden = true;
    defCard.querySelector(".def-toolbar").classList.remove("has-back");
  }

  defBody.addEventListener("click", function (e) {
    var el = e.target.closest("[data-lookup], #noteToggle, #gotoChain, #masterToggle, #searchLib");
    if (!el) return;
    if (el.hasAttribute("data-lookup")) {
      var t = exactTerm(el.getAttribute("data-lookup"));
      if (t) showTerm(t, false);
    } else if (el.id === "noteToggle") {
      if (currentTerm) toggleNote(currentTerm);
    } else if (el.id === "gotoChain") {
      if (currentTerm) gotoChainForTerm(currentTerm);
    } else if (el.id === "masterToggle") {
      if (currentTerm) toggleMastered(currentTerm);
    } else if (el.id === "searchLib") {
      var raw = defBody.getAttribute("data-miss") || "";
      switchTab("lib", { top: true });
      $("libSearch").value = raw.slice(0, 20);
      renderLib();
      $("libSearch").focus({ preventScroll: true });
    }
  });
  $("defBack").addEventListener("click", function () {
    if (defHistory.length < 2) return;
    defHistory.pop();
    var t = exactTerm(defHistory[defHistory.length - 1]);
    if (t) { currentTerm = t; paintDef(termHTML(t)); }
  });
  $("defClose").addEventListener("click", closeDrawer);
  scrim.addEventListener("click", closeDrawer);
  /* toggle 事件不冒泡，用捕获监听「补充」的展开 / 收起 */
  defBody.addEventListener("toggle", function (e) {
    if (e.target.classList && e.target.classList.contains("def-more")) store.set("moreOpen", e.target.open);
  }, true);
  /* 抽屉打开时把 Tab 键的焦点圈在抽屉里 */
  defCard.addEventListener("keydown", function (e) {
    if (e.key !== "Tab" || !drawerIsOpen()) return;
    var items = $$('a[href], button:not([disabled]), summary, [tabindex="0"]', defCard).filter(function (el) { return el.offsetParent !== null; });
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  window.addEventListener("resize", function () { placeDef(drawerIsOpen()); });

  /* ================= 页签 ================= */
  var TABS = ["read", "chain", "lib", "exp", "note", "about"];
  var scrollMem = {}, pinSeq = 0;
  /* 切页签时文档高度会骤变（术语库有几万像素高），手机浏览器会顺势把滚动位置钳到别处。
     所以切换后立刻、逐帧、延时各钉一次，压过浏览器的自动调整 */
  function pinScroll(y) {
    var seq = ++pinSeq;
    function pin() { if (seq === pinSeq && Math.abs((window.scrollY || 0) - y) > 1) window.scrollTo(0, y); }
    pin();
    requestAnimationFrame(function () { pin(); requestAnimationFrame(pin); });
    setTimeout(pin, 90);
  }
  /* opts.top 回到页顶；opts.keepScroll 由调用方自己滚动；默认回到这个页签上次离开时的位置 */
  function switchTab(name, opts) {
    opts = opts || {};
    if (TABS.indexOf(name) < 0) name = "read";
    if (name !== curTab) {
      scrollMem[curTab] = window.scrollY || 0;
      closeDrawer(); hideSelBtn();
      curTab = name;
      $$(".tabs [role=tab]").forEach(function (b) {
        var on = b.getAttribute("data-tab") === name;
        b.setAttribute("aria-selected", on ? "true" : "false");
        b.tabIndex = on ? 0 : -1;
        if (on && b.scrollIntoView) b.scrollIntoView({ block: "nearest", inline: "nearest" });
      });
      TABS.forEach(function (n) {
        var p = $("panel-" + n);
        p.classList.toggle("on", n === name);
        p.hidden = n !== name;
      });
      placeDef(false);
      try { history.replaceState(null, "", "#" + name); } catch (e) {}
      if (opts.keepScroll) { pinSeq++; return; }
      pinScroll(opts.top ? 0 : (scrollMem[name] || 0));
      return;
    }
    if (opts.top) pinScroll(0);
  }
  $$(".tabs [role=tab]").forEach(function (b, i, all) {
    b.addEventListener("click", function () { switchTab(b.getAttribute("data-tab")); });
    b.addEventListener("keydown", function (e) {
      var d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      var next = all[(i + d + all.length) % all.length];
      next.focus(); next.click();
    });
  });
  window.addEventListener("hashchange", function () {
    var h = decodeURIComponent(location.hash.slice(1));
    if (TABS.indexOf(h) > -1) switchTab(h, { top: h === curTab });
  });

  /* ================= 阅读区 ================= */
  var passageBody = $("passageBody"), passageSrc = $("passageSrc");
  function tip(text) { return '<p class="passage-tip">' + text + "</p>"; }
  var H_MARK = "\uE000";   /* 段落开头带这个私用字符的，按小标题显示 */
  var doc = null;           /* 当前载入的文献 {paras, title, origin, len}；null 表示正在看示例 */
  function showSample() {
    doc = null;
    $("panel-read").classList.remove("is-reading");
    passageBody.innerHTML = $("tplSample").innerHTML
      + tip("试试看：点一个带底色的词；没有底色的词（比如「脂溶性」）可以划选，再点「查这个词」。");
    $$(".term", passageBody).forEach(function (el) {
      var t = exactTerm(el.getAttribute("data-term"));
      if (t && isMastered(t)) {                 /* 已掌握：拆掉标记，只留文字 */
        while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
        el.remove();
        return;
      }
      el.tabIndex = 0; el.setAttribute("role", "button");
    });
    passageSrc.innerHTML = "<b>示例文献</b> · 改写自 Meier 课题组 cycloSal 核苷酸前药系列的论述思路，用来练习查词";
    $("modeSample").setAttribute("aria-pressed", "true");
  }
  function setPasteOpen(open) {
    $("pasteBox").hidden = !open;
    $("modePaste").setAttribute("aria-pressed", open ? "true" : "false");
  }
  function setOcrOpen(open) {
    $("ocrBox").hidden = !open;
    $("modeOcr").setAttribute("aria-pressed", open ? "true" : "false");
  }
  function srcStatus(msg, isErr) {
    var el = $("srcStatus");
    el.textContent = msg || "";
    el.hidden = !msg;
    el.classList.toggle("err", !!isErr);
  }

  /* 逐行断开的文本合并成段：英文行尾连字符接回去，中文行之间不加空格 */
  function joinLines(lines) {
    var cur = "";
    lines.forEach(function (line) {
      var t = line.trim();
      if (!t) return;
      if (!cur) { cur = t; return; }
      if (/[A-Za-z]-$/.test(cur) && /^[a-z]/.test(t)) { cur = cur.slice(0, -1) + t; return; }
      var cjkEnd = /[一-鿿。；：、，）】」”]$/.test(cur), cjkStart = /^[一-鿿（【「“]/.test(t);
      cur += (cjkEnd || cjkStart) ? t : " " + t;
    });
    return cur;
  }
  /* 从 PDF 复制出来的文字每行都带硬换行：多数行没在句末结束、行长又接近，就当作一段 */
  function isHardWrapped(lines) {
    if (lines.length < 3) return false;
    var body = lines.slice(0, -1);
    var open = body.filter(function (l) { return !/[。.!?！？:：;；]["”’)）]?$/.test(l); }).length;
    var lens = body.map(function (l) { return l.length; }).sort(function (a, b) { return a - b; });
    return open / body.length >= 0.6 && lens[lens.length >> 1] >= 20;
  }
  function toParagraphs(raw, forceJoin) {
    var out = [];
    raw.split(/\n\s*\n/).forEach(function (block) {
      var lines = block.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
      if (!lines.length) return;
      if (forceJoin || isHardWrapped(lines)) out.push(joinLines(lines));
      else out.push.apply(out, lines);
    });
    return out;
  }

  /* Markdown → 纯文本：去掉标题 / 粗体 / 链接 / 表格等标记，保留段落 */
  function mdToText(md) {
    return md
      .replace(/```[\s\S]*?```/g, function (m) { return m.replace(/```/g, ""); })
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/^[ \t]*\|?[ \t:|-]+\|[ \t:|-]*$/gm, "")
      .replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, function (m, inner) { return inner.split("|").map(function (s) { return s.trim(); }).join(" · "); })
      .replace(/^#{1,6}\s+(.*)$/gm, "\n\n" + H_MARK + "$1\n\n")
      .replace(/^>\s?/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "· ")
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/~~(.+?)~~/g, "$1")
      .replace(/(\*|_)(.+?)\1/g, "$2")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/^\s*(-{3,}|\*{3,})\s*$/gm, "");
  }
  function looksLikeMarkdown(s) {
    if (!s) return false;
    if (/```/.test(s) || /\[[^\]]+\]\([^)]+\)/.test(s) || /!\[[^\]]*\]\([^)]+\)/.test(s)) return true;
    if (/(^|\n)\s{0,3}#{1,6}\s+\S/.test(s) || /\*\*[^*\n]+\*\*/.test(s) || /__[^_\n]+__/.test(s)) return true;
    if (/(^|\n)\s*\|[^\n]*\|/.test(s) && /(^|\n)[ \t]*\|?[ \t:|-]+\|/.test(s)) return true;
    var weak = 0;
    s.split("\n").forEach(function (line) {
      if (/^\s*([-*+]\s+|>\s+)/.test(line) || /`[^`\n]+`/.test(line)) weak++;
    });
    return weak >= 2;
  }

  /* 按当前的标词规则把 doc 画进阅读区；「已掌握」变了以后会再调一次 */
  function renderDoc() {
    var count = 0, html = doc.title ? "<h2>" + esc(doc.title) + "</h2>" : "";
    doc.paras.forEach(function (p) {
      if (p.charAt(0) === H_MARK) { html += "<h3>" + esc(p.slice(1)) + "</h3>"; return; }
      var r = highlight(p);
      count += r.count;
      html += "<p>" + r.html + "</p>";
    });
    passageBody.innerHTML = html + tip(count
      ? "带底色的词可以直接点。其他词划选后点「查这个词」；词库里没有的，会给出最接近的词条。"
      : "这段文字里没有标出词库收录的词。可以划选任意词语，再点「查这个词」试试。");
    var known = masteredList().length;
    passageSrc.innerHTML = "<b>" + esc(doc.title || "粘贴的文本") + "</b>"
      + (doc.origin ? " · " + esc(doc.origin) : "")
      + " · " + num(doc.len) + " 字 · 标出 " + num(count) + " 处基础词"
      + (known ? " · 已掌握的 " + known + " 个词不再标出" : "");
  }
  function rerenderPassage() { if (doc) renderDoc(); else showSample(); }
  function toggleMastered(term) {
    if (mastered[term.w]) delete mastered[term.w]; else mastered[term.w] = 1;
    store.set("mastered", masteredList());
    rerenderPassage();
    renderNotes();
    toast(mastered[term.w] ? "已标为掌握，正文里不再标出" : "已恢复标出");
    if (currentTerm === term) {
      var y = defCard.scrollTop;
      defBody.innerHTML = termHTML(term);
      defCard.scrollTop = y;
    }
  }

  /* 把一段文本载入阅读区。opts: title 标题, origin 来源说明, forceJoin 行一律并段（PDF）, markdown 按 Markdown 清理 */
  function loadText(raw, opts) {
    opts = opts || {};
    raw = String(raw || "").replace(/\r\n?/g, "\n").trim();
    if (opts.markdown || looksLikeMarkdown(raw)) raw = mdToText(raw).trim();
    if (raw.replace(/\s/g, "").length < 20) {
      srcStatus("内容太短了，至少放进一两句完整的话。", true);
      return false;
    }
    var truncated = raw.length > CONFIG.maxChars;
    if (truncated) raw = raw.slice(0, CONFIG.maxChars);
    doc = { paras: toParagraphs(raw, opts.forceJoin), title: opts.title || "", origin: opts.origin || "", len: raw.length };
    renderDoc();
    $("panel-read").classList.add("is-reading");
    $("modeSample").setAttribute("aria-pressed", "false");
    setPasteOpen(false);
    srcStatus(truncated ? "原文较长，只载入了前 " + num(CONFIG.maxChars) + " 字。读完这部分再载入后面的内容。" : "");
    if (shouldDock()) resetDef();
    hideSelBtn();
    pinSeq++;
    $("panel-read").querySelector(".source").scrollIntoView({ behavior: "smooth", block: "start" });
    return true;
  }

  $("modeSample").addEventListener("click", function () {
    setPasteOpen(false); setOcrOpen(false); srcStatus("");
    showSample();
    if (shouldDock()) resetDef();
  });
  $("modePaste").addEventListener("click", function () {
    var open = $("pasteBox").hidden;
    setPasteOpen(open); setOcrOpen(false);
    if (open) $("customText").focus({ preventScroll: true });
  });
  $("modeFile").addEventListener("click", function () { $("fileInput").click(); });
  $("modeOcr").addEventListener("click", function () {
    var open = $("ocrBox").hidden;
    setOcrOpen(open); setPasteOpen(false);
  });
  function updateCharCount() {
    var n = $("customText").value.trim().length;
    $("charCount").textContent = num(n) + " 字" + (n > CONFIG.maxChars ? "（超过 " + num(CONFIG.maxChars) + " 字的部分不会载入）" : "");
  }
  $("customText").addEventListener("input", updateCharCount);
  $("clearPaste").addEventListener("click", function () {
    $("customText").value = ""; $("customTitle").value = "";
    updateCharCount(); srcStatus("");
    $("customText").focus({ preventScroll: true });
  });
  $("loadCustom").addEventListener("click", function () {
    loadText($("customText").value, { title: $("customTitle").value.trim(), origin: "手动粘贴" });
  });
  /* 导入的文本同步进输入框，方便之后打开「粘贴文本」删改再读 */
  function fillPaste(text, title) {
    $("customText").value = text.slice(0, CONFIG.maxChars);
    $("customTitle").value = title || "";
    updateCharCount();
  }

  /* ---------- PDF：pdf.js 在本机逐页提取文字 ---------- */
  function loadPdfJs() {
    return loadScript(CONFIG.pdfjsBase + "pdf.min.js").then(function () {
      if (!window.pdfjsLib) throw new Error("script-load");
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = CONFIG.pdfjsBase + "pdf.worker.min.js";
      return window.pdfjsLib;
    });
  }
  /* 一页的文字块 → 带段落空行的文本。只把「紧挨着且同一基线」的块拼成一行，
     保持内容流的顺序——双栏论文的左右两栏不会因为基线相同而被搅在一起 */
  function pageItemsToText(items) {
    var rows = [];
    items.forEach(function (it) {
      if (!it.str) return;
      var y = Math.round(it.transform[5]), last = rows[rows.length - 1];
      if (last && Math.abs(last.y - y) <= 2) last.parts.push(it.str);
      else rows.push({ y: y, parts: [it.str] });
    });
    var gaps = [];
    for (var i = 1; i < rows.length; i++) { var d = rows[i - 1].y - rows[i].y; if (d > 0) gaps.push(d); }
    gaps.sort(function (a, b) { return a - b; });
    var lineGap = gaps.length ? gaps[gaps.length >> 1] : 0;
    var out = [];
    rows.forEach(function (r, k) {
      if (k > 0) {
        var dy = rows[k - 1].y - r.y;
        if (dy < 0 || (lineGap && dy > lineGap * 1.45)) out.push("");   /* 换栏，或行距明显变大：新段落 */
      }
      out.push(r.parts.join(" ").replace(/\s+/g, " ").trim());
    });
    return out.join("\n");
  }
  function pdfToText(buf) {
    return loadPdfJs().then(function (lib) {
      return lib.getDocument({ data: buf }).promise;
    }).then(function (pdf) {
      var pages = [], chain = Promise.resolve();
      for (var p = 1; p <= pdf.numPages; p++) {
        (function (pno) {
          chain = chain.then(function () { return pdf.getPage(pno); })
            .then(function (page) { return page.getTextContent(); })
            .then(function (tc) { pages.push(pageItemsToText(tc.items)); });
        })(p);
      }
      return chain.then(function () { return { text: pages.join("\n\n"), total: pdf.numPages }; });
    });
  }
  function importFile(f) {
    if (!f) return;
    var title = f.name.replace(/\.(txt|md|markdown|pdf)$/i, "");
    var isPdf = /\.pdf$/i.test(f.name) || f.type === "application/pdf";
    var isMd = /\.(md|markdown)$/i.test(f.name);
    if (/^image\//.test(f.type) || /\.(png|jpe?g|webp)$/i.test(f.name)) {      /* 图片只能走 OCR */
      setPasteOpen(false); setOcrOpen(true);
      setOcrFile(null, f, f.name, 0);
      ocrStatus("已选好图片，点「开始识别」。");
      srcStatus("图片要先做文字识别，已为你打开识别面板。");
      return;
    }
    if (!isPdf && !isMd && !/\.txt$/i.test(f.name) && !/^text\//.test(f.type)) {
      srcStatus("暂时读不了这种文件。支持 .txt、.md、.pdf 和图片；Word 文档可以把文字复制出来粘贴。", true);
      return;
    }
    var reader = new FileReader();
    reader.onerror = function () { srcStatus("这个文件读不出来。换一个文件，或直接粘贴文本。", true); };
    if (!isPdf) {
      reader.onload = function () {
        var text = String(reader.result || "");
        fillPaste(text, title);
        loadText(text, { title: title, origin: f.name, markdown: isMd });
      };
      reader.readAsText(f);
      return;
    }
    setOcrOpen(false);
    srcStatus("正在本机提取 PDF 文字，页数多时会慢一些…");
    reader.onload = function () {
      var kept = reader.result.slice(0);          /* pdf.js 会接管传入的缓冲，留一份给 OCR 用 */
      pdfToText(new Uint8Array(reader.result)).then(function (r) {
        if (r.text.replace(/\s/g, "").length < 20) { offerOcr(kept, f.name, r.total); return; }
        fillPaste(r.text, title);
        loadText(r.text, { title: title, origin: f.name + "，共 " + r.total + " 页", forceJoin: true });
      }, function (err) {
        srcStatus(err && err.message === "script-load"
          ? "PDF 组件没有加载成功，它需要联网下载一次。请检查网络后重试，或直接粘贴文本。"
          : "这个 PDF 打不开，可能已损坏或设了密码。换一个试试，或直接粘贴文本。", true);
      });
    };
    reader.readAsArrayBuffer(f);
  }
  $("fileInput").addEventListener("change", function () {
    var f = this.files && this.files[0];
    this.value = "";
    importFile(f);
  });
  /* 把文件直接拖进页面 */
  var dragDepth = 0;
  function hasFiles(e) { return !!e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") > -1; }
  function endDrag() { dragDepth = 0; document.body.classList.remove("dragging"); }
  document.addEventListener("dragenter", function (e) { if (hasFiles(e)) { dragDepth++; document.body.classList.add("dragging"); } });
  document.addEventListener("dragleave", function (e) { if (hasFiles(e) && --dragDepth <= 0) endDrag(); });
  document.addEventListener("dragover", function (e) { if (hasFiles(e)) e.preventDefault(); });
  document.addEventListener("drop", function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault(); endDrag();
    switchTab("read", { top: true });
    importFile(e.dataTransfer.files[0]);
  });

  /* ---------- OCR：只给扫描件兜底，引擎按需加载 ---------- */
  var ocr = { pdfBuf: null, image: null, name: "", running: false, worker: null, lastMd: "", lastTitle: "" };
  function ocrStatus(html, isErr) { var el = $("ocrStatus"); el.innerHTML = html; el.classList.toggle("err", !!isErr); }
  function ocrProgress(frac) {
    $("ocrBar").hidden = frac == null;
    $("ocrBarFill").style.width = Math.round(Math.max(0, Math.min(1, frac || 0)) * 100) + "%";
  }
  function armOcr() {
    $("ocrStart").disabled = !(ocr.pdfBuf || ocr.image) || ocr.running;
    $("ocrCancel").hidden = !ocr.running;
  }
  function setOcrFile(pdfBuf, image, name, pages) {
    ocr.pdfBuf = pdfBuf; ocr.image = image; ocr.name = name;
    $("ocrFileName").textContent = name + (pages ? "（共 " + pages + " 页）" : "");
    armOcr();
  }
  /* 普通导入提不出文字时，自动转到 OCR */
  function offerOcr(buf, name, pages) {
    setPasteOpen(false); setOcrOpen(true);
    setOcrFile(buf, null, name, pages);
    srcStatus("这个 PDF 没有文字层，应该是扫描件。已为你打开 OCR，点「开始识别」即可。");
    ocrStatus("<b>已带入 " + esc(name) + "。</b>中英混排选「中文 + 英文」，纯英文选「仅英文」会更快。");
    $("ocrBox").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  $("ocrPick").addEventListener("click", function () { $("ocrFileInput").click(); });
  $("ocrFileInput").addEventListener("change", function () {
    var f = this.files && this.files[0];
    this.value = "";
    if (!f) return;
    if (/\.pdf$/i.test(f.name) || f.type === "application/pdf") {
      var r = new FileReader();
      r.onload = function () { setOcrFile(r.result, null, f.name, 0); ocrStatus("已选好文件，点「开始识别」。"); };
      r.onerror = function () { ocrStatus("这个文件读不出来，换一个试试。", true); };
      r.readAsArrayBuffer(f);
    } else {
      setOcrFile(null, f, f.name, 0);
      ocrStatus("已选好图片，点「开始识别」。");
    }
  });
  /* 每页的识别结果先并段；多页时按页分节 */
  function ocrPages(pageTexts) {
    return pageTexts.map(function (txt) {
      return toParagraphs(String(txt || "").replace(/\r\n?/g, "\n"), true).join("\n\n");
    });
  }
  function ocrToMarkdown(title, pages) {
    return ("# " + title + "\n" + pages.map(function (txt, i) {
      return "\n" + (pages.length > 1 ? "## 第 " + (i + 1) + " 页\n\n" : "") + txt + "\n";
    }).join("")).trim() + "\n";
  }
  function renderPdfPage(pdf, pno) {
    return pdf.getPage(pno).then(function (page) {
      var viewport = page.getViewport({ scale: 2 });
      var canvas = document.createElement("canvas");
      canvas.width = viewport.width; canvas.height = viewport.height;
      var ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () {
        var url = canvas.toDataURL("image/png");
        canvas.width = 0; canvas.height = 0;
        return url;
      });
    });
  }
  function killOcrWorker() {
    var w = ocr.worker; ocr.worker = null;
    if (w) w.terminate().catch(function () {});
  }
  $("ocrCancel").addEventListener("click", function () {
    ocr.running = false; killOcrWorker(); armOcr(); ocrProgress(null);
    ocrStatus("已取消。可以重新开始，或换一个文件。");
  });
  $("ocrDownload").addEventListener("click", function () {
    if (ocr.lastMd) download((ocr.lastTitle || "ocr-result") + ".md", ocr.lastMd, "text/markdown;charset=utf-8");
  });
  $("ocrStart").addEventListener("click", function () {
    if (ocr.running || !(ocr.pdfBuf || ocr.image)) return;
    ocr.running = true; armOcr();
    $("ocrDownload").hidden = true;
    ocrProgress(0);
    var lang = $("ocrLang").value;
    var maxPages = Math.min(parseInt($("ocrPages").value, 10) || 5, CONFIG.ocrMaxPages);
    var title = ocr.name.replace(/\.(pdf|png|jpe?g|webp)$/i, "") || "OCR 识别结果";
    var pageTotal = 1, pageDone = 0, skipped = 0;
    ocrStatus("正在加载识别引擎和语言包，第一次会慢一些…");
    var needPdf = ocr.pdfBuf ? loadPdfJs() : Promise.resolve();
    Promise.all([loadScript(CONFIG.tesseractSrc), needPdf]).then(function () {
      if (!window.Tesseract) throw new Error("script-load");
      return window.Tesseract.createWorker(lang, 1, {
        logger: function (m) {
          if (!m || m.status !== "recognizing text") return;
          ocrProgress((pageDone + (m.progress || 0)) / pageTotal);
          ocrStatus("正在识别第 <b>" + (pageDone + 1) + " / " + pageTotal + "</b> 页 · " + Math.round((m.progress || 0) * 100) + "%");
        }
      });
    }).then(function (worker) {
      if (!ocr.running) { worker.terminate().catch(function () {}); throw new Error("cancelled"); }
      ocr.worker = worker;
      if (ocr.image) return worker.recognize(ocr.image).then(function (res) { return [res.data.text]; });
      return window.pdfjsLib.getDocument({ data: ocr.pdfBuf.slice(0) }).promise.then(function (pdf) {
        pageTotal = Math.min(pdf.numPages, maxPages);
        skipped = pdf.numPages - pageTotal;
        var texts = [], chain = Promise.resolve();
        for (var p = 1; p <= pageTotal; p++) {
          (function (pno) {
            chain = chain.then(function () {
              if (!ocr.running) throw new Error("cancelled");
              return renderPdfPage(pdf, pno);
            }).then(function (img) { return worker.recognize(img); })
              .then(function (res) { texts.push(res.data.text); pageDone = pno; ocrProgress(pageDone / pageTotal); });
          })(p);
        }
        return chain.then(function () { return texts; });
      });
    }).then(function (pageTexts) {
      ocr.running = false; killOcrWorker(); armOcr();
      if (pageTexts.join("").replace(/\s/g, "").length < 20) {
        ocrProgress(null);
        ocrStatus("<b>几乎没有识别出文字。</b>可能是扫描太模糊、字太小，或者是手写内容。换一种识别语言、换更清晰的扫描件，或直接粘贴文本。", true);
        return;
      }
      var pages = ocrPages(pageTexts);
      var md = ocrToMarkdown(title, pages);
      ocr.lastMd = md; ocr.lastTitle = title;
      $("ocrDownload").hidden = false;
      ocrProgress(1);
      ocrStatus("<b>识别完成，已载入阅读区。</b>" + (skipped > 0 ? "这份 PDF 还有 " + skipped + " 页没有识别。" : "")
        + "OCR 难免有错字，关键数字、剂量和术语请对照原文。");
      fillPaste(md, title);
      var readerText = pages.length > 1
        ? pages.map(function (txt, i) { return H_MARK + "第 " + (i + 1) + " 页\n\n" + txt; }).join("\n\n")
        : pages[0];
      loadText(readerText, { title: title, origin: "OCR 识别 · " + ocr.name + (ocr.image ? "" : "，" + pageTexts.length + " 页") });
    }).catch(function (err) {
      ocr.running = false; killOcrWorker(); armOcr(); ocrProgress(null);
      if (err && err.message === "cancelled") return;
      ocrStatus("<b>识别没有成功。</b>多半是网络不通，识别引擎或语言包没有下载下来。请检查网络后重试，或直接粘贴文本。", true);
    });
  });

  /* ---------- 正文里点词 / 划词 ---------- */
  function markCurrent(el) {
    $$(".term.cur", passageBody).forEach(function (x) { x.classList.remove("cur"); });
    if (el) el.classList.add("cur");
  }
  passageBody.addEventListener("click", function (e) {
    var el = e.target.closest(".term");
    if (!el) return;
    var sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim().length > el.textContent.length) return;   /* 正在划选更长的内容 */
    var t = exactTerm(el.getAttribute("data-term")) || findTerm(el.getAttribute("data-term"));
    if (t) { markCurrent(el); showTerm(t, true); }
  });
  passageBody.addEventListener("keydown", function (e) {
    if ((e.key === "Enter" || e.key === " ") && e.target.classList && e.target.classList.contains("term")) {
      e.preventDefault(); e.target.click();
    }
  });

  var selBtn = $("selBtn"), pendingText = "", selTimer = 0;
  function hideSelBtn() { selBtn.hidden = true; }
  function onSelection() {
    var sel = window.getSelection();
    if (curTab !== "read" || !sel || sel.rangeCount === 0 || sel.isCollapsed) { hideSelBtn(); return; }
    var text = sel.toString().replace(/\s+/g, " ").trim();
    if (!text || text.length > 80) { hideSelBtn(); return; }
    var range = sel.getRangeAt(0);
    /* 拖选时终点常会滑出阅读区：起点、终点或公共祖先有一处在正文里就算数 */
    if (!(passageBody.contains(range.startContainer) || passageBody.contains(range.endContainer) || passageBody.contains(range.commonAncestorContainer))) { hideSelBtn(); return; }
    var rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) { hideSelBtn(); return; }
    pendingText = text;
    selBtn.style.left = Math.max(64, Math.min(window.innerWidth - 64, rect.left + rect.width / 2)) + "px";
    /* 选区贴着顶栏时，按钮改到选区下方，免得被顶栏盖住 */
    var above = rect.top > 110 && !window.matchMedia("(pointer: coarse)").matches;
    selBtn.style.top = (above ? rect.top : rect.bottom) + "px";
    selBtn.style.transform = above ? "translate(-50%, -125%)" : "translate(-50%, 25%)";
    selBtn.hidden = false;
  }
  document.addEventListener("selectionchange", function () { clearTimeout(selTimer); selTimer = setTimeout(onSelection, 60); });
  /* 只靠 selectionchange，鼠标拖选收尾的那一下有时不触发：松手时再补检两次 */
  ["mouseup", "touchend"].forEach(function (ev) {
    document.addEventListener(ev, function () { setTimeout(onSelection, 10); setTimeout(onSelection, 120); }, { passive: true });
  });
  selBtn.addEventListener("mousedown", function (e) { e.preventDefault(); });   /* 按下时别让浏览器清掉选区 */
  selBtn.addEventListener("click", function () {
    hideSelBtn(); markCurrent(null);
    lookup(pendingText);
    var sel = window.getSelection();
    if (sel) sel.removeAllRanges();
  });
  document.addEventListener("pointerdown", function (e) {
    if (e.target === selBtn || passageBody.contains(e.target)) return;
    hideSelBtn();
  });
  window.addEventListener("scroll", function () { if (!selBtn.hidden) onSelection(); }, { passive: true });

  /* ---------- 阅读排版 ---------- */
  var SIZES = [15.5, 17.5, 19.5, 21.5, 23.5];
  var read = store.get("read", null) || { size: 1, loose: false, sans: false };
  function applyRead() {
    var p = $("passage").style;
    read.size = Math.max(0, Math.min(SIZES.length - 1, read.size | 0));
    p.setProperty("--read-size", SIZES[read.size] + "px");
    p.setProperty("--read-lh", read.loose ? "2.3" : "1.95");
    p.setProperty("--read-font", read.sans ? "var(--font-ui)" : "var(--font-read-serif)");
    $("fontDown").disabled = read.size === 0;
    $("fontUp").disabled = read.size === SIZES.length - 1;
    $("leadingBtn").setAttribute("aria-pressed", read.loose ? "true" : "false");
    $("faceBtn").setAttribute("aria-pressed", read.sans ? "true" : "false");
    store.set("read", read);
  }
  $("fontDown").addEventListener("click", function () { read.size--; applyRead(); });
  $("fontUp").addEventListener("click", function () { read.size++; applyRead(); });
  $("leadingBtn").addEventListener("click", function () { read.loose = !read.loose; applyRead(); });
  $("faceBtn").addEventListener("click", function () { read.sans = !read.sans; applyRead(); });

  /* ================= 逻辑链 ================= */
  /* 一环的展开说明，后面跟上这一环提到的词条，点了直接看解释 */
  function nodeNoteHTML(n) {
    var seen = [];
    scan(n.t + "。" + n.d + "。" + n.n, true).forEach(function (h) {
      if (seen.indexOf(h.term) < 0 && seen.length < 6) seen.push(h.term);
    });
    return "<b>" + esc(n.t) + "：</b>" + esc(n.n)
      + (seen.length ? '<span class="note-terms"><span>相关词条</span>' + seen.map(function (t) { return nodeBtn(t); }).join("") + "</span>" : "");
  }
  function renderChains() {
    $("chainList").innerHTML = CHAINS.map(function (c, ci) {
      var parts = String(c.title).split(/\s*·\s*/);
      var kicker = parts.length > 1 ? parts.shift() : "";
      var nodes = c.nodes.map(function (n, ni) {
        return (ni > 0 ? '<span class="farr" aria-hidden="true">→</span>' : "")
          + '<button type="button" class="fnode" aria-pressed="' + (ni === 0) + '" data-chain="' + ci + '" data-node="' + ni + '"><b>'
          + esc(n.t) + "</b><span>" + esc(n.d) + "</span></button>";
      }).join("");
      return '<article class="chain-card" id="chainCard' + ci + '">'
        + (kicker ? '<p class="chain-kicker">' + esc(kicker) + "</p>" : "")
        + "<h2>" + esc(parts.join(" · ")) + '</h2><p class="chain-q">' + esc(c.q) + "</p>"
        + '<div class="flow">' + nodes + "</div>"
        + '<p class="flow-note" id="flowNote' + ci + '" aria-live="polite">' + nodeNoteHTML(c.nodes[0]) + "</p></article>";
    }).join("");
  }
  function selectChainNode(ci, ni) {
    var card = $("chainCard" + ci), n = CHAINS[ci].nodes[ni];
    if (!card || !n) return;
    $$(".fnode", card).forEach(function (b) { b.setAttribute("aria-pressed", +b.getAttribute("data-node") === ni ? "true" : "false"); });
    $("flowNote" + ci).innerHTML = nodeNoteHTML(n);
  }
  $("chainList").addEventListener("click", function (e) {
    var chip = e.target.closest("[data-lookup]");
    if (chip) { var ct = exactTerm(chip.getAttribute("data-lookup")); if (ct) showTerm(ct, true); return; }
    var b = e.target.closest(".fnode");
    if (b) selectChainNode(+b.getAttribute("data-chain"), +b.getAttribute("data-node"));
  });

  /* 「在逻辑链中查看」：定位到这个词所在的链并点亮对应节点。
     匹配顺序：节点标题精确 / 包含 → 节点说明里出现 → 逻辑位置里相邻词所在的链 → 按分类兜底 */
  var CAT_CHAIN = { "前药策略": 0, "数据指标": 1, "药物化学": 4, "药理学": 5, "药物分析": 6, "抗病毒核苷": 7, "分子基础": 8 };
  function termKeys(term) {
    var keys = [term.w].concat(aliasesOf(term));
    matchers.forEach(function (m) { if (m.term === term && keys.indexOf(m.txt) < 0) keys.push(m.txt); });
    return keys;
  }
  function chainNodeHit(node, keys) {
    var hay = node.t + " " + node.d + " " + node.n, best = 0;
    keys.forEach(function (k) {
      if (!k || k.length < 2) return;
      var s = node.t === k ? 3 : (node.t.indexOf(k) > -1 || k.indexOf(node.t) > -1) ? 2 : hay.indexOf(k) > -1 ? 1 : 0;
      if (s > best) best = s;
    });
    return best;
  }
  function bestChainHit(keys) {
    var best = null;
    CHAINS.forEach(function (c, ci) {
      c.nodes.forEach(function (n, ni) {
        var s = chainNodeHit(n, keys);
        if (s && (!best || s > best.score)) best = { ci: ci, ni: ni, score: s };
      });
    });
    return best;
  }
  function chainFor(term) {
    var best = bestChainHit(termKeys(term));
    for (var i = 0; !best && term.chain && i < term.chain.length; i++) {
      var linked = exactTerm(term.chain[i]);
      if (linked && linked !== term) best = bestChainHit(termKeys(linked));
    }
    if (!best && Object.prototype.hasOwnProperty.call(CAT_CHAIN, term.cat) && CHAINS[CAT_CHAIN[term.cat]]) best = { ci: CAT_CHAIN[term.cat], ni: -1 };
    return best;
  }
  function gotoChainForTerm(term) {
    var hit = chainFor(term);
    if (!hit) return;
    switchTab("chain", { keepScroll: true });
    setTimeout(function () {
      var card = $("chainCard" + hit.ci);
      if (!card) return;
      if (hit.ni >= 0) selectChainNode(hit.ci, hit.ni);
      card.scrollIntoView({ behavior: "smooth", block: "start" });
      card.classList.add("focus");
      setTimeout(function () { card.classList.remove("focus"); }, 2600);
    }, 60);
  }

  /* ================= 术语库 ================= */
  var curCat = "全部";
  var FIG_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m4 16 4.5-4.5 4 4 2.5-2.5 5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  function chipsHTML(cats, counts, total, cur) {
    return ["全部"].concat(cats).map(function (c) {
      return '<button type="button" data-cat="' + esc(c) + '" aria-pressed="' + (c === cur) + '">' + esc(c)
        + '<span class="n">' + (c === "全部" ? total : counts[c]) + "</span></button>";
    }).join("");
  }
  function renderLibChips() {
    var counts = {};
    KB.forEach(function (t) { counts[t.cat] = (counts[t.cat] || 0) + 1; });
    $("libChips").innerHTML = chipsHTML(sortCats(Object.keys(counts)), counts, KB.length, curCat);
  }
  function markHit(text, rawQ) {
    var at = rawQ ? text.toLowerCase().indexOf(rawQ.toLowerCase()) : -1;
    if (at < 0) return esc(text);
    return esc(text.slice(0, at)) + "<mark>" + esc(text.substr(at, rawQ.length)) + "</mark>" + esc(text.slice(at + rawQ.length));
  }
  function renderLib() {
    var rawQ = $("libSearch").value.trim(), q = norm(rawQ), rows = [];
    KB.forEach(function (t, i) {
      if (curCat !== "全部" && t.cat !== curCat) return;
      var rank = 0;
      if (q) {
        if (NAME[i] === q) rank = 0;
        else if (NAME[i].indexOf(q) === 0) rank = 1;
        else if (NAME[i].indexOf(q) > -1) rank = 2;
        else if (EN[i].indexOf(q) > -1 || norm(t.alias).indexOf(q) > -1) rank = 3;
        else if (norm(t.def).indexOf(q) > -1 || norm(t.plain).indexOf(q) > -1) rank = 4;
        else return;
      }
      rows.push([rank, i, t]);
    });
    if (q) rows.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    $("libGrid").innerHTML = rows.map(function (r) {
      var t = r[2];
      return '<button type="button" class="lib-card" data-w="' + esc(t.w) + '">'
        + '<span class="w">' + markHit(t.w, rawQ) + '</span><span class="e">' + markHit(t.en, rawQ) + "</span>"
        + '<span class="d">' + esc(t.def) + "</span>"
        + '<span class="foot">' + catTag(t.cat) + (t.fig ? '<span class="figmark">' + FIG_ICON + "有配图</span>" : "") + "</span></button>";
    }).join("");
    $("libCount").textContent = (q || curCat !== "全部" ? "找到 " : "共 ") + num(rows.length) + " 条";
    $("libNone").hidden = rows.length > 0;
  }
  var libTimer = 0;
  $("libSearch").addEventListener("input", function () { clearTimeout(libTimer); libTimer = setTimeout(renderLib, 120); });
  $("libChips").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-cat]");
    if (!b) return;
    curCat = b.getAttribute("data-cat");
    $$("button", $("libChips")).forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
    var y = window.scrollY || 0;
    renderLib();
    pinScroll(Math.min(y, Math.max(0, document.documentElement.scrollHeight - window.innerHeight)));
  });
  $("libGrid").addEventListener("click", function (e) {
    var card = e.target.closest(".lib-card");
    var t = card && exactTerm(card.getAttribute("data-w"));
    if (t) showTerm(t, true);
  });
  function setDensity(compact) {
    $("libGrid").classList.toggle("compact", compact);
    $("densComfy").setAttribute("aria-pressed", compact ? "false" : "true");
    $("densCompact").setAttribute("aria-pressed", compact ? "true" : "false");
    store.set("compact", compact);
  }
  $("densComfy").addEventListener("click", function () { setDensity(false); });
  $("densCompact").addEventListener("click", function () { setDensity(true); });

  /* ================= 生词本 ================= */
  function saveNotes() { store.set("notes", notes); }
  function toggleNote(term) {
    var i = notes.indexOf(term.w);
    if (i > -1) { notes.splice(i, 1); toast("已移出生词本"); }
    else { notes.push(term.w); toast("已加入生词本"); }
    saveNotes(); renderNotes();
    if (currentTerm === term) {
      var y = defCard.scrollTop;
      defBody.innerHTML = termHTML(term);
      defCard.scrollTop = y;
    }
  }
  function noteTerms() { return notes.map(exactTerm).filter(Boolean); }
  var quiz = false;     /* 自测：先把解释藏起来，自己想一遍再点开 */
  function renderNotes() {
    var list = noteTerms(), badge = $("noteCount");
    badge.hidden = !list.length; badge.textContent = list.length;
    $("noteActions").hidden = !list.length;
    $("noteBarText").textContent = list.length
      ? "共 " + list.length + " 个生词，保存在这台设备的浏览器里。复习时先自己复述一遍，再点开核对。"
      : "读文献时遇到的生词收在这里，方便读完集中复习。";
    $("noteList").innerHTML = list.length ? list.map(function (t) {
      return '<div class="note-item"><button type="button" class="open" data-w="' + esc(t.w) + '">'
        + '<span class="w">' + esc(t.w) + '</span><span class="e">' + esc(t.en) + "</span>"
        + (quiz ? '<span class="d quiz-hidden" data-hidden>先自己说一遍，再点这里看解释</span>' : '<span class="d">' + esc(t.plain) + "</span>") + "</button>"
        + '<button type="button" class="icon-btn del" data-del="' + esc(t.w) + '" aria-label="移出生词本：' + esc(t.w) + '" title="移出生词本">'
        + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></div>';
    }).join("") : '<p class="note-empty">生词本还是空的。<br />查词时点「加入生词本」，词条就会出现在这里。</p>';
    $("quizNotes").setAttribute("aria-pressed", quiz ? "true" : "false");
    var known = masteredList().map(exactTerm).filter(Boolean), box = $("masteredBox");
    box.hidden = !known.length;
    box.innerHTML = known.length
      ? "<h2>已掌握 · " + known.length + ' 个</h2><p class="muted small">这些词在正文里不再自动加底色。点一个，恢复标出。</p><div class="def-chain">'
        + known.map(function (t) { return '<button type="button" class="node" data-restore="' + esc(t.w) + '">' + esc(t.w) + " ✕</button>"; }).join("") + "</div>"
      : "";
  }
  $("masteredBox").addEventListener("click", function (e) {
    var b = e.target.closest("[data-restore]"), t = b && exactTerm(b.getAttribute("data-restore"));
    if (t) toggleMastered(t);
  });
  $("quizNotes").addEventListener("click", function () { quiz = !quiz; renderNotes(); });
  $("ankiNotes").addEventListener("click", function () {
    /* Anki 的「导入文件」认制表符分隔的文本：正面 <Tab> 背面，背面允许 HTML */
    var flat = function (x) { return esc(String(x || "").replace(/[\t\r\n]+/g, " ")); };
    var tsv = noteTerms().map(function (t) {
      return flat(t.w + "（" + t.en + "）") + "\t" + flat(t.plain) + "<br><br>" + flat(t.def)
        + (t.trap ? "<br><br>常见误解：" + flat(t.trap) : "");
    }).join("\n") + "\n";
    download("生词本-anki.txt", tsv, "text/plain;charset=utf-8");
    toast("已导出。在 Anki 里用「导入文件」，并勾选允许 HTML");
  });
  $("noteList").addEventListener("click", function (e) {
    var del = e.target.closest("[data-del]"), open = e.target.closest(".open");
    var t = del ? exactTerm(del.getAttribute("data-del")) : open ? exactTerm(open.getAttribute("data-w")) : null;
    if (!t) return;
    if (del) { toggleNote(t); return; }
    var hidden = open.querySelector("[data-hidden]");
    if (hidden) {                              /* 自测时第一下只揭晓解释，第二下才打开词条 */
      hidden.textContent = t.plain;
      hidden.removeAttribute("data-hidden"); hidden.classList.remove("quiz-hidden");
      return;
    }
    showTerm(t, true);
  });
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy") ? resolve() : reject(); } catch (e) { reject(e); }
      ta.remove();
    });
  }
  function download(name, text, type) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: type }));
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }
  $("copyNotes").addEventListener("click", function () {
    var text = noteTerms().map(function (t) { return t.w + "（" + t.en + "）：" + t.plain; }).join("\n");
    copyText(text).then(function () { toast("已复制 " + notes.length + " 个生词"); }, function () { toast("复制失败，请手动选择文字复制"); });
  });
  $("exportNotes").addEventListener("click", function () {
    var md = "# 生词本\n\n" + noteTerms().map(function (t) {
      return "## " + t.w + "（" + t.en + "）\n\n- 一句话：" + t.plain + "\n- 定义：" + t.def + "\n- 为什么重要：" + t.use
        + (t.trap ? "\n- 常见误解：" + t.trap : "") + "\n";
    }).join("\n");
    download("生词本.md", md, "text/markdown;charset=utf-8");
  });
  $("clearNotes").addEventListener("click", function () {
    if (!window.confirm("确定清空生词本里的 " + notes.length + " 个词吗？这个操作无法撤销。")) return;
    notes = []; saveNotes(); renderNotes();
    if (currentTerm) defBody.innerHTML = termHTML(currentTerm);
  });

  /* ================= 实验速查 ================= */
  /* 第五维在数据里叫「安全性」，但分数越高越危险，界面上改叫「安全风险」以免读反 */
  var EXP_AXES = ["实验难度", "产率影响", "经费", "耗时", "安全风险"];
  var EXP_AXES_SHORT = ["难度", "产率", "经费", "耗时", "风险"];
  var EXP_COLORS = ["var(--c-blue)", "var(--warn)", "var(--c-green)"];
  var EXP_NOTE = "每根轴从中心 0 分到外圈 5 分，分数越高越费劲；「安全风险」越高，风险越大。评分是编者的主观印象，没有统一细则，也不是论文数据。";
  /* 从评分依据里摘出这篇论文涉及的具体危害（数据里有三种写法） */
  function hazardOf(e) {
    var s = String(e.scoreText || "");
    var m = /安全依据：([^）]*)/.exec(s) || /安全性\s*\d\s*\/\s*5[，。]\s*([^；]*)/.exec(s);
    return m ? m[1].replace(/[。\s]+$/, "") : "";
  }
  var expCat = "全部", cmpSel = [], expListY = 0;
  function score(v) { return v == null ? "—" : v; }
  function radarSVG(list, size) {
    var cx = size / 2, cy = size / 2, R = size / 2 - 56;
    function pt(i, v) {
      var a = (-90 + i * 72) * Math.PI / 180;
      return [(cx + R * (v / 5) * Math.cos(a)).toFixed(1), (cy + R * (v / 5) * Math.sin(a)).toFixed(1)];
    }
    var s = '<svg viewBox="0 0 ' + size + " " + size + '" role="img" aria-label="五维雷达图">';
    for (var ring = 1; ring <= 5; ring++) {
      s += '<polygon points="' + EXP_AXES.map(function (_, i) { return pt(i, ring).join(","); }).join(" ") + '" fill="none" stroke="var(--line)" stroke-width="1"/>';
    }
    EXP_AXES.forEach(function (ax, i) {
      var e = pt(i, 5), l = pt(i, 6.15);
      s += '<line x1="' + cx + '" y1="' + cy + '" x2="' + e[0] + '" y2="' + e[1] + '" stroke="var(--line)"/>'
        + '<text x="' + l[0] + '" y="' + l[1] + '" font-size="13" font-weight="600" fill="var(--ink-2)" text-anchor="middle" dominant-baseline="middle">' + ax + "</text>";
    });
    list.forEach(function (d) {
      s += '<polygon points="' + d.scores.map(function (v, i) { return pt(i, v || 0).join(","); }).join(" ")
        + '" fill="' + d.color + '" fill-opacity="0.14" stroke="' + d.color + '" stroke-width="2" stroke-linejoin="round"/>';
      d.scores.forEach(function (v, i) { var p = pt(i, v || 0); s += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3.2" fill="' + d.color + '"/>'; });
    });
    return s + "</svg>";
  }
  function scoreTable(e) {
    return '<table class="score-table"><thead><tr><th>维度</th><th class="num">评分</th></tr></thead><tbody>' + EXP_AXES.map(function (ax, i) {
      return "<tr><td>" + ax + '</td><td class="num">' + score(e.scores[i]) + " <span>/ 5</span></td></tr>";
    }).join("") + "</tbody></table>";
  }
  function expSec(title, inner) { return '<section class="exp-sec"><h2>' + title + "</h2>" + inner + "</section>"; }
  function listOrPara(txt) {
    if (!txt) return "<p>论文未给出</p>";
    if (txt.indexOf("；") > -1) {
      return "<ul>" + txt.split("；").map(function (x) { return "<li>" + esc(x.replace(/。$/, "")) + "</li>"; }).join("") + "</ul>";
    }
    return "<p>" + esc(txt) + "</p>";
  }
  function expCats() {
    var seen = [];
    EXPS.forEach(function (e) { if (seen.indexOf(e.cat) < 0) seen.push(e.cat); });
    return seen;
  }
  function renderExpChips() {
    var counts = {};
    EXPS.forEach(function (e) { counts[e.cat] = (counts[e.cat] || 0) + 1; });
    $("expChips").innerHTML = chipsHTML(expCats(), counts, EXPS.length, expCat);
  }
  function renderCmpBar() {
    $("expCmpNames").textContent = cmpSel.length ? cmpSel.join("、") + (cmpSel.length < 2 ? "（再选 1 个就能对比）" : "") : "选 2–3 个实验，叠在一张雷达图上比较";
    $("expCmpGo").disabled = cmpSel.length < 2;
    $("expCmpClear").hidden = !cmpSel.length;
  }
  function renderExpList() {
    var html = "";
    EXPS.forEach(function (e, idx) {
      if (expCat !== "全部" && e.cat !== expCat) return;
      var inCmp = cmpSel.indexOf(e.name) > -1;
      html += '<article class="exp-card">'
        + '<button type="button" class="nm" data-exp="' + idx + '"><span class="w">' + esc(e.name) + '</span><span class="e">' + esc(e.en) + "</span></button>"
        + '<p class="u">' + esc(e.use) + "</p>"
        + '<div class="meters" aria-label="编者印象分">' + EXP_AXES_SHORT.map(function (ax, i) {
          return '<span class="meter' + (i === 4 ? " risk" : "") + '" title="' + EXP_AXES[i] + " " + score(e.scores[i]) + ' / 5">' + ax + " " + score(e.scores[i])
            + '<i style="--v:' + (e.scores[i] || 0) + '"></i></span>';
        }).join("") + "</div>"
        + '<div class="rowb"><button type="button" class="btn" data-exp="' + idx + '">查看详情</button>'
        + '<button type="button" class="btn cmp" data-cmp="' + idx + '" aria-pressed="' + inCmp + '">' + (inCmp ? "✓ 已加入对比" : "加入对比") + "</button></div></article>";
    });
    $("expGrid").innerHTML = html || '<p class="empty-line">这一类还没有实验。</p>';
  }
  function showExpView(which) {
    $("expListView").hidden = which !== "list";
    $("expDetail").hidden = which !== "detail";
    $("expCmpView").hidden = which !== "cmp";
  }
  var BACK_BTN = '<button type="button" class="btn ghost back" data-back><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6 8.5 12l6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>返回列表</button>';
  function openExpDetail(idx) {
    var e = EXPS[idx];
    if (!e) return;
    var src = e.source || {};
    var links = (src.dois || []).map(function (d) {
      return '<p>DOI：<a href="https://doi.org/' + esc(d) + '" target="_blank" rel="noopener">' + esc(d) + "</a></p>";
    }).join("") + (src.urls || []).map(function (u) {
      return '<p>原文：<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(u) + "</a></p>";
    }).join("");
    var hazard = hazardOf(e);
    /* 先交代「这是哪一篇论文的做法」和「有什么危害」，主观评分放到最后 */
    $("expDetail").innerHTML = BACK_BTN
      + "<h1>" + esc(e.name) + '</h1><p class="en"><span>' + esc(e.en) + "</span><span>" + esc(e.cat) + "</span></p>"
      + '<div class="callout paper"><p><b>这是一篇论文里的做法，不是通用操作规程。</b>下面的条件、用量和产率只代表这一篇：</p><p>'
        + esc(src.text) + "</p>" + links + "</div>"
      + expSec("用途", "<p>" + esc(e.use) + "</p>")
      + (hazard ? '<div class="callout warn"><p><b>主要危害</b>　' + esc(hazard) + "。</p><p>动手前请查阅每种试剂的安全技术说明书（SDS），并遵守所在实验室的安全规程。</p></div>" : "")
      + expSec("这篇论文的流程", "<ol>" + (e.steps || []).map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol>")
      + expSec("这篇论文的用量", listOrPara(e.materials))
      + expSec("设备", listOrPara(e.equip))
      + expSec("产率", "<p>" + esc(e["yield"] || "论文未给出") + "</p>")
      + expSec("注意事项", "<p>" + esc(e.notes) + "</p>")
      + expSec("适用范围", "<p>" + esc(e.scope) + "</p>")
      + expSec("编者印象分", '<div class="radar-wrap"><div class="radar-box">' + radarSVG([{ scores: e.scores, color: EXP_COLORS[0] }], 340)
        + '</div><div class="radar-side">' + scoreTable(e) + '<p class="muted small" style="margin-top:10px">' + EXP_NOTE + "</p></div></div>")
      + expSec("打分时的考虑", "<p>" + esc(String(e.scoreText || "").replace(/安全性(?=\s*\d\s*\/\s*5)/g, "安全风险")) + "</p>");
    expListY = window.scrollY || 0;
    showExpView("detail");
    pinScroll(0);
  }
  function openExpCmp() {
    var sel = cmpSel.map(function (n) { return EXPS.filter(function (e) { return e.name === n; })[0]; }).filter(Boolean);
    if (sel.length < 2) return;
    $("expCmpView").innerHTML = BACK_BTN + "<h1>评分对比</h1>"
      + '<div class="radar-wrap" style="margin-top:14px"><div class="radar-box">'
      + radarSVG(sel.map(function (e, i) { return { scores: e.scores, color: EXP_COLORS[i] }; }), 340)
      + '</div><div class="radar-side"><div class="cmp-tables">' + sel.map(function (e, i) {
        return '<div><h3><i style="background:' + EXP_COLORS[i] + '"></i>' + esc(e.name) + "</h3>" + scoreTable(e) + "</div>";
      }).join("") + '</div><p class="muted small" style="margin-top:12px">' + EXP_NOTE + "</p></div></div>";
    expListY = window.scrollY || 0;
    showExpView("cmp");
    pinScroll(0);
  }
  $("panel-exp").addEventListener("click", function (e) {
    var el = e.target.closest("[data-exp], [data-cmp], [data-back], button[data-cat]");
    if (!el) return;
    if (el.hasAttribute("data-exp")) return openExpDetail(+el.getAttribute("data-exp"));
    if (el.hasAttribute("data-back")) { showExpView("list"); pinScroll(expListY); return; }
    if (el.hasAttribute("data-cat")) { expCat = el.getAttribute("data-cat"); renderExpChips(); renderExpList(); return; }
    var name = EXPS[+el.getAttribute("data-cmp")].name, i = cmpSel.indexOf(name);
    if (i > -1) cmpSel.splice(i, 1);
    else if (cmpSel.length >= 3) { toast("最多同时对比 3 个实验"); return; }
    else cmpSel.push(name);
    renderCmpBar(); renderExpList();
  });
  $("expCmpGo").addEventListener("click", openExpCmp);
  $("expCmpClear").addEventListener("click", function () { cmpSel = []; renderCmpBar(); renderExpList(); });

  /* ================= 大图 ================= */
  var lightbox = $("figOverlay"), lightboxOpener = null;
  function closeLightbox() {
    if (lightbox.hidden) return;
    lightbox.hidden = true;
    if (lightboxOpener && document.contains(lightboxOpener)) lightboxOpener.focus({ preventScroll: true });
  }
  document.addEventListener("click", function (e) {
    var img = e.target;
    if (!img || img.tagName !== "IMG" || !img.hasAttribute("data-zoom")) return;
    var cap = img.closest("figure") && img.closest("figure").querySelector("figcaption");
    $("figBig").src = img.currentSrc || img.src; $("figBig").alt = img.alt || "";
    $("figCap").innerHTML = cap ? cap.innerHTML : "";
    lightboxOpener = document.activeElement;
    lightbox.hidden = false;
    $("figClose").focus({ preventScroll: true });
  });
  $("figClose").addEventListener("click", closeLightbox);
  lightbox.addEventListener("click", function (e) { if (e.target === lightbox) closeLightbox(); });

  /* ================= 全局：配色、快捷键、启动 ================= */
  $("themeBtn").addEventListener("click", function () {
    var root = document.documentElement;
    var dark = root.getAttribute("data-theme")
      ? root.getAttribute("data-theme") === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
    var next = dark ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("lp:theme", next); } catch (e) {}
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (!lightbox.hidden) closeLightbox(); else closeDrawer();
      return;
    }
    /* 按 / 直接去术语库搜索 */
    if (e.key === "/" && !e.ctrlKey && !e.metaKey && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ""))) {
      e.preventDefault();
      switchTab("lib", { top: true });
      $("libSearch").focus({ preventScroll: true });
    }
  });

  (function init() {
    var withFig = KB.filter(function (t) { return t.fig; });
    var figCount = withFig.reduce(function (n, t) { return n + 1 + (t.figs ? t.figs.length : 0); }, 0);
    $("stats").innerHTML = [[KB.length, "词条"], [withFig.length, "配图词条"], [CHAINS.length, "逻辑链"], [EXPS.length, "实验案例"]]
      .map(function (s) { return "<li><b>" + num(s[0]) + "</b><span>" + s[1] + "</span></li>"; }).join("");
    $("aboutFigs").textContent = "目前有 " + withFig.length + " 个词条配了图，共 " + figCount + " 张。";
    $("expIntro").textContent = EXPS.length + " 个论文案例，分 " + expCats().length + " 类。每条概括自一篇公开论文里的做法：流程、用量、注意事项，并附原文链接。";
    if (CONFIG.repoUrl) { $("repoLink").href = CONFIG.repoUrl; $("repoLink").hidden = false; }

    showSample();
    resetDef();
    applyRead();
    updateCharCount();
    renderChains();
    renderLibChips();
    setDensity(!!store.get("compact", false));
    renderLib();
    renderNotes();
    renderExpChips(); renderCmpBar(); renderExpList();
    placeDef(false);

    /* 支持 #lib 这类页签链接，以及 #term=核苷 这类词条直达链接 */
    var h = decodeURIComponent(location.hash.slice(1));
    if (h.indexOf("term=") === 0) {
      var t = findTerm(h.slice(5));
      switchTab("lib", { top: true });
      if (t) showTerm(t, true);
    } else if (TABS.indexOf(h) > -1 && h !== "read") {
      switchTab(h, { top: true });
    }
  })();
})();
