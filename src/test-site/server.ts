import express from "express";

export function createTestSiteApp(): express.Express {
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html>
<meta charset="utf-8" />
<title>Capture Test Site</title>
<h1>Capture Test Site</h1>
<nav>
  <a href="/cascade">Cascade form</a>
  <a href="/reliability">Reliability</a>
  <a href="/new-tab" target="_blank">Open target tab</a>
</nav>
<button id="load" onclick="fetch('/api/normal').then(r=>r.json()).then(x=>document.querySelector('#out').textContent=JSON.stringify(x))">Load normal request</button>
<pre id="out"></pre>`);
});

app.get("/new-tab", (_req, res) => {
  res.type("html").send("<!doctype html><title>New Tab</title><h1>New Tab</h1><button onclick=\"history.pushState({},'', '/new-tab?traceGuid=abc123#detail')\">SPA URL</button>");
});

app.get("/cascade", (_req, res) => {
  res.type("html").send(`<!doctype html>
<meta charset="utf-8" />
<title>Cascade</title>
<h1>告警配置</h1>
<form id="alarm">
  <label>应用
    <select name="applicationId" id="app">
      <option value="">请选择</option>
      <option value="2033">OA 系统</option>
      <option value="2044">支付系统</option>
    </select>
  </label>
  <label>事务
    <select name="transactionId" id="tx"></select>
  </label>
  <label>严重阈值 <input name="threshold" value="" /></label>
  <button type="submit">保存</button>
</form>
<pre id="result"></pre>
<script>
document.querySelector('#app').addEventListener('change', async (event) => {
  const data = await fetch('/api/transactions?applicationId=' + encodeURIComponent(event.target.value)).then(r => r.json());
  const tx = document.querySelector('#tx');
  tx.innerHTML = data.items.map(item => '<option value="' + item.id + '">' + item.name + '</option>').join('');
});
document.querySelector('#alarm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.target).entries());
  const data = await fetch('/save', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer secret-token' }, body: JSON.stringify(body) }).then(r => r.json());
  document.querySelector('#result').textContent = JSON.stringify(data);
});
</script>`);
});

app.get("/reliability", (_req, res) => {
  res.type("html").send(`<!doctype html>
<meta charset="utf-8" />
<title>Reliability</title>
<h1>Reliability</h1>
<button onclick="fetch('/api/delay?ms=1200')">Delayed request</button>
<button onclick="fetch('/api/fail')">Failed request</button>
<button onclick="location.href='/redirect-start'">Redirect</button>
<a href="/download">Download</a>
<iframe src="/iframe-page"></iframe>
<button onclick="history.pushState({},'', '/reliability?actionId=7788#trace')">SPA URL</button>`);
});

app.get("/iframe-page", (_req, res) => {
  res.type("html").send("<!doctype html><title>Frame</title><button onclick=\"fetch('/api/frame')\">Frame request</button>");
});

app.get("/api/normal", (_req, res) => res.json({ ok: true, applicationId: 2033 }));
app.get("/api/transactions", (req, res) => {
  const appId = String(req.query.applicationId ?? "");
  res.json({
    items: appId === "2044" ? [{ id: "tx-pay", name: "支付" }] : [{ id: "tx-login", name: "登录" }, { id: "tx-query", name: "查询" }]
  });
});
app.post("/save", (req, res) => res.json({ saved: true, received: req.body }));
app.get("/api/delay", async (req, res) => {
  await new Promise((resolve) => setTimeout(resolve, Number(req.query.ms ?? 1000)));
  res.json({ delayed: true });
});
app.get("/api/fail", (_req, res) => res.status(503).json({ error: "planned failure" }));
app.get("/api/frame", (_req, res) => res.json({ frame: true }));
app.get("/redirect-start", (_req, res) => res.redirect(302, "/redirect-end"));
app.get("/redirect-end", (_req, res) => res.json({ redirected: true }));
app.get("/download", (_req, res) => {
  res.setHeader("content-type", "text/plain");
  res.setHeader("content-disposition", "attachment; filename=capture-test.txt");
  res.send("download evidence");
});
return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.TEST_SITE_PORT ?? 5174);
  createTestSiteApp().listen(port, "127.0.0.1", () => {
    console.log(`test site listening on http://127.0.0.1:${port}`);
  });
}
