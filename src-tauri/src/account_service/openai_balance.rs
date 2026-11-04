//! Optional compatibility with the Platform dashboard billing endpoint.
//! Session credentials exist only for the duration of the query, never in profiles or exports.
use super::*;
use serde::Deserialize;
use serde_json::Value;

const BILLING_ENDPOINT: &str = "https://api.openai.com/dashboard/billing/credit_grants";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QueryOpenAiBalanceInput {
    pub(crate) session: String,
    pub(crate) organization_id: Option<String>,
}

pub(crate) async fn query_openai_balance_internal(
    app: &AppHandle,
    state: &AppState,
    id: &str,
    input: QueryOpenAiBalanceInput,
) -> Result<AccountSummary, String> {
    let original_api_key = {
        let _guard = state.store_lock.lock().await;
        let store = load_store(app)?;
        let account = store
            .accounts
            .iter()
            .find(|account| account.id == id)
            .ok_or("找不到要查询余额的账号。")?;
        ensure_official_account(account)?;
        account.api_key.clone()
    };
    let session = parse_platform_session(&input.session)?;
    let organization = normalize_organization(input.organization_id.as_deref())?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "创建 OpenAI 余额查询客户端失败。".to_string())?;
    // This dashboard route is not a public API and may stop accepting sessions.
    let balance_text =
        fetch_balance(&client, BILLING_ENDPOINT, &session, organization.as_deref()).await?;
    let _guard = state.store_lock.lock().await;
    let mut store = load_store(app)?;
    let account = store
        .accounts
        .iter_mut()
        .find(|account| account.id == id)
        .ok_or("余额查询期间账号已被删除。")?;
    ensure_official_account(account)?;
    if account.api_key != original_api_key {
        return Err("余额查询期间 API Key 已更改，请重新查询。".to_string());
    }
    account.balance_text = Some(balance_text);
    account.api_balance_fetched_at = Some(now_unix_seconds());
    let summary = account.to_summary(
        current_auth_account_key().as_deref(),
        current_auth_variant_key().as_deref(),
    );
    save_store(app, &store)?;
    Ok(summary)
}

fn ensure_official_account(account: &StoredAccount) -> Result<(), String> {
    if matches!(account.source_kind, AccountSourceKind::Relay)
        && account
            .api_base_url
            .as_deref()
            .is_some_and(profile_files::official_api::is_official_base_url)
    {
        Ok(())
    } else {
        Err("仅 OpenAI 官方 API 账号支持 Platform Session 余额查询。".to_string())
    }
}

fn parse_platform_session(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    let value = serde_json::from_str::<Value>(trimmed).ok();
    let token = value
        .as_ref()
        .and_then(|value| {
            value.as_str().or_else(|| {
                [
                    "/session/sensitive_id",
                    "/user/session/sensitive_id",
                    "/sensitive_id",
                    "/sessionKey",
                    "/session_key",
                    "/accessToken",
                ]
                .iter()
                .find_map(|path| value.pointer(path).and_then(Value::as_str))
            })
        })
        .unwrap_or(trimmed)
        .trim();
    if !token.starts_with("sess-")
        || token.len() <= 5
        || token.len() > 4096
        || !token
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("请导入 OpenAI Platform 的 Session Key（sess- 开头）或包含该 Key 的 JSON；ChatGPT Session 和普通 API Key 不能用于此查询。".to_string());
    }
    Ok(token.to_string())
}

fn normalize_organization(input: Option<&str>) -> Result<Option<String>, String> {
    let Some(input) = input.map(str::trim).filter(|input| !input.is_empty()) else {
        return Ok(None);
    };
    if !input.starts_with("org-")
        || input.len() <= 4
        || input.len() > 128
        || !input
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("组织 ID 格式无效，请填写 org- 开头的组织 ID。".to_string());
    }
    Ok(Some(input.to_string()))
}

async fn fetch_balance(
    client: &reqwest::Client,
    endpoint: &str,
    session: &str,
    organization: Option<&str>,
) -> Result<String, String> {
    let mut request = client.get(endpoint).bearer_auth(session);
    if let Some(organization) = organization {
        request = request.header("OpenAI-Organization", organization);
    }
    let response = request
        .send()
        .await
        .map_err(|_| "OpenAI 余额查询失败，请检查网络后重试。".to_string())?;
    let status = response.status();
    if !status.is_success() {
        return Err(match status {
            reqwest::StatusCode::UNAUTHORIZED => {
                "Platform Session 已过期或无效，请重新导入。".to_string()
            }
            reqwest::StatusCode::FORBIDDEN => {
                "Platform Session 无账单访问权限或被拒绝，请在官方账单页面查看余额。".to_string()
            }
            reqwest::StatusCode::NOT_FOUND | reqwest::StatusCode::GONE => {
                "OpenAI 账单接口当前不可用，请在官方账单页面查看余额。".to_string()
            }
            _ => format!("OpenAI 账单接口返回 {status}，请稍后重试或在官方账单页面查看余额。"),
        });
    }
    let payload = response
        .json::<Value>()
        .await
        .map_err(|_| "OpenAI 账单接口返回了无效响应，无法读取余额。".to_string())?;
    parse_balance(&payload)
}

fn parse_balance(payload: &Value) -> Result<String, String> {
    let balance = payload
        .get("total_available")
        .and_then(|value| {
            value
                .as_f64()
                .or_else(|| value.as_str().and_then(|text| text.parse::<f64>().ok()))
        })
        .filter(|balance| balance.is_finite())
        .ok_or("OpenAI 账单接口未提供可用余额，请在官方账单页面查看。")?;
    Ok(format!("${balance:.2}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_platform_tokens_and_rejects_chatgpt_sessions_and_api_keys() {
        for input in [
            "sess-test_123",
            r#"{"session":{"sensitive_id":"sess-test_123"}}"#,
            r#"{"user":{"session":{"sensitive_id":"sess-test_123"}}}"#,
            r#"{"sessionKey":"sess-test_123"}"#,
            r#""sess-test_123""#,
        ] {
            assert_eq!(parse_platform_session(input).unwrap(), "sess-test_123");
        }
        for input in [
            "sk-test",
            "sess-",
            "sess-test\r\nHeader:value",
            r#"{"accessToken":"eyJ.chatgpt.token"}"#,
            "{}",
        ] {
            assert!(parse_platform_session(input).is_err());
        }
        assert!(normalize_organization(Some("org-test\nHeader:value")).is_err());
    }

    #[test]
    fn missing_balance_is_unknown_and_zero_or_negative_balances_are_real_values() {
        for value in [
            serde_json::json!({}),
            serde_json::json!({"total_available":null}),
            serde_json::json!({"total_available":"NaN"}),
            serde_json::json!({"total_available":"inf"}),
            serde_json::json!({"total_granted":50,"total_used":10}),
        ] {
            assert!(parse_balance(&value).is_err());
        }
        assert_eq!(
            parse_balance(&serde_json::json!({"total_available":0})).unwrap(),
            "$0.00"
        );
        assert_eq!(
            parse_balance(&serde_json::json!({"total_available":-1.25})).unwrap(),
            "$-1.25"
        );
        assert_eq!(
            parse_balance(&serde_json::json!({"total_available":"12.34"})).unwrap(),
            "$12.34"
        );
    }

    #[tokio::test]
    async fn sends_only_session_and_selected_organization_and_handles_expiry() {
        use axum::{http::HeaderMap, routing::get, Json, Router};
        let app = Router::new()
            .route(
                "/balance",
                get(|headers: HeaderMap| async move {
                    assert_eq!(headers["authorization"], "Bearer sess-test");
                    assert_eq!(headers["openai-organization"], "org-test");
                    Json(serde_json::json!({"total_available":23.45}))
                }),
            )
            .route(
                "/expired",
                get(|| async { reqwest::StatusCode::UNAUTHORIZED }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = reqwest::Client::new();
        assert_eq!(
            fetch_balance(
                &client,
                &format!("{origin}/balance"),
                "sess-test",
                Some("org-test")
            )
            .await
            .unwrap(),
            "$23.45"
        );
        let error = fetch_balance(&client, &format!("{origin}/expired"), "sess-secret", None)
            .await
            .unwrap_err();
        assert!(error.contains("过期"));
        assert!(!error.contains("sess-secret"));
        server.abort();
    }
}
