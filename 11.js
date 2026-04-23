"use strict";

// 四川联通周二福利秒杀（修正版）
//
// 重点修复：
// 1. 去掉 axios 依赖，改用 Node 18+ 内置 fetch，避免本地缺依赖直接报错。
// 2. 秒杀成功/失败提示优先从接口返回包中提取，成功时拼接 resultMsg + data。
// 3. 结合 HAR 的真实请求行为，支持完整 Referer、Cookie 和动态 phoneNumber。
// 4. 商品 status 仅作展示，不参与可抢判断；只要有库存就进入优先级并发队列。
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
// export SC_FORCE_SESSION="am"
// export SC_PREHEAT_LEAD_MS=2500
// export SC_SECKILL_RETRY_PER_PRIZE=3
// export SC_SECKILL_RETRY_DELAY_MS=80
// export DEBUG_MODE=1
// export SC_API_TOKEN="h5_notLoggedIn_xxx"
// export TEST_MODE=1

const SCRIPT_NAME = "四川联通周二福利秒杀";
const IS_TEST = String(process.env.TEST_MODE || "").trim() === "1";
const DEBUG_MODE = String(process.env.DEBUG_MODE || "").trim() === "1";

function envInt(name, fallback) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
}

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

const RUNTIME_CONFIG = {
  preheatLeadMs: envInt("SC_PREHEAT_LEAD_MS", 2500),
  earlyWarmupThresholdMs: envInt("SC_EARLY_WARMUP_THRESHOLD_MS", 15000),
  emptyQueueRetryDelayMs: envInt("SC_EMPTY_QUEUE_RETRY_DELAY_MS", 250),
  precheckRetry: envInt("SC_PRECHECK_RETRY", 2),
  precheckRetryDelayMs: envInt("SC_PRECHECK_RETRY_DELAY_MS", 120),
  prizeListRetry: envInt("SC_PRIZE_LIST_RETRY", 2),
  prizeListRetryDelayMs: envInt("SC_PRIZE_LIST_RETRY_DELAY_MS", 120),
  seckillRetryPerPrize: envInt("SC_SECKILL_RETRY_PER_PRIZE", 3),
  seckillRetryDelayMs: envInt("SC_SECKILL_RETRY_DELAY_MS", 80),
  switchPrizeDelayMs: envInt("SC_SWITCH_PRIZE_DELAY_MS", 120),
  checkTimeoutMs: envInt("SC_CHECK_TIMEOUT_MS", 5000),
  prizeListTimeoutMs: envInt("SC_PRIZE_LIST_TIMEOUT_MS", 6000),
  seckillTimeoutMs: envInt("SC_SECKILL_TIMEOUT_MS", 3500),
  forceSession: ["am", "pm"].includes(String(process.env.SC_FORCE_SESSION || "").trim().toLowerCase())
    ? String(process.env.SC_FORCE_SESSION || "").trim().toLowerCase()
    : "",
  samePrizeRetryKeywords: [
    "系统繁忙",
    "稍后再试",
    "超时",
    "timeout",
    "网络异常",
    "网络繁忙",
    "服务繁忙",
    "请求频繁",
    "火爆",
    "异常",
  ],
  stopPrizeKeywords: [
    "每月只能秒杀一次",
    "本月已秒杀",
    "已经领取",
    "已领取",
    "已兑换",
    "每个奖品每月只能秒杀一次",
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
  "0": "状态0(可尝试)",
  "1": "状态1(未开始/非当前场)",
  "3": "状态3(疑似该账号已领过/已秒过)",
  "4": "状态4(可尝试)",
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

function getTargetDate(targetTimeStr, baseDate = new Date()) {
  const [timePart, msPart = "000"] = targetTimeStr.split(".");
  const [hours, minutes, seconds] = timePart.split(":").map(Number);

  return new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate(),
    hours,
    minutes,
    seconds,
    Number(msPart)
  );
}

function formatTimeWithMs(date) {
  const time = date.toLocaleTimeString("zh-CN", { hour12: false });
  return `${time}.${String(date.getMilliseconds()).padStart(3, "0")}`;
}

async function waitUntilDate(target) {
  if (IS_TEST) return;
  if (!(target instanceof Date) || Number.isNaN(target.getTime())) return;

  if (target <= new Date()) return;

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

async function waitForExactTime(targetTimeStr) {
  await waitUntilDate(getTargetDate(targetTimeStr));
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
    this.lastPrizeListResult = null;
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
    if (DEBUG_MODE) {
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

  resolveSessionKey() {
    if (RUNTIME_CONFIG.forceSession) return RUNTIME_CONFIG.forceSession;
    return new Date().getHours() < 12 ? "am" : "pm";
  }

  async runWithRetry(taskFn, { attempts = 1, delayMs = 0, shouldRetry = () => false } = {}) {
    let lastResult = null;

    for (let attempt = 1; attempt <= Math.max(1, attempts); attempt += 1) {
      lastResult = await taskFn(attempt);

      if (attempt >= attempts || !shouldRetry(lastResult, attempt)) {
        return lastResult;
      }

      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }

    return lastResult;
  }

  async checkSCUser(options = {}) {
    const { quiet = false } = options;
    if (!quiet) {
      this.info("第一步：校验四川联通用户资格...");
    }

    try {
      const data = await requestJson("GET", API.checkSCUser, {
        headers: this.getHeaders(),
        params: this.getCommonParams(),
        timeout: RUNTIME_CONFIG.checkTimeoutMs,
      });

      this.debug(buildApiDebugLine("checkSCUser", data));
      const summary = buildPacketSummary(data, "资格校验接口未返回提示");
      const eligible = extractDataBoolean(data && data.data, [
        "eligible",
        "isEligible",
        "pass",
      ]);

      if (!quiet) {
        console.log("=".repeat(60));
        console.log(
          `[1] 资格校验结果：code=${summary.code || "-"} | msg=${summary.message || "-"} | data=${eligible}`
        );
      }

      const displayMessage =
        summary.message === "Success"
          ? mergeMessageParts(summary.message, eligible === true ? "data=true(资格通过)" : "data=false(资格不通过)")
          : summary.message || "资格校验未通过";

      if (!isSuccessCode(summary.code) || eligible !== true) {
        if (!quiet) {
          this.error(`接口提示：${displayMessage}`);
        }
        return { ok: false, stopAll: true, ...summary };
      }

      if (!quiet) {
        this.success(`接口提示：${displayMessage}`);
      }
      return { ok: true, stopAll: false, ...summary };
    } catch (error) {
      const message = formatError(error);
      if (!quiet) {
        this.error(`资格校验异常：${message}`);
      }
      return { ok: false, stopAll: true, code: "", message };
    }
  }

  async checkUser(options = {}) {
    const { quiet = false } = options;
    if (!quiet) {
      this.info("第二步：校验今日参与状态...");
    }

    try {
      const data = await requestJson("GET", API.checkUser, {
        headers: this.getHeaders(),
        params: this.getCommonParams(),
        timeout: RUNTIME_CONFIG.checkTimeoutMs,
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

      if (!quiet) {
        console.log("=".repeat(60));
        console.log(
          `[2] 参与状态校验结果：code=${summary.code || "-"} | msg=${summary.message || "-"} | data=${participated}`
        );
      }

      const displayMessage =
        summary.message === "Success"
          ? mergeMessageParts(
              summary.message,
              participated === true ? "data=true(今天已参与)" : "data=false(今日未参与)"
            )
          : summary.message || "参与状态校验失败";

      if (!isSuccessCode(summary.code)) {
        if (!quiet) {
          this.error(`接口提示：${displayMessage}`);
        }
        return { ok: false, stopAll: true, ...summary };
      }

      if (participated === true) {
        if (!quiet) {
          this.warning(`接口提示：${displayMessage}`);
        }
        return { ok: false, stopAll: true, ...summary };
      }

      if (!quiet) {
        this.success(`接口提示：${displayMessage}`);
      }
      return { ok: true, stopAll: false, ...summary };
    } catch (error) {
      const message = formatError(error);
      if (!quiet) {
        this.error(`参与状态校验异常：${message}`);
      }
      return { ok: false, stopAll: true, code: "", message };
    }
  }

  async queryPrizeList(options = {}) {
    const { quiet = false, printList = !quiet, sessionKey = "" } = options;
    if (!quiet) {
      this.info("第三步：查询商品列表...");
    }

    try {
      const data = await requestJson("POST", API.prizeList, {
        headers: this.getHeaders(),
        params: this.getCommonParams(),
        body: {},
        timeout: RUNTIME_CONFIG.prizeListTimeoutMs,
      });

      const summary = buildPacketSummary(data, "商品列表接口未返回提示");

      if (!isSuccessCode(summary.code)) {
        if (!quiet) {
          this.warning(`接口提示：${summary.message || "查询商品失败"}`);
        }
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

      const result = { ok: true, am, pm, ...summary };
      this.lastPrizeListResult = result;

      if (printList) {
        if (sessionKey === "am" || sessionKey === "pm") {
          this.printPrizeList(
            SESSION_RULES[sessionKey].label,
            this.getSessionPrizes(result, sessionKey)
          );
        } else {
          this.printPrizeList("上午场", am);
          this.printPrizeList("下午场", pm);
        }
      }

      return result;
    } catch (error) {
      const message = formatError(error);
      if (!quiet) {
        this.error(`查询商品异常：${message}`);
      }
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
        `   [${String(prize.id || prize.prizeConfigId || "-")}] ${this.getPrizeName(prize)} ${stockText} | ${statusText}(仅展示)`
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
    return new Date().getHours() < 12 ? "am" : "pm";
  }

  isPrizeInSession(prizeId, prizeListResult, sessionKey) {
    if (!prizeListResult || !prizeListResult.ok) return true;

    const sourceList =
      sessionKey === "pm" ? prizeListResult.pm || [] : prizeListResult.am || [];

    return sourceList.some((prize) => this.getPrizeId(prize) === String(prizeId));
  }

  getSessionPrizes(prizeListResult, sessionKey) {
    if (!prizeListResult || !prizeListResult.ok) return [];
    return sessionKey === "pm" ? prizeListResult.pm || [] : prizeListResult.am || [];
  }

  isRunnablePrize(prize) {
    const stock = Number(prize.sessionStock ?? prize.stock ?? 0);
    return stock > 0;
  }

  buildSessionPlan(prizeListResult, preferredSessionKey) {
    const sessionKey = preferredSessionKey || this.inferSessionKey(prizeListResult);
    const sessionRule = sessionKey === "pm" ? SESSION_RULES.pm : SESSION_RULES.am;
    const priorityConfig = this.getPriorityRules(sessionKey);
    const sourceList = this.getSessionPrizes(prizeListResult, sessionKey);

    const batches = [];
    const queue = [];
    const usedIds = new Set();

    priorityConfig.rules.forEach((rule, index) => {
      const matched = [];

      for (const prize of sourceList) {
        const prizeId = this.getPrizeId(prize);
        if (!prizeId || usedIds.has(prizeId)) continue;
        if (!this.matchPrize(rule, prize) || !this.isRunnablePrize(prize)) continue;

        const item = {
          id: prizeId,
          name: this.getPrizeName(prize),
          sessionKey,
          priority: index + 1,
          priorityLabel: rule.label,
        };
        usedIds.add(prizeId);
        matched.push(item);
        queue.push(item);
      }

      if (matched.length > 0) {
        batches.push({
          priority: index + 1,
          label: rule.label,
          prizes: matched,
        });
      }
    });

    const fallback = [];

    for (const prize of sourceList) {
      const prizeId = this.getPrizeId(prize);
      if (!prizeId || usedIds.has(prizeId)) continue;

      if (this.isRunnablePrize(prize)) {
        const item = {
          id: prizeId,
          name: this.getPrizeName(prize),
          sessionKey,
          priority: priorityConfig.rules.length + 1,
          priorityLabel: "未命中优先级",
        };
        usedIds.add(prizeId);
        fallback.push(item);
        queue.push(item);
      }
    }

    if (fallback.length > 0) {
      batches.push({
        priority: priorityConfig.rules.length + 1,
        label: "未命中优先级",
        prizes: fallback,
      });
    }

    return {
      sessionKey,
      sessionLabel: sessionRule.label,
      scheduledTime: sessionRule.startTime,
      prioritySource: priorityConfig.source,
      priorityRaw: priorityConfig.raw,
      batches,
      queue,
    };
  }

  shouldRetryPrecheck(result) {
    if (!result) return false;
    if (result.ok) return false;
    if (result.stopAll) return false;
    if (!result.code) return true;
    return containsAny(result.message, RUNTIME_CONFIG.samePrizeRetryKeywords);
  }

  async warmupIfNeeded(targetAt) {
    if (IS_TEST) return;
    if (!(targetAt instanceof Date)) return;

    const diff = targetAt - new Date();
    if (diff <= RUNTIME_CONFIG.earlyWarmupThresholdMs) return;

    await this.queryPrizeList({ quiet: true, printList: false });
  }

  async prepareForSeckill(sessionKey) {
    const [prizeListResult, userResult, scUserResult] = await Promise.all([
      this.runWithRetry(
        () => this.queryPrizeList({ quiet: true, printList: false }),
        {
          attempts: RUNTIME_CONFIG.prizeListRetry,
          delayMs: RUNTIME_CONFIG.prizeListRetryDelayMs,
          shouldRetry: (result) => !result.ok && !result.code,
        }
      ),
      this.runWithRetry(
        () => this.checkUser({ quiet: true }),
        {
          attempts: RUNTIME_CONFIG.precheckRetry,
          delayMs: RUNTIME_CONFIG.precheckRetryDelayMs,
          shouldRetry: (result) => this.shouldRetryPrecheck(result),
        }
      ),
      this.runWithRetry(
        () => this.checkSCUser({ quiet: true }),
        {
          attempts: RUNTIME_CONFIG.precheckRetry,
          delayMs: RUNTIME_CONFIG.precheckRetryDelayMs,
          shouldRetry: (result) => this.shouldRetryPrecheck(result),
        }
      ),
    ]);

    return {
      prizeListResult:
        prizeListResult.ok ? prizeListResult : this.lastPrizeListResult || prizeListResult,
      userResult,
      scUserResult,
    };
  }

  classifySeckillAction(result, attempt, maxAttempts) {
    const message = String(result?.message || "");

    if (result?.ok) return "success";
    if (result?.stopAll) return "stopAll";

    if (
      result?.code === "6006" ||
      containsAny(message, RUNTIME_CONFIG.stopPrizeKeywords)
    ) {
      return "nextPrize";
    }

    if (
      attempt < maxAttempts &&
      (!result?.code || containsAny(message, RUNTIME_CONFIG.samePrizeRetryKeywords))
    ) {
      return "retrySamePrize";
    }

    return "nextPrize";
  }

  buildBatchSkipResult(batchControl) {
    if (!batchControl) return null;

    if (batchControl.success) {
      const winnerName = batchControl.winnerPrizeName || "同批次商品";
      return {
        ok: false,
        stopAll: false,
        tryNext: false,
        skipped: true,
        code: "",
        message: `${winnerName} 已成功，停止继续重试`,
      };
    }

    if (batchControl.stopAll) {
      return {
        ok: false,
        stopAll: true,
        tryNext: false,
        skipped: true,
        code: "",
        message: batchControl.stopMessage || "接口要求终止后续尝试",
      };
    }

    return null;
  }

  async seckillWithRetry(prize, batchControl = null) {
    const maxAttempts = Math.max(1, RUNTIME_CONFIG.seckillRetryPerPrize);
    let lastResult = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const skippedResult = this.buildBatchSkipResult(batchControl);
      if (skippedResult) {
        return skippedResult;
      }

      if (attempt === 1) {
        this.info(`执行秒杀：${prize.name}（ID:${prize.id}）`);
      } else {
        this.warning(`重试同一商品：${prize.name}（第 ${attempt}/${maxAttempts} 次）`);
      }

      lastResult = await this.seckill(prize, { quiet: true });
      console.log("=".repeat(60));
      console.log(
        `[4] 秒杀执行结果：code=${lastResult.code || "-"} | msg=${lastResult.message || "-"}`
      );

      if (lastResult.ok) {
        if (batchControl) {
          batchControl.success = true;
          batchControl.winnerPrizeName = prize.name;
        }
        this.success(`接口提示：${lastResult.message}`);
        return lastResult;
      }

      const action = this.classifySeckillAction(lastResult, attempt, maxAttempts);
      if (action === "stopAll") {
        if (batchControl) {
          batchControl.stopAll = true;
          batchControl.stopMessage = lastResult.message;
        }
        this.error(`接口提示：${lastResult.message}`);
        return { ...lastResult, stopAll: true };
      }

      if (action === "retrySamePrize") {
        const retrySkippedResult = this.buildBatchSkipResult(batchControl);
        if (retrySkippedResult) {
          return retrySkippedResult;
        }
        await sleep(RUNTIME_CONFIG.seckillRetryDelayMs);
        continue;
      }

      this.error(`接口提示：${lastResult.message}`);
      return lastResult;
    }

    return lastResult || {
      ok: false,
      stopAll: false,
      tryNext: true,
      code: "",
      message: "秒杀未返回有效结果",
    };
  }

  async seckillBatch(batch, prizeListResult, sessionPlan) {
    const executable = [];

    for (const prize of batch.prizes) {
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

      executable.push(prize);
    }

    if (executable.length === 0) {
      return {
        attempted: false,
        successResult: null,
        stopResult: null,
        results: [],
      };
    }

    this.info(
      `开始并发提交 P${batch.priority}（${batch.label}）：${executable
        .map((item) => item.name)
        .join("、")}`
    );

    const batchControl = {
      success: false,
      winnerPrizeName: "",
      stopAll: false,
      stopMessage: "",
    };

    const settledResults = await Promise.allSettled(
      executable.map(async (prize) => ({
        prize,
        result: await this.seckillWithRetry(prize, batchControl),
      }))
    );

    const results = settledResults.map((entry, index) => {
      if (entry.status === "fulfilled") {
        return entry.value;
      }

      return {
        prize: executable[index],
        result: {
          ok: false,
          stopAll: false,
          tryNext: true,
          code: "",
          message: formatError(entry.reason),
        },
      };
    });

    const successResult = results.find((entry) => entry.result?.ok) || null;
    if (successResult) {
      return {
        attempted: true,
        successResult,
        stopResult: null,
        results,
      };
    }

    const stopResult = results.find((entry) => entry.result?.stopAll) || null;
    return {
      attempted: true,
      successResult: null,
      stopResult,
      results,
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

  async seckill(prize, options = {}) {
    const { quiet = false } = options;
    if (!quiet) {
      this.info(`执行秒杀：${prize.name}（ID:${prize.id}）`);
    }

    try {
      const data = await requestJson("POST", API.seckillDo, {
        headers: this.getHeaders(),
        params: this.getCommonParams({
          prizeConfigId: prize.id,
        }),
        body: {},
        timeout: RUNTIME_CONFIG.seckillTimeoutMs,
      });

      this.debug(buildApiDebugLine("seckill", data));
      if (!quiet) {
        console.log("=".repeat(60));
        console.log(
          `[4] 秒杀执行结果：code=${extractCode(data) || "-"} | msg=${extractMessage(data) || "-"}${typeof data?.data === "string" && data.data.trim() ? ` | data=${data.data.trim()}` : ""}`
        );
      }

      const result = this.parseSeckillResult(data);

      if (result.ok) {
        if (!quiet) {
          this.success(`接口提示：${result.message}`);
        }
      } else {
        if (!quiet) {
          this.error(`接口提示：${result.message}`);
        }
      }

      return result;
    } catch (error) {
      const message = formatError(error);
      if (!quiet) {
        this.error(`秒杀请求异常：${message}`);
      }
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
    const scheduledSessionKey = this.resolveSessionKey();
    const scheduledSession = SESSION_RULES[scheduledSessionKey];
    const targetAt = getTargetDate(scheduledSession.startTime);
    const preheatAt = new Date(targetAt.getTime() - RUNTIME_CONFIG.preheatLeadMs);

    await this.warmupIfNeeded(targetAt);

    if (!IS_TEST && preheatAt > new Date()) {
      this.info(`等待进入${scheduledSession.label}预热窗口 [${formatTimeWithMs(preheatAt)}]...`);
      await waitUntilDate(preheatAt);
    }

    this.info(`${scheduledSession.label}预热中，开始资格校验与商品刷新`);
    let { prizeListResult, userResult, scUserResult } = await this.prepareForSeckill(
      scheduledSessionKey
    );

    if (!userResult.ok) {
      if (userResult.message) {
        this.warning(`预检终止：${userResult.message}`);
      }
      return;
    }
    if (!scUserResult.ok) {
      if (scUserResult.message) {
        this.warning(`预检终止：${scUserResult.message}`);
      }
      return;
    }

    if (!prizeListResult || !prizeListResult.ok) {
      this.error("商品列表预热失败，无法建立秒杀队列");
      return;
    }

    this.printPrizeList(
      scheduledSession.label,
      this.getSessionPrizes(prizeListResult, scheduledSessionKey)
    );

    if (!IS_TEST && targetAt > new Date()) {
      this.info(`预热完成，等待开抢时间 [${scheduledSession.startTime}]...`);
      await waitUntilDate(targetAt);
    }

    this.success(`${scheduledSession.label}开始时间已到，发起秒杀`);

    let sessionPlan = this.buildSessionPlan(prizeListResult, scheduledSessionKey);
    this.info(`当前场次：${sessionPlan.sessionLabel}`);
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
      this.warning("当前队列为空，快速刷新商品库存后重试一次");
      await sleep(RUNTIME_CONFIG.emptyQueueRetryDelayMs);
      prizeListResult = await this.runWithRetry(
        () => this.queryPrizeList({ quiet: true, printList: false }),
        {
          attempts: RUNTIME_CONFIG.prizeListRetry,
          delayMs: RUNTIME_CONFIG.prizeListRetryDelayMs,
          shouldRetry: (result) => !result.ok && !result.code,
        }
      );
      if (prizeListResult.ok) {
        this.printPrizeList(
          scheduledSession.label,
          this.getSessionPrizes(prizeListResult, scheduledSessionKey)
        );
      } else if (this.lastPrizeListResult) {
        prizeListResult = this.lastPrizeListResult;
      }
      sessionPlan = this.buildSessionPlan(prizeListResult, scheduledSessionKey);
      if (sessionPlan.queue.length === 0) {
        this.error("未找到有库存的商品队列，停止执行");
        return;
      }
    }

    this.info(
      `${sessionPlan.sessionLabel}并发批次：${sessionPlan.batches
        .map(
          (batch) =>
            `P${batch.priority}(${batch.label})[${batch.prizes
              .map((item) => item.name)
              .join("、")}]`
        )
        .join(" | ")}`
    );

    let successResult = null;
    const lastBatchIndex = sessionPlan.batches.length - 1;

    for (const [batchIndex, batch] of sessionPlan.batches.entries()) {
      const batchResult = await this.seckillBatch(batch, prizeListResult, sessionPlan);

      if (batchResult.successResult) {
        successResult = batchResult.successResult;
        break;
      }

      if (batchResult.stopResult) {
        this.warning(`接口提示要求终止后续尝试：${batchResult.stopResult.result.message}`);
        break;
      }

      if (!batchResult.attempted) continue;

      this.warning(`P${batch.priority}（${batch.label}）未成功，准备切换下一批次`);
      if (batchIndex < lastBatchIndex) {
        await sleep(RUNTIME_CONFIG.switchPrizeDelayMs);
      }
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
