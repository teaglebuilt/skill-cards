#[allow(warnings)]
mod bindings;

use bindings::exports::skills::sbom_auditor::auditor::{
    AuditError, AuditReport, Guest, Severity, Vulnerability,
};
use serde::Deserialize;
use std::collections::HashMap;
use std::fs;

struct Component;

#[derive(Deserialize)]
struct NpmLockfile {
    #[serde(default)]
    packages: HashMap<String, NpmLockedPackage>,
}

#[derive(Deserialize)]
struct NpmLockedPackage {
    #[serde(default)]
    version: Option<String>,
}

struct KnownVuln {
    id: &'static str,
    package: &'static str,
    affected: &'static str,
    fixed_in: Option<&'static str>,
    severity: Severity,
    summary: &'static str,
}

const VULN_DB: &[KnownVuln] = &[
    KnownVuln {
        id: "GHSA-4xc9-xhrj-v574",
        package: "minimist",
        affected: "<1.2.6",
        fixed_in: Some("1.2.6"),
        severity: Severity::Medium,
        summary: "Prototype pollution in minimist",
    },
    KnownVuln {
        id: "CVE-2022-25883",
        package: "semver",
        affected: "<7.5.2",
        fixed_in: Some("7.5.2"),
        severity: Severity::High,
        summary: "Regular expression denial of service in semver",
    },
    KnownVuln {
        id: "GHSA-fxwm-579q-49qq",
        package: "ws",
        affected: "<7.5.10",
        fixed_in: Some("7.5.10"),
        severity: Severity::High,
        summary: "DoS when handling crafted HTTP headers",
    },
];

impl Guest for Component {
    fn audit_lockfile(path: String) -> Result<AuditReport, AuditError> {
        let contents = fs::read_to_string(&path)
            .map_err(|e| AuditError::FileNotFound(format!("{path}: {e}")))?;

        if !path.ends_with("package-lock.json") {
            return Err(AuditError::UnsupportedEcosystem(
                "Only package-lock.json supported in this build".into(),
            ));
        }

        let parsed: NpmLockfile = serde_json::from_str(&contents)
            .map_err(|e| AuditError::ParseError(e.to_string()))?;

        let mut vulnerabilities = Vec::new();
        let mut total_deps: u32 = 0;

        for (key, pkg) in &parsed.packages {
            if key.is_empty() {
                continue;
            }
            total_deps += 1;

            let name = key.rsplit("node_modules/").next().unwrap_or(key);
            let Some(version) = &pkg.version else { continue };

            for v in VULN_DB {
                if v.package == name && version_affected(version, v.affected) {
                    vulnerabilities.push(Vulnerability {
                        id: v.id.into(),
                        package: name.into(),
                        version: version.clone(),
                        severity: v.severity,
                        summary: v.summary.into(),
                        fixed_in: v.fixed_in.map(String::from),
                    });
                }
            }
        }

        Ok(AuditReport {
            ecosystem: "npm".into(),
            total_deps,
            vulnerabilities,
        })
    }
}

fn version_affected(version: &str, range: &str) -> bool {
    if let Some(rest) = range.strip_prefix('<') {
        compare_versions(version, rest) == std::cmp::Ordering::Less
    } else {
        false
    }
}

fn compare_versions(a: &str, b: &str) -> std::cmp::Ordering {
    let parse = |s: &str| -> Vec<u32> {
        s.split('.').filter_map(|p| p.parse().ok()).collect()
    };
    parse(a).cmp(&parse(b))
}

bindings::export!(Component with_types_in bindings);
