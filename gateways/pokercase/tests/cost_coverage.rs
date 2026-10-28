//! D-04 cost-only coverage through actual SQLite/admin/HTML/CSV reads.
//! No provider connections, routes, inference, credentials or private databases.
use serde_json::{json, Value};
use std::time::Duration;
use tempfile::TempDir;
use tokio::net::TcpListener;

type StoredRow = (
    i64,
    String,
    Option<String>,
    Option<String>,
    Option<i64>,
    Option<i64>,
    Option<String>,
    Option<i64>,
    Option<i64>,
    Option<f64>,
);
struct Fixture {
    base: String,
    client: reqwest::Client,
    child: tokio::process::Child,
    dir: TempDir,
}
impl Fixture {
    async fn start() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let reserve = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = reserve.local_addr().unwrap().port();
        drop(reserve);
        let mut child = tokio::process::Command::new(env!("CARGO_BIN_EXE_thinrouter"))
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .args([
                "serve",
                "--host",
                "127.0.0.1",
                "--port",
                &port.to_string(),
                "--data-dir",
                dir.path().to_str().unwrap(),
                "--admin-token",
                "synthetic-admin",
            ])
            .stdout(std::process::Stdio::null())
            .stderr(std::fs::File::create(dir.path().join("stderr")).unwrap())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let base = format!("http://127.0.0.1:{port}");
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap();
        for _ in 0..100 {
            assert!(
                child.try_wait().unwrap().is_none(),
                "synthetic gateway exited before health"
            );
            if client
                .get(format!("{base}/health"))
                .send()
                .await
                .is_ok_and(|r| r.status().is_success())
            {
                return Self {
                    base,
                    client,
                    child,
                    dir,
                };
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        panic!("synthetic gateway health timeout");
    }
    async fn get(&self, path: &str) -> String {
        let r = self
            .client
            .get(format!("{}{path}", self.base))
            .header("x-admin-token", "synthetic-admin")
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 200, "admin read {path}");
        r.text().await.unwrap()
    }
}
fn snapshot(db: &rusqlite::Connection) -> Vec<StoredRow> {
    db.prepare("SELECT id,ts,public_model,connection_id,status,latency_ms,error,prompt_tokens,completion_tokens,estimated_cost_usd FROM usage_events ORDER BY id").unwrap()
        .query_map([],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?,r.get(8)?,r.get(9)?))).unwrap().map(Result::unwrap).collect()
}
fn summary(sum: Option<f64>, known: i64, total: i64, status: &str) -> Value {
    json!({"known_sum":sum,"known_count":known,"unknown_count":total-known,"total_count":total,
        "coverage":if total==0 {None} else {Some(known as f64/total as f64)},"status":status,"basis":"stored_estimate_usd"})
}
fn ui_matches(text: &str, s: &Value) -> bool {
    let phrase = match s["status"].as_str().unwrap() {
        "no_data" => "No data",
        "unknown" => "Unknown",
        "partial" => "Partial estimate",
        "complete" => "Estimated total",
        _ => "Unavailable",
    };
    let counts = if s["total_count"] == 0 {
        "0 rows".to_owned()
    } else {
        format!("{}/{} rows", s["known_count"], s["total_count"])
    };
    let money = s["known_sum"].as_f64().map(|n| format!("${n}"));
    text.contains(phrase)
        && text.contains(&counts)
        && money.as_ref().is_none_or(|m| text.contains(m))
}
#[tokio::test]
async fn cc1_cc2_cost_coverage_agrees_across_admin_surfaces() {
    let mut f = Fixture::start().await;
    let db = rusqlite::Connection::open(f.dir.path().join("thinrouter.db")).unwrap();
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let cases = [
        ("empty", vec![], summary(None, 0, 0, "no_data"), Value::Null),
        (
            "unknown",
            vec![(false, None, 200), (false, None, 502)],
            summary(None, 0, 2, "unknown"),
            Value::Null,
        ),
        (
            "zero",
            vec![(false, Some(0.0), 200)],
            summary(Some(0.0), 1, 1, "complete"),
            json!(0.0),
        ),
        (
            "complete",
            vec![(false, Some(1.25), 200), (false, Some(2.75), 200)],
            summary(Some(4.0), 2, 2, "complete"),
            json!(4.0),
        ),
        (
            "partial",
            vec![
                (false, Some(0.25), 200),
                (false, None, 502),
                (false, Some(0.0), 200),
            ],
            summary(Some(0.25), 2, 3, "partial"),
            Value::Null,
        ),
        (
            "split-days",
            vec![
                (true, Some(1.25), 200),
                (true, Some(2.75), 200),
                (false, Some(0.0), 200),
                (false, None, 502),
            ],
            summary(Some(4.0), 3, 4, "partial"),
            Value::Null,
        ),
    ];
    let mut mismatches = Vec::new();
    for (name, rows, want, legacy) in cases {
        db.execute("DELETE FROM usage_events", []).unwrap();
        for (old, cost, status) in &rows {
            let day = if *old { "2020-01-01" } else { today.as_str() };
            db.execute("INSERT INTO usage_events (ts,public_model,status,latency_ms,error,prompt_tokens,completion_tokens,estimated_cost_usd) VALUES (?1,'synthetic',?2,8,?3,NULL,NULL,?4)",rusqlite::params![format!("{day}T00:00:00Z"),status,if *status==200 {None} else {Some("synthetic_failure")},cost]).unwrap();
        }
        let before = snapshot(&db);
        let stats: Value = serde_json::from_str(&f.get("/admin/api/stats").await).unwrap();
        assert_eq!(stats["connections"], 0);
        assert_eq!(stats["routes"], 0);
        assert_eq!(stats["usage_events"], rows.len());
        if stats["estimated_cost_usd"] != legacy {
            mismatches.push(format!("{name}:stats-total"));
        }
        if stats["cost_summary"] != want {
            mismatches.push(format!("{name}:stats-coverage"));
        }
        let dashboard = f.get("/admin").await;
        if !dashboard.contains("All-time") || !ui_matches(&dashboard, &want) {
            mismatches.push(format!("{name}:dashboard"));
        }
        let html = f.get("/admin/usage").await;
        let header = html.split("<section").next().unwrap();
        if !header.contains("All-time") || !ui_matches(header, &want) {
            mismatches.push(format!("{name}:usage-total"));
        }
        let daily: Value = serde_json::from_str(&f.get("/admin/api/usage/daily").await).unwrap();
        let days = daily["data"].as_array().unwrap();
        assert_eq!(
            days.len(),
            if rows.is_empty() {
                0
            } else if name == "split-days" {
                2
            } else {
                1
            }
        );
        for day in days {
            let day_name = day["day"].as_str().unwrap();
            let (expected, total) = if name == "split-days" {
                if day_name == "2020-01-01" {
                    (summary(Some(4.0), 2, 2, "complete"), json!(4.0))
                } else {
                    (summary(Some(0.0), 1, 2, "partial"), Value::Null)
                }
            } else {
                (want.clone(), legacy.clone())
            };
            if day["estimated_cost_usd"] != total || day["cost_summary"] != expected {
                mismatches.push(format!("{name}:{day_name}:daily-json"));
            }
            let matching: Vec<_> = rows
                .iter()
                .filter(|(old, _, _)| {
                    if *old {
                        day_name == "2020-01-01"
                    } else {
                        day_name == today
                    }
                })
                .collect();
            assert_eq!(day["requests"], matching.len());
            assert_eq!(
                day["ok"],
                matching
                    .iter()
                    .filter(|(_, _, status)| *status == 200)
                    .count()
            );
            assert_eq!(
                day["errors"],
                matching
                    .iter()
                    .filter(|(_, _, status)| *status != 200)
                    .count()
            );
            let rendered = html
                .split("<tr>")
                .find(|r| r.contains(&format!(">{day_name}</td>")))
                .unwrap();
            if !ui_matches(rendered, &expected) {
                mismatches.push(format!("{name}:{day_name}:daily-html"));
            }
        }
        let csv = f.get("/admin/api/usage/export.csv").await;
        let values: Vec<Option<f64>> = csv
            .lines()
            .skip(1)
            .map(|l| {
                let c = l.split(',').nth(8).unwrap();
                if c.is_empty() {
                    None
                } else {
                    Some(c.parse().unwrap())
                }
            })
            .collect();
        assert_eq!(
            values,
            rows.iter()
                .rev()
                .map(|(_, cost, _)| *cost)
                .collect::<Vec<_>>(),
            "{name}: event CSV null/zero"
        );
        let known: Vec<_> = values.into_iter().flatten().collect();
        let sum = if known.is_empty() {
            None
        } else {
            Some(known.iter().sum::<f64>())
        };
        assert_eq!(json!(sum), want["known_sum"], "{name}: CSV same-scope sum");
        assert_eq!(snapshot(&db), before, "{name}: reads changed usage rows");
    }
    f.child.kill().await.unwrap();
    assert!(
        mismatches.is_empty(),
        "CC-1/CC-2 synthetic aggregate mismatches: {}",
        mismatches.join(", ")
    );
}

#[tokio::test]
async fn cc2_doctor_reports_cost_coverage_from_its_synthetic_database() {
    let mut f = Fixture::start().await;
    let db = rusqlite::Connection::open(f.dir.path().join("thinrouter.db")).unwrap();
    let cases: &[(&[Option<f64>], &str)] = &[
        (&[], "no data (0 rows)"),
        (&[None], "unknown (0/1 rows)"),
        (&[Some(0.0)], "total $0.000000 (1/1 rows)"),
        (&[Some(0.25), None], "partial est. $0.250000 (1/2 rows)"),
        (&[Some(1.25), Some(2.75)], "total $4.000000 (2/2 rows)"),
    ];
    for (costs, expected) in cases {
        db.execute("DELETE FROM usage_events", []).unwrap();
        for cost in *costs {
            db.execute("INSERT INTO usage_events (ts,estimated_cost_usd) VALUES ('2020-01-01T00:00:00Z',?1)",[cost]).unwrap();
        }
        let before = snapshot(&db);
        let mut cmd = tokio::process::Command::new(env!("CARGO_BIN_EXE_thinrouter"));
        cmd.env_clear()
            .env("PATH", "/usr/bin:/bin")
            .args(["doctor", "--data-dir", f.dir.path().to_str().unwrap()])
            .kill_on_drop(true);
        let result = tokio::time::timeout(Duration::from_secs(5), cmd.output())
            .await
            .unwrap()
            .unwrap();
        assert!(result.status.success(), "synthetic doctor failed");
        let text = String::from_utf8(result.stdout).unwrap();
        assert!(
            text.contains("all-time") && text.contains(expected),
            "doctor missing coverage: {expected}"
        );
        assert_eq!(snapshot(&db), before);
    }
    f.child.kill().await.unwrap();
}
