/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Classified {
    Url {
        url: String,
    },
    Search {
        query: String,
    },
    /// Looks like a host with an unfamiliar top-level domain (`node.js`).
    Ambiguous {
        url: String,
        query: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SearchEngine {
    pub name: String,
    /// URL with a `{searchTerms}` placeholder.
    pub template: String,
}

impl SearchEngine {
    pub fn search_url(&self, query: &str) -> String {
        self.template.replace("{searchTerms}", &form_encode(query))
    }
}

/// The first engine is the default.
pub fn default_engines() -> Vec<SearchEngine> {
    vec![
        SearchEngine {
            name: "Google".into(),
            template: "https://www.google.com/search?q={searchTerms}".into(),
        },
        SearchEngine {
            name: "DuckDuckGo".into(),
            template: "https://duckduckgo.com/?q={searchTerms}".into(),
        },
    ]
}

const KNOWN_TLDS: &[&str] = &[
    "com", "org", "net", "io", "dev", "app", "co", "edu", "gov", "uk", "de", "fr", "it", "es",
    "nl", "ch", "jp", "cn", "ru", "br", "ca", "au", "in", "me", "tv", "ai", "so", "sh", "info",
    "biz", "xyz", "eu", "us", "se", "no", "dk", "fi", "pl", "pt", "at", "be", "nz", "kr", "mx",
    "ar", "cl", "za", "gg", "fm", "to", "cc", "ly", "ws", "page", "blog", "cloud", "tech",
    "online", "site", "store", "news", "wiki",
];

fn form_encode(text: &str) -> String {
    let mut out = String::new();
    for byte in text.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(byte as char)
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn search(text: &str) -> Classified {
    Classified::Search {
        query: text.to_owned(),
    }
}

fn is_ipv4(host: &str) -> bool {
    let parts: Vec<&str> = host.split('.').collect();
    parts.len() == 4
        && parts.iter().all(|p| {
            !p.is_empty()
                && p.len() <= 3
                && p.bytes().all(|b| b.is_ascii_digit())
                && p.parse::<u16>().is_ok_and(|n| n <= 255)
        })
}

fn is_label(label: &str) -> bool {
    !label.is_empty()
        && !label.starts_with('-')
        && !label.ends_with('-')
        && label.chars().all(|c| c.is_alphanumeric() || c == '-')
}

fn is_port(text: &str) -> bool {
    !text.is_empty() && text.len() <= 5 && text.bytes().all(|b| b.is_ascii_digit())
}

/// Decides what Enter should do with `text`.
pub fn classify(text: &str) -> Classified {
    let t = text.trim();
    if t.is_empty() || t.contains(char::is_whitespace) || t.contains('@') {
        return search(t);
    }
    let lower = t.to_lowercase();
    for scheme in ["http://", "https://", "file://"] {
        if lower.starts_with(scheme) {
            return if t.len() > scheme.len() {
                Classified::Url { url: t.to_owned() }
            } else {
                search(t)
            };
        }
    }
    if let Some(rest) = lower.strip_prefix("about:") {
        let valid = !rest.is_empty() && rest.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
        return if valid {
            Classified::Url { url: t.to_owned() }
        } else {
            search(t)
        };
    }

    let split = t.find(['/', '?', '#']).unwrap_or(t.len());
    let (authority, rest) = t.split_at(split);
    let (host, port) = match authority.rsplit_once(':') {
        Some((host, port)) if is_port(port) => (host, Some(port)),
        Some(_) => return search(t),
        None => (authority, None),
    };
    let host_lower = host.to_lowercase();
    if host_lower == "localhost" || is_ipv4(&host_lower) {
        return Classified::Url {
            url: format!("http://{t}"),
        };
    }
    let labels: Vec<&str> = host_lower.split('.').collect();
    let tld = labels.last().copied().unwrap_or("");
    let tld_ok =
        tld.len() >= 2 && (tld.chars().all(char::is_alphabetic) || tld.starts_with("xn--"));
    if labels.len() < 2 || !tld_ok || !labels.iter().all(|l| is_label(l)) {
        return search(t);
    }
    let url = format!("https://{t}");
    let confident =
        KNOWN_TLDS.contains(&tld) || labels[0] == "www" || port.is_some() || !rest.is_empty();
    if confident {
        Classified::Url { url }
    } else {
        Classified::Ambiguous {
            url,
            query: t.to_owned(),
        }
    }
}
