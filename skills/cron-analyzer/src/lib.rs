#[allow(warnings)]
mod bindings;

use bindings::exports::skills::cron_analyzer::analyzer::{
    AnalyzeError, Guest, ScheduleInfo,
};
use chrono_tz::Tz;
use cron::Schedule;
use std::str::FromStr;

struct Component;

impl Guest for Component {
    fn analyze(
        expression: String,
        count: u32,
        timezone: String,
    ) -> Result<ScheduleInfo, AnalyzeError> {
        let schedule = Schedule::from_str(&expression)
            .map_err(|e| AnalyzeError::InvalidExpression(e.to_string()))?;

        let tz: Tz = timezone
            .parse()
            .map_err(|_| AnalyzeError::InvalidTimezone(timezone.clone()))?;

        let next_runs: Vec<String> = schedule
            .upcoming(tz)
            .take(count.min(50) as usize)
            .map(|dt| dt.to_rfc3339())
            .collect();

        Ok(ScheduleInfo {
            description: humanize(&expression),
            next_runs,
            timezone,
        })
    }
}

fn humanize(expr: &str) -> String {
    format!("Cron expression: {expr}")
}

bindings::export!(Component with_types_in bindings);
