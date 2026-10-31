# dsh-aliyun-coupon

[![npm version](https://img.shields.io/npm/v/dsh-aliyun-coupon.svg)](https://www.npmjs.com/package/dsh-aliyun-coupon)
[![license](https://img.shields.io/npm/l/dsh-aliyun-coupon.svg)](LICENSE)

在 DeepSeek Harness（DSH）Web GUI 的**侧栏页脚**（`sidebar.footer.action`，即 dsh-cost-meter 余额/预算图框原来的位置）显示
**阿里云卡券（代金券）的剩余余额**、已用额度与到期时间。面向云工开物学生专属代金券这类账户券，也适用于任意阿里云代金券/抵用券。

- 数据源：阿里云官方 **BSS OpenAPI 只读接口**——首选 `DescribeCoupon`（2023-09-30，新费用中心「卡券」页同源数据），
  失败或返回空结果时自动回退 `QueryCashCoupons`（2017-12-14）。
- 凭据：只读 **RAM AccessKey**（`LTAI…`，**不是**百炼/DashScope 的 `sk-` Key），只在**宿主进程**里用于签名。
  浏览器只能拿到：掩码 ID（`LTAI5t...IjKl`）、余额数字、**脱敏券号**（`1234****9012`）、`~` 形式的文件路径。
- 路由：`GET /api/dsh-aliyun-coupon/overview`、`POST /api/dsh-aliyun-coupon/refresh`，**仅回环地址**可访问；
  带 `X-Forwarded-For` 等代理头的请求、以及跨站请求同样被拒。

> **第一次装？** 从零到出数大约 5 分钟。建只读 RAM 用户、写 AK 文件、配置项、常见问题排查，
> 全在 **[使用说明（docs/usage.zh-CN.md）](docs/usage.zh-CN.md)** 里，本文只讲重点。

<!-- 截图：维护者可在 docs/screenshot.png 放一张侧栏图后在此处引用；本文件暂不引用不存在的图片。 -->

## 它显示什么

| 位置 | 内容 |
| --- | --- |
| 标题行 | 图框标题（默认「阿里云代金券」，可用 `label` 改）＋剩余余额，如 `¥123.46` |
| 进度条 | 已用 / 面值 |
| 第二行 | `面值 ¥500 · 已用 ¥376.54` |
| 第三行 | `到期 2027-12-31` ＋ 刷新提示 / 错误行 |
| 悬停 | 券号、券类型、面值、余额、到期时间；多张券逐条列出 |
| 侧栏收起态 | 只显示金额（`¥123.5`） |

## 安装

**方式一：插件页安装（推荐，桌面端也能用）**

DSH 的 **desktop** profile 由桌面 App 独占，`dsh` CLI 拒绝改动它，所以桌面端请在 **插件** 页安装本包
（添加本地目录或 GitHub 源），装好后刷新页面。

**方式二：CLI（非 desktop profile）**

```bash
# npm（最短，推荐）
dsh plugin --profile <profile> add dsh-aliyun-coupon

# 从 GitHub
dsh plugin --profile <profile> add github:fvvef121-cell/dsh-aliyun-coupon

# 锁版本
dsh plugin --profile <profile> add github:fvvef121-cell/dsh-aliyun-coupon#v0.1.1
```

> 新建的 profile 只有 `@deepseek-ai/dsh-base`，没有 webServer，插件会停在
> `pending (waiting for service: webServer)`。请先用 `dsh <profile> --from-default-profile web` 建出带 Web 层的 profile。

**本地开发**

```bash
dsh plugin --profile <profile> add link:/path/to/dsh-aliyun-coupon
```

装完重启/刷新后，侧栏页脚会出现图框；此时尚未配置 AccessKey，图框会显示配置提示。

## 配置 AccessKey

优先级：**环境变量 → AK 文件**。任一路径给全 `akId` + `akSecret` 即可。

**方式一（默认，推荐）**：写进 `~/.dsh/aliyun-coupon.json`

```json
{
  "akId": "LTAI5t...",
  "akSecret": "..."
}
```

可选字段：`stsToken`（STS 临时凭据）、`endpoint`（国际站填 `business.ap-southeast-1.aliyuncs.com`）。
兼容别名：`aliyunAkId` / `aliyunAkSecret` / `AccessKeyId` / `AccessKeySecret`。
记事本保存的 UTF-8 BOM 会被自动削掉；该文件不要进 git，也不要贴进聊天。

**方式二**：环境变量 `ALIBABA_CLOUD_ACCESS_KEY_ID` / `ALIBABA_CLOUD_ACCESS_KEY_SECRET`
（别名 `ALIYUN_AK_ID` / `ALIYUN_AK_SECRET`），可选 `ALIBABA_CLOUD_SECURITY_TOKEN`、`ALIYUN_BSS_ENDPOINT`。

### RAM 权限（最小授权）

建一个 **RAM 用户**，只挂下面两个只读 Action（自定义策略即可），**不要**用主账号 AccessKey：

```json
{
  "Version": "1",
  "Statement": [
    { "Effect": "Allow", "Action": ["bss:DescribeCoupon", "bss:DescribeCoupons"], "Resource": ["*"] }
  ]
}
```

| 调用 | Action |
| --- | --- |
| `DescribeCoupon` | `bss:DescribeCoupon` |
| `QueryCashCoupons` | `bss:DescribeCoupons` |

嫌麻烦也可以直接挂系统策略 `AliyunBSSReadOnlyAccess`（读权限更多，但一样花不了钱、开不了资源）。
若返回 `NotApplicable`，说明该身份不适用于此接口——那种情况才需要主账号 AccessKey。

## 可选配置

在 profile 的 `cordis.patch.yml` 里按 `id: aliyun-coupon` 覆盖：

```yaml
- id: aliyun-coupon
  config:
    refreshMinutes: 10
    label: 云工开物券
```

| 键 | 默认 | 含义 |
| --- | --- | --- |
| `refreshMinutes` | `10` | 宿主轮询间隔（1–1440 分钟） |
| `akFile` | `~/.dsh/aliyun-coupon.json` | AK 文件路径 |
| `endpoint` | `business.aliyuncs.com` | BSS 端点（国际站换 `business.ap-southeast-1.aliyuncs.com`） |
| `label` | 空 | 图框标题 |
| `fullCouponNumbers` | `false` | 是否把**完整券号**下发到浏览器（默认脱敏） |

## 数据与接口

- `DescribeCoupon`（`BssOpenApi` 2023-09-30，`business.aliyuncs.com`，ACS3-HMAC-SHA256 签名）：
  返回 `Amount`（面值）、`RemainAmount`（余额）、`Status`、`EndTime`、`Currency`、`ItemNames`。
- `QueryCashCoupons`（2017-12-14，RPC 签名 V1.0，HMAC-SHA1）：返回 `NominalValue`、`Balance`、`Status`、`ExpiryTime`。
- 只把 `Status === Available` 的券计入总计；一张可用的都没有时退回全量，避免把「已过期」误报成 0。
- 余额按接口原样保留（阿里云给到小数点后 10 位），界面显示两位小数，悬停可见原值。

## 交互

- 卡片每 60 秒（页面可见时）拉一次宿主快照；**点击卡片**立即触发一次查询（刷新中显示「正在刷新…」）。
- 查询失败时保留上一次的数值，并在卡片上显示错误行，不会突然变成 0。

## 隐私与安全

- **AccessKey 只留在宿主进程**：仅用于对阿里云端点签名，不写日志、不进响应体。
- **浏览器只收到最小集**：掩码 AK ID（`LTAI5t...IjKl`）、余额数字、脱敏券号（`1234****9012`）、`~` 形式文件路径。
  需要完整券号时才显式打开 `fullCouponNumbers`。
- **端点白名单**：只允许 `*.aliyuncs.com`。配置里的 `endpoint` 若被改成别的域名，插件直接退回默认端点——
  绝不把 AccessKey ID / 签名 / STS Token 发到陌生地址。
- **路由三层拦截**：非回环地址 403；带 `X-Forwarded-For` / `Forwarded` / `X-Real-Ip`（反向代理、隧道、端口转发）403；
  `Sec-Fetch-Site: cross-site` 的跨站请求 403。响应带 `no-store` 与 `nosniff`，不发 CORS 头。
- **错误信息脱敏**：不回显阿里云返回的 `Message`（可能含账号、RequestId、余额），只保留错误码与本地提示。
- 插件只联系你配置的 BSS 端点（默认 `business.aliyuncs.com`），没有任何遥测。

## 卸载

在「插件」页停用/移除，或删掉 profile 里的 `aliyun-coupon` 行后重启 DSH。AK 文件不会被自动删除——要清干净请自行删除 `~/.dsh/aliyun-coupon.json`。

## 开发自检

```bash
npm test        # 等价于 node tools/selfcheck.mjs：签名串、解析、汇总、掩码，不联网
```

## 致谢

- **[@fvvef121-cell](https://github.com/fvvef121-cell)** —— 需求提出、概念把关，以及在真实账号上做验收：余额与阿里云控制台逐位核对、指出接口口径（券余额 ≠ 账户可用金），并推动修复了初版的隐私与安全问题。
- **DeepSeek Harness 中的 AI 结对（DeepSeek V4.1 Flash）** —— 初版实现：宿主/客户端两半代码、BSS 接口选型（`DescribeCoupon` 优先 + `QueryCashCoupons` 回退）与 ACS3/RPC 签名、离线自检、文档。

> 所有提交均由仓库所有者审阅后发布。AI 不持有任何凭据，也无法访问维护者的阿里云账号；本插件读取的 AccessKey 只由使用者自己写入本机文件。

## 许可

MIT，见 [LICENSE](LICENSE)。