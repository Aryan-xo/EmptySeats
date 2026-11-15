//! Railway Empty Seats — tiny backend.
//!
//! * Proxies the public IRCTC online-charts APIs (with a small in-memory cache
//!   so we stay polite and fast).
//! * Aggregates "train composition + vacant berths for every class" into one call.
//! * Imports a browser HAR export so you can work fully offline / when IRCTC
//!   refuses the server-side request.
//! * Serves the built React frontend.

use std::{
    collections::{BTreeSet, HashMap},
    net::SocketAddr,
    sync::Arc,
    time::{Duration, Instant},
};

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::RwLock;
use tower_http::{
    cors::CorsLayer,
    services::{ServeDir, ServeFile},
};

const CHARTS_API: &str = "https://www.irctc.co.in/online-charts/api";
const TRAIN_LIST: &str = include_str!("../data/trainList.txt");

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

struct CacheEntry {
    at: Instant,
    value: Value,
}

struct AppState {
    http: reqwest::Client,
    /// HTTP/1.1-only fallback client
    http1: reqwest::Client,
    ttl: Duration,
    /// key = "<endpoint>|<canonical request json>"
    cache: RwLock<HashMap<String, CacheEntry>>,
    /// trainNo -> ordered station list (only filled from HAR imports)
    schedules: RwLock<HashMap<String, Vec<Value>>>,
    trains: Vec<Value>,
}

type Shared = Arc<AppState>;

fn cache_key(endpoint: &str, body: &Value) -> String {
    // serde_json's default Map is a BTreeMap, so serialisation is canonical.
    format!("{endpoint}|{body}")
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

struct AppError(StatusCode, String);

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "error": self.1 }))).into_response()
    }
}

impl<E: std::fmt::Display> From<E> for AppError {
    fn from(e: E) -> Self {
        AppError(StatusCode::BAD_GATEWAY, e.to_string())
    }
}

type ApiResult<T> = Result<T, AppError>;

// ---------------------------------------------------------------------------
// IRCTC calls
// ---------------------------------------------------------------------------

impl AppState {
    /// POST to an online-charts endpoint, with caching + stale fallback.
    async fn call(&self, endpoint: &str, body: Value, offline: bool) -> ApiResult<Value> {
        let key = cache_key(endpoint, &body);

        if let Some(e) = self.cache.read().await.get(&key) {
            if offline || e.at.elapsed() < self.ttl {
                return Ok(e.value.clone());
            }
        }
        if offline {
            return Err(AppError(
                StatusCode::NOT_FOUND,
                format!("{endpoint}: not in imported data"),
            ));
        }

        // Try HTTP/2 first; IRCTC's CDN sometimes resets h2 streams, so retry once over HTTP/1.1.
        let mut live = fetch(&self.http, endpoint, &body).await;
        if let Err(e) = &live {
            tracing::info!("{endpoint}: retrying over HTTP/1.1 after: {e:#}");
            live = fetch(&self.http1, endpoint, &body).await;
        }

        match live {
            Ok(v) => {
                self.cache.write().await.insert(
                    key,
                    CacheEntry {
                        at: Instant::now(),
                        value: v.clone(),
                    },
                );
                Ok(v)
            }
            Err(err) => {
                // Serve stale data rather than nothing.
                if let Some(e) = self.cache.read().await.get(&key) {
                    let mut v = e.value.clone();
                    v["_stale"] = json!(true);
                    return Ok(v);
                }
                tracing::warn!("{endpoint} failed: {err:#}");
                Err(AppError(StatusCode::BAD_GATEWAY, format!("{err:#}")))
            }
        }
    }

    /// Looser lookup for offline mode: find a cached response of `endpoint`
    /// whose request matches all of the given fields.
    async fn find_cached(&self, endpoint: &str, want: &[(&str, &Value)]) -> Option<Value> {
        let cache = self.cache.read().await;
        cache
            .iter()
            .filter_map(|(k, e)| {
                let (ep, req) = k.split_once('|')?;
                if ep != endpoint {
                    return None;
                }
                let req: Value = serde_json::from_str(req).ok()?;
                want.iter()
                    .all(|(f, v)| str_of(&req[*f]) == str_of(v))
                    .then(|| (e.at, e.value.clone()))
            })
            .max_by_key(|(at, _)| *at)
            .map(|(_, v)| v)
    }
}

/// One POST to an online-charts endpoint, with the same headers the IRCTC page sends.
async fn fetch(client: &reqwest::Client, endpoint: &str, body: &Value) -> anyhow::Result<Value> {
    let resp = client
        .post(format!("{CHARTS_API}/{endpoint}"))
        .header("Accept", "application/json")
        .header("Referer", "https://www.irctc.co.in/online-charts/traincomposition")
        .json(body)
        .send()
        .await?;
    let status = resp.status();
    let text = resp.text().await?;
    if text.trim().is_empty() {
        anyhow::bail!(
            "IRCTC returned an empty response (HTTP {status}). It may be rejecting this \
             client; try IRCTC_USER_AGENT or Import HAR."
        );
    }
    serde_json::from_str(&text)
        .map_err(|e| anyhow::anyhow!("IRCTC returned non-JSON (HTTP {status}): {e}"))
}

fn str_of(v: &Value) -> String {
    match v {
        Value::String(s) => s.trim().to_uppercase(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async fn health() -> Json<Value> {
    Json(json!({ "ok": true }))
}

async fn trains(State(s): State<Shared>) -> Json<Value> {
    Json(Value::Array(s.trains.clone()))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChartReq {
    train_no: String,
    j_date: String,
    boarding_station: String,
    #[serde(default)]
    offline: bool,
}

/// Composition + vacant berths of every class in one go.
async fn chart(State(s): State<Shared>, Json(r): Json<ChartReq>) -> ApiResult<Json<Value>> {
    let train_no = r.train_no.trim().to_string();
    let bstn = r.boarding_station.trim().to_uppercase();
    let comp_req = json!({ "trainNo": train_no, "jDate": r.j_date, "boardingStation": bstn });

    let comp = match s.call("trainComposition", comp_req.clone(), r.offline).await {
        Ok(v) => v,
        Err(e) if r.offline => s
            .find_cached(
                "trainComposition",
                &[("trainNo", &json!(train_no)), ("jDate", &json!(r.j_date))],
            )
            .await
            .ok_or(e)?,
        Err(e) => return Err(e),
    };

    if let Some(err) = comp["error"].as_str().filter(|e| !e.is_empty()) {
        return Ok(Json(json!({ "error": err, "composition": comp })));
    }

    let classes: BTreeSet<String> = comp["cdd"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|c| c["classCode"].as_str().map(str::to_string))
        .collect();

    let chart_type = if comp["chartTwoDate"].as_str().is_some_and(|d| !d.is_empty()) {
        2
    } else {
        1
    };
    let remote = comp["remote"].as_str().unwrap_or(&bstn).to_string();
    let source = comp["from"].as_str().unwrap_or(&bstn).to_string();
    let start = comp["trainStartDate"].as_str().unwrap_or(&r.j_date).to_string();
    // Same as the IRCTC site: boardingStation = what the user picked.
    let boarding = bstn.clone();

    let jobs = classes.iter().map(|cls| {
        let s = s.clone();
        let body = json!({
            "trainNo": train_no, "boardingStation": boarding, "remoteStation": remote,
            "trainSourceStation": source, "jDate": start, "cls": cls, "chartType": chart_type,
        });
        let cls = cls.clone();
        let train_no = train_no.clone();
        async move {
            let res = match s.call("vacantBerth", body, r.offline).await {
                Ok(v) => Ok(v),
                Err(e) if r.offline => s
                    .find_cached(
                        "vacantBerth",
                        &[("trainNo", &json!(train_no)), ("cls", &json!(cls))],
                    )
                    .await
                    .ok_or(e),
                Err(e) => Err(e),
            };
            (cls, res)
        }
    });

    let mut vacant = serde_json::Map::new();
    let mut errors = serde_json::Map::new();
    for (cls, res) in futures::future::join_all(jobs).await {
        match res {
            Ok(v) => {
                // "No Record Found" just means zero vacancies in this class.
                if let Some(e) = v["error"]
                    .as_str()
                    .filter(|e| !e.is_empty() && !e.eq_ignore_ascii_case("No Record Found"))
                {
                    errors.insert(cls.clone(), json!(e));
                }
                vacant.insert(cls, v["vbd"].clone());
            }
            Err(AppError(_, msg)) => {
                errors.insert(cls, json!(msg));
            }
        }
    }

    let stations = s.schedules.read().await.get(&train_no).cloned();

    Ok(Json(json!({
        "composition": comp,
        "vacant": vacant,
        "errors": errors,
        "stations": stations,
        "chartType": chart_type,
        "fetchedAt": chrono::Local::now().to_rfc3339(),
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CoachReq {
    train_no: String,
    boarding_station: String,
    remote_station: String,
    train_source_station: String,
    j_date: String,
    coach: String,
    cls: String,
    #[serde(default)]
    offline: bool,
}

/// Full per-berth layout of one coach (occupied + vacant segments).
async fn coach(State(s): State<Shared>, Json(r): Json<CoachReq>) -> ApiResult<Json<Value>> {
    coach_detail(&s, &r).await.map(Json)
}

async fn coach_detail(s: &AppState, r: &CoachReq) -> ApiResult<Value> {
    let body = json!({
        "trainNo": r.train_no, "boardingStation": r.boarding_station,
        "remoteStation": r.remote_station, "trainSourceStation": r.train_source_station,
        "jDate": r.j_date, "coach": r.coach, "cls": r.cls,
    });
    match s.call("coachComposition", body, r.offline).await {
        Ok(v) => Ok(v),
        Err(e) if r.offline => s
            .find_cached(
                "coachComposition",
                &[("trainNo", &json!(r.train_no)), ("coach", &json!(r.coach))],
            )
            .await
            .ok_or(e),
        Err(e) => Err(e),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CoachesReq {
    train_no: String,
    boarding_station: String,
    remote_station: String,
    train_source_station: String,
    j_date: String,
    coaches: Vec<CoachRef>,
    #[serde(default)]
    offline: bool,
}

#[derive(Deserialize)]
struct CoachRef {
    coach: String,
    cls: String,
}

/// Every coach's chart at once (4 requests in flight). Each berth carries its full
/// segment chain, which gives the exact station order and quotas.
async fn coaches(State(s): State<Shared>, Json(r): Json<CoachesReq>) -> Json<Value> {
    use futures::stream::{self, StreamExt};

    let results: Vec<(String, ApiResult<Value>)> = stream::iter(r.coaches)
        .map(|c| {
            let s = s.clone();
            let req = CoachReq {
                train_no: r.train_no.clone(),
                boarding_station: r.boarding_station.clone(),
                remote_station: r.remote_station.clone(),
                train_source_station: r.train_source_station.clone(),
                j_date: r.j_date.clone(),
                coach: c.coach,
                cls: c.cls,
                offline: r.offline,
            };
            async move { (req.coach.clone(), coach_detail(&s, &req).await) }
        })
        .buffer_unordered(4)
        .collect()
        .await;

    let mut details = serde_json::Map::new();
    let mut errors = serde_json::Map::new();
    for (coach, res) in results {
        match res {
            Ok(v) => {
                details.insert(coach, v);
            }
            Err(AppError(_, msg)) => {
                errors.insert(coach, json!(msg));
            }
        }
    }
    Json(json!({ "details": details, "errors": errors }))
}

/// Accepts a HAR file (Chrome DevTools → Network → Export HAR) and loads every
/// IRCTC chart response in it into the cache.
async fn import_har(State(s): State<Shared>, Json(har): Json<Value>) -> ApiResult<Json<Value>> {
    let entries = har["log"]["entries"]
        .as_array()
        .ok_or_else(|| AppError(StatusCode::BAD_REQUEST, "not a HAR file".into()))?;

    let mut counts: HashMap<&str, usize> = HashMap::new();
    let mut charts = Vec::new();

    for e in entries {
        let url = e["request"]["url"].as_str().unwrap_or_default();
        let Some(text) = response_text(&e["response"]["content"]) else {
            continue;
        };

        if let Some(ep) = ["trainComposition", "vacantBerth", "coachComposition"]
            .into_iter()
            .find(|ep| url.contains(&format!("online-charts/api/{ep}")))
        {
            let (Some(req), Ok(resp)) = (
                e["request"]["postData"]["text"]
                    .as_str()
                    .and_then(|t| serde_json::from_str::<Value>(t).ok()),
                serde_json::from_str::<Value>(&text),
            ) else {
                continue;
            };
            if ep == "trainComposition" {
                charts.push(json!({
                    "trainNo": req["trainNo"], "jDate": req["jDate"],
                    "boardingStation": req["boardingStation"],
                    "trainName": resp["trainName"],
                }));
            }
            s.cache.write().await.insert(
                cache_key(ep, &req),
                CacheEntry {
                    at: Instant::now(),
                    value: resp,
                },
            );
            *counts.entry(ep).or_default() += 1;
        } else if url.contains("trnscheduleenquiry/") {
            let train = url.rsplit('/').next().unwrap_or_default().to_string();
            if let Ok(v) = serde_json::from_str::<Value>(&text) {
                if let Some(list) = v["stationList"].as_array() {
                    s.schedules.write().await.insert(train, list.clone());
                    *counts.entry("schedule").or_default() += 1;
                }
            }
        }
    }

    Ok(Json(json!({ "imported": counts, "charts": charts })))
}

fn response_text(content: &Value) -> Option<String> {
    let text = content["text"].as_str()?;
    if content["encoding"].as_str() == Some("base64") {
        use base64_lite::decode;
        return decode(text).and_then(|b| String::from_utf8(b).ok());
    }
    Some(text.to_string())
}

/// Minimal base64 decoder (keeps the dependency list short).
mod base64_lite {
    pub fn decode(s: &str) -> Option<Vec<u8>> {
        let mut out = Vec::with_capacity(s.len() * 3 / 4);
        let (mut buf, mut bits) = (0u32, 0u32);
        for c in s.bytes() {
            let v = match c {
                b'A'..=b'Z' => c - b'A',
                b'a'..=b'z' => c - b'a' + 26,
                b'0'..=b'9' => c - b'0' + 52,
                b'+' | b'-' => 62,
                b'/' | b'_' => 63,
                b'=' | b'\n' | b'\r' | b' ' => continue,
                _ => return None,
            } as u32;
            buf = (buf << 6) | v;
            bits += 6;
            if bits >= 8 {
                bits -= 8;
                out.push((buf >> bits) as u8);
                buf &= (1 << bits) - 1;
            }
        }
        Some(out)
    }
}

fn parse_train_list(raw: &str) -> Vec<Value> {
    raw.split("\",\"")
        .filter_map(|item| {
            let item = item.trim_matches(|c| c == '"' || c == ' ' || c == '\n');
            let (no, name) = item.split_once(" - ")?;
            Some(json!({ "number": no.trim(), "name": name.trim() }))
        })
        .collect()
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "railway_seats=info".into()),
        )
        .init();

    // IRCTC's CDN resets requests from non-browser user agents, so default to the same
    // UA the site's own page sends. Override with IRCTC_USER_AGENT if needed.
    let user_agent = std::env::var("IRCTC_USER_AGENT").unwrap_or_else(|_| {
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
         (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36"
            .into()
    });
    let ttl = std::env::var("CACHE_TTL_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(120);

    let client = |h1: bool| {
        let b = reqwest::Client::builder()
            .user_agent(user_agent.clone())
            .timeout(Duration::from_secs(30));
        if h1 { b.http1_only() } else { b }.build()
    };

    let state = Arc::new(AppState {
        http: client(false)?,
        http1: client(true)?,
        ttl: Duration::from_secs(ttl),
        cache: RwLock::default(),
        schedules: RwLock::default(),
        trains: parse_train_list(TRAIN_LIST),
    });

    let static_dir = std::env::var("STATIC_DIR")
        .unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/../frontend/dist").into());
    let spa = ServeDir::new(&static_dir)
        .not_found_service(ServeFile::new(format!("{static_dir}/index.html")));

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/trains", get(trains))
        .route("/api/chart", post(chart))
        .route("/api/coach", post(coach))
        .route("/api/coaches", post(coaches))
        .route("/api/import/har", post(import_har))
        .layer(DefaultBodyLimit::max(200 * 1024 * 1024))
        .layer(CorsLayer::permissive())
        .with_state(state)
        .fallback_service(spa);

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);
    // Local default is loopback; containers (Vercel) set HOST=0.0.0.0.
    let host: std::net::IpAddr = std::env::var("HOST")
        .ok()
        .and_then(|h| h.parse().ok())
        .unwrap_or([127, 0, 0, 1].into());
    let addr = SocketAddr::from((host, port));
    tracing::info!("listening on http://{addr}");
    axum::serve(tokio::net::TcpListener::bind(addr).await?, app).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_train_list() {
        let t = parse_train_list(TRAIN_LIST);
        assert!(t.len() > 1000);
        assert_eq!(t[0]["number"], "22636");
        assert_eq!(t[0]["name"], "MADGAON EXP");
    }

    #[test]
    fn base64_roundtrip() {
        assert_eq!(base64_lite::decode("aGVsbG8=").unwrap(), b"hello");
    }
}
