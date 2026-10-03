//! Keyset page: fetch `limit + 1`, return `limit` rows, cursor is the last
//! returned id (the client asks for ids strictly less than that cursor).

pub fn page_limit<T, F>(mut rows: Vec<T>, limit: usize, id_of: F) -> (Vec<T>, Option<i64>)
where
    F: Fn(&T) -> i64,
{
    if rows.len() > limit {
        rows.truncate(limit);
        let cursor = rows.last().map(&id_of);
        (rows, cursor)
    } else {
        (rows, None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cursor_is_the_last_returned_id_only_when_more_rows_exist() {
        let (page, next) = page_limit(vec![5, 4, 3], 2, |n| *n);
        assert_eq!(page, vec![5, 4]);
        assert_eq!(next, Some(4));

        let (page, next) = page_limit(vec![5, 4], 2, |n| *n);
        assert_eq!(page, vec![5, 4]);
        assert_eq!(next, None);

        let (page, next) = page_limit(Vec::<i64>::new(), 50, |n| *n);
        assert!(page.is_empty());
        assert_eq!(next, None);
    }
}
