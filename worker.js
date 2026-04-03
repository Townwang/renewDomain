// ========== 配置区 ==========
const CONFIG = {
  API_KEY: "cfsd_59a3c7ef2963fa83380c2f25fc949cca",
  API_SECRET: "fa76d3edd6a43286e91f2630e5d912dafbe77992c0396f7a56b421edee31b4c7",
};
// ===========================

const API_HOST = "https://api005.dnshe.com";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/run") {
      return new Response(
        new ReadableStream({
          async start(controller) {
            const send = (msg) => {
              console.log(msg);
              controller.enqueue(`data: ${JSON.stringify(msg)}\n\n`);
            };

            try {
              send("=== 开始续期 ===");
              const list = await listDomains(send);
              if (!list || list.length === 0) {
                send("无活跃子域名");
                return;
              }
              send(`找到 ${list.length} 个活跃子域名`);

              for (const item of list) {
                const id = item.id;
                const fullDomain = item.full_domain;
                send(`处理: ${fullDomain} (ID: ${id})`);

                const res = await renew(id);
                if (res?.success === true) {
                  send(`✅ 续期成功: ${fullDomain}，新过期时间: ${res.new_expires_at}`);
                } else {
                  send(`❌ 续期失败: ${fullDomain}，原因: ${res?.message || "接口无响应/网络错误"}`);
                }
                await sleep(800);
              }
              send("=== 全部完成 ===");
            } catch (e) {
              send("异常：" + e.message);
            } finally {
              controller.close();
            }
          },
        }),
        {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          },
        }
      );
    }

    return new Response(pageHtml(), {
      headers: { "Content-Type": "text/html;charset=utf-8" },
    });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(autoRenewAll(console.log));
  },
};

async function autoRenewAll(log) {
  log("=== 开始续期 ===");
  const list = await listDomains(log);
  if (!list || list.length === 0) {
    log("无活跃子域名");
    return;
  }
  log(`找到 ${list.length} 个活跃子域名`);
  for (const item of list) {
    const id = item.id;
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

async function listDomains(log) {
  try {
    const r = await fetch(`${API_HOST}/index.php?m=domain_hub&endpoint=subdomains&action=list`, {
      method: "GET",
      headers: {
        "X-API-Key": CONFIG.API_KEY,
        "X-API-Secret": CONFIG.API_SECRET,
      },
    });
    if (!r.ok) {
      log(`listDomains HTTP 错误: ${r.status}`);
      return [];
    }
    const d = await r.json();
    if (!d.success) {
      log(`listDomains 失败: ${d.message}`);
      return [];
    }
    log(`接口返回总域名数: ${d.count}`);
    return d.subdomains.filter(item => item.status === "active");
  } catch (e) {
    log("listDomains 异常: " + e);
    return [];
  }
}

async function renew(id) {
  try {
    const r = await fetch(`${API_HOST}/index.php?m=domain_hub&endpoint=subdomains&action=renew`, {
      method: "POST",
      headers: {
        "X-API-Key": CONFIG.API_KEY,
        "X-API-Secret": CONFIG.API_SECRET,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ subdomain_id: id }),
    });
    if (!r.ok) return { success: false, message: `HTTP ${r.status}` };
    return await r.json();
  } catch (e) {
    return { success: false, message: String(e) };
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// 页面 + 修复按钮恢复
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
    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  body {
    background: #f0f2f5;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    padding: 20px;
  }
  .container {
    width: 100%;
    max-width: 720px;
    background: #fff;
    border-radius: 16px;
    padding: 30px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.06);
  }
  h1 {
    text-align: center;
    font-size: 24px;
    color: #1e293b;
    margin-bottom: 24px;
  }
  .btn-run {
    width: 100%;
    padding: 14px;
    font-size: 16px;
    font-weight: 500;
    color: #fff;
    background: #2563eb;
    border: none;
    border-radius: 10px;
    cursor: pointer;
    transition: background 0.2s;
  }
  .btn-run:hover {
    background: #1d4ed8;
  }
  .btn-run:disabled {
    background: #94a3b8;
    cursor: not-allowed;
  }
  .log-card {
    margin-top: 20px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 16px;
    min-height: 240px;
    max-height: 500px;
    overflow-y: auto;
    font-size: 14px;
    line-height: 1.6;
    white-space: pre-wrap;
  }
  .log-success { color: #059669; font-weight: 500; }
  .log-error { color: #dc2626; font-weight: 500; }
  .log-normal { color: #334155; }
</style>
</head>
<body>
  <div class="container">
    <h1>DNSHE 自动续期</h1>
    <button class="btn-run" id="btn" onclick="startRun()">开始续期</button>
    <div id="log" class="log-card">等待执行...</div>
  </div>

<script>
const btn = document.getElementById('btn');
const logEl = document.getElementById('log');
let es = null;

function startRun() {
  if (es) es.close();

  btn.disabled = true;
  btn.textContent = '执行中...';
  logEl.innerHTML = '';

  es = new EventSource('/run');

  es.onmessage = e => {
    const line = JSON.parse(e.data);
    const txt = escapeHtml(line);
    if (line.includes('✅')) {
      logEl.innerHTML += '<span class="log-success">' + txt + '</span><br>';
    } else if (line.includes('❌') || line.includes('失败') || line.includes('错误')) {
      logEl.innerHTML += '<span class="log-error">' + txt + '</span><br>';
    } else {
      logEl.innerHTML += '<span class="log-normal">' + txt + '</span><br>';
    }
    logEl.scrollTop = logEl.scrollHeight;

    // 完成后恢复按钮
    if (line.includes('全部完成') || line.includes('无活跃子域名')) {
      es.close();
      btn.disabled = false;
      btn.textContent = '开始续期';
    }
  };

  es.onerror = () => {
    es.close();
    btn.disabled = false;
    btn.textContent = '开始续期';
  };
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
</script>
</body>
</html>
  `;
}
