// @LastEditTime: "2026-04-14"
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
    
    // 添加cookie管理和got库配置
    const { CookieJar } = require("tough-cookie");
    this.cookieJar = new CookieJar(undefined, { rejectPublicSuffixes: true, looseMode: true });
    this.got = require("got").extend({
      cookieJar: this.cookieJar, timeout: 30000, followRedirect: false, retry: { limit: 1 }, headers: { "Connection": "keep-alive" }
    });
  }

  log(msg) {
    const timeStr = new Date().toLocaleTimeString("en-US", { hour12: false });
    const timestamp = `[${timeStr}]`;
    const accountPrefix = `账号[${this.index}]`;
    console.log(`${timestamp} ${accountPrefix} ${msg}`);
  }

  // 美化日志输出
  info(msg) {
    this.log(`ℹ️ ${msg}`);
  }

  success(msg) {
    this.log(`✅ ${msg}`);
  }

  warning(msg) {
    this.log(`⚠️ ${msg}`);
  }

  error(msg) {
    this.log(`❌ ${msg}`);
  }

  debug(msg) {
    if (IS_TEST) {
      this.log(`🔍 ${msg}`);
    }
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

  async checkSCUser() {
    const cfg = this.getConfig();
    const axios = require("axios");
    try {
      const params = {
        phoneNumber: cfg.phoneNumber,
        activityId: cfg.activityId,
        timestamp: Date.now()
      };
      this.info(`第一步：校验四川联通用户...`);
      const { data } = await axios.get(API_CHECK_SC_USER, { headers: cfg.headers, params });
      this.debug(`checkSCUser响应: ${JSON.stringify(data)}`);

      if (data.resultCode === "0000" && data.data === true) {
        this.success("校验通过：四川联通用户");
        return true;
      } else {
        this.error("校验失败：非四川联通用户，无法参与");
        return false;
      }
    } catch (e) {
      this.error(`校验用户异常：${e.message}`);
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
      this.info(`第二步：校验今日参与状态...`);
      const { data } = await axios.get(API_CHECK_USER, { headers: cfg.headers, params });
      this.debug(`checkUser响应: ${JSON.stringify(data)}`);

      if (data.resultCode === "0000" && data.data === false) {
        this.success("今日未参与，可以秒杀");
        return true;
      } else {
        this.warning("今日已参与，跳过");
        return false;
      }
    } catch (e) {
      this.error(`校验参与状态异常：${e.message}`);
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
      this.info(`第三步：查询商品列表...`);
      const { data } = await axios.post(API_PRIZE_LIST, {}, { headers: cfg.headers, params });
      this.debug(`prizeList响应: ${JSON.stringify(data)}`);

      if (data.resultCode === "0000") {
        const am = data.data.secKillPrizeAM || [];
        const pm = data.data.secKillPrizePM || [];
        this.success(`商品列表获取成功`);
        console.log(`\n${"=".repeat(50)}`);
        this.info(`上午场（共${am.length}个商品）：`);
        am.forEach(p => {
          const stock = p.sessionStock > 0 ? `✅有货 (库存: ${p.sessionStock})` : `❌售罄`;
          console.log(`   [${p.id}] ${p.miniPrizeName} ${stock}`);
        });
        this.info(`下午场（共${pm.length}个商品）：`);
        pm.forEach(p => {
          const stock = p.sessionStock > 0 ? `✅有货 (库存: ${p.sessionStock})` : `❌售罄`;
          console.log(`   [${p.id}] ${p.miniPrizeName} ${stock}`);
        });
        console.log(`${"=".repeat(50)}\n`);
        return { am, pm };
      } else {
        this.warning(`查询商品失败：${data.resultCode} | ${data.resultMsg}`);
        return null;
      }
    } catch (e) {
      this.error(`查询商品异常：${e.message}`);
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
      this.success("企业微信推送成功");
    } catch (e) {
      this.error(`企业微信推送失败: ${e.message}`);
    }
  }

  // 生成随机字符串
  randomString(len) {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-";
    let r = '';
    for (let i = 0; i < len; i++) r += chars.charAt(Math.floor(Math.random() * chars.length));
    return r;
  }

  // 基础登录
  async onLine() {
    try {
      const userAgent_base = "Dalvik/2.1.0 (Linux; U; Android 9; ALN-AL10 Build/PQ3A.190705.11211540);unicom{version:android@11.0000}";
      
      this.info("🔓 正在进行基础登录...");
      const r = await this.got({
        method: "post",
        url: "https://m.client.10010.com/mobileService/onLine.htm",
        headers: { "User-Agent": userAgent_base, "Content-Type": "application/x-www-form-urlencoded" },
        body: `isFirstInstall=1&netWay=Wifi&version=android@11.0000&deviceId=${this.token_online || 'test'}&token_online=${this.token_online || 'test'}&provinceChanel=general&deviceModel=ALN-AL10&step=dingshi&androidId=291a7deb1d716b5a&reqtime=${Date.now()}`
      });
      
      let body;
      try { body = JSON.parse(r.body); } catch (e) { body = r.body; }
      
      if (body.code == 0 || body.code == 200) {
        this.mobile = body.desmobile || "";
        this.info(`✅ 基础登录成功 ${this.mobile ? this.mobile : '未知号码'}`);
        return true;
      }
      this.error(`❌ 基础登录失败: ${body.msg || body.code}`);
      return false;
    } catch (e) {
      this.error(`❌ 登录异常: ${e.message}`);
      return false;
    }
  }

  // 登录权益超市获取token
  async loginMarket() {
    try {
      // 先进行基础登录
      if (!await this.onLine()) {
        this.error("❌ 基础登录失败，无法获取Ticket");
        return false;
      }
      
      this.info("🔓 登录权益超市...");
      
      // 使用与10点抢购v2.0.js相同的User-Agent
      const userAgent_base = "Dalvik/2.1.0 (Linux; U; Android 9; ALN-AL10 Build/PQ3A.190705.11211540);unicom{version:android@11.0000}";
      
      // 第一步：获取ticket
      const r = await this.got({
        method: "get",
        url: "https://m.client.10010.com/mobileService/openPlatform/openPlatLineNew.htm",
        headers: { "User-Agent": userAgent_base },
        searchParams: { to_url: "https://contact.bol.wo.cn/" }
      });
      
      let ticket = null;
      if (r.headers?.location) {
        ticket = new URL(r.headers.location).searchParams.get("ticket");
      }
      
      if (!ticket) {
        this.error("❌ 权益超市: 获取Ticket失败");
        return false;
      }
      
      // 第二步：使用ticket登录获取token
      const yGdtco4r = this.randomString(800);
      
      const loginR = await this.got({
        method: "post",
        url: `https://backward.bol.wo.cn/prod-api/auth/marketUnicomLogin?yGdtco4r=${yGdtco4r}`,
        headers: {
          "Host": "backward.bol.wo.cn",
          "Connection": "keep-alive",
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": userAgent_base,
          "Referer": "https://contact.bol.wo.cn/"
        },
        body: `ticket=${ticket}`
      });
      
      let loginBody;
      try { loginBody = JSON.parse(loginR.body); } catch (e) { loginBody = loginR.body; }
      
      if (loginBody.code === 200 && loginBody.data?.token) {
        this.market_token = loginBody.data.token;
        this.success("✅ 权益超市: 登录成功");
        return true;
      } else {
        this.error(`❌ 权益超市: 登录失败: ${loginBody.msg || JSON.stringify(loginBody)}`);
        return false;
      }
    } catch (e) {
      this.error(`❌ 登录权益超市异常: ${e.message}`);
      return false;
    }
  }

  // 查询会员信息
  async queryVipInfo() {
    try {
      // 先登录权益超市获取token
      const loginSuccess = await this.loginMarket();
      if (!loginSuccess || !this.market_token) {
        this.error("❌ 无法获取会员信息：登录权益超市失败");
        return;
      }
      
      const axios = require("axios");
      this.info("🔍 查询会员信息...");
      const response = await axios.post(
        "https://backward.bol.wo.cn/prod-api/market/contactVip/selectInfo",
        { vipType: 0 },
        {
          headers: {
            "Host": "backward.bol.wo.cn",
            "Connection": "keep-alive",
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) unicom{version:iphone_c@12.1001};ltst;OSVersion/18.5",
            "Authorization": `Bearer ${this.market_token}`,
            "Referer": "https://contact.bol.wo.cn/"
          }
        }
      );
      
      if (response.data.code === 200 && response.data.data && response.data.data.length > 0) {
        const userInfo = response.data.data[0];
        this.mobile = userInfo.mobile || "未知";
        this.info(`📱 手机号：${this.mobile}`);
        this.info(`⭐ 会员等级：${userInfo.level || "0"}`);
        this.info(`📈 成长值：${userInfo.growthValue || "0"}`);
        this.info(`⏳ 会员到期：${userInfo.endTime || "无"}`);
      } else {
        this.error(`⚠️ 查询会员信息失败：${response.data.msg || JSON.stringify(response.data)}`);
      }
    } catch (e) {
      this.error(`查询会员信息异常: ${e.message}`);
    }
  }

  async seckill(prizeId, prizeName) {
    const cfg = this.getConfig();
    const axios = require("axios");
    
    // 前置资格校验
    this.info(`执行前置资格校验`);
    try {
      const checkTs = Date.now();
      const checkUrl = `https://${cfg.headers["Host"]}/2b2c-mobile/api/seckill/checkSCUser`;
      const checkParams = {
        phoneNumber: cfg.phoneNumber,
        activityId: cfg.activityId,
        timestamp: checkTs
      };
      
      this.debug(`资格校验参数: ${JSON.stringify(checkParams)}`);
      const checkResponse = await axios.get(checkUrl, { headers: cfg.headers, params: checkParams, timeout: 5000 });
      const checkData = checkResponse.data;
      
      this.debug(`资格校验响应: ${JSON.stringify(checkData)}`);
      console.log("=".repeat(50));
      console.log("[1] 资格校验结果：", checkData);
      
      if (checkData.resultCode !== "0000" || checkData.data !== true) {
        this.error(`资格校验失败：${checkData.resultCode} | ${checkData.resultMsg}`);
        return false;
      }
      
      this.success(`资格校验通过，可以执行秒杀`);
    } catch (e) {
      this.error(`资格校验出错：${e.message}`);
      return false;
    }
    
    // 执行秒杀
    try {
      const ts = Date.now();
      const url = `https://${cfg.headers["Host"]}/2b2c-mobile/api/seckill/do`;
      const params = {
        prizeConfigId: prizeId,
        phoneNumber: cfg.phoneNumber,
        activityId: cfg.activityId,
        timestamp: ts
      };
      this.info(`执行秒杀: ${prizeName}（ID:${prizeId}）`);
      const { data } = await axios.post(url, {}, { headers: cfg.headers, params });
      this.debug(`seckill响应: ${JSON.stringify(data)}`);
      console.log("=".repeat(50));
      console.log("[3] 秒杀执行结果：", JSON.stringify(data));

      if (data.resultCode === "0000") {
        this.success(`秒杀成功：${prizeName}`);
        // 推送消息到企业微信
        const phoneNumber = this.mobile || cfg.phoneNumber || "未知";
        await this.sendWechatMessage(`${phoneNumber} 秒杀成功的商品：${prizeName}`);
        return true;
      } else {
        this.error(`秒杀失败：${data.resultCode} | ${data.resultMsg}`);
        return false;
      }
    } catch (e) {
      console.log("秒杀出错：", e.message);
      return false;
    }
  }

  async start() {
    this.info("开始四川联通周二福利秒杀");

    // 查询会员信息
    await this.queryVipInfo();

    const isSC = await this.checkSCUser();
    if (!isSC) return;

    const canRun = await this.checkUser();
    if (!canRun) return;

    const list = await this.queryPrizeList();
    if (!list) return;

    const hour = new Date().getHours();
    let targetIds, targetNames, scheduledTime;

    if (hour < 12) {
      // 上午场：11:00开始抢QQ音乐（12:00之前都可以抢购）
      scheduledTime = "11:00:00.020";
      targetIds = ["4", "2", "3"];
      targetNames = ["QQ音乐会员-周卡", "5元话费券", "喜马拉雅会员-周卡"];
      this.info(`正在等待上午场开始时间 [${scheduledTime}]...`);
      await waitForExactTime(scheduledTime);
      this.success(`上午场开始时间已到，开始抢购！`);
      this.info(`上午场抢购顺序：${targetNames.join(', ')}`);
    } else {
      // 下午场：17:00开始抢爱奇艺月卡
      scheduledTime = "17:00:00.020";
      targetIds = ["11", "12", "13"];
      targetNames = ["爱奇艺月卡", "哔哩哗哩大会员", "滴滴快车5元代金券"];
      this.info(`正在等待下午场开始时间 [${scheduledTime}]...`);
      await waitForExactTime(scheduledTime);
      this.success(`下午场开始时间已到，开始抢购！`);
      this.info(`下午场抢购顺序：${targetNames.join(', ')}`);
    }

    let success = false;
    for (let i = 0; i < targetIds.length; i++) {
      const prizeId = targetIds[i];
      const prizeName = targetNames[i] || PRIZE_NAME_MAP[prizeId] || `商品${prizeId}`;
      this.info(`尝试领取：${prizeName}（ID:${prizeId}）`);
      const result = await this.seckill(prizeId, prizeName);
      if (result) {
        success = true;
        break;
      }
      this.warning(`${prizeName} 领取失败，尝试下一个...`);
      await sleep(300);
    }

    if (!success) {
      this.error("所有商品均领取失败");
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