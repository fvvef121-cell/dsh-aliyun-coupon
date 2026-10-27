/**
 * 离线自检：不联网、不碰凭据，只验证签名串、解析与汇总。
 * 运行：node tools/selfcheck.mjs
 */
import assert from 'node:assert/strict'
import {
  canonicalQuery,
  buildDescribeCouponRequest,
  buildQueryCashCouponsRequest,
  parseDescribeCoupon,
  parseQueryCashCoupons,
  summarizeCoupons,
  maskAccessKeyId,
  maskCouponNumber,
  displayPath,
  safeEndpoint,
  DEFAULT_ENDPOINT,
} from '../lib/index.js'

const credentials = { akId: 'LTAI5tTESTKEYID', akSecret: 'test-secret', stsToken: '' }
const fixed = { endpoint: DEFAULT_ENDPOINT, now: new Date('2026-10-26T05:09:45Z'), nonce: 'nonce-fixed-1' }

// 1) 参数串：升序 + RFC3986 编码（空格 %20，波浪号不转义）
assert.equal(canonicalQuery({ PageSize: 50, CurrentPage: 1 }), 'CurrentPage=1&PageSize=50')
assert.equal(canonicalQuery({ b: 'x y', a: '~*' }), 'a=~%2A&b=x%20y')

// 2) DescribeCoupon（ACS3）：请求形状与签名头
const acs = buildDescribeCouponRequest(credentials, fixed)
assert.equal(acs.init.method, 'POST')
assert.match(acs.url, /^https:\/\/business\.aliyuncs\.com\/\?CurrentPage=1&PageSize=50$/)
assert.equal(acs.init.headers['x-acs-action'], 'DescribeCoupon')
assert.equal(acs.init.headers['x-acs-date'], '2026-10-26T05:09:45Z')
assert.equal(acs.init.headers['x-acs-version'], '2023-09-30')
assert.match(acs.init.headers.authorization, /^ACS3-HMAC-SHA256 Credential=LTAI5tTESTKEYID,SignedHeaders=[a-z0-9;-]+,Signature=[0-9a-f]{64}$/)
// SignedHeaders 必须与实际参与签名的头一致，且不含 Authorization/Accept
const signed = acs.init.headers.authorization.match(/SignedHeaders=([^,]+),/)[1].split(';')
assert.deepEqual(signed, ['content-type', 'host', 'x-acs-action', 'x-acs-content-sha256', 'x-acs-date', 'x-acs-signature-nonce', 'x-acs-version'])
assert.equal(acs.init.headers.authorization.includes('Accept'), false)
assert.equal(acs.init.redirect, 'error')

// 3) QueryCashCoupons（RPC V1.0）：表单体里必须带 Signature
const rpc = buildQueryCashCouponsRequest(credentials, fixed)
assert.equal(rpc.init.method, 'POST')
assert.equal(rpc.url, 'https://business.aliyuncs.com/')
assert.match(rpc.init.body, /Action=QueryCashCoupons/)
assert.match(rpc.init.body, /SignatureVersion=1\.0/)
assert.match(rpc.init.body, /Signature=[A-Za-z0-9%._~-]+$/)
assert.equal(rpc.init.body.includes('test-secret'), false)

// 4) 解析：新接口 / 旧接口各一份「形状真实、数值虚构」的样例
const describe = parseDescribeCoupon({
  CurrentPage: 1,
  PageSize: 20,
  TotalCount: 1,
  Data: [
    {
      CouponNo: '123456789012',
      CouponType: 'CERTAIN',
      CouponTypeName: '代金券',
      Amount: '500.000000',
      RemainAmount: '123.4567000000',
      Status: 'Available',
      Currency: 'CNY',
      StartTime: '2025-01-01T00:00Z',
      EndTime: '2027-12-31T00:00Z',
      ItemNames: ['通用'],
      UniversalType: 'UNIVERSAL',
    },
  ],
})
assert.equal(describe.length, 1)
assert.equal(describe[0].remaining, 123.4567)
assert.equal(describe[0].nominal, 500)

const legacy = parseQueryCashCoupons({
  Code: 'Success',
  Success: true,
  Data: { CashCoupon: [{ Status: 'Available', CashCouponNo: 'Q-abc', NominalValue: '100.00', Balance: '88.88', ExpiryTime: '2027-06-30T00:00:00Z', ApplicableProducts: '通用' }] },
})
assert.equal(legacy[0].remaining, 88.88)

// 5) 汇总：只算 Available，过期券不参与总计；到期时间取最近一张
const summary = summarizeCoupons([
  ...describe,
  { no: 'expired', status: 'Expired', currency: 'CNY', nominal: 100, remaining: 100, expiry: '2026-01-01T00:00:00Z' },
])
assert.equal(summary.count, 1)
assert.equal(summary.remaining, 123.4567)
assert.equal(Math.round(summary.used * 100) / 100, 376.54)
assert.equal(summary.expiry, '2027-12-31T00:00:00.000Z')

// 6) 掩码：浏览器只会看到这一种形态
assert.equal(maskAccessKeyId('LTAI5tAbCdEfGhIjKl'), 'LTAI5t...IjKl')
assert.equal(maskAccessKeyId('short'), 'sh***')

// 7) 券号脱敏：默认不下发完整券号
assert.equal(maskCouponNumber('123456789012'), '1234****9012')
assert.equal(maskCouponNumber('12345'), '12***')
assert.equal(maskCouponNumber(''), '')

// 8) 端点白名单：只放行 *.aliyuncs.com，其他一律退回默认端点
assert.equal(safeEndpoint('business.aliyuncs.com'), 'business.aliyuncs.com')
assert.equal(safeEndpoint('https://business.ap-southeast-1.aliyuncs.com/'), 'business.ap-southeast-1.aliyuncs.com')
assert.equal(safeEndpoint('  BUSINESS.Aliyuncs.COM  '), 'business.aliyuncs.com')
for (const hostile of [
  'evil.com',
  'business.aliyuncs.com.evil.com',
  'evil-aliyuncs.com',
  'aliyuncs.com.evil.cn',
  'http://127.0.0.1:8080',
  'business.aliyuncs.com#@evil.com',
  '',
  undefined,
]) {
  assert.equal(safeEndpoint(hostile), DEFAULT_ENDPOINT, `应拒绝端点: ${String(hostile)}`)
}

// 9) 下发路径不带电脑用户名
const homePath = displayPath(
  process.platform === 'win32'
    ? `${process.env.USERPROFILE}\\.dsh\\aliyun-coupon.json`
    : `${process.env.HOME}/.dsh/aliyun-coupon.json`,
)
assert.match(homePath, /^~[\\/]\.dsh[\\/]aliyun-coupon\.json$/)
assert.equal(homePath.includes(process.env.USERPROFILE ?? '\u0000'), false)

console.log('selfcheck ok: 签名串/解析/汇总/掩码/端点白名单/路径脱敏 全部通过')