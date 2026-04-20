// @LastEditTime: "2026-04-16"
// 领取优享会员脚本

const $ = new Env("领取优享会员");

// ==================== 配置 ====================
const API_TAKE_COUPON = "https://mgp.api.mucfc.com/?operationId=mucfc.activity.coupon.take";

// ==================== 工具 ====================
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function Env(n) { return { name: n, log: console.log }; }

// ==================== 核心服务 ====================
class CouponService {
  constructor(index = 0) {
    this.index = index + 1;
  }

  log(msg) {
    const timeStr = new Date().toLocaleTimeString("en-US", { hour12: false });
    console.log(`[${timeStr}] 账号[${this.index}] ${msg}`);
  }

  getConfig() {
    return {
      headers: {
        "Host": "mgp.api.mucfc.com",
        "Accept": "*/*",
        "Sec-Fetch-Site": "same-site",
        "Accept-Language": "zh-CN,zh-Hans;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Sec-Fetch-Mode": "cors",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "Origin": "https://act.mucfc.com",
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)  unicom{version:iphone_c@12.1001};ltst;OSVersion/18.5",
        "Referer": "https://act.mucfc.com/",
        "Connection": "keep-alive",
        "Sec-Fetch-Dest": "empty",
        "Cookie": "m_a_ch=3CUAPP; mtago=12008.41.02; MUGY=0; USER_CUST_GRP=\"\"; USER_ID_HASH=9590e50812406133ab280e54591ac694b2e37d16d22c99c812e411ff27f4a6e7; USER_TAIL_NUMBER=34; MUSESSIONID=891301298542A24C775FBBCF5015C6E9.3d"
      }
    };
  }

  // 发送HTTP请求的工具函数
  async sendRequest(url, options = {}) {
    const https = require('https');
    const zlib = require('zlib');
    return new Promise((resolve, reject) => {
      const req = https.request(url, options, (res) => {
        const chunks = [];
        res.on('data', (chunk) => {
          chunks.push(chunk);
        });
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const encoding = res.headers['content-encoding'];
          
          if (encoding === 'gzip') {
            zlib.gunzip(buffer, (err, decoded) => {
              if (err) {
                resolve({ status: res.statusCode, headers: res.headers, data: buffer.toString() });
                return;
              }
              try {
                const parsedData = JSON.parse(decoded.toString());
                resolve({ status: res.statusCode, headers: res.headers, data: parsedData });
              } catch (e) {
                resolve({ status: res.statusCode, headers: res.headers, data: decoded.toString() });
              }
            });
          } else {
            try {
              const parsedData = JSON.parse(buffer.toString());
              resolve({ status: res.statusCode, headers: res.headers, data: parsedData });
            } catch (e) {
              resolve({ status: res.statusCode, headers: res.headers, data: buffer.toString() });
            }
          }
        });
      });
      // 设置超时
      req.setTimeout(5000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      req.on('error', (e) => {
        reject(e);
      });
      if (options.body) {
        req.write(options.body);
      }
      req.end();
    });
  }

  // 企业微信推送
  async sendWechatMessage(content) {
    try {
      const webhookUrl = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=d0ee6878-96fe-46d9-b18e-997edfec7b32";
      const { status, data } = await this.sendRequest(webhookUrl, {
        method: 'POST',
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          msgtype: "text",
          text: {
            content: content
          }
        })
      });
      this.log(`✅ 企业微信推送成功 (状态码: ${status})`);
    } catch (e) {
      this.log(`❌ 企业微信推送失败: ${e.message}`);
    }
  }

  async takeCoupon() {
    const cfg = this.getConfig();
    try {
      const data = JSON.stringify({"activityCode":"202512230000301662","pageCode":"2025123000001"});
      const reqEnvParams = JSON.stringify({"channel":"3CUAPP","appType":"H5","module":"2025123000001","token":"RifQVDrSangSR4VBllnA7AZHYm-uVpK9A7a3C00701","sign":"6dfd1bf1m3j16ulpcfc2ed8e","pageUrl":"https://act.mucfc.com/na/2025123000001/index.html","mapCode":"H5","notSupport401":"0","mtago":"12008.41.02","clientTime":Date.now().toString()});
      
      const body = `data=${encodeURIComponent(data)}&reqEnvParams=${encodeURIComponent(reqEnvParams)}`;
      
      this.log(`🔍 开始领取优享会员...`);
      this.log(`📋 请求URL: ${API_TAKE_COUPON}`);
      
      const { status, data: responseData } = await this.sendRequest(API_TAKE_COUPON, {
        method: 'POST',
        headers: cfg.headers,
        body: body
      });
      
      this.log(`📋 响应状态码: ${status}`);
      this.log(`📋 响应数据: ${JSON.stringify(responseData)}`);

      if (status === 200 && responseData.ret === "0" && responseData.errCode === "COM00000") {
        this.log(`🎉 领取成功`);
        // 推送消息到企业微信
        await this.sendWechatMessage(`领取成功`);
        return true;
      } else {
        this.log(`❌ 领取失败：状态码 ${status} | ${responseData.errCode} | ${responseData.errMsg}`);
        return false;
      }
    } catch (e) {
      this.log(`❌ 领取异常：${e.message}`);
      return false;
    }
  }

  async start() {
    this.log("🚀 开始领取优享会员");

    const result = await this.takeCoupon();
    
    if (result) {
      this.log("✅ 任务完成");
    } else {
      this.log("❌ 任务失败");
    }
  }
}

// ==================== 入口 ====================
async function main() {
  console.log("=====================================");
  console.log("        领取优享会员脚本");
  console.log("=====================================");

  const service = new CouponService();
  await service.start();
  
  console.log("🏁 执行完成");
}

if (require.main === module) main().catch(console.error);
module.exports = { CouponService };
