# 学习账号与云同步后端

为现有 poetry-recite 和 english-grammar-lab Pages 站点提供共用账号。只通过 Pages `LEARNING_SYNC` Service Binding 调用，不创建第三个网站。公开 Workers URL 和预览 URL 已关闭。

## 登录方式与已接受的安全折中

注册和登录均使用用户自行设置的**用户名＋密码**；没有随机登录码。用户名不区分大小写。注册和重设密码时可选择 6–128 位字母或数字，无需同时包含两种字符；密码内容不做裁剪或大小写转换。已有包含空格或符号的旧密码仍可原样登录，不强制重设。注册仅一次性显示独立的 192 位随机恢复码，请另行离线保存。没有邮箱或短信找回；丢失密码及恢复码且已退出时无法恢复账号。

密码不以明文或可逆密文存储。每个密码有 128 位随机盐，使用标准 PBKDF2-HMAC-SHA256 **10,000 次**，其派生结果再用独立的 256 位 Worker Secret `PASSWORD_PEPPER` 做 HMAC-SHA256。数据库只存最终摘要和盐；服务端秘密不在 D1、配置源码或 Git 中。恢复账号必须输入恢复码和新密码，成功后轮换恢复码、撤销所有旧会话。

**10,000 次显著低于目前 OWASP 的 600,000 次建议，属于用户在免费运行限制下明确接受的降低强度方案，不应称为符合当前推荐密码哈希强度。** 独立秘密保护数据库单独泄露的情况；数据库与 Worker 秘密同时泄露时，较低迭代次数会使弱密码更容易被离线猜出。请使用不同于其他服务的强密码，勿在此复用邮箱等重要密码。这里没有把普通密码直接做 SHA-256，更没有明文存储。

认证受 `AUTH_RELEASE_VERIFIED` 门禁控制。本地测试不等于线上验收。

## 本地验证

`npm ci && npm test`，需要 Node.js 22 或更高版本。测试仅使用明显标记的合成数据和 RFC 文档 IP，不连接远程数据库。测试环境显式打开发布门禁以检查认证流程，并单独验证门禁默认关闭。

## 部署配置

先检查账户套餐、现有 Pages 项目、Git 关联和 D1。新数据库执行 `schema.sql`。从之前已建立的随机码 schema 升级时，先检查 `PRAGMA table_info(users)`，确认还没有 `password_salt` 和 `password_scheme`，然后**仅执行一次** `migrations/0001-passwords.sql` 的两个 ADD COLUMN；新库不得重复执行该迁移。它不会删除或重建任何表，也不会改写现有学习数据。

生成 32 个随机字节并以 64 个十六进制字符通过 `wrangler secret put PASSWORD_PEPPER` 安全写入；不要在聊天、日志、配置文件或 Git 中输出该秘密。部署程序必须从安全输入传入 Secret，不能把它写进 `wrangler.jsonc`。Secret 缺失或格式无效时认证返回 503，不允许回退为明文。秘密应由账户持有人安全保管；直接更换秘密会使此前密码摘要无法验证，需配套恢复/迁移流程。

完成数据库与 Secret 配置后部署 Worker，并给两个**现有** Pages 项目添加 `LEARNING_SYNC` Service Binding。保留其原有构建、域名、环境变量和部署关联。

`ALLOWED_ORIGINS` 是两个正式站点及受信任分支预览的精确 HTTPS origin 列表。Pages 代理用请求 URL 覆盖 `X-Learning-Origin`，保留浏览器原始 `Origin`、真实 `CF-Connecting-IP` 和 Cookie。后端依赖 Service Binding 的私有访问边界，**不得打开 workers.dev、预览 URL 或公共路由**。

## 会话与同步安全

- 用户名 3–32 位 ASCII 字母、数字、`_`、`-`，不区分大小写。
- 256 位随机会话令牌仅在 `__Host-`、HttpOnly、Secure、SameSite=Strict Cookie 中传递；数据库只保存 SHA-256 摘要，有效期 30 天。
- 恢复码通过原子比较更新保证单次使用。会话凭据版本阻止并发旧登录请求在恢复后复活旧会话。
- 认证按真实 IP 和用户名在 D1 中原子限流；每天定时删除过期会话及认证限流桶。达到限制返回 429，不影响本地学习。
- 格式校验通过的同步提交按账号在 D1 中原子限流，每分钟最多 120 次。限流计数与带版本条件的数据写入在同一 D1 batch 事务内执行，减少一次数据库往返；SQL 本身要求计数未超限，返回 429 的请求不能改写学习数据。限制跨实例共享，不依赖 Worker 内存。
- 服务端仅以会话中的用户 ID 查询数据；同步要求 `X-Account-ID` 与会话一致，防止另一标签页换号后排队请求污染账号。
- 每用户每应用独立记录。PUT 使用 `baseRevision` 原子 CAS；冲突返回 409 和最新快照，绝不静默覆盖。
- JSON 上限 64 KiB、深度 16、最多 2,000 个节点，仅允许明确列出的学习字段，递归拒绝私密认证字段。超限拒绝整次上传，不截断或修改本地记录。前端仍可导出完整本地备份。
- 英语 AI Key、AI 题池和未完成草稿不属于后端同步字段。前端必须继续使用字段白名单，不能上传全部 localStorage。用户不应把凭据写入学习笔记正文。
- 不记录请求体、密码、恢复码、Cookie 或用户学习数据。运维不要开启会输出这些值的调试日志。

## API

所有接口经现有站点 `/api` 前缀代理，响应 `Cache-Control: no-store`。写请求必须携带与站点一致的 Origin。

| 方法与路径 | 请求 | 响应 |
| --- | --- | --- |
| POST `/auth/register` | `{username,password}` | `{user,recoveryCode}` + Cookie |
| POST `/auth/login` | `{username,password}` | `{user}` + Cookie |
| GET `/auth/me` | — | `{user}`，未登录为 null |
| POST `/auth/logout` | — | `{ok:true}` + 清除 Cookie |
| POST `/auth/recover` | `{username,recoveryCode,password}` | `{user,recoveryCode}` + Cookie |
| GET `/sync/poetry` 或 `/sync/english` | `X-Account-ID` 头 | `{revision,data,updatedAt}` |
| PUT 同上 | 头及 `{baseRevision,data}` | `{revision,updatedAt}` |

`password` 是用户自选的原始密码，仅通过 HTTPS 发送，不由前端存储。`login_code_hash` 是早期测试数据库沿用的列名；新方案在此存储带盐及秘密值处理后的密码摘要，并以 `password_scheme` 明确区分。旧的 `generated-v1` 合成测试账号暂有兼容读取路径，正式开放前应仅按测试账号精确 ID 清理。

错误 `{error,message}`；同步冲突另有 `{revision,data,updatedAt}`。空云端为 `{revision:0,data:null,updatedAt:null}`。

## 免费限制

2026-10-31 查阅官方文档：Workers Free 每日 100,000 次请求、每次 10ms CPU；D1 Free 单库 500MB、账户 5GB、最多 10 个数据库，每日 500 万行读取、10 万行写入。索引和限流计数也消耗 D1 写入。客户端防抖，仅在数据变更时同步。免费配额耗尽会使云端不可用，不能影响已有本地数据。此仓库不会自动升级套餐。

- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/d1/platform/pricing/

所有额度以部署当日官方信息和实际账户为准。生产数据另行受控备份，禁止提交到 Git。

## 真实部署验证

2026-11-01，现有 Pages 预览通过私有绑定访问真实 Worker/D1，账号密码注册、双站登录、恢复撤销旧密码和会话、用户隔离、CSRF、版本冲突与超限保留均通过。事务优化后，对约 65KB、1,996 节点的合成快照连续进行 40 次完整读写，上传最高 9ms CPU、下载最高 5ms，40 次均成功。这是有限样本，不是未来所有请求的性能保证；超时或额度耗尽必须继续保留本地数据。

最终账号密码认证微测中，注册最高 13ms、登录最高 11ms、恢复最高 10ms，所有请求均成功；少量峰值超过免费版标称 10ms，依赖平台内置短时宽限，不能保证未来不会因 CPU 限制失败。不得将这一结果写成“所有请求低于 10ms”。生产故障时保持本地学习和明确重试提示，不会自动启用付费资源。
