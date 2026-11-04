//! Official API keys use model metadata for validation; this does not generate tokens.
use super::*;

pub(crate) const BASE_URL: &str = "https://api.openai.com/v1";

pub(crate) fn is_official_base_url(base_url: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(base_url.trim()) else {
        return false;
    };
    url.scheme() == "https"
        && url.host_str() == Some("api.openai.com")
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
        && matches!(url.path().trim_end_matches('/'), "" | "/v1")
}

pub(super) async fn validate_key(
    client: &reqwest::Client,
    base_url: &str,
    api_key: &str,
    model_name: &str,
) -> Result<Option<String>, String> {
    let mut endpoint = reqwest::Url::parse(&format!("{base_url}/models"))
        .map_err(|_| "OpenAI API 地址无效。".to_string())?;
    endpoint
        .path_segments_mut()
        .map_err(|_| "OpenAI API 地址无效。".to_string())?
        .push(model_name);
    // https://developers.openai.com/api/reference/resources/models/methods/retrieve
    let response = client
        .get(endpoint)
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|error| format!("检测 OpenAI API 失败: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(match status {
            StatusCode::UNAUTHORIZED => "API Key 无效或已失效。".to_string(),
            StatusCode::FORBIDDEN => {
                "OpenAI API Key 无权访问该模型，请检查 Key 权限和项目设置。".to_string()
            }
            StatusCode::NOT_FOUND => {
                "OpenAI 模型不存在或当前 Key 无权访问，请检查模型名称。".to_string()
            }
            _ => format!("检测 OpenAI API 返回 {status}。"),
        });
    }
    let payload: Value = response
        .json()
        .await
        .map_err(|_| "OpenAI 模型接口返回了无效响应。".to_string())?;
    if payload.get("object").and_then(Value::as_str) != Some("model")
        || !payload
            .get("id")
            .and_then(Value::as_str)
            .is_some_and(|id| !id.is_empty())
    {
        return Err("OpenAI 模型接口返回了无效响应。".to_string());
    }
    // The public Costs API reports spend, requires an Admin key, and is not a
    // remaining-credit endpoint. Never probe retired dashboard billing routes.
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn official_origin_requires_https_and_an_unmodified_api_root() {
        for url in [
            BASE_URL,
            "https://api.openai.com",
            "https://API.OPENAI.COM:443/v1/",
        ] {
            assert!(is_official_base_url(url), "{url}");
        }
        for url in [
            "http://api.openai.com/v1",
            "https://api.openai.com.evil.invalid/v1",
            "https://api.openai.com:444/v1",
            "https://user@api.openai.com/v1",
            "https://api.openai.com/v1?proxy=1",
            "https://api.openai.com/v1#fragment",
            "https://api.openai.com/v1/responses",
            "https://relay.invalid/v1",
        ] {
            assert!(!is_official_base_url(url), "{url}");
        }
        assert_eq!(
            normalize_relay_base_url("https://api.openai.com/").unwrap(),
            BASE_URL
        );
    }

    #[tokio::test]
    async fn validation_reads_model_metadata_without_generation_or_billing_requests() {
        use axum::{extract::Path, http::HeaderMap, routing::get, Json, Router};
        let app = Router::new().route(
            "/v1/models/:model",
            get(|Path(model): Path<String>, headers: HeaderMap| async move {
                assert_eq!(model, "test-model");
                assert_eq!(headers["authorization"], "Bearer test-key");
                Json(serde_json::json!({"object": "model", "id": model}))
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base_url = format!("http://{}/v1", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let result =
            validate_key(&reqwest::Client::new(), &base_url, "test-key", "test-model").await;
        server.abort();
        assert_eq!(result.unwrap(), None);
    }

    #[tokio::test]
    async fn invalid_key_and_malformed_success_are_not_reported_as_valid() {
        use axum::{routing::get, Router};
        for (status, body) in [
            (StatusCode::UNAUTHORIZED, "invalid"),
            (StatusCode::OK, "{}"),
            (StatusCode::OK, "not-json"),
        ] {
            let app = Router::new().route(
                "/v1/models/test",
                get(move || async move { (status, body) }),
            );
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let base_url = format!("http://{}/v1", listener.local_addr().unwrap());
            let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
            let result = validate_key(&reqwest::Client::new(), &base_url, "test-key", "test").await;
            server.abort();
            assert!(result.is_err());
        }
    }
}
