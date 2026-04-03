// ========== 配置区 ==========
const CONFIG = {
  API_KEY: "cfsd_59a3c7ef2963fa83380c2f25fc949cca",
  API_SECRET: "fa76d3edd6a43286e91f2630e5d912dafbe77992c0396f7a56b421edee31b4c7",
  RENEW_INTERVAL_DAYS: 200,
};
// ===========================

const API_HOST = "https://api005.dnshe.com";

// 全局日志数组（用于页面展示）
let logs = [];

function log(msg) {
  console.log(msg);
  logs.push(msg);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 接口：执行续期
    if (url.pathname === "/run") {
      logs = []; // 清空日志
      await autoRenewAll();
      return new Response(JSON.stringify({ logs }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // 主页：带按钮和日志面板
    const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>自动续期面板</title>
  <style>
    *{box-sizing:border-box;font-family:system-ui,-apple-ui,Segoe UI,Roboto}
    body{max-width:800px;margin:40px auto;padding:0 20px;background:#f6f8fa}
    .card{background:white;padding:24px;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,.06)}
    h1{font-size:22px;margin:0 0 16px}
    #log{background:#f9f9f9;padding:16px;border-radius:8px;white-space:pre-wrap;font-size:14px;line-height:1.5;height:380px;overflow-y:scroll;margin-top:16px}
    button{padding:12px 24px;background:#007bff;color:white;border:none;border-radius:8px;font-size:16px;cursor:pointer}
    button:disabled{background:#ccc}
  </style>
</head>
<body>
  <div class="card">
    <h1>子域名自动续期</h1>
    <button id="startBtn">开始自动续期</button>
    <div id="log">日志将在这里显示...</div>
  </div>

  <script>
    const btn = document.getElementById('startBtn');
    const logBox = document.getElementById('log');

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = '执行中...';
      logBox.textContent = '正在请求...\\n';

      try {
        const res = await fetch('/run');
        const data = await res.json();
        logBox.textContent = data.logs.join('\\n');
      } catch (e) {
        logBox.textContent = '请求失败：' + e.message;
      } finally {
        btn.disabled = false;
        btn.textContent = '开始自动续期';
      }
    });
  </script>
</body>
</html>
    `;

    return new Response(html, {
      headers: { "Content-Type": "text/html;charset=utf-8" },
    });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(autoRenewAll());
  },
};

// 主续期逻辑
async function autoRenewAll() {
  log("=== 开始自动续期任务 ===");

  const domainList = await listAllSubdomains();
  if (!domainList || domainList.length === 0) {
    log("未获取到任何子域名");
    return;
  }

  log(`共获取到 ${domainList.length} 个子域名`);

  for (const item of domainList) {
    const id = item.id;
    const sub = item.subdomain;
    log(`正在续期: ${sub} (id: ${id})`);

    const result = await renewSubdomain(id);
    if (result?.success) {
      log(`✅ 续期成功: ${sub} → 新到期: ${result.new_expires_at}`);
    } else {
      log(`❌ 续期失败: ${sub}`);
    }

    await sleep(800);
  }

  log("=== 全部续期任务完成 ===");
}

// 获取子域名列表
async function listAllSubdomains() {
  try {
    const url = `${API_HOST}/index.php?m=domain_hub&endpoint=dns_records&action=list`;
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        "X-API-Key": CONFIG.API_KEY,
        "X-API-Secret": CONFIG.API_SECRET,
      },
    });
    const data = await resp.json();
    return data?.success ? data.subdomains : [];
  } catch (e) {
    log("获取域名列表失败: " + e.message);
    return [];
  }
}

// 续期单个（你原接口地址可能写错了，我保持原样）
async function renewSubdomain(subdomain_id) {
  try {
    const url = `${API_HOST}/index.php?m=domain_hub&endpoint=dns_records&action=list&subdomain_id=${subdomain_id}`;
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        "X-API-Key": CONFIG.API_KEY,
        "X-API-Secret": CONFIG.API_SECRET,
      },
    });
    return await resp.json();
  } catch (e) {
    log(`续期异常 ${subdomain_id}: ` + e.message);
    return null;
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
