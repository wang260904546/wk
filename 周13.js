"use strict";

// 四川联通周二福利秒杀（修正版）
//
// 重点修复：
// 1. 去掉 axios 依赖，改用 Node 18+ 内置 fetch，避免本地缺依赖直接报错。
// 2. 秒杀成功/失败提示优先从接口返回包中提取，成功时拼接 resultMsg + data。
// 3. 结合 HAR 的真实请求行为，支持完整 Referer、Cookie 和动态 phoneNumber。
// 4. 根据 prizeList 的 status 推断上午/下午场，尽量和页面实际状态保持一致。
//
// 环境变量示例：
// export chinaUnicomCookie="占位账号1&占位账号2"
// export SC_REFERER="完整活动页 Referer"
// export SC_REFERER_LIST='["完整活动页 Referer 1","完整活动页 Referer 2"]'
// export SC_COOKIE="从 HAR 抄下来的 Cookie"
// export SC_COOKIE_LIST='["cookie1=value1; cookie2=value2","cookie3=value3"]'
// export SC_PHONE_NUMBER="固定 phoneNumber（可选，不配则按 HAR 规律动态生成）"
// export SC_AM_PRIORITY="QQ音乐,5元话费,喜马拉雅,8GB"
// export SC_PM_PRIORITY="爱奇艺,哔哩,滴滴,10元话费,8GB"
// export SC_API_TOKEN="h5_notLoggedIn_xxx"
// export QYWX_WEBHOOK="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxx"
// export TEST_MODE=1

const SCRIPT_NAME = "四川联通周二福利秒杀";
const IS_TEST = String(process.env.TEST_MODE || "").trim() === "1";

const FIXED_CONFIG = {
  activityId: "tuesday_benefits_2026",
  host: "sclyh.169ol.com",
  apiToken: process.env.SC_API_TOKEN || "h5_notLoggedIn_7Zd04iNcte2M30gI",
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) unicom{version:iphone_c@12.1001};ltst;OSVersion/18.5",
  referer: "https://sclyh.169ol.com/micropage/pages/tuesdayBenefits/index",
  phoneTokenMiddle: process.env.SC_PHONE_MIDDLE || "3d0edd901c4",
  phoneTokenPrefixLength: Number(process.env.SC_PHONE_PREFIX_LEN || 5),
  phoneTokenSuffixLength: Number(process.env.SC_PHONE_SUFFIX_LEN || 7),
  phoneTokenAlphabet: "0123456789abcdefghijklmnopqrstuvwxyz",
  stopAllKeywords: [
    "今天已参与",
    "今日已参与",
    "已参与",
    "活动结束",
    "认证失败",
    "资格校验失败",
    "请先登录",
    "登录失效",
  ],
  tryNextKeywords: ["已抢完", "来晚了", "售罄", "库存不足", "火爆"],
  successKeywords: [
    "成功",
    "领取成功",
    "秒杀成功",
    "抢购成功",
    "兑换成功",
    "已领取",
    "抢到了",
  ],
  failureKeywords: [
    "失败",
    "已参与",
    "已抢完",
    "来晚了",
    "活动结束",
    "认证失败",
    "售罄",
    "库存不足",
    "未开始",
    "火爆",
    "异常",
    "错误",
  ],
};

const API = {
  checkSCUser:
    "https://sclyh.169ol.com/2b2c-mobile/api/seckill/checkSCUser",
  checkUser: "https://sclyh.169ol.com/2b2c-mobile/api/seckill/checkUser",
  prizeList: "https://sclyh.169ol.com/2b2c-mobile/api/seckill/prizeList",
  seckillDo: "https://sclyh.169ol.com/2b2c-mobile/api/seckill/do",
};

const SESSION_RULES = {
  am: {
    label: "上午场",
    startTime: "10:59:59.900",
    preferred: [
      { label: "QQ音乐", keywords: ["QQ音乐"] },
      { label: "5元话费", keywords: ["5元话费", "5元"] },
      { label: "喜马拉雅", keywords: ["喜马拉雅"] },
      { label: "8GB", keywords: ["8GB"] },
    ],
  },
  pm: {
    label: "下午场",
    startTime: "16:59:59.900",
    preferred: [
      { label: "爱奇艺", keywords: ["爱奇艺"] },
      { label: "哔哩", keywords: ["哔哩哔哩", "哔哩哗哩", "哔哩", "B站"] },
      { label: "滴滴", keywords: ["滴滴快车", "滴滴"] },
      { label: "10元话费", keywords: ["10元话费", "10元"] },
      { label: "8GB", keywords: ["8GB"] },
    ],
  },
};

const SUCCESS_CODES = new Set(["0000", "0", "200", "20000", "SUCCESS", "success"]);
const TEXT_MESSAGE_KEYS = [
  "resultMsg",
  "msg",
  "message",
  "errorMsg",
  "errMsg",
  "respMsg",
  "respDesc",
  "desc",
  "tip",
  "tips",
  "toast",
  "toastMsg",
  "remark",
  "statusDesc",
  "businessMsg",
];
const CODE_KEYS = [
  "resultCode",
  "code",
  "respCode",
  "errorCode",
  "status",
  "statusCode",
];
const NESTED_KEYS = ["data", "result", "respData", "body", "detail"];
const PRIZE_STATUS_TEXT = {
  "0": "状态0(疑似当前可抢)",
  "1": "状态1(疑似未开始)",
  "3": "状态3(疑似该账号已领过/已秒过)",
  "4": "状态4(当前场页面不可操作)",
};

const ACCOUNT_TOKENS = splitSimpleList(process.env.chinaUnicomCookie || "");
const REFERER_LIST = splitConfigList(
  process.env.SC_REFERER_LIST || process.env.SC_REFERER || ""
);
const COOKIE_LIST = splitConfigList(
  process.env.SC_COOKIE_LIST || process.env.SC_COOKIE || ""
);
const PHONE_LIST = splitConfigList(
  process.env.SC_PHONE_NUMBER_LIST || process.env.SC_PHONE_NUMBER || ""
);
const MOBILE_LIST = splitConfigList(
  process.env.SC_DISPLAY_MOBILE_LIST || process.env.SC_DISPLAY_MOBILE || ""
);
const SESSION_PRIORITY_ENV = {
  am: "SC_AM_PRIORITY",
  pm: "SC_PM_PRIORITY",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowTime() {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

function splitSimpleList(raw) {
  return String(raw || "")
    .split(/[\n&@]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitConfigList(raw) {
  const source = String(raw || "").trim();
  if (!source) return [];

  if (source.startsWith("[")) {
    try {
      const parsed = JSON.parse(source);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item || "").trim()).filter(Boolean);
      }
    } catch (error) {
      // 回退到按行分割。
    }
  }

  return source
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitPriorityTokens(raw) {
  const source = String(raw || "").trim();
  if (!source) return [];

  if (source.startsWith("[")) {
    try {
      const parsed = JSON.parse(source);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item || "").trim()).filter(Boolean);
      }
    } catch (error) {
      // 回退到文本分割。
    }
  }

  return source
    .replace(/->/g, ",")
    .split(/[,\n|，、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function pickIndexedValue(list, index, singleValue = "") {
  if (Array.isArray(list) && list[index]) return list[index];
  if (Array.isArray(list) && list.length === 1) return list[0];
  return String(singleValue || "").trim();
}

function maskString(value, prefix = 4, suffix = 4) {
  const raw = String(value || "").trim();
  if (!raw) return "未配置";
  if (raw.length <= prefix + suffix) return raw;
  return `${raw.slice(0, prefix)}***${raw.slice(-suffix)}`;
}

function buildPriorityRule(token) {
  const raw = String(token || "").trim();
  if (!raw) return null;
  return {
    label: raw,
    keywords: [raw],
  };
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[·\-_－—\s（）()]/g, "");
}

function containsAny(text, keywords) {
  const source = String(text || "");
  return keywords.some((keyword) => source.includes(keyword));
}

function isSuccessCode(code) {
  return SUCCESS_CODES.has(String(code || "").trim());
}

function joinCookies(parts) {
  return parts
    .flatMap((part) => String(part || "").split(";"))
    .map((part) => part.trim())
    .filter(Boolean)
    .join("; ");
}

function randomString(length) {
  let output = "";
  for (let i = 0; i < length; i += 1) {
    const index = Math.floor(Math.random() * FIXED_CONFIG.phoneTokenAlphabet.length);
    output += FIXED_CONFIG.phoneTokenAlphabet[index];
  }
  return output;
}

function buildRandomPhoneNumber() {
  return (
    `${randomString(FIXED_CONFIG.phoneTokenPrefixLength)}` +
    `${FIXED_CONFIG.phoneTokenMiddle}` +
    `${randomString(FIXED_CONFIG.phoneTokenSuffixLength)}==`
  );
}

function extractBusinessText(data) {
  if (typeof data === "string" && data.trim()) {
    return data.trim();
  }
  if (!data || typeof data !== "object") {
    return "";
  }

  for (const key of ["miniPrizeName", "prizeName", "name", "msg", "message"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function mergeMessageParts(primary, secondary) {
  const left = String(primary || "").trim();
  const right = String(secondary || "").trim();
  if (!left) return right;
  if (!right) return left;
  if (left.includes(right) || right.includes(left)) return left.length >= right.length ? left : right;
  return `${left}：${right}`;
}

function extractMobileFromReferer(referer) {
  try {
    const parsed = new URL(referer);
    return (
      parsed.searchParams.get("userNumber") ||
      parsed.searchParams.get("desmobile") ||
      ""
    ).trim();
  } catch (error) {
    return "";
  }
}

function buildApiDebugLine(tag, packet) {
  const code = extractCode(packet) || "-";
  const message = extractMessage(packet) || "-";
  const data = packet && typeof packet === "object" ? packet.data : undefined;

  if (data && typeof data === "object") {
    const am = Array.isArray(data.secKillPrizeAM) ? data.secKillPrizeAM.length : 0;
    const pm = Array.isArray(data.secKillPrizePM) ? data.secKillPrizePM.length : 0;
    if (am || pm) {
      return `${tag}响应：code=${code} | msg=${message} | 上午场${am}项 | 下午场${pm}项`;
    }
  }

  if (typeof data === "boolean") {
    return `${tag}响应：code=${code} | msg=${message} | data=${data}`;
  }

  if (typeof data === "string" && data.trim()) {
    return `${tag}响应：code=${code} | msg=${message} | data=${data.trim()}`;
  }

  return `${tag}响应：code=${code} | msg=${message}`;
}

function toBoolean(value) {
  if (value === true || value === false) return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "ok"].includes(normalized)) return true;
    if (["false", "0", "no"].includes(normalized)) return false;
  }
  return null;
}

function extractCode(packet, depth = 0, seen = new Set()) {
  if (packet == null || depth > 4) return "";
  if (typeof packet !== "object") return "";
  if (seen.has(packet)) return "";
  seen.add(packet);

  for (const key of CODE_KEYS) {
    const value = packet[key];
    if (value != null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }

  for (const key of NESTED_KEYS) {
    const value = packet[key];
    if (value && typeof value === "object") {
      const nestedCode = extractCode(value, depth + 1, seen);
      if (nestedCode) return nestedCode;
    }
  }

  return "";
}

function extractMessage(packet) {
  if (typeof packet === "string") return packet.trim();
  if (packet == null || typeof packet !== "object") return "";

  const queue = [packet];
  const seen = new Set();

  while (queue.length > 0) {
    const current = queue.shift();
    if (current == null) continue;

    if (typeof current === "string") {
      const text = current.trim();
      if (text) return text;
      continue;
    }

    if (typeof current !== "object") continue;
    if (seen.has(current)) continue;
    seen.add(current);

    for (const key of TEXT_MESSAGE_KEYS) {
      const value = current[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }

    for (const key of NESTED_KEYS) {
      const value = current[key];
      if (value != null) queue.push(value);
    }
  }

  return "";
}

function extractDataBoolean(data, candidateKeys = []) {
  const direct = toBoolean(data);
  if (direct !== null) return direct;
  if (data == null || typeof data !== "object") return null;

  for (const key of candidateKeys) {
    const value = toBoolean(data[key]);
    if (value !== null) return value;
  }

  for (const value of Object.values(data)) {
    const boolValue = toBoolean(value);
    if (boolValue !== null) return boolValue;
  }

  return null;
}

function buildPacketSummary(packet, fallbackMessage = "") {
  const code = extractCode(packet);
  const businessText =
    packet && typeof packet === "object" ? extractBusinessText(packet.data) : "";
  const message = extractMessage(packet) || businessText || fallbackMessage;
  return { code, message, raw: packet };
}

function formatError(error) {
  if (!error) return "未知错误";
  if (error.name === "AbortError") return "请求超时";
  if (error.responseText) return error.responseText;
  return error.message || String(error);
}

async function requestJson(method, url, { headers = {}, params = {}, body, timeout = 8000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const requestUrl = new URL(url);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        requestUrl.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(requestUrl, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    let data = {};

    if (text) {
      try {
        data = JSON.parse(text);
      } catch (error) {
        data = { message: text };
      }
    }

    if (!response.ok) {
      const message = extractMessage(data) || `HTTP ${response.status}`;
      const httpError = new Error(message);
      httpError.status = response.status;
      httpError.responseText = text;
      throw httpError;
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForExactTime(targetTimeStr) {
  if (IS_TEST) return;

  const now = new Date();
  const [timePart, msPart = "000"] = targetTimeStr.split(".");
  const [hours, minutes, seconds] = timePart.split(":").map(Number);
  const target = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    hours,
    minutes,
    seconds,
    Number(msPart)
  );

  if (target <= now) return;

  while (true) {
    const diff = target - new Date();
    if (diff <= 0) break;
    if (diff > 2000) {
      await sleep(1000);
    } else if (diff > 50) {
      await sleep(10);
    } else {
      while (new Date() < target) {
        // 最后 50ms 自旋，尽量压缩事件循环抖动。
      }
      break;
    }
  }
}

class SeckillService {
  constructor(account, index = 0) {
    this.index = index + 1;
    this.tokenOnline = account.tokenOnline;
    this.phoneNumber = account.phoneNumber;
    this.extraCookie = account.extraCookie;
    this.referer = account.referer || FIXED_CONFIG.referer;
    this.displayMobile =
      account.displayMobile || extractMobileFromReferer(this.referer);
    this.prizeNameById = new Map();
  }

  log(msg) {
    console.log(`[${nowTime()}] 账号[${this.index}] ${msg}`);
  }

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

  getHeaders() {
    const cookie = joinCookies([
      this.extraCookie,
      this.tokenOnline ? `token_online=${this.tokenOnline}` : "",
    ]);

    const headers = {
      Host: FIXED_CONFIG.host,
      Accept: "application/json, text/plain, */*",
      "Accept-Encoding": "gzip, deflate, br",
      "Accept-Language": "zh-CN,zh;q=0.9",
      "Content-Type": "application/json;charset=UTF-8",
      Origin: `https://${FIXED_CONFIG.host}`,
      Referer: this.referer,
      Connection: "keep-alive",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "User-Agent": FIXED_CONFIG.userAgent,
      token: FIXED_CONFIG.apiToken,
    };

    if (cookie) {
      headers.Cookie = cookie;
    }

    return headers;
  }

  nextPhoneNumber() {
    return this.phoneNumber || buildRandomPhoneNumber();
  }

  getCommonParams(extra = {}) {
    return {
      activityId: FIXED_CONFIG.activityId,
      phoneNumber: this.nextPhoneNumber(),
      timestamp: Date.now(),
      ...extra,
    };
  }

  accountLabel() {
    return this.displayMobile ? maskString(this.displayMobile, 3, 4) : `账号[${this.index}]`;
  }

  async sendWechatMessage(content) {
    const webhookUrl = String(process.env.QYWX_WEBHOOK || "").trim();
    if (!webhookUrl) return;

    try {
      await requestJson("POST", webhookUrl, {
        headers: {
          "Content-Type": "application/json",
        },
        body: {
          msgtype: "text",
          text: { content },
        },
        timeout: 5000,
      });
      this.success("企业微信推送成功");
    } catch (error) {
      this.error(`企业微信推送失败：${formatError(error)}`);
    }
  }

  async checkSCUser() {
    this.info("第一步：校验四川联通用户资格...");

    try {
      const data = await requestJson("GET", API.checkSCUser, {
        headers: this.getHeaders(),
        params: this.getCommonParams(),
        timeout: 5000,
      });

      this.debug(buildApiDebugLine("checkSCUser", data));
      const summary = buildPacketSummary(data, "资格校验接口未返回提示");
      const eligible = extractDataBoolean(data && data.data, [
        "eligible",
        "isEligible",
        "pass",
      ]);

      console.log("=".repeat(60));
      console.log(
        `[1] 资格校验结果：code=${summary.code || "-"} | msg=${summary.message || "-"} | data=${eligible}`
      );

      const displayMessage =
        summary.message === "Success"
          ? mergeMessageParts(summary.message, eligible === true ? "data=true(资格通过)" : "data=false(资格不通过)")
          : summary.message || "资格校验未通过";

      if (!isSuccessCode(summary.code) || eligible !== true) {
        this.error(`接口提示：${displayMessage}`);
        return { ok: false, stopAll: true, ...summary };
      }

      this.success(`接口提示：${displayMessage}`);
      return { ok: true, stopAll: false, ...summary };
    } catch (error) {
      const message = formatError(error);
      this.error(`资格校验异常：${message}`);
      return { ok: false, stopAll: true, code: "", message };
    }
  }

  async checkUser() {
    this.info("第二步：校验今日参与状态...");

    try {
      const data = await requestJson("GET", API.checkUser, {
        headers: this.getHeaders(),
        params: this.getCommonParams(),
        timeout: 5000,
      });

      this.debug(buildApiDebugLine("checkUser", data));
      const summary = buildPacketSummary(data, "参与状态接口未返回提示");
      const participated = extractDataBoolean(data && data.data, [
        "joined",
        "isJoined",
        "hasJoined",
        "participated",
        "hasParticipated",
      ]);

      console.log("=".repeat(60));
      console.log(
        `[2] 参与状态校验结果：code=${summary.code || "-"} | msg=${summary.message || "-"} | data=${participated}`
      );

      const displayMessage =
        summary.message === "Success"
          ? mergeMessageParts(
              summary.message,
              participated === true ? "data=true(今天已参与)" : "data=false(今日未参与)"
            )
          : summary.message || "参与状态校验失败";

      if (!isSuccessCode(summary.code)) {
        this.error(`接口提示：${displayMessage}`);
        return { ok: false, stopAll: true, ...summary };
      }

      if (participated === true) {
        this.warning(`接口提示：${displayMessage}`);
        return { ok: false, stopAll: true, ...summary };
      }

      this.success(`接口提示：${displayMessage}`);
      return { ok: true, stopAll: false, ...summary };
    } catch (error) {
      const message = formatError(error);
      this.error(`参与状态校验异常：${message}`);
      return { ok: false, stopAll: true, code: "", message };
    }
  }

  async queryPrizeList() {
    this.info("第三步：查询商品列表...");

    try {
      const data = await requestJson("POST", API.prizeList, {
        headers: this.getHeaders(),
        params: this.getCommonParams(),
        body: {},
        timeout: 6000,
      });

      const summary = buildPacketSummary(data, "商品列表接口未返回提示");

      if (!isSuccessCode(summary.code)) {
        this.warning(`接口提示：${summary.message || "查询商品失败"}`);
        return { ok: false, am: [], pm: [], ...summary };
      }

      const payload = data && data.data ? data.data : {};
      const am = Array.isArray(payload.secKillPrizeAM) ? payload.secKillPrizeAM : [];
      const pm = Array.isArray(payload.secKillPrizePM) ? payload.secKillPrizePM : [];

      for (const prize of [...am, ...pm]) {
        const prizeId = String(prize.id || prize.prizeConfigId || "");
        const prizeName = this.getPrizeName(prize);
        if (prizeId) {
          this.prizeNameById.set(prizeId, prizeName);
        }
      }

      this.printPrizeList("上午场", am);
      this.printPrizeList("下午场", pm);

      return { ok: true, am, pm, ...summary };
    } catch (error) {
      const message = formatError(error);
      this.error(`查询商品异常：${message}`);
      return { ok: false, am: [], pm: [], code: "", message };
    }
  }

  printPrizeList(label, prizes) {
    console.log(`\n${"=".repeat(60)}`);
    this.info(`${label}（共 ${prizes.length} 个商品）：`);

    prizes.forEach((prize) => {
      const stock = Number(prize.sessionStock ?? prize.stock ?? 0);
      const stockText = stock > 0 ? `✅有货(库存:${stock})` : "❌售罄";
      const status = String(prize.status ?? "");
      const statusText = PRIZE_STATUS_TEXT[status] || `状态${status || "-"}`;
      console.log(
        `   [${String(prize.id || prize.prizeConfigId || "-")}] ${this.getPrizeName(prize)} ${stockText} | ${statusText}`
      );
    });

    console.log(`${"=".repeat(60)}\n`);
  }

  getPrizeName(prize) {
    if (!prize || typeof prize !== "object") return "未知商品";
    return (
      prize.miniPrizeName ||
      prize.prizeName ||
      prize.name ||
      this.prizeNameById.get(String(prize.id || prize.prizeConfigId || "")) ||
      `商品${String(prize.id || prize.prizeConfigId || "") || ""}`
    );
  }

  getPrizeId(prize) {
    return String(prize.id || prize.prizeConfigId || prize.prizeId || "");
  }

  getPrizeSearchText(prize) {
    if (!prize || typeof prize !== "object") return "";

    return normalizeText(
      [
        prize.miniPrizeName,
        prize.prizeName,
        prize.name,
        this.prizeNameById.get(String(prize.id || prize.prizeConfigId || "")),
      ]
        .filter(Boolean)
        .join(" ")
    );
  }

  matchPrize(rule, prize) {
    const currentName = this.getPrizeSearchText(prize);
    const keywords = Array.isArray(rule.keywords) ? rule.keywords : [];

    return keywords.some((keyword) => {
      const expected = normalizeText(keyword);
      return expected && currentName.includes(expected);
    });
  }

  getPriorityRules(sessionKey) {
    const envKey = SESSION_PRIORITY_ENV[sessionKey];
    const customTokens = splitPriorityTokens(process.env[envKey] || "");

    if (customTokens.length === 0) {
      return {
        rules: SESSION_RULES[sessionKey].preferred,
        source: "default",
        raw: SESSION_RULES[sessionKey].preferred.map((rule) => rule.label),
      };
    }

    const rules = customTokens
      .map((token) => buildPriorityRule(token))
      .filter(Boolean);

    if (rules.length === 0) {
      return {
        rules: SESSION_RULES[sessionKey].preferred,
        source: "default",
        raw: SESSION_RULES[sessionKey].preferred.map((rule) => rule.label),
      };
    }

    return {
      rules,
      source: "custom",
      raw: customTokens,
    };
  }

  inferSessionKey(prizeListResult) {
    if (prizeListResult && prizeListResult.ok) {
      const score = (prizes) =>
        prizes.reduce((count, prize) => {
          const status = String(prize.status ?? "");
          return count + (status && status !== "1" ? 1 : 0);
        }, 0);

      const amScore = score(prizeListResult.am || []);
      const pmScore = score(prizeListResult.pm || []);

      if (amScore > pmScore) return "am";
      if (pmScore > amScore) return "pm";
    }

    return new Date().getHours() < 12 ? "am" : "pm";
  }

  isPrizeInSession(prizeId, prizeListResult, sessionKey) {
    if (!prizeListResult || !prizeListResult.ok) return true;

    const sourceList =
      sessionKey === "pm" ? prizeListResult.pm || [] : prizeListResult.am || [];

    return sourceList.some((prize) => this.getPrizeId(prize) === String(prizeId));
  }

  isRunnablePrize(prize) {
    const stock = Number(prize.sessionStock ?? prize.stock ?? 0);
    const status = String(prize.status ?? "");
    if (stock <= 0) return false;
    if (!status) return true;
    return status === "0";
  }

  buildSessionPlan(prizeListResult, preferredSessionKey) {
    const sessionKey = preferredSessionKey || this.inferSessionKey(prizeListResult);
    const sessionRule = sessionKey === "pm" ? SESSION_RULES.pm : SESSION_RULES.am;
    const priorityConfig = this.getPriorityRules(sessionKey);
    const sourceList =
      prizeListResult && prizeListResult.ok
        ? sessionKey === "pm"
          ? prizeListResult.pm
          : prizeListResult.am
        : [];

    const queue = [];
    const usedIds = new Set();

    for (const rule of priorityConfig.rules) {
      const matched =
        sourceList.find(
          (prize) =>
            !usedIds.has(this.getPrizeId(prize)) &&
            this.matchPrize(rule, prize) &&
            this.isRunnablePrize(prize)
        ) || null;

      if (matched) {
        const prizeId = this.getPrizeId(matched);
        if (!usedIds.has(prizeId)) {
          usedIds.add(prizeId);
          queue.push({
            id: prizeId,
            name: this.getPrizeName(matched),
            sessionKey,
          });
        }
      }
    }

    for (const prize of sourceList) {
      const prizeId = this.getPrizeId(prize);
      if (!prizeId || usedIds.has(prizeId)) continue;

      if (this.isRunnablePrize(prize)) {
        usedIds.add(prizeId);
        queue.push({ id: prizeId, name: this.getPrizeName(prize), sessionKey });
      }
    }

    return {
      sessionKey,
      sessionLabel: sessionRule.label,
      scheduledTime: sessionRule.startTime,
      prioritySource: priorityConfig.source,
      priorityRaw: priorityConfig.raw,
      queue,
    };
  }

  parseSeckillResult(packet) {
    const summary = buildPacketSummary(packet, "秒杀接口未返回明确提示");
    const resultData = packet && typeof packet === "object" ? packet.data : null;
    const businessSuccess = extractDataBoolean(resultData, [
      "success",
      "isSuccess",
      "ok",
      "result",
    ]);
    const businessText = extractBusinessText(resultData);
    const message = mergeMessageParts(
      extractMessage(packet),
      businessText
    ) || "秒杀接口未返回明确提示";
    const successByMessage =
      containsAny(message, FIXED_CONFIG.successKeywords) &&
      !containsAny(message, FIXED_CONFIG.failureKeywords);
    const failureByMessage = containsAny(message, FIXED_CONFIG.failureKeywords);

    const ok =
      businessSuccess === true ||
      successByMessage ||
      (isSuccessCode(summary.code) && businessSuccess !== false && !failureByMessage);

    const stopAll = containsAny(message, FIXED_CONFIG.stopAllKeywords);
    const tryNext = !ok && !stopAll;

    return {
      ok,
      stopAll,
      tryNext,
      code: summary.code,
      message,
      raw: packet,
    };
  }

  async seckill(prize) {
    this.info(`执行秒杀：${prize.name}（ID:${prize.id}）`);

    try {
      const data = await requestJson("POST", API.seckillDo, {
        headers: this.getHeaders(),
        params: this.getCommonParams({
          prizeConfigId: prize.id,
        }),
        body: {},
        timeout: 6000,
      });

      this.debug(buildApiDebugLine("seckill", data));
      console.log("=".repeat(60));
      console.log(
        `[4] 秒杀执行结果：code=${extractCode(data) || "-"} | msg=${extractMessage(data) || "-"}${typeof data?.data === "string" && data.data.trim() ? ` | data=${data.data.trim()}` : ""}`
      );

      const result = this.parseSeckillResult(data);

      if (result.ok) {
        this.success(`接口提示：${result.message}`);
        await this.sendWechatMessage(
          `${this.accountLabel()} ${prize.name}：${result.message}`
        );
      } else {
        this.error(`接口提示：${result.message}`);
      }

      return result;
    } catch (error) {
      const message = formatError(error);
      this.error(`秒杀请求异常：${message}`);
      return {
        ok: false,
        stopAll: false,
        tryNext: true,
        code: "",
        message,
      };
    }
  }

  async start() {
    const scheduledSessionKey = new Date().getHours() < 12 ? "am" : "pm";
    const scheduledSession = SESSION_RULES[scheduledSessionKey];
    if (!IS_TEST) {
      this.info(`等待 ${scheduledSession.label}开始时间 [${scheduledSession.startTime}]...`);
    }
    await waitForExactTime(scheduledSession.startTime);
    this.success(`${scheduledSession.label}开始时间已到，开始刷新商品状态`);

    const prizeListResult = await this.queryPrizeList();
    const sessionPlan = this.buildSessionPlan(prizeListResult, scheduledSessionKey);
    this.info(`根据 prizeList 推断当前场次：${sessionPlan.sessionLabel}`);
    if (sessionPlan.prioritySource === "custom") {
      this.info(
        `${sessionPlan.sessionLabel}使用自定义优先级：${sessionPlan.priorityRaw.join(" -> ")}`
      );
    } else {
      this.info(
        `${sessionPlan.sessionLabel}使用默认优先级：${sessionPlan.priorityRaw.join(" -> ")}`
      );
    }

    if (sessionPlan.queue.length === 0) {
      this.error("未找到可尝试的商品队列，停止执行");
      return;
    }

    this.info(
      `${sessionPlan.sessionLabel}抢购顺序：${sessionPlan.queue
        .map((item) => item.name)
        .join(" -> ")}`
    );

    const userResult = await this.checkUser();
    if (!userResult.ok) return;

    const scUserResult = await this.checkSCUser();
    if (!scUserResult.ok) return;

    let successResult = null;

    for (const prize of sessionPlan.queue) {
      if (prize.sessionKey !== sessionPlan.sessionKey) {
        this.warning(
          `检测到跨场次商品，已跳过：${prize.name}（队列场次=${prize.sessionKey}，当前场次=${sessionPlan.sessionKey}）`
        );
        continue;
      }

      if (!this.isPrizeInSession(prize.id, prizeListResult, sessionPlan.sessionKey)) {
        this.warning(
          `检测到跨场次商品，已跳过：${prize.name}（ID:${prize.id} 不属于 ${sessionPlan.sessionLabel}）`
        );
        continue;
      }

      const result = await this.seckill(prize);
      if (result.ok) {
        successResult = { prize, result };
        break;
      }

      if (result.stopAll) {
        this.warning(`接口提示要求终止后续尝试：${result.message}`);
        break;
      }

      this.warning(`${prize.name} 未成功，准备尝试下一个商品`);
      await sleep(300);
    }

    if (!successResult) {
      this.error("本轮秒杀未成功");
      return;
    }

    this.success(
      `${successResult.prize.name} 秒杀完成，接口提示：${successResult.result.message}`
    );
  }
}

function parseAccount(rawAccount, index) {
  const segments = String(rawAccount || "")
    .split("#")
    .map((item) => item.trim())
    .filter(Boolean);

  const tokenOnline = segments[0] || "";
  let phoneNumber = pickIndexedValue(PHONE_LIST, index, process.env.SC_PHONE_NUMBER || "");
  let extraCookie = pickIndexedValue(COOKIE_LIST, index, process.env.SC_COOKIE || "");
  let displayMobile = pickIndexedValue(
    MOBILE_LIST,
    index,
    process.env.SC_DISPLAY_MOBILE || ""
  );
  let referer = pickIndexedValue(REFERER_LIST, index, process.env.SC_REFERER || "");

  for (const segment of segments.slice(1)) {
    const eqIndex = segment.indexOf("=");
    if (eqIndex < 0) continue;
    const key = segment.slice(0, eqIndex).trim().toLowerCase();
    const value = segment.slice(eqIndex + 1).trim();
    if (!value) continue;

    if (["phone", "phonenumber", "pn"].includes(key)) {
      phoneNumber = value;
    } else if (["cookie", "ck"].includes(key)) {
      extraCookie = joinCookies([extraCookie, value]);
    } else if (["mobile", "displaymobile"].includes(key)) {
      displayMobile = value;
    } else if (["referer", "ref"].includes(key)) {
      referer = value;
    }
  }

  return {
    tokenOnline,
    phoneNumber,
    extraCookie,
    displayMobile,
    referer,
  };
}

async function main() {
  console.log("=".repeat(60));
  console.log(`    ${SCRIPT_NAME}（修正版）`);
  console.log("=".repeat(60));

  const accountCount = Math.max(
    ACCOUNT_TOKENS.length,
    REFERER_LIST.length,
    COOKIE_LIST.length,
    PHONE_LIST.length,
    MOBILE_LIST.length
  );

  if (accountCount === 0) {
    console.log("❌ 请至少配置 chinaUnicomCookie、SC_REFERER、SC_COOKIE、SC_PHONE_NUMBER 中的一项");
    return;
  }

  console.log(`共读取到 ${accountCount} 个账号`);
  const useDefaultReferer = REFERER_LIST.length === 0 && !process.env.SC_REFERER;
  const useDynamicPhone = PHONE_LIST.length === 0 && !process.env.SC_PHONE_NUMBER;
  if (useDefaultReferer) {
    console.log("提示：未配置完整 SC_REFERER，当前使用默认活动页地址");
  }
  if (useDynamicPhone) {
    console.log(
      `提示：未配置固定 phoneNumber，当前按 ${FIXED_CONFIG.phoneTokenPrefixLength}+${FIXED_CONFIG.phoneTokenMiddle}+${FIXED_CONFIG.phoneTokenSuffixLength}+== 动态生成`
    );
  }

  const services = Array.from({ length: accountCount }, (_, index) => {
    const parsed = parseAccount(ACCOUNT_TOKENS[index] || "", index);
    console.log(
      `[${nowTime()}] 账号[${index + 1}] 已加载 | token=${maskString(
        parsed.tokenOnline,
        6,
        4
      )} | ${parsed.referer ? "自定义Referer" : "默认Referer"} | ${
        parsed.phoneNumber ? "固定phoneNumber" : "动态phoneNumber"
      }`
    );
    return new SeckillService(parsed, index);
  });

  await Promise.all(services.map((service) => service.start()));
  console.log("🏁 所有账号执行完成");
}

if (require.main === module) {
  main().catch((error) => {
    console.error("脚本执行失败：", error);
    process.exitCode = 1;
  });
}

module.exports = {
  SeckillService,
  parseAccount,
  buildPacketSummary,
};
