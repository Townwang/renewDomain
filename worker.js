// ========== 配置区 ==========
const CONFIG = {
  API_KEY: "cfsd_59a3c7ef2963fa83380c2f25fc949cca",
  API_SECRET: "fa76d3edd6a43286e91f2630e5d912dafbe77992c0396f7a56b421edee31b4c7",
};
// ===========================

const API_HOST = "https://api005.dnshe.com";

let logs = [];
function log(msg) {
  console.log(msg);
  logs.push(msg);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/run") {
      logs = [];
      await autoRenewAll();
      return new Response(JSON.stringify({ logs }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(pageHtml(), {
      headers: { "Content-Type": "text/html;charset=utf-8" },
    });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(autoRenewAll());
  },
};

// 主续期逻辑
async function autoRenewAll() {
  log("=== 开始续期 ===");

  const list = await listDomains();
  if (!list || list.length === 0) {
    log("无域名");
    return;
  }

  log(`找到 ${list.length} 个域名`);

  for (const item of list) {
    const id = item.id;
    const sub = item.subdomain;
    log("处理: " + sub);

    const res = await renew(id);
    if (res?.success) {
      log("✅ 续期成功: " + sub);
    } else {
      log("❌ 续期失败: " + sub);
    }

    await sleep(800);
  }

  log("=== 全部完成 ===");
}

// 获取域名列表
async function listDomains() {
  try {
    const r = await fetch(`${API_HOST}/index.php?m=domain_hub&endpoint=dns_records&action=list`, {
      headers: {
        "X-API-Key": CONFIG.API_KEY,
        "X-API-Secret": CONFIG.API_SECRET,
      },
    });
    const d = await r.json();
    return d.success ? d.subdomains : [];
  } catch (e) {
    log("list err: " + e);
    return [];
  }
}

// 续期（修复了 action=renew）
async function renew(id) {
  try {
    const r = await fetch(`${API_HOST}/index.php?m=domain_hub&endpoint=dns_records&action=renew&subdomain_id=${id}`, {
      headers: {
        "X-API-Key": CONFIG.API_KEY,
        "X-API-Secret": CONFIG.API_SECRET,
      },
    });
    return await r.json();
  } catch (e) {
    log("renew err: " + e);
    return null;
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// 极简页面
function pageHtml() {
  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>DNSHE 续期</title>
</head>
<body>
<h1>DNSHE 自动续期</h1>
<button onclick="run()">开始续期</button>
<pre id="log" style="background:#f5f5f5;padding:10px;margin-top:10px;"></pre>

<script>
async function run() {
  document.getElementById('log').textContent = '执行中...';
  const res = await fetch('/run');
  const data = await res.json();
  document.getElementById('log').textContent = data.logs.join('\\n');
}
</script>
</body>
</html>
  `;
}
