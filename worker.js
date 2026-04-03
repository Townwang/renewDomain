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

// 主续期逻辑（完全对齐双规范）
async function autoRenewAll() {
  log("=== 开始续期 ===");
  
  const list = await listDomains();
  if (!list || list.length === 0) {
    log("无活跃子域名");
    return;
  }
  
  log(`找到 ${list.length} 个活跃子域名`);
  
  for (const item of list) {
    const id = item.id;
    const sub = item.subdomain;
    const fullDomain = item.full_domain;
    log(`处理: ${fullDomain} (ID: ${id})`);
    
    const res = await renew(id);
    if (res?.success === true) {
      log(`✅ 续期成功: ${fullDomain}，新过期时间: ${res.new_expires_at}`);
    } else {
      log(`❌ 续期失败: ${fullDomain}，原因: ${res?.message || "接口无响应/网络错误"}`);
    }
    
    await sleep(800);
  }
  
  log("=== 全部完成 ===");
}

// 【修正后】获取子域名列表（100% 对齐 1.1 列出子域名 spec）
async function listDomains() {
  try {
    // 完全对齐官方 curl 示例：endpoint=subdomains&action=list
    const r = await fetch(`${API_HOST}/index.php?m=domain_hub&endpoint=subdomains&action=list`, {
      method: "GET",
      headers: {
        "X-API-Key": CONFIG.API_KEY,
        "X-API-Secret": CONFIG.API_SECRET,
      },
    });
    
    // 新增 HTTP 状态码校验，避免 401/404 等错误
    if (!r.ok) {
      log(`listDomains HTTP 错误: ${r.status} ${r.statusText}`);
      return [];
    }
    
    const d = await r.json();
    // 严格校验 success 字段，只返回活跃的子域名
    if (!d.success) {
      log(`listDomains 接口返回失败: ${d.message || "未知错误"}`);
      return [];
    }
    
    log(`接口返回总域名数: ${d.count}`);
    // 过滤只保留 status 为 active 的域名，避免续期已停用的
    const activeDomains = d.subdomains.filter(item => item.status === "active");
    return activeDomains;
  } catch (e) {
    log("listDomains 异常: " + e);
    return [];
  }
}

// 【修正后】续期子域名（100% 对齐 1.5 续期子域名 spec）
async function renew(id) {
  try {
    const r = await fetch(`${API_HOST}/index.php?m=domain_hub&endpoint=subdomains&action=renew`, {
      method: "POST",
      headers: {
        "X-API-Key": CONFIG.API_KEY,
        "X-API-Secret": CONFIG.API_SECRET,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        subdomain_id: id
      })
    });
    
    if (!r.ok) {
      log(`renew HTTP 错误: ${r.status}，ID: ${id}`);
      return { success: false, message: `HTTP ${r.status}` };
    }
    
    const res = await r.json();
    return res;
  } catch (e) {
    log("renew 异常: " + e);
    return { success: false, message: String(e) };
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// 极简页面（美化版：居中、卡片、蓝按钮、彩色日志）
function pageHtml() {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>DNSHE 自动续期</title>
<style>
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  body {
    background-color: #f0f2f5;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    padding: 20px;
  }
  .container {
    width: 100%;
    max-width: 700px;
    background: #fff;
    border-radius: 16px;
    padding: 30px;
    box-shadow: 0 2px 20px rgba(0,0,0,0.08);
  }
  h1 {
    text-align: center;
    font-size: 24px;
    color: #1f2937;
    margin-bottom: 24px;
  }
  .btn-run {
    display: block;
    width: 100%;
    padding: 14px;
    font-size: 16px;
    font-weight: 500;
    color: #fff;
    background-color: #2563eb;
    border: none;
    border-radius: 10px;
    cursor: pointer;
    transition: background 0.2s;
  }
  .btn-run:hover {
    background-color: #1d4ed8;
  }
  .log-card {
    margin-top: 20px;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    padding: 16px;
    min-height: 200px;
    max-height: 500px;
    overflow-y: auto;
    white-space: pre-wrap;
    font-size: 14px;
    line-height: 1.6;
  }
  .log-success {
    color: #059669;
    font-weight: 500;
  }
  .log-error {
    color: #dc2626;
    font-weight: 500;
  }
  .log-normal {
    color: #1f2937;
  }
</style>
</head>
<body>
  <div class="container">
    <h1>DNSHE 自动续期</h1>
    <button class="btn-run" onclick="run()">开始续期</button>
    <div id="log" class="log-card">等待执行...</div>
  </div>

<script>
async function run() {
  const logEl = document.getElementById('log');
  logEl.innerHTML = '<span class="log-normal">执行中，请稍候...</span>';
  
  try {
    const res = await fetch('/run');
    const data = await res.json();
    renderLogs(data.logs);
  } catch (e) {
    logEl.innerHTML = '<span class="log-error">请求失败：' + e + '</span>';
  }
}

function renderLogs(logs) {
  const logEl = document.getElementById('log');
  let html = '';
  logs.forEach(line => {
    if (line.includes('✅') || line.includes('成功')) {
      html += '<span class="log-success">' + escapeHtml(line) + '</span>\\n';
    } else if (line.includes('❌') || line.includes('失败') || line.includes('错误') || line.includes('异常')) {
      html += '<span class="log-error">' + escapeHtml(line) + '</span>\\n';
    } else {
      html += '<span class="log-normal">' + escapeHtml(line) + '</span>\\n';
    }
  });
  logEl.innerHTML = html;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
</script>
</body>
</html>
  `;
}
