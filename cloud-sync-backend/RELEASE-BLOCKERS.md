# 密码方案验证记录与免费资源发布验收

当前按用户明确要求恢复为用户自选用户名＋密码。最终拟用方案为带 128 位随机盐的 PBKDF2-SHA256 10,000 次，再对派生结果做 HMAC-SHA256，使用独立的 256 位 Worker Secret。**这是低于 OWASP 当前建议的安全折中，不能称为推荐强度；不能存储明文密码。** 数据库和秘密同时泄露时，降低的迭代数会降低离线猜测成本。完整流程仍须以实际部署的 CPU 数据验收。

以下保留此前方案的真实验证证据；历史随机码方案并非最终界面或最终认证方式。

## 2026-10-31 实际验证

在 Cloudflare 真实生产运行时创建了一个临时、随机 Secret 鉴权的基准 Worker，使用合成内容，分别运行以下探测。记录来自实时 tail 的 `cpuTime`，不是客户端墙钟延迟。探测未连接用户数据库，也未更改 Pages。临时 Worker 测试后删除。

| 探测 | 结果 | CPU |
| --- | --- | --- |
| WebCrypto PBKDF2-HMAC-SHA256，600,000 次 | 10/10 失败：`iteration counts above 100000 are not supported (requested 600000)` | 失败路径 0–2ms，不能视为哈希性能 |
| `node:crypto.pbkdf2`，同参数 | 10/10 同样失败 | 失败路径 0–2ms |
| `node:crypto.scrypt`，N=32768,r=8,p=3,maxmem=64MiB | 10/10 能计算，但超过免费 CPU 预算 | 192–384ms |
| 初版 JSON 校验，约 316KB、79,000 个数组元素 | 10/10 能返回，但超过免费 CPU 预算 | 25–86ms |
| 限制为 128KiB/10,000 节点并优化数组遍历，39.6KB/9,900 元素 | 10/10 返回 | 1–4ms |
| 优化后，94.9KB/1,000 条合成错题，约 7,000 节点 | 10/10 返回，其中一次超过 10ms | 1–11ms |

最后两行仅测 JSON 读取、字段校验和序列化，不包括完整会话认证、D1 限流及同步写入。仍需完整接口负载测试。成功返回 HTTP 200 也不能证明满足免费 10ms CPU 合同，不应依赖宽限或未触发强制终止。

本地 workerd 接受 PBKDF2 600,000 次，且本地认证/隔离/冲突/恢复测试通过；**本地运行时的参数限制与线上不同**。本地成功不代表生产密码认证可用。对应 Cloudflare workerd 上游仍有提升 PBKDF2 上限的讨论，不能依赖未部署的变更。

## 原先要求推荐强度时的结论

在原先要求达到当前推荐强度的条件下，不能把服务端 PBKDF2 降至 100,000 次，也不能通过弱化 scrypt 参数满足预算。不能因 WebCrypto 或 Node API 返回 Promise 就假设原生 CPU 不计费。没有采用自行组合的客户端预哈希协议。

随后曾实现并在预览站点验证高熵随机登录码。用户之后明确拒绝登录码，并授权降低密码强度，现改为 README 所述自选密码方案。没有采用客户端预哈希协议或明文存储。新的密码方案本地测试与生产 CPU 验收应单独报告，历史随机码的通过结果不能算作最终密码流程验证通过。

完整随机码接口初轮测量中，注册最高 9ms、登录最高 5ms、恢复最高 9ms、GET 最高 6ms；接近原上限的 PUT 出现一次 12ms。因此当前同步进一步限制为 64KiB、2,000 节点、深度 16，并减少对象遍历分配。超限拒绝而不截断；仍需验证完整最大负载，并保证前端明确提示、保留本地数据和导出功能。

## 依据

- Workers Free 每次 HTTP 请求 CPU 10ms：https://developers.cloudflare.com/workers/platform/limits/
- WebCrypto：https://developers.cloudflare.com/workers/runtime-apis/web-crypto/
- Node crypto 兼容性：https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/
- OWASP PBKDF2-SHA256 600,000 次及 scrypt N=2^15,r=8,p=3 参数：https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- 上游 PBKDF2 限制变更讨论（不能当成已上线）：https://github.com/cloudflare/workerd/pull/7550

不在仓库保存探测 URL、鉴权 Secret、原始 tail 请求头、账户标识、真实用户数据或授权文件。
