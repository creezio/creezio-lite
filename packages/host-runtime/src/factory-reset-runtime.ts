/**
 * Wipe factory-reset (sessions Electron + chemins).
 * Les cibles fichiers viennent de @creezio/platform-core.
 */

import fs from "node:fs";
import type { AppManifest } from "@creezio/brand-config";
import { appSessionPartition } from "@creezio/brand-config";
import {
  factoryResetPartitionPrefixes,
  factoryResetTargets,
  resolveUploadsDir,
  resolveUserDataDir,
  type PathsContext,
} from "@creezio/platform-core";

function rmQuiet(target: string): void {
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

function wipeFile(filePath: string): void {
  for (const suffix of ["", "-shm", "-wal", "-journal"]) {
    rmQuiet(filePath + suffix);
  }
}

export async function wipeLocalUserData(
  ctx: PathsContext,
  extras: string[] = [],
): Promise<{ wiped: string[] }> {
  const { session } = await import("electron");
  const wiped: string[] = [];
  const root = resolveUserDataDir(ctx);
  const partition = appSessionPartition(ctx.manifest);

  try {
    const appSes = session.fromPartition(partition);
    await appSes.clearStorageData();
    await appSes.clearCache();
    wiped.push(`partition:${partition}`);
  } catch {
    /* ignore */
  }

  const prefixes = factoryResetPartitionPrefixes(ctx.manifest);
  const partitionsDir = `${root}/Partitions`;
  try {
    if (fs.existsSync(partitionsDir)) {
      for (const name of fs.readdirSync(partitionsDir)) {
        if (!prefixes.some((p) => name === p || name.startsWith(p))) continue;
        try {
          const ses = session.fromPartition(`persist:${name}`);
          await ses.clearStorageData();
          await ses.clearCache();
          wiped.push(`partition:persist:${name}`);
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }

  for (const target of factoryResetTargets(ctx, extras)) {
    if (target.endsWith(".db") || target.includes("assistant_chats")) {
      wipeFile(target);
    } else {
      rmQuiet(target);
    }
    wiped.push(target);
  }

  try {
    fs.mkdirSync(resolveUploadsDir(ctx), { recursive: true });
  } catch {
    /* ignore */
  }

  return { wiped };
}

export function factoryResetSessionPartition(manifest: AppManifest): string {
  return appSessionPartition(manifest);
}
