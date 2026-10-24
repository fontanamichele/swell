/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

use crate::entities::Node;
use crate::ids::NodeId;

/// One change to the node tree. `index` is the position in the parent's
/// children after the change is applied.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TreeOp {
    Inserted {
        node: Node,
        parent: NodeId,
        index: u32,
    },
    Removed {
        id: NodeId,
    },
    Moved {
        id: NodeId,
        parent: NodeId,
        index: u32,
    },
    Updated {
        node: Node,
    },
}
