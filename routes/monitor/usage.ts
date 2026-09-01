import { Request, Response } from "express";
import { readFileSync } from "fs";
import path from "path";

import { PROJECT_ROOT } from "../../utils/constants.js";
import { store as bibrefs } from "../bibrefs/lib/store-init.js";

let version = "unknown";
try {
  const pkg = JSON.parse(
    readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf-8"),
  );
  if (typeof pkg.version === "string" && pkg.version) {
    version = pkg.version;
  }
} catch (error) {
  console.error("Failed to read version from package.json:", error);
}

export default function route(_req: Request, res: Response) {
  const { heapUsed, heapTotal, rss } = process.memoryUsage();
  res.set("Cache-Control", "no-store");
  res.json({
    name: "respec.org",
    version,
    uptime: process.uptime(),
    heapUsed,
    heapTotal,
    // pm2 restarts on rss, not heap.
    rss,
    bibrefs: {
      updatedAt: bibrefs.dataWrittenAt?.toISOString() ?? null,
      entries: bibrefs.entries,
      degraded: bibrefs.degraded,
    },
  });
}
