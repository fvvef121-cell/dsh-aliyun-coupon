/**
 * dsh-aliyun-coupon —— Host 半部。
 *
 * 只用阿里云官方 BSS OpenAPI 只读接口读卡券（代金券）余额：
 *   1) DescribeCoupon（2023-09-30，ACS3-HMAC-SHA256 签名，新费用中心「卡券」页同源数据）
 *   2) QueryCashCoupons（2017-12-14，RPC 签名 V1.0，旧接口，作回退）
 * 凭据从环境变量或 ~/.dsh/aliyun-coupon.json 读取，只在宿主进程里用于签名；
 * 下发给浏览器的只有汇总数字与掩码后的 AccessKey ID。路由仅接受回环地址。
 */

import { createHash, createHmac, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const VERSION = '0.1.1'
export const ROUTE_PREFIX = '/api/dsh-aliyun-coupon'
export const DEFAULT_AK_FILE = join(homedir(), '.dsh', 'aliyun-coupon.json')
export const DEFAULT_ENDPOINT = 'business.aliyuncs.com'

const REQUEST_TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 262_144
const ENV_KEYS = {
  akId: ['ALIBABA_CLOUD_ACCESS_KEY_ID', 'ALIYUN_AK_ID', 'ALIYUN_ACCESS_KEY_ID'],
  akSecret: ['ALIBABA_CLOUD_ACCESS_KEY_SECRET', 'ALIYUN_AK_SECRET', 'ALIYUN_ACCESS_KEY_SECRET'],
  stsToken: ['ALIBABA_CLOUD_SECURITY_TOKEN', 'ALIYUN_STS_TOKEN'],
  endpoint: ['ALIYUN_BSS_ENDPOINT'],
}
const AK_FILE_KEYS = {
  akId: ['akId', 'aliyunAkId', 'AccessKeyId', 'accessKeyId'],
  akSecret: ['akSecret', 'aliyunAkSecret', 'AccessKeySecret', 'accessKeySecret'],
  stsToken: ['stsToken', 'aliyunStsToken', 'securityToken', 'SecurityToken'],
  endpoint: ['endpoint', 'bssEndpoint'],
}

export const inject = ['webServer']

// ---------------------------------------------------------------- 基础工具

function hashHex(value) {
  return createHash('sha256').update(value).digest('hex')
}

/** ACS3 与 RPC 两套签名都要求 RFC 3986 百分号编码（encodeURIComponent 另外漏掉 !'()*）。 */
function percentEncode(value) {
  return encodeURIComponent(String(value)).replace(
    /[!'()*]/g,
    character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

/** 参数名升序、逐项百分号编码；空值（undefined/null/''）不参与签名也不发送。 */
export function canonicalQuery(params) {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${percentEncode(key)}=${percentEncode(value)}`)
    .join('&')
}

const isoTimestamp = now => now.toISOString().replace(/\.\d{3}Z$/, 'Z')

export function maskAccessKeyId(akId) {
  const text = String(akId ?? '')
  if (text.length <= 8) return text ? `${text.slice(0, 2)}***` : ''
  return `${text.slice(0, 6)}...${text.slice(-4)}`
}

/** 券号默认脱敏：首尾各留 4 位，够和后台核对，又不会整串外流。 */
export function maskCouponNumber(value) {
  const text = String(value ?? '')
  if (text.length <= 8) return text ? `${text.slice(0, 2)}***` : ''
  return `${text.slice(0, 4)}****${text.slice(-4)}`
}

/** 原生路径换成 ~ 形式再下发浏览器，别把电脑用户名带进前端。 */
export function displayPath(filePath) {
  const text = String(filePath ?? '')
  const home = homedir()
  if (home && (text === home || text.startsWith(`${home}\\`) || text.startsWith(`${home}/`))) {
    return `~${text.slice(home.length)}`
  }
  return text
}

/**
 * 端点白名单：只认 *.aliyuncs.com。
 * 配置里的 endpoint 若被改坏或被人塞了别的域名，绝不把 AccessKey ID / 签名 / STS Token 发过去。
 */
export const ENDPOINT_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.aliyuncs\.com$/

export function safeEndpoint(candidate, fallback = DEFAULT_ENDPOINT) {
  const text = String(candidate ?? '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/?#].*$/, '')
  return ENDPOINT_PATTERN.test(text) ? text : fallback
}

function asMoney(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const text = String(value ?? '').trim()
  if (!/^[+-]?\d+(\.\d+)?$/.test(text)) return null
  const amount = Number(text)
  return Number.isFinite(amount) ? amount : null
}

// ---------------------------------------------------------------- 请求构造

/** DescribeCoupon：POST + 查询串，ACS3-HMAC-SHA256。 */
export function buildDescribeCouponRequest(credentials, options = {}) {
  const {
    endpoint = DEFAULT_ENDPOINT,
    now = new Date(),
    nonce = randomUUID(),
    page = 1,
    pageSize = 50,
  } = options
  const query = canonicalQuery({ CurrentPage: page, PageSize: pageSize })
  const headers = {
    'content-type': 'application/x-www-form-urlencoded',
    host: endpoint,
    'x-acs-action': 'DescribeCoupon',
    'x-acs-content-sha256': hashHex(''),
    'x-acs-date': isoTimestamp(now),
    'x-acs-signature-nonce': nonce,
    'x-acs-version': '2023-09-30',
  }
  if (credentials.stsToken) headers['x-acs-security-token'] = credentials.stsToken
  const names = Object.keys(headers).sort()
  const canonicalHeaders = names.map(name => `${name}:${headers[name].trim()}\n`).join('')
  const signedHeaders = names.join(';')
  const canonicalRequest = ['POST', '/', query, canonicalHeaders, signedHeaders, hashHex('')].join('\n')
  const signature = createHmac('sha256', credentials.akSecret)
    .update(`ACS3-HMAC-SHA256\n${hashHex(canonicalRequest)}`)
    .digest('hex')
  headers.authorization = `ACS3-HMAC-SHA256 Credential=${credentials.akId},SignedHeaders=${signedHeaders},Signature=${signature}`
  headers.accept = 'application/json'
  return {
    url: `https://${endpoint}/?${query}`,
    init: { method: 'POST', headers, body: '', redirect: 'error' },
  }
}

/** QueryCashCoupons：RPC 风格 HMAC-SHA1（SignatureVersion 1.0）。 */
export function buildQueryCashCouponsRequest(credentials, options = {}) {
  const {
    endpoint = DEFAULT_ENDPOINT,
    now = new Date(),
    nonce = randomUUID(),
    effectiveOrNot = true,
  } = options
  const params = {
    AccessKeyId: credentials.akId,
    Action: 'QueryCashCoupons',
    EffectiveOrNot: String(effectiveOrNot),
    Format: 'JSON',
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: nonce,
    SignatureVersion: '1.0',
    Timestamp: isoTimestamp(now),
    Version: '2017-12-14',
  }
  if (credentials.stsToken) params.SecurityToken = credentials.stsToken
  const query = canonicalQuery(params)
  const stringToSign = `POST&${percentEncode('/')}&${percentEncode(query)}`
  const signature = createHmac('sha1', `${credentials.akSecret}&`).update(stringToSign).digest('base64')
  return {
    url: `https://${endpoint}/`,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: `${query}&Signature=${percentEncode(signature)}`,
      redirect: 'error',
    },
  }
}

// ---------------------------------------------------------------- 响应解析

export function parseDescribeCoupon(data) {
  const list = Array.isArray(data?.Data) ? data.Data : []
  return list.map(item => ({
    no: String(item?.CouponNo ?? item?.CouponId ?? ''),
    type: String(item?.CouponTypeName ?? item?.CouponType ?? ''),
    status: String(item?.Status ?? ''),
    currency: String(item?.Currency ?? 'CNY'),
    nominal: asMoney(item?.Amount),
    remaining: asMoney(item?.RemainAmount),
    start: String(item?.StartTime ?? ''),
    expiry: String(item?.EndTime ?? ''),
    products: Array.isArray(item?.ItemNames) ? item.ItemNames.join('、') : String(item?.ItemNames ?? ''),
  }))
}

export function parseQueryCashCoupons(data) {
  const raw = data?.Data?.CashCoupon ?? data?.CashCoupon
  const list = Array.isArray(raw) ? raw : []
  return list.map(item => ({
    no: String(item?.CashCouponNo ?? item?.CashCouponId ?? ''),
    type: '代金券',
    status: String(item?.Status ?? ''),
    currency: 'CNY',
    nominal: asMoney(item?.NominalValue),
    remaining: asMoney(item?.Balance),
    start: String(item?.EffectiveTime ?? ''),
    expiry: String(item?.ExpiryTime ?? ''),
    products: String(item?.ApplicableProducts ?? ''),
  }))
}

/** 只统计状态为 Available 的券；一张都没有时退回全量，避免把「已过期」误报成 0。 */
export function summarizeCoupons(coupons) {
  const available = coupons.filter(item => item.status.toLowerCase() === 'available')
  const rows = available.length > 0 ? available : coupons
  const remaining = rows.reduce((sum, item) => sum + (item.remaining ?? 0), 0)
  const nominal = rows.reduce((sum, item) => sum + (item.nominal ?? 0), 0)
  const expiries = rows.map(item => Date.parse(item.expiry)).filter(Number.isFinite)
  return {
    count: rows.length,
    availableCount: available.length,
    currency: rows[0]?.currency ?? 'CNY',
    remaining,
    nominal,
    used: nominal > 0 ? Math.max(0, nominal - remaining) : null,
    expiry: expiries.length > 0 ? new Date(Math.min(...expiries)).toISOString() : null,
    numbers: rows.map(item => item.no).filter(Boolean).slice(0, 5),
    rows,
  }
}

// ---------------------------------------------------------------- 凭据解析

function firstString(source, keys) {
  for (const key of keys) {
    const value = source?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

/** 环境变量优先，其次 AK 文件；任何一条缺失都算未配置。 */
export async function resolveCredentials(options = {}) {
  const filePath = options.akFile || DEFAULT_AK_FILE
  let fileSettings = null
  let fileError = null
  try {
    // 记事本保存可能带 UTF-8 BOM，JSON.parse 不认，先削掉再解析。
    const raw = await readFile(filePath, 'utf8')
    fileSettings = JSON.parse(raw.replace(/^\uFEFF/, ''))
  } catch (error) {
    if (error?.code !== 'ENOENT') fileError = `AK 文件无法读取：${displayPath(filePath)}（${error?.code ?? error?.name ?? '未知错误'}）`
  }
  const envSource = {}
  for (const [field, names] of Object.entries(ENV_KEYS)) {
    for (const name of names) {
      if (process.env[name]) {
        envSource[field] = process.env[name]
        break
      }
    }
  }
  const pick = field => firstString(envSource, [field]) || firstString(fileSettings, AK_FILE_KEYS[field])
  const akId = pick('akId')
  const akSecret = pick('akSecret')
  const stsToken = pick('stsToken')
  // 端点只认阿里云域；写了别的域名一律退回默认端点，防止凭据被导流。
  const endpoint = safeEndpoint(pick('endpoint') || options.endpoint, DEFAULT_ENDPOINT)
  return {
    akId,
    akSecret,
    stsToken,
    endpoint,
    configured: Boolean(akId && akSecret),
    source: firstString(envSource, ['akId']) ? 'env' : fileSettings ? 'file' : '',
    filePath,
    fileError,
  }
}

// ---------------------------------------------------------------- 网络查询

class CouponError extends Error {
  constructor(message, code = 'error') {
    super(message)
    this.name = 'CouponError'
    this.code = code
  }
}

async function readJson(response) {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new CouponError('响应过大，已拒绝解析', 'payload')
  const text = await response.text()
  if (text.length > MAX_RESPONSE_BYTES) throw new CouponError('响应过大，已拒绝解析', 'payload')
  try {
    return JSON.parse(text)
  } catch {
    throw new CouponError('响应不是 JSON', 'payload')
  }
}

function apiFailure(data, status) {
  // 只保留错误码，不回显上游 Message：那里可能夹账号、RequestId 甚至余额。
  const code = String(data?.Code ?? data?.code ?? '')
    .slice(0, 40)
    .replace(/[^A-Za-z]/g, '')
  if (code && !/^success$/i.test(code)) {
    if (/NotAuthorized|Forbidden|NoPermission/i.test(code)) {
      return new CouponError(`阿里云拒绝该 AccessKey（${code}）：RAM 需要 bss:DescribeCoupon / bss:DescribeCoupons 只读权限`, 'permission')
    }
    if (/NotApplicable/i.test(code)) {
      return new CouponError('该接口不适用于当前账号类型（NotApplicable）：改用主账号 AccessKey 重试', 'not-applicable')
    }
    return new CouponError(`阿里云返回错误码 ${code}`, 'api')
  }
  if (data?.Success === false) return new CouponError('阿里云返回失败（Success=false）', 'api')
  if (status === 401 || status === 403) {
    return new CouponError('阿里云鉴权失败：请检查 AccessKey 与 RAM 只读权限 bss:DescribeCoupon / bss:DescribeCoupons', 'permission')
  }
  return null
}

async function callEndpoint(build, parse, credentials, endpoint, signal) {
  const { url, init } = build(credentials, { endpoint })
  let response
  try {
    response = await fetch(url, { ...init, signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw new CouponError('阿里云接口超时（15 秒）', 'timeout')
    if (/redirect/i.test(String(error?.message))) throw new CouponError('阿里云接口发生重定向，已拒绝转发凭据', 'redirect')
    throw new CouponError(
      `阿里云接口网络失败（${String(error?.cause?.code ?? error?.name ?? 'unknown').slice(0, 40)}）`,
      'network',
    )
  }
  let data
  try {
    data = await readJson(response)
  } catch (error) {
    if (response.status === 403 || response.status === 401) {
      throw new CouponError('阿里云鉴权失败：请检查 AccessKey 与 RAM 只读权限', 'permission')
    }
    if (response.status >= 300 && response.status < 400) throw new CouponError('阿里云接口发生重定向，已拒绝转发凭据', 'redirect')
    throw new CouponError(`阿里云接口返回 HTTP ${response.status}（响应无法解析）`, 'http')
  }
  const failure = apiFailure(data, response.status)
  if (failure) throw failure
  if (!response.ok) throw new CouponError(`阿里云接口返回 HTTP ${response.status}`, 'http')
  return parse(data)
}

/** 先 DescribeCoupon；失败或空结果时再用 QueryCashCoupons 兜底，返回数据较多的一方。 */
export async function queryCoupons(credentials, options = {}) {
  const endpoint = safeEndpoint(options.endpoint || credentials.endpoint, DEFAULT_ENDPOINT)
  const attempts = []
  let best = null
  for (const [source, build, parse] of [
    ['DescribeCoupon', buildDescribeCouponRequest, parseDescribeCoupon],
    ['QueryCashCoupons', buildQueryCashCouponsRequest, parseQueryCashCoupons],
  ]) {
    try {
      const coupons = await callEndpoint(build, parse, credentials, endpoint, options.signal)
      if (coupons.length === 0) {
        attempts.push({ source, outcome: 'empty' })
        continue
      }
      best = { source, coupons }
      break
    } catch (error) {
      // 只记自家错误码，不把上游文本带出去。
      attempts.push({ source, outcome: 'error', code: String(error?.code ?? 'error').slice(0, 24) })
      // 权限/账号类型问题换接口也没用，但空结果与网络问题值得换，所以继续下一轮。
    }
  }
  if (best) return { ...best, attempts }
  if (attempts.every(item => item.outcome === 'empty')) return { source: 'DescribeCoupon', coupons: [], attempts }
  const summary = attempts.map(item => `${item.source}:${item.outcome}${item.code ? `/${item.code}` : ''}`).join('；')
  throw new CouponError(`阿里云接口查询失败（${summary}）`, 'all-failed')
}

// ---------------------------------------------------------------- 路由

function isLoopback(request) {
  const address = request.socket?.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/**
 * 只接受本机直连的同类请求：
 *  - 源地址必须是回环；
 *  - 带 X-Forwarded-For / Forwarded / X-Real-Ip 说明是反代或隧道转发的，
 *    否则代理会把「源地址」伪装成回环，回环判断就被绕过了；
 *  - Sec-Fetch-Site: cross-site 说明是别的站点发起的跨站请求。
 */
function requestGuard(request, method) {
  if (!isLoopback(request)) return { status: 403, error: 'forbidden: loopback-only' }
  const headers = request.headers ?? {}
  if (headers['x-forwarded-for'] || headers['x-real-ip'] || headers.forwarded) {
    return { status: 403, error: 'forbidden: proxied request' }
  }
  if (String(headers['sec-fetch-site'] ?? '').toLowerCase() === 'cross-site') {
    return { status: 403, error: 'forbidden: cross-site request' }
  }
  if (method && request.method !== method) return { status: 405, error: 'method not allowed' }
  return null
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  })
  response.end(body)
}

// ---------------------------------------------------------------- 插件主体

const clampNumber = (value, min, max, fallback) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

export function apply(ctx, config = {}) {
  const options = {
    refreshMinutes: clampNumber(config?.refreshMinutes, 1, 1440, 10),
    akFile: typeof config?.akFile === 'string' && config.akFile.trim() ? config.akFile.trim() : DEFAULT_AK_FILE,
    endpoint: typeof config?.endpoint === 'string' ? config.endpoint.trim() : '',
    label: typeof config?.label === 'string' ? config.label.trim() : '',
    // 默认对下发到浏览器的券号脱敏；确实要整串核对时再打开。
    fullCouponNumbers: config?.fullCouponNumbers === true,
  }
  const state = {
    at: null,
    busy: false,
    configured: false,
    akIdMasked: '',
    credentialSource: '',
    akFile: options.akFile,
    hint: '',
    error: null,
    snapshot: null,
    attempts: [],
  }

  async function refresh() {
    if (state.busy) return
    state.busy = true
    try {
      const credentials = await resolveCredentials(options)
      state.akFile = credentials.filePath
      state.credentialSource = credentials.source
      state.configured = credentials.configured
      state.akIdMasked = credentials.configured ? maskAccessKeyId(credentials.akId) : ''
      if (!credentials.configured) {
        state.hint = credentials.fileError
          ? credentials.fileError
          : `未配置 AccessKey：把只读 RAM AccessKey 写进 ${displayPath(credentials.filePath)}`
        state.error = null
        return
      }
      const result = await queryCoupons(credentials, { endpoint: options.endpoint })
      const summary = summarizeCoupons(result.coupons)
      state.snapshot = {
        ...summary,
        label: options.label,
        source: result.source,
        refreshedAt: Date.now(),
      }
      state.attempts = result.attempts
      state.hint = ''
      state.error = null
      state.at = Date.now()
    } catch (error) {
      // 失败保留上一次的数值，只记错误，不让图框变空。
      state.error = error?.message ?? String(error)
      state.at = Date.now()
    } finally {
      state.busy = false
    }
  }

  function payload() {
    // 下发到浏览器的东西只有这些：掩码 AK ID、余额数字、脱敏券号、~ 形式路径、自家错误码。
    const showNumber = value => (options.fullCouponNumbers ? String(value ?? '') : maskCouponNumber(value))
    return {
      ok: Boolean(state.snapshot) && !state.error,
      at: state.at,
      busy: state.busy,
      configured: state.configured,
      akIdMasked: state.akIdMasked,
      credentialSource: state.credentialSource,
      akFile: displayPath(state.akFile),
      hint: state.hint,
      error: state.error,
      attempts: state.attempts.map(item => `${item.source}: ${item.outcome}`),
      refreshMinutes: options.refreshMinutes,
      coupon: state.snapshot
        ? {
            label: state.snapshot.label,
            source: state.snapshot.source,
            currency: state.snapshot.currency,
            remaining: state.snapshot.remaining,
            nominal: state.snapshot.nominal,
            used: state.snapshot.used,
            count: state.snapshot.count,
            expiry: state.snapshot.expiry,
            numbers: state.snapshot.numbers.map(showNumber),
          }
        : null,
      coupons: state.snapshot
        ? state.snapshot.rows.map(item => ({
            no: showNumber(item.no),
            type: item.type,
            status: item.status,
            currency: item.currency,
            nominal: item.nominal,
            remaining: item.remaining,
            expiry: item.expiry,
            products: item.products,
          }))
        : [],
      client: { version: VERSION },
    }
  }

  const overview = async (request, response) => {
    const rejection = requestGuard(request, 'GET')
    if (rejection) {
      sendJson(response, rejection.status, { ok: false, error: rejection.error })
      return
    }
    if (!state.at) await refresh()
    sendJson(response, 200, payload())
  }

  const manualRefresh = async (request, response) => {
    const rejection = requestGuard(request, 'POST')
    if (rejection) {
      sendJson(response, rejection.status, { ok: false, error: rejection.error })
      return
    }
    // 消费掉请求体，避免连接悬着；本接口不读任何入参。
    request.resume()
    await refresh()
    sendJson(response, 200, payload())
  }

  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: `${ROUTE_PREFIX}/overview`, handler: overview }))
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: `${ROUTE_PREFIX}/refresh`, handler: manualRefresh }))

  ctx.effect(() => {
    const kickoff = setTimeout(() => void refresh(), 3_000)
    const timer = setInterval(() => void refresh(), options.refreshMinutes * 60_000)
    return () => {
      clearTimeout(kickoff)
      clearInterval(timer)
    }
  })
}