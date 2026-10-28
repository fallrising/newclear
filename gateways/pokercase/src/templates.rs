use std::sync::OnceLock;

use minijinja::{AutoEscape, Environment, Value};

static ENV: OnceLock<Environment<'static>> = OnceLock::new();

pub fn env() -> &'static Environment<'static> {
    ENV.get_or_init(|| {
        let mut env = Environment::new();
        // Template names carry no .html suffix, so escaping must be forced on: pages
        // render upstream error bodies and client-supplied model names.
        env.set_auto_escape_callback(|_| AutoEscape::Html);
        env.add_template(
            "cost_summary",
            include_str!("../templates/cost_summary.html"),
        )
        .unwrap();
        env.add_template("dashboard", include_str!("../templates/dashboard.html"))
            .unwrap();
        env.add_template("connections", include_str!("../templates/connections.html"))
            .unwrap();
        env.add_template("routes", include_str!("../templates/routes.html"))
            .unwrap();
        env.add_template("keys", include_str!("../templates/keys.html"))
            .unwrap();
        env.add_template("usage", include_str!("../templates/usage.html"))
            .unwrap();
        env.add_template("login", include_str!("../templates/login.html"))
            .unwrap();
        env
    })
}

pub fn render(name: &str, ctx: Value) -> Result<String, minijinja::Error> {
    let tmpl = env().get_template(name)?;
    tmpl.render(ctx)
}

#[cfg(test)]
mod tests {
    #[test]
    fn upstream_text_is_html_escaped() {
        let html = super::render(
            "usage",
            minijinja::context! {
                title => "Usage", active => "usage", csrf => "", cost_total => crate::store::UsageCostSummary::from_observations(None, 0, 0),
                daily => Vec::<i32>::new(), admin_protected => true,
                events => vec![minijinja::context! { ts => "t", error => "<script>x()</script>" }],
            },
        )
        .unwrap();
        assert!(!html.contains("<script>x()"));
        assert!(html.contains("&lt;script&gt;"));
    }
}
