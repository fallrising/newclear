//! Deterministic Markdown export. User prose is escaped; pinned bodies stay verbatim
//! inside a fence longer than any backtick run in that body.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExportStep {
    pub position: u32,
    pub script_id: i64,
    pub script_revision: i64,
    pub instruction: String,
    pub script_title: String,
    pub language: String,
    pub body: String,
    pub script_archived: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExportRunbook {
    pub id: i64,
    pub revision: i64,
    pub title: String,
    pub description: String,
    pub revision_created_at: String,
    pub steps: Vec<ExportStep>,
}

pub fn export_filename(id: i64, revision: i64) -> String {
    format!("runbook-{id}-r{revision}.md")
}

pub fn content_disposition(id: i64, revision: i64) -> String {
    format!(
        "attachment; filename=\"{}\"",
        export_filename(id, revision)
    )
}

pub fn fence_width(body: &str) -> usize {
    longest_backtick_run(body).saturating_add(1).max(3)
}

pub fn render(doc: &ExportRunbook) -> String {
    let mut out = header(doc);
    for (index, step) in doc.steps.iter().enumerate() {
        if index > 0 {
            out.push('\n');
        }
        out.push_str(&render_step(step));
    }
    if doc.steps.is_empty() {
        while out.ends_with("\n\n") {
            out.pop();
        }
        if !out.ends_with('\n') {
            out.push('\n');
        }
    }
    out
}

fn header(doc: &ExportRunbook) -> String {
    let mut out = String::new();
    out.push_str("# ");
    out.push_str(&esc(&doc.title));
    out.push_str("\n\n");
    if !doc.description.is_empty() {
        out.push_str(&esc(&doc.description));
        out.push_str("\n\n");
    }
    out.push_str("_Runbook ");
    out.push_str(&doc.id.to_string());
    out.push_str(", revision ");
    out.push_str(&doc.revision.to_string());
    out.push_str(", saved ");
    out.push_str(&doc.revision_created_at);
    out.push_str("_\n\n");
    out
}

fn render_step(step: &ExportStep) -> String {
    let fence = "`".repeat(fence_width(&step.body));
    let mut body = String::with_capacity(step.body.len() + 1);
    body.push_str(&step.body);
    if !body.ends_with('\n') {
        body.push('\n');
    }
    let mut out = String::new();
    out.push_str("## Step ");
    out.push_str(&step.position.to_string());
    out.push_str(": ");
    out.push_str(&esc(&step.script_title));
    out.push_str("\n\n_Script ");
    out.push_str(&step.script_id.to_string());
    out.push_str(", revision ");
    out.push_str(&step.script_revision.to_string());
    out.push_str(", ");
    out.push_str(&step.language);
    if step.script_archived {
        out.push_str(", archived");
    }
    out.push_str("_\n\n");
    out.push_str(&esc(&step.instruction));
    out.push_str("\n\n");
    out.push_str(&fence);
    out.push_str(&step.language);
    out.push('\n');
    out.push_str(&body);
    out.push_str(&fence);
    out.push('\n');
    out
}

fn longest_backtick_run(body: &str) -> usize {
    let mut best = 0;
    let mut current = 0;
    for ch in body.chars() {
        if ch == '`' {
            current += 1;
            best = best.max(current);
        } else {
            current = 0;
        }
    }
    best
}

fn esc(input: &str) -> String {
    let lines: Vec<&str> = input.split('\n').collect();
    let parts: Vec<String> = lines
        .iter()
        .map(|line| {
            let stripped = line.trim_start_matches([' ', '\t']);
            if stripped.is_empty() {
                String::new()
            } else {
                escape_punctuation(stripped)
            }
        })
        .collect();
    let mut out = String::new();
    for (index, part) in parts.iter().enumerate() {
        if index > 0 {
            let prev_blank = parts[index - 1].is_empty();
            if prev_blank || part.is_empty() {
                out.push('\n');
            } else {
                out.push_str("  \n");
            }
        }
        out.push_str(part);
    }
    out
}

fn escape_punctuation(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    for ch in line.chars() {
        if ch.is_ascii_punctuation() {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn step(body: &str, archived: bool) -> ExportStep {
        ExportStep {
            position: 1,
            script_id: 3,
            script_revision: 2,
            instruction: "run it".into(),
            script_title: "Backup".into(),
            language: "bash".into(),
            body: body.into(),
            script_archived: archived,
        }
    }

    fn doc(description: &str, steps: Vec<ExportStep>) -> ExportRunbook {
        ExportRunbook {
            id: 9,
            revision: 4,
            title: "Nightly".into(),
            description: description.into(),
            revision_created_at: "2026-09-30T12:34:56.789Z".into(),
            steps,
        }
    }

    /// CommonMark fenced code blocks. Content keeps the newline of each line
    /// between the fences, including the last line's newline.
    fn code_blocks(markdown: &str) -> Vec<(String, String)> {
        let lines: Vec<&str> = markdown.split('\n').collect();
        let mut index = 0;
        let mut blocks = Vec::new();
        while index < lines.len() {
            if let Some((width, info)) = opening_fence(lines[index]) {
                let mut content = String::new();
                index += 1;
                while index < lines.len() && !closing_fence(lines[index], width) {
                    content.push_str(lines[index]);
                    content.push('\n');
                    index += 1;
                }
                blocks.push((info, content));
            }
            index += 1;
        }
        blocks
    }

    fn opening_fence(line: &str) -> Option<(usize, String)> {
        let trimmed = line.trim_start_matches(' ');
        if line.len() - trimmed.len() > 3 || !trimmed.starts_with("```") {
            return None;
        }
        let width = trimmed.chars().take_while(|ch| *ch == '`').count();
        if width < 3 {
            return None;
        }
        let rest = &trimmed[width..];
        if rest.contains('`') {
            return None;
        }
        Some((width, rest.trim().to_string()))
    }

    fn closing_fence(line: &str, open: usize) -> bool {
        let trimmed = line.trim();
        !trimmed.is_empty()
            && trimmed.chars().all(|ch| ch == '`')
            && trimmed.len() >= open
            && line.len() - line.trim_start().len() <= 3
    }

    #[test]
    fn fence_is_one_longer_than_the_longest_backtick_run() {
        assert_eq!(fence_width(""), 3);
        assert_eq!(fence_width("no ticks"), 3);
        assert_eq!(fence_width("```"), 4);
        assert_eq!(fence_width("a `` b ``` c"), 4);
        assert_eq!(fence_width("````"), 5);
        assert_eq!(fence_width("`` ``` ````"), 5);
    }

    #[test]
    fn four_backtick_line_round_trips_inside_a_five_backtick_fence() {
        let body = "intro ` tick\n````\nend ` `` ```\n";
        assert_eq!(fence_width(body), 5);
        let rendered = render(&doc("", vec![step(body, false)]));
        assert!(rendered.contains("`````bash\n"));
        assert!(rendered.ends_with('\n'));
        assert!(!rendered.ends_with("\n\n"));
        let blocks = code_blocks(&rendered);
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].0, "bash");
        assert_eq!(blocks[0].1, body);
        assert!(!rendered.contains('\r'));
    }

    #[test]
    fn body_without_trailing_newline_is_closed_on_its_own_line() {
        let body = "echo café 😀";
        let rendered = render(&doc("", vec![step(body, false)]));
        let blocks = code_blocks(&rendered);
        assert_eq!(blocks[0].1, format!("{body}\n"));
        assert!(rendered.contains("echo café 😀\n"));
    }

    #[test]
    fn malicious_prose_is_escaped_and_does_not_open_a_fence() {
        let mut step = step("echo\n", false);
        step.script_title = "# x <script>".into();
        step.instruction = "# x\n<script>\n[a](javascript:1)\n```".into();
        let mut document = doc("see # x", vec![step]);
        document.title = "# x <script> [a](javascript:1) ```".into();
        let rendered = render(&document);
        assert!(rendered.starts_with(
            "# \\# x \\<script\\> \\[a\\]\\(javascript:1\\) \\`\\`\\`\n"
        ));
        assert!(rendered.contains("## Step 1: \\# x \\<script\\>\n"));
        assert!(rendered.contains(
            "\\# x  \n\\<script\\>  \n\\[a\\]\\(javascript:1\\)  \n\\`\\`\\`\n"
        ));
        assert!(!rendered.contains("<script>"));
        let blocks = code_blocks(&rendered);
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].1, "echo\n");
    }

    #[test]
    fn description_archive_marker_and_step_order() {
        let mut first = step("one\n", false);
        first.position = 1;
        first.language = "python".into();
        let mut second = step("two ` tick", true);
        second.position = 2;
        second.script_id = 8;
        second.script_revision = 1;
        second.language = "powershell".into();
        second.script_title = "Tail".into();
        let rendered = render(&doc("Keep this.", vec![first, second]));
        assert!(rendered.contains("# Nightly\n\nKeep this.\n\n_Runbook 9, revision 4, saved 2026-09-30T12:34:56.789Z_\n"));
        assert!(rendered.contains("_Script 3, revision 2, python_\n"));
        assert!(rendered.contains("_Script 8, revision 1, powershell, archived_\n"));
        let blocks = code_blocks(&rendered);
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0].1, "one\n");
        assert_eq!(blocks[1].1, "two ` tick\n");
        assert!(rendered.find("one\n").unwrap() < rendered.find("two ` tick").unwrap());
        let omitted = render(&doc("", vec![step("x\n", false)]));
        assert!(omitted.contains("# Nightly\n\n_Runbook 9, revision 4, saved 2026-09-30T12:34:56.789Z_\n"));
        assert!(!omitted.contains("# Nightly\n\n\n"));
    }

    #[test]
    fn prose_hard_breaks_and_paragraphs() {
        let mut step = step("x\n", false);
        step.instruction = "  # hi\n\n\t- item".into();
        let rendered = render(&doc("", vec![step]));
        assert!(rendered.contains("\\# hi\n\n\\- item\n"));
        assert_eq!(
            content_disposition(9, 4),
            "attachment; filename=\"runbook-9-r4.md\""
        );
    }
}
