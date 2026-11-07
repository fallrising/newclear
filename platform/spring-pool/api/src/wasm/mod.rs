mod audit;
mod body;
mod conflict;
mod db;
mod dispatch;
mod respond;
mod runbooks;
mod scripts;
mod time;

use worker::Result;

pub async fn fetch(req: worker::Request, env: worker::Env) -> Result<worker::Response> {
    match dispatch::handle(req, env).await {
        Ok(response) => Ok(response),
        Err(err) => {
            drop(err);
            worker::console_error!("unhandled error");
            respond::json_response(500, &crate::error::internal_error())
        }
    }
}

pub(super) fn worker_msg(message: &str) -> worker::Error {
    worker::Error::from(message.to_owned())
}
