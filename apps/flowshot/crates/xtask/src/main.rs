mod boundaries;
mod contracts;

use std::{env, process::ExitCode};

fn main() -> ExitCode {
    match run(env::args().skip(1)) {
        Ok(message) => {
            println!("{message}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("xtask: {error}");
            ExitCode::FAILURE
        }
    }
}

fn run(mut args: impl Iterator<Item = String>) -> Result<String, String> {
    match args.next().as_deref() {
        Some("check-boundaries") => boundaries::run(args),
        Some("contracts") => contracts::run(args),
        Some(command) => Err(format!("unknown command `{command}`")),
        None => Err("missing command; available: check-boundaries, contracts".into()),
    }
}
