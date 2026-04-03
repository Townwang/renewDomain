// ========== 配置区（按你的实际信息修改） ==========
const CONFIG = {
  API_KEY: "cfsd_59a3c7ef2963fa83380c2f25fc949cca",
  API_SECRET: "fa76d3edd6a43286e91f2630e5d912dafbe77992c0396f7a56b421edee31b4c7",
  RENEW_INTERVAL_DAYS: 180, // 严格匹配文档：到期前180天开启续期
  REQUEST_DELAY_MS: 800, // 请求间隔，避免被限流
};
// ==================================================

const API_HOST = "https://api005.dnshe.com";

// 全局日志存储（用于页面实时展示）
let executionLogs = [];

// 统一日志方法：同时打印到控制台和页面日志
function log(message) {
  const timestamp = new Date().toISOString();
  const logMsg = `[${timestamp}] ${message}`;
  console.log(logMsg);
  executionLogs.push(logMsg);
}

export default {
  // 处理HTTP请求（页面+接口）
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. 手动触发续期接口（流式日志，实时返回）
    if (url.pathname === "/run") {
      executionLogs = []; // 清空历史日志
      // 后台异步执行续期任务，不阻塞响应
      ctx.waitUntil(autoRenewAll());
      return new Response(JSON.stringify({ status: "started", logs: executionLogs }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // 2. 实时获取日志接口（用于页面轮询）
    if (url.pathname === "/logs") {
      return new Response(JSON.stringify({ logs: executionLogs }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // 3. 主页：带按钮+实时日志面板
    return new Response(getHtmlPage(), {
      headers: { "Content-Type": "text/html;charset=utf-8" },
    });
  },

  // 定时任务：自动执行续期（按cron配置）
  async scheduled(event, env, ctx) {
    executionLogs = [];
    log("=== 定时自动续期任务启动 ===");
    ctx.waitUntil(autoRenewAll());
  },
};

// 主流程：获取所有域名 → 批量续期（完全符合文档）
async function autoRenewAll() {
  log("=== 开始执行DNSHE免费域名自动续期 ===");

  // 1. 获取所有子域名列表（文档步骤2）
  const domainList = await listAllSubdomains();
  if (!domainList || domainList.length === 0) {
    log("❌ 未获取到任何子域名，任务终止");
    return;
  }

  log(`✅ 成功获取 ${domainList.length} 个有效子域名`);

  // 2. 逐个执行续期（文档步骤3）
  for (const item of domainList) {
    const { id, subdomain, expires_at } = item;
    log(`🔄 正在处理域名: ${subdomain} (ID: ${id})`);
    if (expires_at) log(`📅 当前到期时间: ${expires_at}`);

    const result = await renewSubdomain(id);
    
    // 严格匹配文档的成功判断
    if (result?.success === true) {
      log(`✅ 续期成功: ${subdomain}`);
      log(`   旧到期时间: ${result.previous_expires_at}`);
      log(`   新到期时间: ${result.new_expires_at}`);
      log(`   费用: ${result.charged_amount} (免费续期)`);
    } else {
      log(`❌ 续期失败: ${subdomain}`);
      log(`   失败原因: ${result?.message || "未知错误"}`);
    }

    // 限流：避免请求过快被API拦截
    await sleep(CONFIG.REQUEST_DELAY_MS);
  }

  log("=== 全部续期任务执行完成 ===");
}

// 步骤2：获取所有子域名列表（完全符合文档）
async function listAllSubdomains() {
  try {
    const url = `${API_HOST}/index.php?m=domain_hub&endpoint=dns_records&action=list`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-API-Key": CONFIG.API_KEY,
        "X-API-Secret": CONFIG.API_SECRET,
      },
    });

    if (!response.ok) {
      log(`❌ 获取域名列表失败，HTTP状态码: ${response.status}`);
      return [];
    }

    const data = await response.json();
    if (data?.success !== true) {
      log(`❌ API返回错误: ${data?.message || "未知错误"}`);
      return [];
    }

    return data.subdomains || [];
  } catch (error) {
    log(`❌ 获取域名列表异常: ${error.message}`);
    return [];
  }
}

// 步骤3：续期单个子域名（完全符合文档，修复了核心错误）
async function renewSubdomain(subdomainId) {
  try {
    // ✅ 正确的续期接口：action=renew（原代码是list，完全错误）
    const url = `${API_HOST}/index.php?m=domain_hub&endpoint=dns_records&action=renew&subdomain_id=${subdomainId}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-API-Key": CONFIG.API_KEY,
        "X-API-Secret": CONFIG.API_SECRET,
      },
    });

    if (!response.ok) {
      return { success: false, message: `HTTP错误: ${response.status}` };
    }

    return await response.json();
  } catch (error) {
    return { success: false, message: error.message };
  }
}

// 延时工具（限流用）
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 页面HTML：带实时日志滚动（优化体验）
function getHtmlPage() {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DNSHE 免费域名自动续期面板</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; font-family: system-ui, -apple-system, Segoe UI, Roboto; }
    body { background: #f6f8fa; padding: 20px; }
    .container { max-width: 900px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); padding: 24px; }
    h1 { font-size: 24px; color: #1f2937; margin-bottom: 20px; }
    .btn-group { margin-bottom: 20px; }
    #startBtn { padding: 12px 24px; background: #2563eb; color: #fff; border: none; border-radius: 8px; font-size: 16px; cursor: pointer; transition: background 0.2s; }
    #startBtn:disabled { background: #94a3b8; cursor: not-allowed; }
    #logPanel { background: #0f172a; color: #10b981; padding: 16px; border-radius: 8px; height: 500px; overflow-y: auto; font-size: 14px; line-height: 1.6; white-space: pre-wrap; font-family: 'Courier New', monospace; }
    .tip { margin-top: 16px; color: #6b7280; font-size: 13px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>DNSHE 免费域名自动续期</h1>
    <div class="btn-group">
      <button id="startBtn">开始手动续期</button>
    </div>
    <div id="logPanel">等待执行...\n</div>
    <p class="tip">提示：续期成功后，域名有效期将自动延长1年，完全免费</p>
  </div>

  <script>
    const startBtn = document.getElementById('startBtn');
    const logPanel = document.getElementById('logPanel');
    let logPolling = null;

    // 实时更新日志
    function updateLogs(logs) {
      logPanel.textContent = logs.join('\\n');
      logPanel.scrollTop = logPanel.scrollHeight; // 自动滚动到底部
    }

    // 轮询获取日志
    function startLogPolling() {
      logPolling = setInterval(async () => {
        try {
          const res = await fetch('/logs');
          const data = await res.json();
          updateLogs(data.logs);
        } catch (e) {
          console.error('日志轮询失败', e);
        }
      }, 1000);
    }

    startBtn.addEventListener('click', async () => {
      startBtn.disabled = true;
      startBtn.textContent = '执行中...';
      logPanel.textContent = '正在启动续期任务...\\n';
      
      // 启动日志轮询
      startLogPolling();

      try {
        // 触发续期任务
        const res = await fetch('/run');
        const data = await res.json();
        if (data.status === 'started') {
          logPanel.textContent += '✅ 任务已启动，实时日志如下：\\n';
        }
      } catch (e) {
        logPanel.textContent += '❌ 任务启动失败: ${e.message}\\n';
        clearInterval(logPolling);
        startBtn.disabled = false;
        startBtn.textContent = '开始手动续期';
      }

      // 30秒后自动停止轮询（任务完成）
      setTimeout(() => {
        clearInterval(logPolling);
        startBtn.disabled = false;
        startBtn.textContent = '开始手动续期';
        logPanel.textContent += '\\n=== 任务执行结束，可重新触发 ===';
      }, 30000);
    });
  </script>
</body>
</html>
  `;
}
