# 宝宝文献 · 药学版

读文献时卡在基础概念上？把那一段贴进来，词库里的基础词会自动标出——点一下，就能看到**定义、一句话解释，以及它在整条逻辑里的位置**。

纯前端、零依赖、无需构建。文献只在你的浏览器里处理，不会上传。

![界面截图](docs/screenshot.jpg)

## 功能

- **边读边查**：粘贴文本，或导入、拖入 `.txt` / `.md` / `.pdf`；扫描版 PDF 和图片可以用 OCR 识别。词库收录的词自动加底色，**中英文文献都认**（英文认得出复数和连字符的不同写法），点击即查；其他词划选后再查。已经会的词可以标「已掌握」，之后不再加底色。
- **词条解释**：一句话大白话、基础定义、为什么重要、常见误解、逻辑位置、配图和出处；补充内容默认收起。
- **逻辑链**：9 条因果线，把零散的概念串起来（核苷前药、活性数据表怎么读、方法学验证……），每一环都能点进相关词条。
- **术语库**：551 个词条，覆盖药物化学、药理学、药物分析、药剂学、生药学、人名反应等 17 类，支持中文、英文、缩写搜索。
- **实验速查**：49 个论文案例——每条概括自一篇公开论文里的做法，给出流程、用量、主要危害和原文链接。它们不是通用操作规程。
- **生词本**：保存在浏览器本地，可以自测，也可以导出为 Markdown 或 Anki 卡片。
- 深色模式、手机适配、键盘可操作（按 `/` 直接搜索术语库）。

## 使用

**在线使用**：把仓库部署到 GitHub Pages（Settings → Pages → Deploy from a branch → `main` / root），然后访问对应网址。

**本地使用**：下载仓库后直接双击 `index.html` 即可。也可以起一个本地服务器：

```bash
node tools/serve.js
```

然后打开 <http://127.0.0.1:8765>。

**单文件离线版**：想把它当成一个文件转发（例如通过微信），可以打包：

```bash
node tools/build-single.js
```

成品在 `dist/宝宝文献.html`，约 16 MB，样式、脚本、数据和配图全部内联。

> 导入 PDF 和使用 OCR 时，页面会从 CDN 按需加载 [pdf.js](https://mozilla.github.io/pdf.js/) 与 [Tesseract.js](https://github.com/naptha/tesseract.js)，这两步需要联网；其余功能可完全离线使用。

## 目录结构

```
index.html              页面结构与界面文案
assets/css/app.css      样式（设计变量在文件开头）
assets/js/app.js        全部交互逻辑
assets/js/en-terms.js   英文标词表的推导规则（纯函数，Node 里也能跑）
assets/figures/         词条配图（来源与许可证见 CREDITS.md）
data/kb.js              词库，一行一个词条
data/chains.js          逻辑链
data/experiments.js     实验速查
tools/                  本地预览、数据自检、配图尺寸、署名清单、英文标词表、打包单文件
docs/                   词库修订记录等文档
```

## 参与贡献

最需要帮助的是**词条内容**：补充词条、纠正定义、替换更准确的出处、提供可开放使用的配图。

### 新增或修改词条

编辑 `data/kb.js`，每行是一个 JSON 对象：

```json
{"w":"词条名","en":"English name","cat":"药理学","alias":"别名一；别名二","def":"基础定义……","plain":"一句话大白话。","use":"在文献里为什么重要……","trap":"常见误解……","chain":["上游词","词条名","下游词"],"src":"定义出处……"}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `w` / `en` / `cat` | 是 | 词条名、英文名、分类 |
| `def` / `plain` / `use` | 是 | 基础定义、一句话解释、在文献里为什么重要 |
| `alias` | | 别名，用全角分号 `；` 分隔；中文别名会参与自动标词 |
| `trap` | | 常见误解 |
| `extra` | | 补充小节，`[{"h":"标题","p":"正文"}]` |
| `chain` | | 逻辑位置：按因果顺序列出相邻的词，其中要包含词条自己 |
| `fig` / `figs` | | 配图 `{img, cap, credit, link}`；`img` 指向 `assets/figures/` 下的文件 |
| `figIdea` | | 暂时没有开放图片时，写「这张图应该怎么画」 |
| `src` / `srclink` | | 定义出处、在线核对链接 |
| `unverified` | | 尚未对照原文核实时，写明情况，界面会显示「待核实」 |

几条约定：

1. **定义要有出处**。按教材、规范或公开资料的通行表述转写，不凭印象；拿不准就填 `unverified`。
2. **纯文本**。字段里不要写 HTML；正文里的 `1. …。2. …。` 会自动排成列表。
3. **配图只收开放许可的图片**（公共领域、CC0、CC BY、CC BY-SA），并在 `credit` 里写明作者和许可证。不收商业教科书插图。
4. **英文名决定英文文献里标不标得出来**。`en` 和英文别名会被拆成短语去匹配正文：`selectivity index (SI)` 会认 `selectivity index` 及其复数；缩写要 3 个字符以上才认，且区分大小写。改完可以打印整张表，看有没有误标（加 `--single` 只看最容易出问题的单个词）：

```bash
node tools/list-en-terms.js --single
```

   不想被单独标出的常见词（如 assay、target）和容易撞车的缩写（如 BET、PSA），加进 `assets/js/en-terms.js` 开头的停用表。

5. 提交前运行自检；增删配图后，再更新配图尺寸和署名清单：

```bash
node tools/check-data.js
```

```bash
node tools/fig-sizes.js
```

```bash
node tools/build-credits.js
```

### 修改界面

没有构建步骤：改 `index.html`、`assets/css/app.css`、`assets/js/app.js`，刷新页面即可。颜色、字体、圆角等设计变量集中在 `app.css` 开头，深色模式有对应的一组。

发布后，把 `assets/js/app.js` 开头 `CONFIG.repoUrl` 填成仓库地址，顶栏会出现 GitHub 入口。

## 内容来源与免责声明

- 词条的「基础定义」对照教材、ICH / 药典等规范和公开资料转写，每条底部注明来源，汇总见页面内「关于」页；「一句话」和「为什么重要」是通俗转述。**正式引用请以教材和文献原文为准。**
- 人名反应类词条主要对照 Wikipedia 相应条目与 LibreTexts 开放教材。
- 实验速查中的每一条只是所引那一篇论文的做法，不是通用操作规程；五个分数是编者的主观印象，没有统一细则。动手前请阅读原文、查阅试剂的 SDS，并遵守所在实验室的安全规程。
- 部分出处引的是旧版教材或《中国药典》2020 年版，尚未对照新版更新。
- 本项目用于学习交流，不构成任何用药或临床建议。
- 词库的分批修订与订正记录见 [docs/词库修订记录.md](docs/词库修订记录.md)。

## 配图

`assets/figures/` 中的图片来自 PubChem（公共领域）以及 Wikimedia Commons / OpenStax（公共领域、CC0、CC BY、CC BY-SA），版权归原作者所有。逐张的作者、许可证与原图链接见 [CREDITS.md](CREDITS.md)。

## 致谢

界面的版式与交互思路参考了默读 Modureader、Yomitan、Skola、Elementro、Avogadro 等开源项目（仅借鉴设计模式，未使用其代码与素材）。PDF 文字提取使用 Mozilla 的 pdf.js，OCR 使用 Tesseract.js。

## 许可证

本仓库分三部分授权：

| 部分 | 许可证 |
| --- | --- |
| 代码：`index.html`、`assets/css/`、`assets/js/`、`tools/` | [MIT](LICENSE) |
| 内容：`data/` 里的词库、逻辑链、实验速查，以及 `docs/` 和本文件 | [CC BY-SA 4.0](LICENSE-CONTENT.md) |
| 配图：`assets/figures/` | 各自沿用原作者的许可证，见 [CREDITS.md](CREDITS.md) |

简单说：代码随便用，保留版权声明即可；词库等内容可以转载和改编，但要署名，并且改编后的成果也要按 CC BY-SA 4.0 发布；配图请按每张图自己的许可证使用。

用 `tools/build-single.js` 打包出来的单文件同时包含这三部分，转发或再分发时三种许可证都适用。
