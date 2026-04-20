// @LastEditTime: 2026-04-14 | 四川联通周二福利秒杀（并发抢购版）
const $ = new Env("四川联通周二福利");
const crypto = require("crypto");

// ==================== 固定配置 ====================
const FIXED_CONFIG = {
  stop_keywords: ["今天已参与", "已抢完", "来晚了", "认证失败", "活动结束"]
};
const ACTIVITY_ID = "tuesday_benefits_2026";
// 接口地址 硬编码固化
const API_CHECK_SC_USER = "https://sclyh.169ol.com/2b2c-mobile/api/seckill/checkSCUser";
const API_CHECK_USER = "https://sclyh.169ol.com/2b2c-mobile/api/seckill/checkUser";
const API_PRIZE_LIST = "https://sclyh.169ol.com/2b2c-mobile/api/seckill/prizeList";
const API_SECKILL_DO = "https://sclyh.169ol.com/2b2c-mobile/api/seckill/do";

// 抢购商品配置（根据实际查询结果动态调整）
const MORNING_TARGETS = [
  { id: "4", name: "QQ音乐会员-周卡" },
  { id: "2", name: "5元话费券" },
  { id: "3", name: "喜马拉雅会员-周卡" }
];

const AFTERNOON_TARGETS = [
  { id: "11", name: "爱奇艺月卡" },
  { id: "12", name: "哔哩哗哩大会员" },
  { id: "13", name: "滴滴快车5元代金券" }
];

// ==================== 工具 ====================
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function Env(n) { return { name: n, log: console.log }; }

// 等待到指定时间并显示倒计时
async function waitUntil(targetHour, targetMinute, targetSecond = 0) {
  let lastLogTime = 0;
  
  while (true) {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentSecond = now.getSeconds();
    
    if (currentHour > targetHour ||
        (currentHour === targetHour && currentMinute > targetMinute) ||
        (currentHour === targetHour && currentMinute === targetMinute && currentSecond >= targetSecond)) {
      break;
    }
    
    // 计算倒计时
    const targetTime = new Date();
    targetTime.setHours(targetHour, targetMinute, targetSecond, 0);
    const diff = targetTime - now;
    
    if (diff > 0) {
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      
      // 每秒显示一次倒计时
      const currentTime = Date.now();
      if (currentTime - lastLogTime >= 1000) {
        console.log(`⏰ 距离抢购开始还有: ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
        lastLogTime = currentTime;
      }
    }
    
    await sleep(100);
  }
}

// ==================== 核心服务 ====================
class UnicomAuthService {
  constructor(token_online, index = 0) {
    this.token_online = token_online;
    this.index = index + 1;
    this.mobile = "";
    this.market_token = "";
    this.eligible = false;
  }
  log(msg) {
    const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false });
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
        "Accept-Encoding": "gzip, deflate, br",
        "token": "h5_notLoggedIn_7Zd04iNcte2M30gI",
        "Sec-Fetch-Mode": "cors",
        "Origin": "https://sclyh.169ol.com",
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) unicom{version:iphone_c@12.1001};ltst;OSVersion/18.5",
        "Referer": "https://sclyh.169ol.com/micropage/pages/tuesdayBenefits/index",
        "Connection": "keep-alive",
        "Content-Type": "application/x-www-form-urlencoded",
        "Sec-Fetch-Dest": "empty",
        "Cookie": "br-session-cache-e4466c71aafc4b578efcde9a51971345=[{\"appId\":\"e4466c71aafc4b578efcde9a51971345\",\"sessionID\":\"2b693183-496c-4b3d-ac97-8d292fcbdc22\",\"lastVisitedTime\":1775530832115}]; _pk_id.3.56f6=929217b66ee11f90.1775527377."
      }
    };
  }

  // 校验四川联通用户
  async checkSCUser() {
    const cfg = this.getConfig();
    const axios = require('axios');
    try {
      const params = {
        phoneNumber: cfg.phoneNumber,
        activityId: cfg.activityId,
        timestamp: Date.now()
      };
      const { data } = await axios.get(API_CHECK_SC_USER, { headers: cfg.headers, params });
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

  // 校验今日是否已抢
  async checkUser() {
    const cfg = this.getConfig();
    const axios = require('axios');
    try {
      const params = {
        phoneNumber: cfg.phoneNumber,
        activityId: cfg.activityId,
        timestamp: Date.now()
      };
      const { data } = await axios.get(API_CHECK_USER, { headers: cfg.headers, params });
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

  // 查询奖品列表
  async queryPrizeList() {
    const cfg = this.getConfig();
    const axios = require('axios');
    try {
      const params = {
        activityId: cfg.activityId,
        timestamp: Date.now(),
        phoneNumber: cfg.phoneNumber
      };
      this.log(`📡 发送商品列表请求：活动ID=${cfg.activityId}`);
      this.log(`📡 请求URL：${API_PRIZE_LIST}`);
      this.log(`📡 请求参数：${JSON.stringify(params)}`);
      const { data } = await axios.post(API_PRIZE_LIST, {}, { headers: cfg.headers, params });
      this.log(`📡 响应结果：${JSON.stringify(data)}`);
      if (data.resultCode === "0000") {
        this.log("📦 获取商品列表成功");
        const am = data.data.secKillPrizeAM || [];
        const pm = data.data.secKillPrizePM || [];
        this.log(`🔆 上午场(${am.length}个)：`);
        am.forEach(p => this.log(`   ${p.id} - ${p.miniPrizeName} | 库存：${p.sessionStock}`));
        this.log(`🌙 下午场(${pm.length}个)：`);
        pm.forEach(p => this.log(`   ${p.id} - ${p.miniPrizeName} | 库存：${p.sessionStock}`));
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
      const axios = require('axios');
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

  // 执行秒杀（使用动态构建的URL）
  async seckill(prizeId, prizeName) {
    const cfg = this.getConfig();
    const axios = require('axios');
    
    // 前置资格校验
    this.log(`🔍 执行前置资格校验`);
    try {
      const checkTs = Date.now();
      const checkUrl = `https://sclyh.169ol.com/2b2c-mobile/api/seckill/checkSCUser`;
      const checkParams = {
        phoneNumber: cfg.phoneNumber,
        activityId: cfg.activityId,
        timestamp: checkTs
      };
      const checkHeaders = {
        "Content-Type": "application/json;charset=UTF-8",
        "token": cfg.headers.token,
        "Cookie": cfg.headers.Cookie,
        "User-Agent": cfg.headers["User-Agent"],
        "Referer": cfg.headers.Referer
      };
      
      this.log(`📡 发送资格校验请求：活动ID=${cfg.activityId}`);
      this.log(`📡 请求URL：${checkUrl}`);
      this.log(`📡 请求参数：${JSON.stringify(checkParams)}`);
      
      const checkResponse = await axios.get(checkUrl, { headers: checkHeaders, params: checkParams, timeout: 5000 });
      const checkData = checkResponse.data;
      
      this.log(`📡 响应状态码：${checkResponse.status}`);
      this.log(`📡 响应结果：${JSON.stringify(checkData)}`);
      
      if (checkData.resultCode !== "0000" || checkData.data !== true) {
        this.log(`❌ 资格校验失败：${checkData.resultCode} | ${checkData.resultMsg}`);
        return false;
      }
      
      this.log(`✅ 资格校验通过，可以执行秒杀`);
    } catch (e) {
      this.log(`❌ 资格校验异常：${e.message}`);
      if (e.response) {
        this.log(`❌ 响应错误：${e.response.status} | ${JSON.stringify(e.response.data)}`);
      } else if (e.request) {
        this.log(`❌ 请求错误：未收到响应`);
      }
      return false;
    }
    
    // 执行秒杀
    try {
      const ts = Date.now();
      const url = `https://sclyh.169ol.com/2b2c-mobile/api/seckill/do`;
      const params = {
        prizeConfigId: prizeId,
        activityId: cfg.activityId,
        phoneNumber: cfg.phoneNumber,
        timestamp: ts
      };
      const headers = {
        "Content-Type": "application/json;charset=UTF-8",
        "token": cfg.headers.token,
        "Cookie": cfg.headers.Cookie,
        "User-Agent": cfg.headers["User-Agent"],
        "Referer": cfg.headers.Referer
      };
      this.log(`📡 发送秒杀请求：奖品ID=${prizeId}，活动ID=${cfg.activityId}`);
      this.log(`📡 请求URL：${url}`);
      this.log(`📡 请求参数：${JSON.stringify(params)}`);
      
      // 发送请求
      const response = await axios.post(url, {}, { headers, params, timeout: 10000 });
      const data = response.data;
      
      this.log(`📡 响应状态码：${response.status}`);
      this.log(`📡 响应结果：${JSON.stringify(data)}`);
      
      if (data.resultCode === "0000") {
        this.log(`🎉 秒杀成功：${prizeName}`);
        // 推送消息到企业微信
        const phoneNumber = cfg.phoneNumber || "未知";
        await this.sendWechatMessage(`${phoneNumber} 秒杀成功的商品：${prizeName}`);
        return true;
      } else {
        this.log(`❌ 秒杀失败：${data.resultCode} | ${data.resultMsg}`);
        // 针对6003错误的特殊处理
        if (data.resultCode === "6003") {
          this.log(`⚠️ 奖品配置不存在，可能是奖品ID或活动ID错误`);
          this.log(`⚠️ 建议：请先查询商品列表，确认正确的奖品ID`);
        }
        return false;
      }
    } catch (e) {
      this.log(`❌ 秒杀异常：${e.message}`);
      if (e.response) {
        this.log(`❌ 响应错误：${e.response.status} | ${JSON.stringify(e.response.data)}`);
      } else if (e.request) {
        this.log(`❌ 请求错误：未收到响应`);
      }
      return false;
    }
  }

  // 检查资格
  async checkEligibility() {
    this.log("🔍 检查参与资格");
    const isSC = await this.checkSCUser();
    this.log(`🔍 四川联通用户检查结果：${isSC ? "通过" : "不通过"}`);
    if (!isSC) return false;
    const canRun = await this.checkUser();
    this.log(`🔍 今日参与状态检查结果：${canRun ? "未参与" : "已参与"}`);
    if (!canRun) return false;
    this.eligible = true;
    this.log("✅ 资格检查通过");
    return true;
  }

  // 上午场抢购
  async morningSeckill() {
    if (!this.eligible) {
      this.log("❌ 无参与资格，跳过上午场");
      return;
    }
    
    this.log("🌅 开始上午场抢购");
    
    // 先查询商品列表，确认正确的奖品ID
    const prizeList = await this.queryPrizeList();
    if (!prizeList) {
      this.log("❌ 无法获取商品列表，跳过上午场");
      return;
    }
    
    // 模拟时间，直接执行抢购
    this.log("⏰ 模拟10:00 开始抢购");
    
    // 依次尝试抢购
    for (const target of MORNING_TARGETS) {
      this.log(`🎯 尝试抢购：${target.name}（ID:${target.id}）`);
      const success = await this.seckill(target.id, target.name);
      if (success) {
        this.log(`✅ 上午场抢购成功：${target.name}`);
        return;
      }
      // 间隔1秒后尝试下一个
      await sleep(1000);
    }
    
    this.log("❌ 上午场抢购失败");
  }

  // 下午场抢购
  async afternoonSeckill() {
    if (!this.eligible) {
      this.log("❌ 无参与资格，跳过下午场");
      return;
    }
    
    this.log("🌆 开始下午场抢购");
    
    // 先查询商品列表，确认正确的奖品ID
    const prizeList = await this.queryPrizeList();
    if (!prizeList) {
      this.log("❌ 无法获取商品列表，跳过下午场");
      return;
    }
    
    // 模拟时间，直接执行抢购
    this.log("⏰ 模拟17:00 开始抢购");
    
    // 依次尝试抢购
    for (const target of AFTERNOON_TARGETS) {
      this.log(`🎯 尝试抢购：${target.name}（ID:${target.id}）`);
      const success = await this.seckill(target.id, target.name);
      if (success) {
        this.log(`✅ 下午场抢购成功：${target.name}`);
        return;
      }
      // 间隔1秒后尝试下一个
      await sleep(1000);
    }
    
    this.log("❌ 下午场抢购失败");
  }

  async start() {
    this.log("🚀 开始四川联通周二福利秒杀");
    
    // 检查资格
    const eligible = await this.checkEligibility();
    if (!eligible) return;
    
    // 查询奖品列表
    await this.queryPrizeList();
    
    const now = new Date();
    const currentHour = now.getHours();
    
    // 执行抢购
    if (currentHour < 17) {
      await this.morningSeckill();
      // 如果上午场失败且时间未到下午场，等待到下午场
      if (currentHour < 17) {
        this.log("⏳ 等待下午场开始");
        await this.afternoonSeckill();
      }
    } else {
      await this.afternoonSeckill();
    }
  }
}

// ==================== 入口 ====================
async function main() {
  console.log("=====================================");
  console.log("    四川联通周二福利秒杀（并发抢购版）");
  console.log("=====================================");
  console.log("📋 开始执行脚本...");
  
  // 模拟一个token，以便测试
  const tokenStr = "test_token";
  const tokens = tokenStr.split(/[\n&@]/).map(t => t.trim()).filter(Boolean);
  
  console.log(`📋 环境变量检查：找到 ${tokens.length} 个token`);
  
  if (tokens.length === 0) {
    console.log("❌ 请配置环境变量：chinaUnicomCookie");
    return;
  }
  
  // 并发检查资格
  console.log("🚦 开始并发检查账号资格");
  const services = tokens.map((token, i) => new UnicomAuthService(token, i));
  const eligibilityChecks = services.map(service => service.checkEligibility());
  await Promise.all(eligibilityChecks);
  console.log("✅ 所有账号资格检查完成");
  
  // 并发执行抢购
  console.log("🚀 开始并发执行抢购任务");
  const seckillTasks = services.map(service => service.start());
  await Promise.all(seckillTasks);
  
  console.log("🏁 所有账号执行完成");
}

if (require.main === module) {
  console.log("📋 脚本入口点被触发");
  main().catch(error => {
    console.error("❌ 脚本执行出错：", error);
  });
}
module.exports = { UnicomAuthService };