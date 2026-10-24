//! Minimal TUI: connections / routes / recent usage.

use std::io::{self, stdout};
use std::time::Duration;

use anyhow::Result;
use crossterm::event::{self, Event, KeyCode, KeyEventKind};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Constraint, Direction, Layout};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, List, ListItem, Paragraph, Tabs};
use ratatui::Terminal;

use crate::config::AppConfig;
use crate::store::Store;

enum Tab {
    Connections,
    Routes,
    Usage,
}

impl Tab {
    fn next(&self) -> Self {
        match self {
            Tab::Connections => Tab::Routes,
            Tab::Routes => Tab::Usage,
            Tab::Usage => Tab::Connections,
        }
    }

    fn prev(&self) -> Self {
        match self {
            Tab::Connections => Tab::Usage,
            Tab::Routes => Tab::Connections,
            Tab::Usage => Tab::Routes,
        }
    }

    fn index(&self) -> usize {
        match self {
            Tab::Connections => 0,
            Tab::Routes => 1,
            Tab::Usage => 2,
        }
    }
}

pub fn run_tui(cfg: &AppConfig) -> Result<()> {
    let store = Store::open(&cfg.db_path(), cfg.secrets_key.clone())?;

    enable_raw_mode()?;
    let mut out = stdout();
    execute!(out, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(out);
    let mut terminal = Terminal::new(backend)?;

    let mut tab = Tab::Connections;
    let result = loop {
        let conns = store.list_connections().unwrap_or_default();
        let routes = store.list_routes().unwrap_or_default();
        let usage = store.recent_usage(30).unwrap_or_default();
        let stats = store.stats().unwrap_or_else(|_| serde_json::json!({}));

        terminal.draw(|f| {
            let chunks = Layout::default()
                .direction(Direction::Vertical)
                .constraints([
                    Constraint::Length(3),
                    Constraint::Min(5),
                    Constraint::Length(2),
                ])
                .split(f.area());

            let titles = vec!["Connections", "Routes", "Usage"];
            let tabs = Tabs::new(titles)
                .select(tab.index())
                .block(
                    Block::default()
                        .borders(Borders::ALL)
                        .title(" thinrouter TUI "),
                )
                .highlight_style(
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                );
            f.render_widget(tabs, chunks[0]);

            let items: Vec<ListItem> = match tab {
                Tab::Connections => conns
                    .iter()
                    .map(|c| {
                        ListItem::new(connection_line(
                            &c.name,
                            &c.base_url,
                            c.default_model.as_deref().unwrap_or("—"),
                            chunks[1].width.saturating_sub(2),
                        ))
                    })
                    .collect(),
                Tab::Routes => routes
                    .iter()
                    .map(|r| {
                        let targets: Vec<_> = r
                            .targets
                            .iter()
                            .map(|t| {
                                format!(
                                    "{}{}",
                                    t.connection_name.as_deref().unwrap_or(&t.connection_id),
                                    t.model_override
                                        .as_ref()
                                        .map(|m| format!("→{m}"))
                                        .unwrap_or_default()
                                )
                            })
                            .collect();
                        ListItem::new(route_line(
                            &r.public_model,
                            &r.strategy,
                            &targets.join(" | "),
                            chunks[1].width.saturating_sub(2),
                        ))
                    })
                    .collect(),
                Tab::Usage => usage
                    .iter()
                    .map(|e| {
                        ListItem::new(format!(
                            "{}  model={}  status={}  {}ms  {}",
                            e.ts,
                            e.public_model.as_deref().unwrap_or("—"),
                            e.status
                                .map(|s| s.to_string())
                                .unwrap_or_else(|| "—".into()),
                            e.latency_ms.unwrap_or(0),
                            e.error.as_deref().unwrap_or("")
                        ))
                    })
                    .collect(),
            };

            let list = List::new(display_items(items)).block(
                Block::default().borders(Borders::ALL).title(match tab {
                    Tab::Connections => " Connections ",
                    Tab::Routes => " Routes ",
                    Tab::Usage => " Recent usage ",
                }),
            );
            f.render_widget(list, chunks[1]);

            let cost = stats
                .get("estimated_cost_usd")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            let help = footer(&cfg.db_path().display().to_string(), cost, chunks[2].width);
            f.render_widget(help, chunks[2]);
        })?;

        if event::poll(Duration::from_millis(250))? {
            if let Event::Key(key) = event::read()? {
                if key.kind != KeyEventKind::Press {
                    continue;
                }
                match key.code {
                    KeyCode::Char('q') | KeyCode::Esc => break Ok(()),
                    KeyCode::Right | KeyCode::Tab | KeyCode::Char('l') => tab = tab.next(),
                    KeyCode::Left | KeyCode::BackTab | KeyCode::Char('h') => tab = tab.prev(),
                    _ => {}
                }
            }
        }
    };

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    // ensure restore even on error
    let _ = io::Result::Ok(());
    result
}

// Bound by terminal display cells, not UTF-8 bytes or scalar count.
fn column(value: &str, width: usize) -> String {
    if width == 0 {
        return String::new();
    }
    let mut text = String::new();
    if Span::raw(value).width() <= width {
        text.push_str(value);
    } else {
        for ch in value.chars() {
            let next = format!("{text}{ch}");
            if Span::raw(next.as_str()).width() > width.saturating_sub(1) {
                break;
            }
            text.push(ch);
        }
        text.push('…');
    }
    let padding = width.saturating_sub(Span::raw(text.as_str()).width());
    text.push_str(&" ".repeat(padding));
    text
}
fn connection_line(name: &str, url: &str, model: &str, width: u16) -> Line<'static> {
    let width = usize::from(width);
    let name_width = (width / 3).min(26);
    let model_width = (width / 4).min(18);
    let url_width = width.saturating_sub(name_width + model_width + 4);
    Line::from(vec![
        Span::styled(column(name, name_width), Style::default().fg(Color::Green)),
        Span::raw(format!(
            "  {}  {}",
            column(url, url_width),
            column(model, model_width)
        )),
    ])
}
fn route_line(model: &str, strategy: &str, targets: &str, width: u16) -> Line<'static> {
    let width = usize::from(width);
    let model_width = (width / 4).min(18);
    let strategy_width = (width / 4).min(12);
    let target_width = width.saturating_sub(model_width + strategy_width + 4);
    Line::from(format!(
        "{}  {}  {}",
        column(model, model_width),
        column(strategy, strategy_width),
        column(targets, target_width)
    ))
}
fn display_items(items: Vec<ListItem<'static>>) -> Vec<ListItem<'static>> {
    if items.is_empty() {
        vec![ListItem::new("No rows to display.")]
    } else {
        items
    }
}
fn footer(path: &str, cost: f64, width: u16) -> Paragraph<'static> {
    Paragraph::new(vec![
        Line::from(format!(
            "←/→ or Tab: switch | q: quit / Esc | est. cost: ${cost:.6}"
        )),
        Line::from(column(&format!("db: {path}"), usize::from(width))),
    ])
    .style(Style::default().fg(Color::DarkGray))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::backend::TestBackend;
    use ratatui::widgets::Widget;

    fn rendered(widget: impl Widget, width: u16, height: u16) -> String {
        let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
        terminal
            .draw(|frame| frame.render_widget(widget, frame.area()))
            .unwrap();
        let buffer = terminal.backend().buffer();
        (0..height)
            .map(|y| {
                (0..width)
                    .map(|x| buffer[(x, y)].symbol())
                    .collect::<String>()
            })
            .collect::<Vec<_>>()
            .join("\n")
    }
    #[test]
    fn review_connection_long_chinese_keeps_url_and_model() {
        for width in [78, 118] {
            let text = rendered(
                Paragraph::new(connection_line(
                    &"長中文".repeat(30),
                    "http://127.0.0.1:20129/synthetic/long-path/v1",
                    "review-model",
                    width,
                )),
                width,
                1,
            );
            assert!(text.contains("http://127.0.0.1"), "URL must remain visible");
            assert!(text.contains("review-model"), "model must remain visible");
            assert!(text.contains('…'), "truncation must be explicit");
        }
    }
    #[test]
    fn review_connection_normal_identity_suffix_remains_visible() {
        for width in [78, 118] {
            let text = rendered(
                Paragraph::new(connection_line(
                    "review-connection-02",
                    "http://127.0.0.1:20129/v1",
                    "review-model",
                    width,
                )),
                width,
                1,
            );
            assert!(
                text.contains("review-connection-02"),
                "normal identity suffix must remain visible"
            );
            assert!(text.contains("http://127.0.0.1:20129/v1"));
            assert!(text.contains("review-model"));
        }
    }

    #[test]
    fn review_route_long_chinese_keeps_strategy_and_target() {
        for width in [78, 118] {
            let text = rendered(
                Paragraph::new(route_line(
                    &"長中文".repeat(30),
                    "fallback",
                    "review-short→review-model | another",
                    width,
                )),
                width,
                1,
            );
            assert!(text.contains("fallback"));
            assert!(text.contains("review-short"));
            assert!(text.contains('…'));
        }
    }
    #[test]
    fn review_footer_has_complete_quit_cost_and_database_lines() {
        let text = rendered(
            footer("/state/synthetic-data/thinrouter.db", 0.0, 80),
            80,
            2,
        );
        let lines: Vec<_> = text.lines().collect();
        assert!(
            lines[0].contains("q: quit")
                && lines[0].contains("Esc")
                && lines[0].contains("$0.000000")
        );
        assert!(lines[1].contains("db: /state/synthetic-data/thinrouter.db"));
    }
    #[test]
    fn review_empty_list_explicit_without_success_claim() {
        assert!(rendered(List::new(display_items(vec![])), 78, 2).contains("No rows to display."));
    }
}
