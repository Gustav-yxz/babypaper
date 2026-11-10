#!/usr/bin/env node
/* 本地预览用的零依赖静态服务器：node tools/serve.js [目录] [端口]（也认环境变量 PORT） */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const port = Number(process.env.PORT || process.argv[3] || 8765);
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp"
};

http.createServer(function (req, res) {
  let rel;
  try { rel = decodeURIComponent(req.url.split("?")[0]); } catch (e) { res.writeHead(400); res.end(); return; }
  let file = path.normalize(path.join(root, rel));
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.stat(file, function (err, st) {
    if (!err && st.isDirectory()) file = path.join(file, "index.html");
    fs.readFile(file, function (err2, buf) {
      if (err2) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("404"); return; }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(buf);
    });
  });
}).listen(port, "127.0.0.1", function () {
  console.log("serving " + root + " at http://127.0.0.1:" + port);
});
