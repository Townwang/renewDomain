const API_HOST = "https://api005.dnshe.com";

// --------------- 配置 ---------------
const VALID_DAYS = 365;        // 有效期固定 365 天
const RENEW_BEFORE_DAYS = 180; // 只有 ≤180 天才续期
const DAY_MS = 24 * 60 * 60 * 1000;

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
              if (!env.API_KEY || !env.API_SECRET) {
                send("❌ 错误：请配置 API_KEY 和 API_SECRET");
                return;
              }

              const list = await listDomains(env, send);
              if (!list || list.length === 0) {
                send("无活跃子域名");
                return;
              }
              send(`找到 ${list.length} 个域名，仅剩余 ≤${RENEW_BEFORE_DAYS} 天续期`);

              for (const item of list) {
                const id = item.id;
                const fullDomain = item.full_domain;
                const updatedAtStr = item.updated_at;

                send(`处理: ${fullDomain} (ID: ${id})`);

                // ====================== 时区矫正：北京时间 UTC+8 ======================
                const updatedAt = new Date(updatedAtStr);
                if (isNaN(updatedAt.getTime())) {
                  send(`⚠️ ${fullDomain} 时间格式错误，跳过`);
                  continue;
                }
                // 接口是北京时间，转成 UTC 时间
                const updatedAtUtc = new Date(updatedAt.getTime() - 8 * 60 * 60 * 1000);

                const now = new Date();
                const elapsedDays = Math.floor((now - updatedAtUtc) / DAY_MS);
                const remainingDays = VALID_DAYS - elapsedDays;
                const realRemaining = Math.min(remainingDays, VALID_DAYS);

                send(`📅 剩余 ${realRemaining} 天`);

                if (realRemaining > RENEW_BEFORE_DAYS) {
                  send(`✅ 剩余 ${realRemaining} 天，无需续期`);
                  await sleep(300);
                  continue;
                }

                send(`🔍 剩余 ${realRemaining} 天，执行续期`);

                const res = await renew(env, id);
                if (res?.success === true) {
                  send(`✅ 续期成功: ${fullDomain}`);
                } else {
                  send(`❌ 续期失败: ${fullDomain}，原因: ${res?.message || "接口无响应"}`);
                }
                await sleep(800);
              }
              send("全部完成");
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
            Connection: "keep-alive",
          },
        }
      );
    }

    return new Response(pageHtml(), {
      headers: { "Content-Type": "text/html;charset=utf-8" },
    });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(autoRenewAll(env, console.log));
  },
};

async function autoRenewAll(env, log) {
  if (!env.API_KEY || !env.API_SECRET) {
    log("❌ API_KEY / API_SECRET 未配置");
    return;
  }

  const list = await listDomains(env, log);
  if (!list || list.length === 0) {
    log("无活跃子域名");
    return;
  }
  log(`找到 ${list.length} 个域名，仅剩余 ≤${RENEW_BEFORE_DAYS} 天续期`);

  for (const item of list) {
    const id = item.id;
    const fullDomain = item.full_domain;
    const updatedAtStr = item.updated_at;

    log(`处理: ${fullDomain} (ID: ${id})`);

    // ====================== 时区矫正：北京时间 UTC+8 ======================
    const updatedAt = new Date(updatedAtStr);
    if (isNaN(updatedAt.getTime())) {
      log(`⚠️ ${fullDomain} 时间格式错误，跳过`);
      continue;
    }
    // 接口是北京时间，转成 UTC 时间
    const updatedAtUtc = new Date(updatedAt.getTime() - 8 * 60 * 60 * 1000);

    const now = new Date();
    const elapsedDays = Math.floor((now - updatedAtUtc) / DAY_MS);
    const remainingDays = VALID_DAYS - elapsedDays;
    const realRemaining = Math.min(remainingDays, VALID_DAYS);

    log(`📅 剩余 ${realRemaining} 天`);

    if (realRemaining > RENEW_BEFORE_DAYS) {
      log(`✅ 剩余 ${realRemaining} 天，无需续期`);
      await sleep(300);
      continue;
    }

    log(`🔍 剩余 ${realRemaining} 天，执行续期`);

    const res = await renew(env, id);
    if (res?.success === true) {
      log(`✅ 续期成功: ${fullDomain}`);
    } else {
      log(`❌ 续期失败: ${fullDomain}，原因: ${res?.message || "接口无响应"}`);
    }
    await sleep(800);
  }
}

async function listDomains(env, log) {
  try {
    const r = await fetch(`${API_HOST}/index.php?m=domain_hub&endpoint=subdomains&action=list`, {
      method: "GET",
      headers: {
        "X-API-Key": env.API_KEY,
        "X-API-Secret": env.API_SECRET,
        "User-Agent": "Mozilla/5.0",
      },
    });
    if (!r.ok) {
      log(`listDomains HTTP错误: ${r.status}`);
      return [];
    }
    const d = await r.json();
    if (!d.success) {
      log(`listDomains 失败: ${d.message}`);
      return [];
    }
    log(`总域名数: ${d.count}`);
    return d.subdomains?.filter(item => item.status === "active") || [];
  } catch (e) {
    log("listDomains 异常: " + e);
    return [];
  }
}

async function renew(env, id) {
  try {
    const r = await fetch(`${API_HOST}/index.php?m=domain_hub&endpoint=subdomains&action=renew`, {
      method: "POST",
      headers: {
        "X-API-Key": env.API_KEY,
        "X-API-Secret": env.API_SECRET,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
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

function pageHtml() {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>DNSHE 自动续期</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;font-family:system-ui}
body{background:#f0f2f5;display:flex;justify-content:center;align-items:center;min-height:100vh;padding:20px}
.container{width:100%;max-width:720px;background:#fff;border-radius:16px;padding:30px;box-shadow:0 4px 20px rgba(0,0,0,0.06)}
h1{text-align:center;font-size:24px;color:#1e293b;margin-bottom:24px}
.btn-run{width:100%;padding:14px;font-size:16px;color:#fff;background:#2563eb;border:none;border-radius:10px;cursor:pointer}
.btn-run:hover{background:#1d4ed8}
.btn-run:disabled{background:#94a3b8;cursor:not-allowed}
.log-card{margin-top:20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;min-height:240px;max-height:500px;overflow-y:auto;font-size:14px;line-height:1.6}
.log-success{color:#059669;font-weight:500}
.log-error{color:#dc2626;font-weight:500}
.log-normal{color:#334155}
.log-warning{color:#d97006;font-weight:500}
</style>
</head>
<body>
<div class="container">
  <h1>DNSHE 自动续期（剩余≤180天续期）</h1>
  <button class="btn-run" id="btn" onclick="startRun()">开始续期</button>
  <div id="log" class="log-card">等待执行...</div>
</div>
<script>
const btn=document.getElementById('btn');
const logEl=document.getElementById('log');
let es=null;
function startRun(){
  if(es)es.close();
  btn.disabled=true;
  btn.textContent='执行中...';
  logEl.innerHTML='';
  es=new EventSource('/run');
  es.onmessage=e=>{
    const line=JSON.parse(e.data);
    const txt=line.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    if(line.includes('✅')){
      logEl.innerHTML+='<span class="log-success">'+txt+'</span><br>'
    }else if(line.includes('❌')||line.includes('失败')||line.includes('错误')){
      logEl.innerHTML+='<span class="log-error">'+txt+'</span><br>'
    }else if(line.includes('⚠️')){
      logEl.innerHTML+='<span class="log-warning">'+txt+'</span><br>'
    }else{
      logEl.innerHTML+='<span class="log-normal">'+txt+'</span><br>'
    }
    logEl.scrollTop=logEl.scrollHeight;
    if(line.includes('全部完成')||line.includes('无活跃')||line.includes('配置')){
      es.close();btn.disabled=false;btn.textContent='开始续期';
    }
  };
  es.onerror=()=>{es.close();btn.disabled=false;btn.textContent='开始续期'}
}
</script>
</body>
</html>
  `;
}
