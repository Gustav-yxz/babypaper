/* SPDX-License-Identifier: MIT */
/* ============================================================
   宝宝文献 · 英文标词表
   从词条的英文名（en）和英文别名（alias）推导出「在英文文献里看到什么词，该标到哪个词条」。
   纯函数、不碰 DOM：浏览器里挂在 window.LP_buildEnMatchers 上，
   Node 里可以直接 require（tools/list-en-terms.js 用它打印整张表供人工审查）。
   ============================================================ */
(function (root) {
  "use strict";

  /* 人工指定的英文词 → 词条名。这里的词不受下面停用表的限制 */
  var EN_ALIAS = { "prodrug": "前药", "kinase": "激酶", "polymerase": "聚合酶", "hydrolysis": "水解", "phosphorylation": "磷酸化", "nucleoside": "核苷", "nucleotide": "核苷酸", "triphosphate": "三磷酸", "monophosphate": "单磷酸", "resistance": "耐药", "mutation": "突变", "metabolism": "代谢", "inhibitor": "抑制剂", "receptor": "受体", "ligand": "配体", "agonist": "激动剂", "antagonist": "拮抗剂", "apoptosis": "凋亡", "proliferation": "增殖", "placebo": "安慰剂", "transcription": "转录", "translation": "翻译", "replication": "复制", "enzyme": "酶", "thymine": "胸腺嘧啶", "uracil": "尿嘧啶", "codon": "密码子", "stability": "稳定性", "diastereomer": "非对映异构体", "enantiomer": "对映异构体", "racemate": "外消旋体", "bioavailability": "生物利用度" };

  /* 单独出现时不标的英文词：在普通行文里太常见，或者多数时候不是词条指的那个意思
     （assay 多指「某种实验」而不是含量测定，polymorphism 可能是基因多态性，
     resolution 可能是晶体结构分辨率，target 常作动词……）。
     它们出现在多词短语里不受影响，比如 target engagement、chiral resolution */
  var EN_STOP = {};
  ("target targets charge base activity tolerance dependence distribution absorption recovery accuracy precision robustness "
    + "resolution specificity selectivity assay polymorphism acceptor donor fitness range control controls linearity "
    + "method methods effect effects analysis reaction coupling rearrangement condensation reduction oxidation "
    + "addition elimination synthesis cyclization olefination amination alkylation acylation esterification "
    + "chromosome processing authentication gradient injection injections").split(" ")
    .forEach(function (w) { EN_STOP[w] = 1; });
  /* 不标的缩写：在药学文献里更常指别的东西
     （BET 多指溴结构域蛋白而不是比表面积，PSA 可能是前列腺特异性抗原，AMD 可能是黄斑变性……） */
  var ABBR_STOP = { "BET": 1, "AMD": 1, "PSA": 1, "CNS": 1, "DEL": 1, "EPS": 1, "SEI": 1, "ICH": 1, "USP": 1, "UDP": 1, "PPI": 1, "PCC": 1 };

  function trim(s) { return s.replace(/^\s+|\s+$/g, ""); }

  /* 把一个 en / alias 字段拆成若干候选短语：
     "selectivity index (SI)"            → selectivity index, SI
     "logP, Partition Coefficient"       → logP, Partition Coefficient
     "First-Pass Effect / First-Pass Metabolism" → 两个都要
     "Hydrogen Bond Donor / Acceptor"    → Hydrogen Bond Donor, Hydrogen Bond Acceptor（补全省略写法） */
  function pieces(raw) {
    var out = [];
    String(raw || "").split(/[；;]/).forEach(function (part) {
      var inner = [];
      part = part.replace(/[（(]([^）)]*)[）)]/g, function (m, x) { inner.push(x); return " "; });
      [part].concat(inner).forEach(function (seg) {
        seg.split(/,|，|\s&\s/).forEach(function (piece) {
          var alts = piece.split(/\s+\/\s+/).map(trim).filter(Boolean);
          if (!alts.length) return;
          var first = alts[0].split(/\s+/);
          alts.forEach(function (a, k) {
            if (k > 0 && first.length >= 2 && a.split(/\s+/).length === 1) a = first.slice(0, -1).concat(a).join(" ");
            out.push(a);
          });
        });
      });
    });
    return out;
  }

  /* 判断一个候选短语能不能用来标词，以及怎么匹配。
     缩写（logP、QSAR、LC-MS、dNK）：区分大小写，至少 3 个字符，不做词形变化。
     普通词和短语：不分大小写，允许复数；单个词至少 5 个字母且不在停用表里 */
  function classify(p, allowStop) {
    p = trim(String(p || "")).replace(/\s+/g, " ");
    if (!/^[A-Za-z]/.test(p) || /[^A-Za-z0-9 \-–'’.]/.test(p)) return null;
    if ((p.match(/[A-Za-z]/g) || []).length < 3) return null;
    var oneWord = p.indexOf(" ") < 0;
    /* 连字符两边都是普通单词（Cross-Resistance、P-Glycoprotein）算普通词，不算缩写 */
    var wordy = p.split(/[-–]/).every(function (tok) { return /^[A-Za-z]$/.test(tok) || /^[A-Z]?[a-z]+$/.test(tok); });
    if (oneWord && !wordy) {
      return p.length >= 3 && !ABBR_STOP[p] ? { txt: p, cs: true, infl: false } : null;
    }
    var low = p.toLowerCase();
    if (oneWord && (low.length < 5 || (!allowStop && EN_STOP[low]))) return null;
    if (!oneWord && low.length < 7) return null;
    return { txt: low, cs: false, infl: true };
  }

  /* 同一个短语的各种写法：连接号换成连字符或空格、弯引号换成直引号，
     以及加 s 表达不了的复数（-y → -ies、-is → -es、index → indices、half-life → half-lives） */
  function variants(txt, infl) {
    var set = {};
    function add(s) { if (s) set[s] = 1; }
    add(txt);
    add(txt.replace(/–/g, "-"));
    add(txt.replace(/[–-]/g, " "));
    add(txt.replace(/’/g, "'"));
    add(txt.replace(/'/g, "’"));
    if (infl) {
      Object.keys(set).forEach(function (s) {
        if (/[^aeiou]y$/.test(s)) add(s.slice(0, -1) + "ies");
        if (/[a-z]is$/.test(s)) add(s.slice(0, -2) + "es");
        if (/index$/.test(s)) add(s.slice(0, -5) + "indices");
        if (/life$/.test(s)) add(s.slice(0, -4) + "lives");
      });
    }
    return Object.keys(set);
  }

  /* 人名反应的常见别称：
     Suzuki–Miyaura Coupling → Suzuki–Miyaura reaction / cross-coupling；
     姓氏只属于这一个反应时，再加上只写第一个姓的说法（Suzuki coupling、Buchwald amination）。
     Corey、Claisen 这类挂在好几个反应上的姓不这么做 */
  function reactionVariants(p, isCoupling, soloName) {
    var out = [], m = /^(.+?)\s+([A-Za-z-]+)$/.exec(p);
    if (!m) return out;
    var name = m[1], kind = m[2].toLowerCase();
    var kinds = [kind];
    if (isCoupling && /^(coupling|cross-coupling|reaction)$/.test(kind)) kinds = ["coupling", "cross-coupling", "reaction"];
    var names = [name], first = name.split(/[–-]/)[0];
    if (first !== name && /^[A-Z][a-z]+$/.test(first) && soloName(first)) names.push(first);
    names.forEach(function (n) { kinds.forEach(function (k) { out.push(n + " " + k); }); });
    return out;
  }

  /* 返回 [{txt, ti, cs, infl}]，ti 是词条在 KB 里的下标。
     优先级：人工指定 = 英文名 < 英文别名 < 推导出来的别称。
     同一个短语被多个词条认领时：前两级取排在词库前面的词条；推导出来的直接放弃，宁缺毋滥 */
  function build(KB) {
    var byName = {};
    KB.forEach(function (t, i) { if (!(t.w in byName)) byName[t.w] = i; });
    var owners = {};
    function claim(c, ti, prio) {
      if (!c) return;
      var key = (c.cs ? "=" : "~") + c.txt, cur = owners[key];
      if (!cur) { owners[key] = { c: c, ti: ti, prio: prio, dead: false }; return; }
      if (cur.ti === ti) { if (prio < cur.prio) cur.prio = prio; return; }
      if (prio < cur.prio) { owners[key] = { c: c, ti: ti, prio: prio, dead: false }; return; }
      if (prio === cur.prio && prio >= 2) cur.dead = true;
    }
    Object.keys(EN_ALIAS).forEach(function (a) {
      if (EN_ALIAS[a] in byName) claim(classify(a, true), byName[EN_ALIAS[a]], 0);
    });
    KB.forEach(function (t, i) {
      /* 整个英文名就是这个词（Potency）的词条，优先于把它列作并列说法之一（activity / potency）的词条 */
      var whole = trim(String(t.en || "").replace(/[（(][^）)]*[）)]/g, " ")).toLowerCase();
      pieces(t.en).forEach(function (p) { claim(classify(p), i, trim(p).toLowerCase() === whole ? -1 : 0); });
    });
    KB.forEach(function (t, i) {
      pieces(String(t.alias || "").replace(/[^；;]*[一-鿿][^；;]*/g, "")).forEach(function (p) { claim(classify(p), i, 1); });
    });
    /* 每个姓氏出现在几个人名反应里 */
    var surnameUse = {};
    KB.forEach(function (t) {
      if (t.cat !== "人名反应") return;
      var mine = {};
      (String(t.en || "").match(/[A-Z][a-z]+/g) || []).forEach(function (n) { if (!mine[n]) { mine[n] = 1; surnameUse[n] = (surnameUse[n] || 0) + 1; } });
    });
    KB.forEach(function (t, i) {
      pieces(t.en).forEach(function (p) {
        var c = classify(p);
        if (!c || c.cs) return;
        /* 英文名本身是复数（alkaloids、glycosides）：补上单数 */
        if (c.txt.indexOf(" ") < 0 && /[^su]s$/.test(c.txt) && !/(is|ics)$/.test(c.txt)) claim(classify(c.txt.slice(0, -1)), i, 2);
        if (t.cat === "人名反应") {
          reactionVariants(trim(p), /偶联/.test(t.w), function (n) { return surnameUse[n] === 1; })
            .forEach(function (v) { claim(classify(v), i, 2); });
        }
      });
    });
    /* 英文名里夹着的全大写缩写（Chiral HPLC 里的 HPLC）：只在它唯一指向一个词条时才用 */
    var tokOwners = {};
    KB.forEach(function (t, i) {
      var mine = {};
      String(t.en || "").split(/[^A-Za-z0-9]+/).forEach(function (tok) {
        if (/^[A-Z][A-Z0-9]{2,}$/.test(tok) && !mine[tok]) { mine[tok] = 1; (tokOwners[tok] = tokOwners[tok] || []).push(i); }
      });
    });
    Object.keys(tokOwners).forEach(function (tok) {
      if (tokOwners[tok].length === 1) claim(classify(tok), tokOwners[tok][0], 3);
    });
    var out = [], seen = {};
    Object.keys(owners).forEach(function (key) {
      var o = owners[key];
      if (o.dead) return;
      variants(o.c.txt, o.c.infl).forEach(function (v) {
        var k = (o.c.cs ? "=" : "~") + v;
        if (seen[k] || (k !== key && owners[k])) return;      /* 变体撞上别的词条自己的短语时让路 */
        seen[k] = 1;
        out.push({ txt: v, ti: o.ti, cs: o.c.cs, infl: o.c.infl });
      });
    });
    return out;
  }

  root.LP_buildEnMatchers = build;
  if (typeof module !== "undefined" && module.exports) module.exports = build;
})(typeof window !== "undefined" ? window : this);
