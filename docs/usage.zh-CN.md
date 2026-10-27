# 使用说明

> 面向第一次碰 DSH 插件的人。全程大约 5 分钟，其中阿里云控制台那步 3 分钟。
> 如果你只想看「装完长什么样」，跳到 [第 4 节](#4-日常怎么用)。

## 1. 你得先有什么

| 需要 | 说明 |
| --- | --- |
| DSH（桌面版或 Web 版） | 侧栏能正常显示的任意 profile；本插件挂在侧栏页脚 |
| 阿里云账号 | 要查的就是**这个账号**下的卡券（学生券、代金券、抵用券都行） |
| 一对**只读** RAM AccessKey | 不要用主账号 AccessKey，见 [第 3 节](#3-建一个只读-ram-accesskey阿里云控制台) |

> 阿里云卡券的数据**只能**通过 BSS OpenAPI 查，而该接口只认 AccessKey。
> 百炼/DashScope 的 `sk-` Key 查不了余额，别拿它试。

## 2. 装插件

**桌面版（推荐）**：打开「插件」页 → 安装本插件（本地目录或 GitHub 源）→ 刷新页面（F5 / Ctrl+R）。
装好后侧栏页脚会立刻出现一张图框，显示：

```
阿里云代金券        —
▁▁▁▁▁▁▁▁▁▁▁▁
未配置 AccessKey：把只读 RAM AccessKey 写进 C:\Users\你\.dsh\aliyun-coupon.json
```

看到这行提示＝插件本身已经跑通了，只差凭据。

**命令行（非 desktop profile）**：

```bash
dsh plugin --profile <profile> add github:fvvef121-cell/dsh-aliyun-coupon
```

> `desktop` profile 由桌面 App 独占，CLI 会拒绝改动它，所以桌面端请走插件页。
> 新建的 profile 若没有 Web 层，插件会停在 `pending (waiting for service: webServer)`，
> 需要先用 `dsh <profile> --from-default-profile web` 建出带 Web 的 profile。

**装完没看到图框？** 按顺序查：插件是否启用 → 是不是装到了你正在跑的那个 profile → 页面有没有刷新 → 宿主（`dsh web` / 桌面 App）有没有重启过。

## 3. 建一个只读 RAM AccessKey（阿里云控制台）

1. 打开 <https://ram.console.aliyun.com/users> → **创建用户**（名字随意，如 `dsh-coupon-ro`）
   → **勾选「使用永久 AccessKey 访问」** → 确定。
2. 创建完立刻弹出 **AccessKey ID**（`LTAI…`）和 **Secret**（只显示这一次，先复制到安全的地方）。
3. 只授权两个只读接口：权限策略 → **创建权限策略** → 脚本编辑 → 粘贴下面这段（把模板里的空数组替换掉）：

   ```json
   {
     "Version": "1",
     "Statement": [
       { "Effect": "Allow", "Action": ["bss:DescribeCoupon", "bss:DescribeCoupons"], "Resource": ["*"] }
     ]
   }
   ```

   策略名随意，如 `dsh-coupon-ro`；点确定。
4. 回到用户 → **权限管理** → **新增授权** → 搜索刚建的策略 → 勾选 → 确认。

> 嫌麻烦可以直接挂系统策略 **`AliyunBSSReadOnlyAccess`**（只读账单/卡券，权限范围更大一点，
> 但一样不能花钱、不能开资源）。插件是「`DescribeCoupon` 失败自动回退 `QueryCashCoupons`」的双路，
> 两条里通一条就能出数。

**这一步的三条红线**

- 别用主账号 AccessKey：那是整号凭据，能开资源、能删数据。
- 别把 AK 贴进聊天、截图、issue 或 git 提交。
- 别给这个 RAM 用户任何 `*:*` 或写权限。

## 4. 写入 AK 文件

文件路径（两种系统都固定，不需要改代码）：

| 系统 | 路径 |
| --- | --- |
| Windows | `C:\Users\<你的用户名>\.dsh\aliyun-coupon.json` |
| macOS / Linux | `~/.dsh/aliyun-coupon.json` |

内容：

```json
{
  "akId": "LTAI5t...",
  "akSecret": "..."
}
```

- 用任意文本编辑器写就行，编码 UTF-8；记事本加的 BOM 插件会自动忽略。
- 可选字段：`stsToken`（STS 临时凭据）、`endpoint`（国际站 `business.ap-southeast-1.aliyuncs.com`）。
- 兼容别名：`aliyunAkId` / `aliyunAkSecret` / `AccessKeyId` / `AccessKeySecret`。

**不想用文件**也可以走环境变量（优先级高于文件）：

```bash
ALIBABA_CLOUD_ACCESS_KEY_ID=LTAI5t...
ALIBABA_CLOUD_ACCESS_KEY_SECRET=...
# 可选：ALIBABA_CLOUD_SECURITY_TOKEN / ALIYUN_BSS_ENDPOINT
```

保存后：**点一下侧栏那张卡片**就会立刻查一次；不点的话，宿主每 10 分钟自己查。不用重启 DSH。

## 5. 日常怎么用

| 操作 | 结果 |
| --- | --- |
| 瞟一眼侧栏 | 剩余余额 + 已用进度条 + 到期日 |
| 点卡片 | 立刻重新查一次（刷新中显示「正在刷新…」） |
| 鼠标悬停 | 券号、券类型、面值、余额、到期时间、最近刷新时间；多张券逐条列出 |
| 收起侧栏 | 只剩金额，如 `¥123.5` |
| 想知道数据新旧 | 悬停最后一行的刷新时间 |

**刷新节奏**：宿主每 10 分钟向阿里云查一次（`refreshMinutes` 可改）；页面每 60 秒读一次宿主缓存。
所以「点一下」＝跳过等待，直接触发一次真实查询。

**查不到的时候不会变 0**：失败会保留上一次的数字，并在卡片里显示错误行——这样临时断网不会让你误以为券花完了。

## 6. 配置项

改 profile 的 `cordis.patch.yml`，按 `id` 覆盖即可（不需要重新安装）：

```yaml
- id: aliyun-coupon
  config:
    refreshMinutes: 10        # 1–1440
    label: 云工开物券          # 图框标题
    # akFile: D:/keys/aliyun-coupon.json
    # endpoint: business.ap-southeast-1.aliyuncs.com
```

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `refreshMinutes` | `10` | 宿主查询间隔（分钟） |
| `akFile` | `~/.dsh/aliyun-coupon.json` | AK 文件路径 |
| `endpoint` | `business.aliyuncs.com` | BSS 端点，国际站换 `business.ap-southeast-1.aliyuncs.com` |
| `label` | 空（显示「阿里云代金券」） | 图框标题 |
| `fullCouponNumbers` | `false` | 默认对下发的券号脱敏；确实要和后台逐位核对时再打开 |

## 7. 常见问题

| 现象 | 原因 | 怎么办 |
| --- | --- | --- |
| 卡片显示「未配置 AccessKey：把只读 RAM AccessKey 写进 …」 | 文件不存在、字段空、路径不对 | 按 [第 4 节](#4-写入-ak-文件) 写文件；路径就是提示里那条 |
| 卡片显示 `NotAuthorized` / `Forbidden` / `HTTP 403` | RAM 没挂策略、策略里 Action 名字写错、或授权没生效 | 确认策略含 `bss:DescribeCoupon` + `bss:DescribeCoupons`，并已「新增授权」到该用户 |
| `NotApplicable` | 该身份不适用于此接口（部分会员/特殊账号类型） | 只能用主账号 AccessKey，但**不推荐**；可先换成 `QueryCashCoupons` 再试（插件已自动回退） |
| `InvalidAccessKeyId` / `SignatureDoesNotMatch` | AK 复制错、多了空格/换行、AK 被删 | 重新复制 AK；注意别带前后空格 |
| 余额显示 `¥0.00` 或 `—` | 没有 `Available` 状态的券（已过期、已用尽、已作废） | 悬停看明细；确认控制台「卡券」页是否还有可用券 |
| 数字和控制台差一点 | 控制台页面有缓存，或扣除发生在两次查询之间 | 点卡片强刷一次再比；仍在用的话余额本来就会往下走 |
| 图框一直不出现 | 插件未启用 / 装到了别的 profile / 页面没刷新 / 宿主没重启 | 插件页确认启用 → 确认 profile → F5 → 重启 DSH |
| 国际站账号查询超时 | 用了国内站端点 | 配 `endpoint: business.ap-southeast-1.aliyuncs.com` |
| 有多张券 | 正常 | 顶部数字是**可用券合计**，悬停逐条看 |

## 8. 精度与口径

- 余额保留接口原值（阿里云给到小数点后 10 位），界面显示两位小数，悬停可看原值。
- 只把 `Status = Available` 的券计入合计；一张可用券都没有时才退回显示全部（避免把「已过期」误报成 0）。
- 这是**券的余额**，不是账户可用金：阿里云的可用额度不含代金券/储值卡，两者是两笔钱。

## 9. 安全与清理

- 插件只联系 `business.aliyuncs.com`（或你配置的 BSS 端点），没有遥测；AK 只在宿主进程里签名，不进日志、不进响应体。
- 浏览器只拿到掩码 ID（`LTAI5t...IjKl`）、余额数字、脱敏券号（`1234****9012`）和 `~` 形式路径；
  查询路由只绑回环地址，带代理头（`X-Forwarded-For` 等）或跨站的请求一律 403。
- 插件只把你配置的端点当目标，且只认 `*.aliyuncs.com`；换成别的域名会被忽略（退回官方域名）。
- 不用了怎么收干净：
  1. 插件页停用/移除本插件；
  2. 删除 `~/.dsh/aliyun-coupon.json`；
  3. 到 RAM 控制台**禁用/删除**那对 AccessKey（这一步才是彻底止损）。

## 10. 卸载

在「插件」页停用或移除即可；CLI 装的话：

```bash
dsh plugin --profile <profile> remove dsh-aliyun-coupon
```

删插件不会自动删 AK 文件，按上面第 3 步自己删。