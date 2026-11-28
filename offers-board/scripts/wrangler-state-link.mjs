#!/usr/bin/env node
/**
 * Keeps the local Workers runtime state reachable on Windows.
 *
 * SQLite — and therefore the Workers runtime Miniflare starts — cannot open a
 * path of 260 characters or more ("unable to open database file:
 * SQLITE_CANTOPEN"). Wrangler keeps that state at
 * `<dir of wrangler config>/.wrangler/state`, and Miniflare's D1 store adds
 * `v3/d1/miniflare-D1DatabaseObject/<64 hex>.sqlite-wal`. In a deep workspace
 * that lands well past the limit, so every command that boots local workerd
 * dies: `sites_prepare_next` while seeding the local preview cache, and
 * `next dev` through `initOpenNextCloudflareForDev`.
 *
 * Windows canonicalises a path as it walks through a directory junction, so
 * pointing `.wrangler` at a short directory keeps the real path under the
 * limit while every tool keeps using its own unchanged path.
 *
 * No-op off Windows, and a no-op when the state already fits.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MAX_PATH = 260;
const STATE_TAIL = path.join("state", "v3", "d1", "miniflare-D1DatabaseObject");
const LONGEST_FILE = `${"0".repeat(64)}.sqlite-wal`;

if (process.platform === "win32") {
  const linkPath = path.join(process.cwd(), ".wrangler");
  const target = path.join(os.tmpdir(), "coeso-offers-board-wrangler");

  const tooDeep = (dir) => dir.length + 1 + LONGEST_FILE.length >= MAX_PATH;

  if (tooDeep(path.join(linkPath, STATE_TAIL))) {
    if (tooDeep(path.join(target, STATE_TAIL))) {
      console.warn(
        `[wrangler-state] ${target} is too deep to hold the state; leaving .wrangler as it is`,
      );
    } else {
      try {
        let existing = null;
        try {
          existing = fs.lstatSync(linkPath);
        } catch {
          existing = null;
        }

        const alreadyLinked =
          existing?.isSymbolicLink() &&
          path.resolve(fs.readlinkSync(linkPath)) === path.resolve(target);

        if (!alreadyLinked) {
          fs.mkdirSync(target, { recursive: true });
          if (existing?.isDirectory()) {
            fs.cpSync(linkPath, target, { recursive: true, force: true });
            fs.rmSync(linkPath, { recursive: true, force: true });
          } else if (existing) {
            fs.rmSync(linkPath, { force: true });
          }
          fs.symlinkSync(target, linkPath, "junction");
          console.log(
            `[wrangler-state] .wrangler now lives at ${target} (kept under the Windows path limit)`,
          );
        }
      } catch (error) {
        // Never break the build over this; report and let the tool surface its
        // own error if the state really cannot be opened.
        console.warn(
          `[wrangler-state] could not link .wrangler: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
