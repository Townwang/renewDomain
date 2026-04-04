const API_HOST = "https://api005.dnshe.com";
// 续期阈值：仅剩余 180 天以内才续期
const RENEW_THRESHOLD_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000; // 1天的毫秒数

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
              // 环境变量校验
              if (!env.API_KEY || !env.API_SECRET) {
                send("❌ 错误：请在 Workers 环境变量中配置 API_KEY 和 API_SECRET");
                return;
              }

              const list = await listDomains(env, send);
              if (!list || list.length === 0) {
                send("无活跃子域名");
                return;
              }
              send(`找到 ${list.length} 个活跃子域名，仅剩余 ${RENEW_THRESHOLD_DAYS} 天以内的域名会续期`);

              for (const item of list) {
                const id = item.id;
                const fullDomain = item.full_domain;
                const updatedAtStr = item.updated_at;

                send(`处理: ${fullDomain} (ID: ${id})`);

                // 1. 解析 updated_at 时间
                const updatedAt = new Date(updatedAtStr);
                if (isNaN(updatedAt.getTime())) {
                  send(`⚠️ ${fullDomain} 的 updated_at 格式异常，跳过`);
                  continue;
                }

                // 2. 计算剩余有效期（DNSHE 子域名有效期通常为 180 天，从 updated_at 起算）
                const expireAt = new Date(updatedAt.getTime() + RENEW_THRESHOLD_DAYS * DAY_MS);
                const now = new Date();
                const remainingMs = expireAt.getTime() - now.getTime();
                const remainingDays = Math.ceil(remainingMs / DAY_MS);

                // 3. 判断是否需要续期
                if (remainingDays <= 0) {
                  send(`⚠️ ${fullDomain} 已过期，立即续期`);
                } else if (remainingDays <= RENEW_THRESHOLD_DAYS) {
                  send(`🔍 ${fullDomain} 剩余 ${remainingDays} 天，符合续期条件，执行续期`);
                } else {
                  send(`✅ ${fullDomain} 剩余 ${remainingDays} 天，无需续期，跳过`);
                  await sleep(300); // 跳过的域名也加小延迟，避免接口限流
                  continue;
                }

                // 4. 符合条件，执行续期
                const res = await renew(env, id);
                if (res?.success === true) {
                  send(`✅ 续期成功: ${fullDomain}，新过期时间: ${res.new_expires_at}`);
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
            "Connection": "keep-alive",
          },
        }
      );
    }

    return new Response(pageHtml(), {
      headers: { "Content-Type": "text/html;charset=utf-8" },
    });
  },

  // 定时任务：每 6 个月 1 号 0 点执行
  async scheduled(event, env, ctx) {
    ctx.waitUntil(autoRenewAll(env, console.log));
  },
};

// 自动续期逻辑（定时任务入口）
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
  log(`找到 ${list.length} 个活跃子域名，仅剩余 ${RENEW_THRESHOLD_DAYS} 天以内的域名会续期`);

  for (const item of list) {
    const id = item.id;
    const fullDomain = item.full_domain;
    const updatedAtStr = item.updated_at;

    log(`处理: ${fullDomain} (ID: ${id})`);

    // 解析 updated_at 时间
    const updatedAt = new Date(updatedAtStr);
    if (isNaN(updatedAt.getTime())) {
      log(`⚠️ ${fullDomain} 的 updated_at 格式异常，跳过`);
      continue;
    }

    // 计算剩余有效期
    const expireAt = new Date(updatedAt.getTime() + RENEW_THRESHOLD_DAYS * DAY_MS);
    const now = new Date();
    const remainingMs = expireAt.getTime() - now.getTime();
    const remainingDays = Math.ceil(remainingMs / DAY_MS);

    // 判断是否需要续期
    if (remainingDays <= 0) {
      log(`⚠️ ${fullDomain} 已过期，立即续期`);
    } else if (remainingDays <= RENEW_THRESHOLD_DAYS) {
      log(`🔍 ${fullDomain} 剩余 ${remainingDays} 天，符合续期条件，执行续期`);
    } else {
      log(`✅ ${fullDomain} 剩余 ${remainingDays} 天，无需续期，跳过`);
      await sleep(300);
      continue;
    }

    // 执行续期
    const res = await renew(env, id);
    if (res?.success === true) {
      log(`✅ 续期成功: ${fullDomain}，新过期时间: ${res.new_expires_at}`);
    } else {
      log(`❌ 续期失败: ${fullDomain}，原因: ${res?.message || "接口无响应"}`);
    }
    await sleep(800);
  }
}

// 获取域名列表
async function listDomains(env, log) {
  try {
    const r = await fetch(`${API_HOST}/index.php?m=domain_hub&endpoint=subdomains&action=list`, {
      method: "GET",
      headers: {
        "X-API-Key": env.API_KEY,
        "X-API-Secret": env.API_SECRET,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
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
    return d.subdomains?.filter(item => item.status === "active") || [];
  } catch (e) {
    log("listDomains 异常: " + e);
    return [];
  }
}

// 续期单个域名
async function renew(env, id) {
  try {
    const r = await fetch(`${API_HOST}/index.php?m=domain_hub&endpoint=subdomains&action=renew`, {
      method: "POST",
      headers: {
        "X-API-Key": env.API_KEY,
        "X-API-Secret": env.API_SECRET,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      body: JSON.stringify({ subdomain_id: id }),
    });

    if (!r.ok) {
      return { success: false, message: `HTTP ${r.status}` };
    }
    return await r.json();
  } catch (e) {
    return { success: false, message: String(e) };
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// 前端页面
function pageHtml() {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>DNSHE 自动续期</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
body{background:#f0f2f5;display:flex;justify-content:center;align-items:center;min-height:100vh;padding:20px}
.container{width:100%;max-width:720px;background:#fff;border-radius:16px;padding:30px;box-shadow:0 4px 20px rgba(0,0,0,0.06)}
h1{text-align:center;font-size:24px;color:#1e293b;margin-bottom:24px}
.btn-run{width:100%;padding:14px;font-size:16px;font-weight:500;color:#fff;background:#2563eb;border:none;border-radius:10px;cursor:pointer}
.btn-run:hover{background:#1d4ed8}
.btn-run:disabled{background:#94a3b8;cursor:not-allowed}
.log-card{margin-top:20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;min-height:240px;max-height:500px;overflow-y:auto;font-size:14px;line-height:1.6;white-space:pre-wrap}
.log-success{color:#059669;font-weight:500}
.log-error{color:#dc2626;font-weight:500}
.log-normal{color:#334155}
.log-warning{color:#d97706;font-weight:500}
</style>
</head>
<body>
<div class="container">
  <h1>DNSHE 自动续期（仅180天内续期）</h1>
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
    }else if(line.includes('❌')||line.includes('失败')||line.includes('错误')||line.includes('异常')){
      logEl.innerHTML+='<span class="log-error">'+txt+'</span><br>'
    }else if(line.includes('⚠️')){
      logEl.innerHTML+='<span class="log-warning">'+txt+'</span><br>'
    }else{
      logEl.innerHTML+='<span class="log-normal">'+txt+'</span><br>'
    }
    logEl.scrollTop=logEl.scrollHeight;
    if(line.includes('全部完成')||line.includes('无活跃子域名')||line.includes('配置')){
      es.close();
      btn.disabled=false;
      btn.textContent='开始续期';
    }
  };
  es.onerror=err=>{
    console.error(err);
    es.close();
    btn.disabled=false;
    btn.textContent='开始续期';
  };
}
</script>
</body>
</html>
  `;
}
