# OpenAI 官方 Key 与余额

在“添加账号 → 导入 API”选择“OpenAI 官方”，填写 API Key 和可用的模型名称，然后点击“检测并保存”。官方地址预填为 `https://api.openai.com/v1`。连接测试只读取模型信息，不生成 Token；它不保证计费额度充足或生成请求一定成功。切换账号时使用 Codex 内置的 OpenAI provider。

保存后，在账号详情的“OpenAI API 余额”中点击“导入 Session 查询”，可以粘贴 `sess-…` 格式的 OpenAI Platform Session Key，或者选择包含该 Key 的 JSON 文件。支持原始 Key、JSON 字符串，以及 `session.sensitive_id`、`user.session.sensitive_id`、`sensitive_id`、`sessionKey`、`session_key`、`accessToken` 字段中的 Platform Key。普通 `sk-…` Key 和 ChatGPT 登录 Session 不能用于此查询。

查询使用 Platform 的非公开账单接口 `https://api.openai.com/dashboard/billing/credit_grants`。该地址目前仍会返回认证错误响应；真实 Session 的可用性未完成线上验证，接口也可能随时调整或停用。此功能是可选的兼容方式，不是稳定的公开 API 承诺。公开的 [Costs API](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs) 需要 Admin Key，并返回费用，不能代替剩余余额。

Session 只用于本次请求，不写入账号库、Codex profile 或导出文件。请求只发送到固定的官方 HTTPS 地址，不跟随重定向。Session JSON 只提取必要的凭据，不上传整个 JSON。如果属于多个组织，可以填写 `org-…` 组织 ID；Session 与 API Key 应属于同一组织，显示的是组织共享余额。

成功后，账号列表和详情显示返回的美元余额以及查询时间，重启后保留查询结果。此金额是上次查询的快照，不会在用量刷新时自动更新。查询失败会保留旧余额；未查询显示“尚未查询”，真实零余额显示 `$0.00`。Session 过期、权限不足或接口不可用时，可以点击“打开官方账单”查看实际余额。

验证：`npm test`、`npm run test:pages`、`npm run build`、`npm run lint`、`cargo test --manifest-path src-tauri/Cargo.toml --lib`。浏览器回归使用模拟后端；启动本地 Vite 后执行 `node scripts/check-openai-api.mjs`，通过 `CODEX_TOOLS_CHROME_PATH` 指定 Chrome，或使用已安装的 Playwright Chromium。

本次验证结果：构建、lint、38 项前端单元测试、58 项静态页面检查、29 项新增 OpenAI 浏览器检查及 29 项现有界面回归通过。Rust 全量测试有一项既有失败：`token_usage::tests::excludes_replayed_parent_history_from_forked_sessions`，在原始提交 `fb00f7f` 的独立 worktree 中同样得到 `300 != 350`；排除此项后 385 项通过、1 项原有忽略。新增的官方 API 验证和 Session 解析、余额响应、过期处理测试全部通过。浏览器使用模拟后端，HTTP 测试使用本地模拟服务，不代表真实 Session 的线上联调已完成。
