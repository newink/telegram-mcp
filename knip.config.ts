import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: ["scripts/*.ts"],
  project: ["src/**/*.ts"],
  ignoreDependencies: [
    // @mtcute/dispatcher is a peer dependency of @mtcute/bun, required at runtime
    "@mtcute/dispatcher",
  ],
};

export default config;
