import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: ["scripts/*.ts", "src/*.test.ts"],
  project: ["src/**/*.ts"],
  ignoreBinaries: [
    // tsc comes from typescript which is listed as a peerDependency
    "tsc",
  ],
  ignoreDependencies: [
    // @mtcute/dispatcher is a peer dependency of @mtcute/bun, required at runtime
    "@mtcute/dispatcher",
  ],
};

export default config;
