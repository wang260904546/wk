// @LastEditTime: "2026-04-10"
// 四川联通周二福利秒杀（接口固化版）

const $ = new Env("四川联通周二福利秒杀");
const crypto = require("crypto");

// ==================== 固定配置 ====================
const FIXED_CONFIG = {
  stop_keywords: ["今天已参与", "已抢完", "来晚了", "认证失败", "活动结束"]
};
const ACTIVITY_ID = "tuesday_benefits_2026";

const API_CHECK_SC_USER = "https://sclyh.169ol.com/2b2c-mobile/api/seckill/checkSCUser";
const API_CHECK_USER = "https://sclyh.169ol.com/2b2c-mobile/api/seckill/checkUser";
const API_PRIZE_LIST = "https://sclyh.169ol.com/2b2c-mobile/api/seckill/prizeList";
const API_SECKILL_DO = "https://sclyh.169ol.com/2b2c-mobile/api/seckill/do";

const PRIZE_NAME_MAP = {
  "1": "20元话费券",
  "2": "5元话费券",
  "3": "喜马拉雅会员-周卡",
  "4": "QQ音乐会员-周卡",
  "5": "8GB流量包",
  "10": "10元话费券",
  "11": "爱奇艺月卡",
  "12": "哔哩哗哩大会员",
  "13": "滴滴快车5元代金券"
};

const IS_TEST = (process.env.TEST_MODE || "").toString() === "1";

// ==================== 工具 ====================
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function Env(n) { return { name: n, log: console.log }; }

// 定时等待函数
async function waitForExactTime(targetTimeStr) {
  if (IS_TEST) return;
  const now = new Date();
  let [timePart, msPart] = targetTimeStr.split('.');
  if (!msPart) msPart = '000';
  
  const [hrs, mins, secs] = timePart.split(':').map(Number);
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hrs, mins, secs, Number(msPart));

  if (target <= now) return;

  while (true) {
    const diff = target - new Date();
    if (diff <= 0) break;
    if (diff > 2000) await sleep(1000);
    else if (diff > 50) await sleep(10);
    else {
      while (new Date() < target) {} // 最后50ms开启CPU自旋锁，消除事件循环延迟
      break;
    }
  }
}

// ==================== 核心服务 ====================
class SeckillService {
  constructor(token_online, index = 0) {
    this.token_online = token_online;
    this.index = index + 1;
    this.mobile = "";
    this.market_token = "";
  }

  log(msg) {
    const timeStr = new Date().toLocaleTimeString("en-US", { hour12: false });
    console.log(`[${timeStr}] 账号[${this.index}] ${msg}`);
  }

  getConfig() {
    return {
      baseUrl: "https://sclyh.169ol.com",
      activityId: ACTIVITY_ID,
      phoneNumber: "uqqle2c5d3806d18fubdk9e==",
      headers: {
        "Host": "sclyh.169ol.com",
        "Accept": "*/*",
        "Sec-Fetch-Site": "same-origin",
        "Accept-Language": "zh-CN,en-US;q=0.8",
        "token": "h5_notLoggedIn_7Zd04iNcte2M30gI",
        "Sec-Fetch-Mode": "cors",
        "Content-Type": "application/json;charset=UTF-8",
        "Referer": "https://sclyh.169ol.com/micropage/pages/tuesdayBenefits/index",
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) unicom{version:iphone_c@12.1001};ltst;OSVersion/18.5",
        "Connection": "keep-alive",
        "Sec-Fetch-Dest": "empty"
      }
    };
  }

  async checkSCUser() {
    const cfg = this.getConfig();
    const axios = require("axios");
    try {
      const params = {
        phoneNumber: cfg.phoneNumber,
        activityId: cfg.activityId,
        timestamp: Date.now()
      };
      this.log(`🔍 第一步：校验四川联通用户...`);
      const { data } = await axios.get(API_CHECK_SC_USER, { headers: cfg.headers, params });
      this.log(`📋 checkSCUser响应: ${JSON.stringify(data)}`);

      if (data.resultCode === "0000" && data.data === true) {
        this.log("✅ 校验通过：四川联通用户");
        return true;
      } else {
        this.log("❌ 校验失败：非四川联通用户，无法参与");
        return false;
      }
    } catch (e) {
      this.log(`❌ 校验用户异常：${e.message}`);
      return false;
    }
  }

  async checkUser() {
    const cfg = this.getConfig();
    const axios = require("axios");
    try {
      const params = {
        phoneNumber: cfg.phoneNumber,
        activityId: cfg.activityId,
        timestamp: Date.now()
      };
      this.log(`🔍 第二步：校验今日参与状态...`);
      const { data } = await axios.get(API_CHECK_USER, { headers: cfg.headers, params });
      this.log(`📋 checkUser响应: ${JSON.stringify(data)}`);

      if (data.resultCode === "0000" && data.data === false) {
        this.log("✅ 今日未参与，可以秒杀");
        return true;
      } else {
        this.log("⚠️ 今日已参与，跳过");
        return false;
      }
    } catch (e) {
      this.log(`❌ 校验参与状态异常：${e.message}`);
      return false;
    }
  }

  async queryPrizeList() {
    const cfg = this.getConfig();
    const axios = require("axios");
    try {
      const params = {
        activityId: cfg.activityId,
        timestamp: Date.now(),
        phoneNumber: cfg.phoneNumber
      };
      this.log(`🔍 第三步：查询商品列表...`);
      const { data } = await axios.post(API_PRIZE_LIST, {}, { headers: cfg.headers, params });
      this.log(`📋 prizeList响应: ${JSON.stringify(data)}`);

      if (data.resultCode === "0000") {
        const am = data.data.secKillPrizeAM || [];
        const pm = data.data.secKillPrizePM || [];
        this.log(`📦 商品列表获取成功`);
        console.log(`\n${"=".repeat(50)}`);
        this.log(`🔆 上午场（共${am.length}个商品）：`);
        am.forEach(p => {
          const stock = p.sessionStock > 0 ? `✅有货` : `❌售罄`;
          this.log(`   [${p.id}] ${p.miniPrizeName} ${stock}`);
        });
        this.log(`\n🌙 下午场（共${pm.length}个商品）：`);
        pm.forEach(p => {
          const stock = p.sessionStock > 0 ? `✅有货` : `❌售罄`;
          this.log(`   [${p.id}] ${p.miniPrizeName} ${stock}`);
        });
        console.log(`${"=".repeat(50)}\n`);
        return { am, pm };
      } else {
        this.log(`⚠️ 查询商品失败：${data.resultCode} | ${data.resultMsg}`);
        return null;
      }
    } catch (e) {
      this.log(`❌ 查询商品异常：${e.message}`);
      return null;
    }
  }

  // 企业微信推送
  async sendWechatMessage(content) {
    try {
      const webhookUrl = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=d0ee6878-96fe-46d9-b18e-997edfec7b32";
      const axios = require("axios");
      await axios.post(webhookUrl, {
        msgtype: "text",
        text: {
          content: content
        }
      }, {
        headers: {
          "Content-Type": "application/json"
        }
      });
      this.log("✅ 企业微信推送成功");
    } catch (e) {
      this.log(`❌ 企业微信推送失败: ${e.message}`);
    }
  }

  async seckill(prizeId, prizeName) {
    const cfg = this.getConfig();
    const axios = require("axios");
    try {
      const requestData = {
        prizeConfigId: prizeId,
        phoneNumber: cfg.phoneNumber,
        activityId: cfg.activityId,
        timestamp: Date.now()
      };
      this.log(`🚀 执行秒杀: ${prizeName}（ID:${prizeId}）`);
      this.log(`📋 请求参数: ${JSON.stringify(requestData)}`);
      this.log(`📋 请求头: ${JSON.stringify(cfg.headers)}`);
      
      const response = await axios.post(API_SECKILL_DO, requestData, { 
        headers: cfg.headers,
        validateStatus: false // 不抛出400错误，让我们查看完整响应
      });
      
      this.log(`📋 响应状态码: ${response.status}`);
      this.log(`📋 响应头: ${JSON.stringify(response.headers)}`);
      this.log(`📋 响应数据: ${JSON.stringify(response.data)}`);

      if (response.status === 200 && response.data.resultCode === "0000") {
        this.log(`🎉 秒杀成功：${prizeName}`);
        // 推送消息到企业微信
        const phoneNumber = cfg.phoneNumber || "未知";
        await this.sendWechatMessage(`${phoneNumber} 秒杀成功的商品：${prizeName}`);
        return true;
      } else {
        this.log(`❌ 秒杀失败：状态码 ${response.status} | ${response.data.resultCode} | ${response.data.resultMsg}`);
        return false;
      }
    } catch (e) {
      this.log(`❌ 秒杀异常：${e.message}`);
      if (e.response) {
        this.log(`📋 异常响应状态码: ${e.response.status}`);
        this.log(`📋 异常响应数据: ${JSON.stringify(e.response.data)}`);
      }
      return false;
    }
  }

  async start() {
    this.log("🚀 开始四川联通周二福利秒杀");

    const isSC = await this.checkSCUser();
    if (!isSC) return;

    const canRun = await this.checkUser();
    if (!canRun) return;

    const list = await this.queryPrizeList();
    if (!list) return;

    // 从查询结果中获取实际的商品ID
    const hour = new Date().getHours();
    let targetIds = [];
    let targetNames = [];
    let scheduledTime;

    if (hour < 12) {
      // 上午场：11:00开始
      scheduledTime = "11:00:00.020";
      this.log(`⏳ 正在等待上午场开始时间 [${scheduledTime}]...`);
      await waitForExactTime(scheduledTime);
      this.log(`🚀 上午场开始时间已到，开始抢购！`);
      
      // 重新查询商品列表，确保获取最新的商品ID
      const latestList = await this.queryPrizeList();
      if (latestList && latestList.am) {
        // 优先选择有库存的商品
        const availableItems = latestList.am.filter(item => item.sessionStock > 0);
        if (availableItems.length > 0) {
          targetIds = availableItems.map(item => item.id);
          targetNames = availableItems.map(item => item.miniPrizeName);
          this.log(`📋 上午场可用商品：${targetNames.join(', ')}`);
        } else {
          this.log("⚠️ 上午场无可用商品");
          return;
        }
      }
    } else {
      // 下午场：17:00开始
      scheduledTime = "17:00:00.020";
      this.log(`⏳ 正在等待下午场开始时间 [${scheduledTime}]...`);
      await waitForExactTime(scheduledTime);
      this.log(`🚀 下午场开始时间已到，开始抢购！`);
      
      // 重新查询商品列表，确保获取最新的商品ID
      const latestList = await this.queryPrizeList();
      if (latestList && latestList.pm) {
        // 优先选择有库存的商品
        const availableItems = latestList.pm.filter(item => item.sessionStock > 0);
        if (availableItems.length > 0) {
          targetIds = availableItems.map(item => item.id);
          targetNames = availableItems.map(item => item.miniPrizeName);
          this.log(`📋 下午场可用商品：${targetNames.join(', ')}`);
        } else {
          this.log("⚠️ 下午场无可用商品");
          return;
        }
      }
    }

    // 如果没有可用商品，使用默认配置
    if (targetIds.length === 0) {
      if (hour < 12) {
        targetIds = ["4", "3", "2"];
        targetNames = ["QQ音乐会员-周卡", "喜马拉雅会员-周卡", "5元话费券"];
      } else {
        targetIds = ["11", "12", "13"];
        targetNames = ["爱奇艺月卡", "哔哩哗哩大会员", "滴滴快车5元代金券"];
      }
      this.log(`⚠️ 使用默认商品配置：${targetNames.join(', ')}`);
    }

    let success = false;
    for (let i = 0; i < targetIds.length; i++) {
      const prizeId = targetIds[i];
      const prizeName = targetNames[i] || PRIZE_NAME_MAP[prizeId] || `商品${prizeId}`;
      this.log(`🎯 尝试领取：${prizeName}（ID:${prizeId}）`);
      const result = await this.seckill(prizeId, prizeName);
      if (result) {
        success = true;
        break;
      }
      this.log(`⚠️ ${prizeName} 领取失败，尝试下一个...`);
      await sleep(300);
    }

    if (!success) {
      this.log("❌ 所有商品均领取失败");
    }
  }
}

// ==================== 入口 ====================
async function main() {
  console.log("=====================================");
  console.log("    四川联通周二福利秒杀（接口固化版）");
  console.log("=====================================");
  const tokenStr = process.env.chinaUnicomCookie || "";
  const tokens = tokenStr.split(/[\n&@]/).map(t => t.trim()).filter(Boolean);
  if (tokens.length === 0) {
    console.log("❌ 请配置环境变量：chinaUnicomCookie");
    return;
  }

  const tasks = tokens.map((token, i) => {
    const service = new SeckillService(token, i);
    return service.start();
  });
  await Promise.all(tasks);
  console.log("🏁 所有账号执行完成");
}

if (require.main === module) main().catch(console.error);
module.exports = { SeckillService };
