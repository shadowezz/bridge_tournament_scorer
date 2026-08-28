import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin file tracing to this project. Without it Next walks up to the nearest
  // lockfile, which on a dev machine can be the home directory.
  outputFileTracingRoot: path.join(import.meta.dirname, "."),
};

export default nextConfig;
