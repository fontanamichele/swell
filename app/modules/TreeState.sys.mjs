/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  NodeKindView,
  TreeOp,
} from "moz-src:///swell/app/modules/Core.sys.mjs";

/**
 * The window's copy of the node trees shown for a space: its Pinned and Today
 * lists and the Favorites of its identity. Loaded from a core snapshot, then
 * kept current by applying the diffs the core sends; it never invents state.
 */
export class TreeState {
  #nodes = new Map();
  #children = new Map();
  #parents = new Map();

  /** @param {TreeSnapshot} snapshot */
  load(snapshot) {
    this.#nodes.clear();
    this.#children.clear();
    this.#parents.clear();
    for (const node of snapshot.nodes) {
      this.#nodes.set(node.id, node);
    }
    for (const { parent, ids } of snapshot.children) {
      this.#children.set(parent, [...ids]);
      for (const id of ids) {
        this.#parents.set(id, parent);
      }
    }
  }

  apply(diff) {
    for (const op of diff.ops) {
      if (op instanceof TreeOp.Inserted) {
        this.#nodes.set(op.node.id, op.node);
        if (op.node.kind instanceof NodeKindView.Folder) {
          this.#children.set(op.node.id, this.#children.get(op.node.id) ?? []);
        }
        this.#insertChild(op.parent, op.node.id, op.index);
      } else if (op instanceof TreeOp.Removed) {
        this.#remove(op.id);
      } else if (op instanceof TreeOp.Moved) {
        this.#detach(op.id);
        this.#insertChild(op.parent, op.id, op.index);
      } else if (op instanceof TreeOp.Updated) {
        this.#nodes.set(op.node.id, op.node);
      }
    }
  }

  #insertChild(parent, id, index) {
    const list = this.#children.get(parent) ?? [];
    list.splice(Math.min(index, list.length), 0, id);
    this.#children.set(parent, list);
    this.#parents.set(id, parent);
  }

  #detach(id) {
    const parent = this.#parents.get(id);
    if (parent !== undefined) {
      const list = this.#children.get(parent) ?? [];
      const at = list.indexOf(id);
      if (at >= 0) {
        list.splice(at, 1);
      }
    }
    this.#parents.delete(id);
  }

  #remove(id) {
    for (const child of [...(this.#children.get(id) ?? [])]) {
      this.#remove(child);
    }
    this.#detach(id);
    this.#children.delete(id);
    this.#nodes.delete(id);
  }

  node(id) {
    return this.#nodes.get(id);
  }

  // A node as a plain object, so window code needs no UniFFI types.
  //
  // Returns
  //   | {kind: "folder", id: string, title: string, collapsed: boolean}
  //   | null}
  describe(id) {
    const node = this.#nodes.get(id);
    if (!node) {
      return null;
    }
    if (node.kind instanceof NodeKindView.Folder) {
      return {
        kind: "folder",
        id,
        title: node.kind.title,
        collapsed: node.kind.collapsed,
      };
    }
    const { url, title, customTitle, icon } = node.kind;
    return { kind: "tab", id, url, title: customTitle || title || url, icon };
  }

  parent(id) {
    return this.#parents.get(id);
  }

  childrenOf(id) {
    return this.#children.get(id) ?? [];
  }

  isFolder(id) {
    return this.#nodes.get(id)?.kind instanceof NodeKindView.Folder;
  }

  // Whether `id` is `ancestor` or sits anywhere below it.
  isWithin(id, ancestor) {
    for (
      let current = id;
      current !== undefined;
      current = this.#parents.get(current)
    ) {
      if (current === ancestor) {
        return true;
      }
    }
    return false;
  }

  // The rows to draw for a root: its nodes in order, folders followed by
  // their children unless collapsed. A collapsed folder is still followed by
  // the pages below it, at any depth, for which `isOpen` is true.
  //
  // Returns >}
  rows(root, isOpen = () => false) {
    const rows = [];
    const walk = (parent, depth) => {
      for (const id of this.childrenOf(parent)) {
        const node = this.#nodes.get(id);
        if (!node) {
          continue;
        }
        rows.push({ id, node, depth });
        if (node.kind instanceof NodeKindView.Folder) {
          if (!node.kind.collapsed) {
            walk(id, depth + 1);
          } else {
            for (const openId of this.#openBelow(id, isOpen)) {
              rows.push({
                id: openId,
                node: this.#nodes.get(openId),
                depth: depth + 1,
              });
            }
          }
        }
      }
    };
    walk(root, 0);
    return rows;
  }

  #openBelow(folder, isOpen) {
    const open = [];
    for (const id of this.childrenOf(folder)) {
      const node = this.#nodes.get(id);
      if (!node) {
        continue;
      }
      if (node.kind instanceof NodeKindView.Folder) {
        open.push(...this.#openBelow(id, isOpen));
      } else if (isOpen(id)) {
        open.push(id);
      }
    }
    return open;
  }

  /**
   * Where a dragged node lands when dropped before, after or inside a target
   * row, as the arguments of the core's move command; null if the drop is not
   * allowed or would change nothing.
   *
   * @param {object} drop
   * @param {string} drop.dragged
   * @param {string} drop.target A node, or a root when dropping into an empty list.
   * @param {"before"|"after"|"inside"} drop.where
   * @param {Set<string>} [drop.tabsOnly] Roots that hold tabs only.
   * @returns {{parent: string, index: number}|null}
   */
  dropTarget({ dragged, target, where, tabsOnly }) {
    const plan = this.planMoves({
      dragged: [dragged],
      target,
      where,
      tabsOnly,
    });
    return plan ? { parent: plan[0].parent, index: plan[0].index } : null;
  }

  /**
   * The core's move commands, to run in order, that drop several nodes before,
   * after or inside a target row, keeping their order. Each index is the
   * position once its node is lifted out and the moves before it are done.
   * Nodes already in place are left out.
   *
   * @param {object} drop
   * @param {string[]} drop.dragged The nodes to move, in the order they land.
   * @param {string} drop.target A node, or a root when dropping into an empty list.
   * @param {"before"|"after"|"inside"} drop.where
   * @param {Set<string>} [drop.tabsOnly] Roots that hold tabs only.
   * @returns {{id: string, parent: string, index: number}[]|null} Null if the
   *   drop is not allowed or would change nothing.
   */
  planMoves({ dragged, target, where, tabsOnly = new Set() }) {
    if (
      !dragged.length ||
      dragged.some(
        id => id === target || !this.#nodes.has(id) || !this.#parents.has(id)
      )
    ) {
      return null;
    }
    const parent = where == "inside" ? target : this.#parents.get(target);
    if (parent === undefined) {
      return null;
    }
    if (this.#nodes.has(parent) && !this.isFolder(parent)) {
      return null;
    }
    if (dragged.some(id => this.isWithin(parent, id))) {
      return null;
    }
    if (tabsOnly.has(parent) && dragged.some(id => this.isFolder(id))) {
      return null;
    }
    const lists = new Map();
    const list = id => {
      if (!lists.has(id)) {
        lists.set(id, [...this.childrenOf(id)]);
      }
      return lists.get(id);
    };
    const plan = [];
    let anchor = where == "inside" ? null : target;
    let offset = where == "after" ? 1 : 0;
    for (const id of dragged) {
      const from = this.#parents.get(id);
      const current = list(from).indexOf(id);
      list(from).splice(current, 1);
      const into = list(parent);
      const index =
        anchor === null ? into.length : into.indexOf(anchor) + offset;
      into.splice(index, 0, id);
      if (from !== parent || current !== index) {
        plan.push({ id, parent, index });
      }
      anchor = id;
      offset = 1;
    }
    return plan.length ? plan : null;
  }
}
