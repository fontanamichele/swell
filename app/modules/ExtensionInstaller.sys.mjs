/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Per-space add-ons. An add-on is installed once for each space that wants
// it, as a copy whose id carries the container of the space ("name--s3@domain";
// see ExtensionData.boundUserContextIdOf in Extension.sys.mjs). The copy only
// sees that container: its tabs, cookies, content scripts and storage. The
// original package must be signed by Mozilla; the copy is not (its id
// changed), so the application does not require signatures.

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AddonManager: "resource://gre/modules/AddonManager.sys.mjs",
  ExtensionData: "resource://gre/modules/Extension.sys.mjs",
});

// The same pattern as gIDTest in XPIInstall.sys.mjs.
const ID_PATTERN =
  /^(\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}|[a-z0-9-._]*@[a-z0-9-._]+)$/i;
const GUID_PATTERN = /^\{([0-9a-f-]{36})\}$/i;
const GUID_DOMAIN = "derived.swell.invalid";
const DROPPED = [/^META-INF\//, /^mozilla-recommendation\.json$/];
const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;

/**
 *
 */
export class InstallError extends Error {}

// The packages as they were installed, so that an add-on of one space can be
// installed in another without downloading it again.
const ORIGINALS_DIR = () =>
  PathUtils.join(PathUtils.profileDir, "swell", "extension-originals");

const originalPath = id =>
  PathUtils.join(
    ORIGINALS_DIR(),
    `${id.replace(/[^a-z0-9@._{}-]/gi, "_")}.xpi`
  );

/**
 * The id of a copy of `original` for a container.
 *
 * @param {string} original
 * @param {number} userContextId
 * @returns {string}
 */
export function derivedId(original, userContextId) {
  if (!Number.isInteger(userContextId) || userContextId <= 0) {
    throw new InstallError(`container ${userContextId} cannot own add-ons`);
  }
  const guid = GUID_PATTERN.exec(original);
  const derived = guid
    ? `${guid[1].toLowerCase()}--s${userContextId}@${GUID_DOMAIN}`
    : `${original.split("@")[0]}--s${userContextId}@${original.split("@")[1]}`;
  if (!ID_PATTERN.test(derived)) {
    throw new InstallError(`${derived} is not a valid add-on id`);
  }
  return derived;
}

// Removes // comments outside strings, as the toolkit does when it reads a
// manifest.
function stripComments(text) {
  let out = "";
  for (let i = 0; i < text.length; ) {
    const c = text[i];
    if (c == '"') {
      let j = i + 1;
      while (j < text.length && text[j] != '"') {
        j += text[j] == "\\" ? 2 : 1;
      }
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c == "/" && text[i + 1] == "/") {
      const end = text.indexOf("\n", i + 2);
      i = end == -1 ? text.length : end;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function readZip(file) {
  const reader = Cc["@mozilla.org/libjar/zip-reader;1"].createInstance(
    Ci.nsIZipReader
  );
  reader.open(file);
  const entries = new Map();
  try {
    for (const name of reader.findEntries("*")) {
      if (name.endsWith("/")) {
        continue;
      }
      const input = Cc["@mozilla.org/binaryinputstream;1"].createInstance(
        Ci.nsIBinaryInputStream
      );
      input.setInputStream(reader.getInputStream(name));
      entries.set(name, new Uint8Array(input.readByteArray(input.available())));
      input.close();
    }
  } finally {
    reader.close();
  }
  return entries;
}

function writeZip(file, entries) {
  const writer = Cc["@mozilla.org/zipwriter;1"].createInstance(Ci.nsIZipWriter);
  writer.open(file, 0x04 | 0x08 | 0x20); // PR_RDWR | PR_CREATE_FILE | PR_TRUNCATE
  try {
    for (const name of [...entries.keys()].sort()) {
      const data = entries.get(name);
      const stream = Cc[
        "@mozilla.org/io/arraybuffer-input-stream;1"
      ].createInstance(Ci.nsIArrayBufferInputStream);
      stream.setData(data.buffer.slice(0), 0, data.byteLength);
      writer.addEntryStream(
        name,
        Date.now() * 1000,
        Ci.nsIZipWriter.COMPRESSION_DEFAULT,
        stream,
        false
      );
    }
  } finally {
    writer.close();
  }
}

/**
 * Makes the copy of a package for a container, without the signature, with
 * the id of the copy, and without an update address of its own.
 *
 * @param {nsIFile} xpi The original package.
 * @param {number} userContextId
 * @param {nsIFile} outDir Where the copy goes.
 * @returns {{file: nsIFile, originalId: string, id: string, name: string, version: string}}
 */
export function deriveCopy(xpi, userContextId, outDir) {
  const entries = readZip(xpi);
  for (const name of [...entries.keys()]) {
    if (DROPPED.some(pattern => pattern.test(name))) {
      entries.delete(name);
    }
  }
  const manifestBytes = entries.get("manifest.json");
  if (!manifestBytes) {
    throw new InstallError("not a WebExtension: no manifest.json");
  }
  const manifest = JSON.parse(
    stripComments(
      new TextDecoder().decode(manifestBytes).replace(/^\uFEFF/, "")
    )
  );
  let gecko = null;
  for (const key of ["browser_specific_settings", "applications"]) {
    if (manifest[key]?.gecko?.id) {
      gecko = manifest[key].gecko;
      break;
    }
  }
  if (!gecko) {
    throw new InstallError(
      "the add-on has no browser_specific_settings.gecko.id"
    );
  }
  const originalId = gecko.id;
  const id = derivedId(originalId, userContextId);
  for (const key of ["browser_specific_settings", "applications"]) {
    const section = manifest[key]?.gecko;
    if (section) {
      section.id = id;
      delete section.update_url;
    }
  }
  entries.set(
    "manifest.json",
    new TextEncoder().encode(JSON.stringify(manifest, null, 2))
  );
  const file = outDir.clone();
  file.append(`${id}.xpi`);
  writeZip(file, entries);
  return {
    file,
    originalId,
    id,
    name: manifest.name,
    version: manifest.version,
  };
}

async function tempDir() {
  const dir = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  dir.initWithPath(
    await IOUtils.createUniqueDirectory(PathUtils.tempDir, "swell-extension")
  );
  return dir;
}

/**
 * The add-ons of a container, as the add-on manager lists them.
 *
 * @param {number} userContextId
 */
export async function copiesOf(userContextId) {
  const addons = await lazy.AddonManager.getAddonsByTypes(["extension"]);
  return addons.filter(
    addon => lazy.ExtensionData.boundUserContextIdOf(addon.id) == userContextId
  );
}

/**
 * Installs a package for a container. The original has to be signed by
 * Mozilla, unless `allowUnsigned` is set (tests and local development).
 *
 * @param {nsIFile} xpi
 * @param {number} userContextId
 * @param {object} [options]
 * @param {Function} [options.prompt] `(info) =>` a promise that resolves to
 *   approve the permissions or rejects; approves by default.
 * @param {boolean} [options.allowUnsigned] Also set by the pref
 *   swell.extensions.allowUnsigned, for tests and local development.
 * @returns {Promise<Addon>}
 */
export async function installCopy(
  xpi,
  userContextId,
  { prompt = null, allowUnsigned = false } = {}
) {
  allowUnsigned ||= Services.prefs.getBoolPref(
    "swell.extensions.allowUnsigned",
    false
  );
  const original = await lazy.AddonManager.getInstallForFile(xpi);
  if (!original?.addon) {
    throw new InstallError("that file is not an add-on");
  }
  if (
    !allowUnsigned &&
    original.addon.signedState < lazy.AddonManager.SIGNEDSTATE_SIGNED
  ) {
    throw new InstallError(`${original.addon.name} is not signed by Mozilla`);
  }
  const dir = await tempDir();
  const copy = deriveCopy(xpi, userContextId, dir);
  try {
    await IOUtils.makeDirectory(ORIGINALS_DIR(), { createAncestors: true });
    const kept = originalPath(copy.originalId);
    if (kept != xpi.path) {
      await IOUtils.copy(xpi.path, kept, { noOverwrite: false });
    }
    const install = await lazy.AddonManager.getInstallForFile(copy.file);
    if (prompt) {
      install.promptHandler = info => prompt(info);
    }
    await install.install();
    return await lazy.AddonManager.getAddonByID(copy.id);
  } finally {
    await IOUtils.remove(dir.path, { recursive: true, ignoreAbsent: true });
  }
}

/**
 * Downloads a package (https only) into a temporary file and installs it.
 *
 * @param {string} url
 * @param {number} userContextId
 * @param {object} [options] As for installCopy.
 */
export async function installCopyFromUrl(url, userContextId, options = {}) {
  if (new URL(url).protocol != "https:") {
    throw new InstallError("add-ons are only downloaded over https");
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new InstallError(`could not download ${url}: ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new InstallError("that add-on is too large");
  }
  const dir = await tempDir();
  const xpi = dir.clone();
  xpi.append("download.xpi");
  await IOUtils.write(xpi.path, bytes);
  try {
    return await installCopy(xpi, userContextId, options);
  } finally {
    await IOUtils.remove(dir.path, { recursive: true, ignoreAbsent: true });
  }
}

/**
 * Installs, for another container, an add-on that was installed before.
 *
 * @param {string} originalId The id of the add-on as it was published.
 * @param {number} userContextId
 * @param {object} [options] As for installCopy.
 */
export async function installStoredCopy(originalId, userContextId, options) {
  const path = originalPath(originalId);
  if (!(await IOUtils.exists(path))) {
    throw new InstallError(`the package of ${originalId} is not kept`);
  }
  const xpi = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  xpi.initWithPath(path);
  return installCopy(xpi, userContextId, options);
}

/**
 * Add-ons of other containers that this one does not have yet.
 *
 * @param {number} userContextId
 * @returns {Promise<Array<{originalId: string, name: string}>>}
 */
export async function availableFromOtherSpaces(userContextId) {
  const addons = await lazy.AddonManager.getAddonsByTypes(["extension"]);
  const have = new Set();
  const others = new Map();
  for (const addon of addons) {
    const bound = lazy.ExtensionData.boundUserContextIdOf(addon.id);
    if (bound < 0) {
      continue;
    }
    const originalId = lazy.ExtensionData.originalIdOf(addon.id);
    if (bound == userContextId) {
      have.add(originalId);
    } else {
      others.set(originalId, addon.name);
    }
  }
  return [...others]
    .filter(([originalId]) => !have.has(originalId))
    .map(([originalId, name]) => ({ originalId, name }));
}
