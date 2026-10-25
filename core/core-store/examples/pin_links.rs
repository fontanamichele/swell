/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! Adds links to the pinned tabs of a space of a profile, for when there are
//! many to add. Swell must not be running.
//!
//! usage: pin_links <data dir> <space title> < links.tsv
//!
//! Each line of the input is `address<TAB>title`. The links are added at the
//! end of the pins of the space, in order, and nothing else is changed.

use core_model::{NodeId, SystemEnv};
use core_store::Store;
use std::io::BufRead;
use std::path::Path;

fn main() {
    let mut args = std::env::args().skip(1);
    let (Some(dir), Some(title)) = (args.next(), args.next()) else {
        eprintln!("usage: pin_links <data dir> <space title> < links.tsv");
        std::process::exit(2);
    };
    let mut store = Store::open(Path::new(&dir)).expect("open the store");
    let device = store
        .get_meta("device_id")
        .expect("read the device")
        .expect("this directory has no Swell data");
    let mut model = store
        .load(Box::new(SystemEnv), &device)
        .expect("load the model");
    let space = model
        .spaces()
        .into_iter()
        .find(|space| space.title == title)
        .unwrap_or_else(|| panic!("there is no space called {title}"));
    let pinned: NodeId = space.pinned_root.clone();
    let mut added = 0;
    for line in std::io::stdin().lock().lines() {
        let line = line.expect("read a line");
        let Some((url, name)) = line.split_once('\t') else {
            continue;
        };
        let index = model.children(&pinned).map_or(0, |children| children.len());
        let (_, ops) = model
            .insert_tab(&pinned, index, url.trim(), name.trim())
            .expect("pin a link");
        store.apply(&model, &ops).expect("save the pin");
        added += 1;
    }
    println!("pinned {added} links in {title}");
}
