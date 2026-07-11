import express from "express";
import ExcelJS from "exceljs";

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
  <a href="/nav-submit">Navigation with hidden submit</a>
  <a href="/reliability">Reliability</a>
  <a href="/new-tab" target="_blank">Open target tab</a>
</nav>
<button id="load" onclick="fetch('/api/normal').then(r=>r.json()).then(x=>document.querySelector('#out').textContent=JSON.stringify(x))">Load normal request</button>
<pre id="out"></pre>`);
});

app.get("/new-tab", (_req, res) => {
  res.type("html").send("<!doctype html><title>New Tab</title><h1>New Tab</h1><button onclick=\"history.pushState({},'', '/new-tab?traceGuid=abc123#detail')\">SPA URL</button>");
});

app.get("/research-list", (_req, res) => {
  res.type("html").send(`<!doctype html>
<meta charset="utf-8" />
<title>Research List</title>
<h1>Trace List</h1>
<button id="open-detail">Open Trace</button>
<button id="open-popup" onclick="window.open('/research-popup','_blank')">Open Popup</button>
<a id="download-csv" href="/download.csv">Download CSV</a>
<a id="download-xlsx" href="/download.xlsx">Download XLSX</a>
<pre id="detail-result"></pre>
<script>
document.querySelector('#open-detail').addEventListener('click', async () => {
  const selected = await fetch('/api/research/selection').then(r => r.json());
  history.pushState({}, '', '/research-detail?actionId=' + selected.actionId);
  const [query, body] = await Promise.all([
    fetch('/api/research/detail?actionId=' + selected.actionId).then(r => r.json()),
    fetch('/api/research/detail', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actionId: selected.actionId }) }).then(r => r.json())
  ]);
  document.querySelector('#detail-result').textContent = JSON.stringify({ query, body });
});
</script>`);
});

app.get("/research-popup", (_req, res) => res.type("html").send("<!doctype html><title>Research Popup</title><h1>Popup Detail</h1>"));
app.get("/api/research/selection", (_req, res) => res.json({ actionId: 7788, page: 1, enabled: true }));
app.get("/api/research/detail", (req, res) => res.json({ actionId: Number(req.query.actionId), code: -1, status: "observed" }));
app.post("/api/research/detail", (req, res) => res.status(200).json({ code: -1, received: req.body }));
app.get("/api/research/secret", (_req, res) => res.json({ access_token: "fake-secret", Authorization: "Bearer fake.jwt.token" }));
app.get("/api/research/large", (_req, res) => res.type("text/plain").send("x".repeat(11 * 1024 * 1024)));
app.get("/api/research/fail", (_req, res) => res.status(503).json({ error: "planned research failure" }));
app.get("/download.csv", (_req, res) => {
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", "attachment; filename=research.csv");
  res.send("actionId,name\n7788,Trace\n");
});
app.get("/download.xlsx", async (_req, res) => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Trace Data").addRows([["actionId", "name"], [7788, "Trace"]]);
  workbook.addWorksheet("Result").addRows([["code"], [-1]]);
  const bytes = await workbook.xlsx.writeBuffer();
  res.setHeader("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("content-disposition", "attachment; filename=research.xlsx");
  res.send(Buffer.from(bytes));
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

app.get("/nav-submit", (_req, res) => {
  res.type("html").send(`<!doctype html>
<meta charset="utf-8" />
<title>Navigation</title>
<nav><a id="plain-nav" href="/reliability">应用</a></nav>
<form id="hidden-form">
  <button id="hidden-submit" type="submit" style="display:none">确 定</button>
</form>`);
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
