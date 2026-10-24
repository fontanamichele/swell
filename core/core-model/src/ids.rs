/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

use serde::{Deserialize, Serialize};
use std::fmt;
use std::time::{SystemTime, UNIX_EPOCH};

macro_rules! id_type {
    ($name:ident) => {
        #[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(pub String);

        impl $name {
            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl From<&str> for $name {
            fn from(s: &str) -> Self {
                Self(s.to_owned())
            }
        }

        impl From<String> for $name {
            fn from(s: String) -> Self {
                Self(s)
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(&self.0)
            }
        }
    };
}

id_type!(IdentityId);
id_type!(SpaceId);
id_type!(NodeId);
id_type!(WindowId);
id_type!(LiveTabId);

/// Source of time and identifiers; replaced by a deterministic one in tests.
pub trait Env: Send {
    fn now_ms(&self) -> i64;
    fn new_id(&mut self) -> String;
}

/// Wall clock plus ids that sort by creation time: 48-bit millisecond
/// timestamp followed by 80 random bits, in hex.
pub struct SystemEnv;

impl Env for SystemEnv {
    fn now_ms(&self) -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    }

    fn new_id(&mut self) -> String {
        let mut random = [0u8; 10];
        getrandom::fill(&mut random).expect("system randomness unavailable");
        let mut id = format!("{:012x}", self.now_ms() as u64 & 0xffff_ffff_ffff);
        for byte in random {
            id.push_str(&format!("{byte:02x}"));
        }
        id
    }
}
