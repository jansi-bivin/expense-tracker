import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    APP_VERSION: require("./package.json").version,
  },
};

export default nextConfig;
